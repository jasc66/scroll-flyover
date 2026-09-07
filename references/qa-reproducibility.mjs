#!/usr/bin/env node
/**
 * qa-reproducibility.mjs
 * -----------------------------------------------------------------------
 * Automates the reproducibility check from SKILL.md Step 8: "Reload the page
 * three times and compare screenshots — they must be pixel-identical. Any
 * difference means a builder is using Math.random() instead of the seeded
 * rng." Also automates the two checks that make that one trustworthy:
 *
 *   1. Confirms a REAL WebGL2 scene rendered on every reload, not the
 *      static fallback silently standing in (see references/gotchas.md,
 *      "Reproducibility and QA" — a plain headless browser can have no real
 *      WebGL2 context and this whole check would "pass" by comparing the
 *      fallback card against itself).
 *   2. Fails loudly on any console/page error during load.
 *
 * Usage:
 *   node references/qa-reproducibility.mjs <url> [--out <dir>] [--reloads N]
 *
 * Example (serving a local build first):
 *   npx serve my-build -l 4173 &
 *   node references/qa-reproducibility.mjs http://localhost:4173
 *
 * Requires `playwright` (npm install -D playwright, or installed globally)
 * and a chromium browser (npx playwright install chromium).
 *
 * Exit code 0 = pass, 1 = fail (reason printed to stderr).
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2];
if (!url || url.startsWith('--')) {
  console.error('Usage: node qa-reproducibility.mjs <url> [--out <dir>] [--reloads N]');
  process.exit(1);
}

function flagValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const outDir = flagValue('--out', '.qa-reproducibility');
const reloads = parseInt(flagValue('--reloads', '3'), 10);

/**
 * Waits until consecutive screenshots stop changing, instead of a fixed
 * sleep. A fixed sleep is unreliable across machines/CI, and — for the very
 * first navigation, before the CDN-fetched Three.js module and shaders are
 * warm — rendering can be much slower than a cached reload. Only call this
 * on an already-warmed page (see the warm-up navigation in main() below):
 * on a cold load, a canvas that exists but hasn't painted its first frame
 * yet is trivially "stable" (unchanging black), which would make this lock
 * onto a false-positive empty frame instead of waiting for the real one.
 */
async function waitForStableFrame(page, { stableChecks = 3, intervalMs = 400, maxWaitMs = 20000 } = {}) {
  const start = Date.now();
  let last = null;
  let streak = 0;
  while (Date.now() - start < maxWaitMs) {
    const shot = await page.screenshot();
    if (last && shot.equals(last)) {
      streak++;
      if (streak >= stableChecks) return shot;
    } else {
      streak = 0;
    }
    last = shot;
    await page.waitForTimeout(intervalMs);
  }
  throw new Error(`frame never stabilized within ${maxWaitMs}ms`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Without these flags, headless Chromium can silently have no real WebGL2
  // context — see references/gotchas.md, "Reproducibility and QA".
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // ---- warm-up: cold load, fetches the CDN module + compiles shaders -------
  // Not one of the compared reloads (SKILL.md Step 8 means "reload an already-
  // loaded page", not "compare the first paint against later ones") — its
  // timing is irrelevant and its screenshot is discarded. This is also where
  // the source is captured for the Math.random grep below.
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  let canvasCount = await page.locator('canvas').count();
  if (canvasCount === 0) {
    console.error(
      `FAIL: no <canvas> found after the initial load — WebGL2 is unavailable with ` +
      `this browser/flag combo, so the page rendered the static fallback (a plain ` +
      `<div>, see scrub-engine.js's renderStaticFallback) instead of the real scene. ` +
      `This run isn't testing what it looks like it's testing.`
    );
    await browser.close();
    process.exit(1);
  }
  const sourceText = await page.content();
  try {
    await waitForStableFrame(page, { maxWaitMs: 30000 }); // longer budget: cold load
  } catch (e) {
    console.error(`FAIL: initial load never settled — ${e.message}.`);
    await browser.close();
    process.exit(1);
  }

  // ---- the actual compared reloads ------------------------------------------
  const shots = [];
  let fail = false;

  for (let i = 0; i < reloads; i++) {
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });

    canvasCount = await page.locator('canvas').count();
    if (canvasCount === 0) {
      console.error(`FAIL: no <canvas> found on reload ${i + 1} (see the same check above).`);
      fail = true;
      break;
    }

    let stableShot;
    try {
      stableShot = await waitForStableFrame(page);
    } catch (e) {
      console.error(
        `FAIL: reload ${i + 1} — ${e.message}. The scene may be animating even at rest ` +
        `(check for a tick() that ignores prefers-reduced-motion) or performance is too ` +
        `slow to settle.`
      );
      fail = true;
      break;
    }
    const file = path.join(outDir, `reload-${i + 1}.png`);
    await writeFile(file, stableShot);
    shots.push(file);
  }

  await browser.close();

  if (errors.length) {
    console.error(`FAIL: console/page errors during load:\n  ${errors.join('\n  ')}`);
    fail = true;
  }

  if (!fail) {
    const buffers = await Promise.all(shots.map((f) => readFile(f)));
    for (let i = 1; i < buffers.length; i++) {
      if (!buffers[i].equals(buffers[0])) {
        console.error(
          `FAIL: reload-${i + 1}.png differs from reload-1.png. This almost always means ` +
          `a scene builder called Math.random() instead of the seeded rng from its ` +
          `options argument (SKILL.md Step 2) — grep the build for "Math.random", should ` +
          `be zero hits. Compare the PNGs in ${outDir}/ to see what moved.`
        );
        fail = true;
      }
    }
  }

  // Convenience grep of the loaded document — catches inline <script> builders
  // (e.g. index-template.html) but NOT bundled/external JS files. Zero hits here
  // is not proof a bundled build is clean; always also grep the build's source
  // files directly, per SKILL.md Step 8. Comments are stripped first (naive
  // block/line-comment strip, not a real parser) so a gotcha explanation that
  // itself mentions "Math.random()" — like this file's own — doesn't self-report.
  const codeOnly = sourceText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const randomHits = (codeOnly.match(/Math\.random\(/g) || []).length;
  if (randomHits > 0) {
    console.error(`FAIL: found ${randomHits} occurrence(s) of "Math.random(" in the page's inline script.`);
    fail = true;
  }

  if (fail) process.exit(1);

  console.log(`PASS: ${reloads} reloads produced byte-identical screenshots, real WebGL2 scene confirmed, no inline Math.random.`);
  console.log(`Screenshots written to ${outDir}/ (also grep the build's own source files for "Math.random" — this only checked inline script).`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
