#!/usr/bin/env node
/**
 * qa-accessibility.mjs
 * -----------------------------------------------------------------------
 * Automated regression check for the class of bug fixed in commit 63a171b:
 * copy-overlay text and CTA text hardcoded against an arbitrary per-build
 * scene background/accent, measuring as low as 1.13:1 contrast (WCAG AA
 * minimum is 4.5:1 for normal text, 3:1 for large/bold text). That fix was
 * found by a human looking at the gallery in a browser — this script
 * exists so the next occurrence of the same bug class fails CI instead of
 * waiting for someone to notice.
 *
 * Two approaches were tried and rejected before this one:
 *
 *   1. axe-core's `color-contrast` rule: on these pages it reports the
 *      rule as entirely "inapplicable" (zero nodes evaluated even after
 *      forcing overlay text to near-black on its own near-black scrim) —
 *      the full-viewport WebGL canvas plus scroll-driven transforms
 *      defeat axe's element-selection heuristic, so it would silently
 *      pass regardless of real contrast.
 *   2. Per-element: hide one element's text, screenshot just its box,
 *      compare to its getComputedStyle color. This produced a false
 *      failure on a CTA button (measured ~1.7:1 on a button that's
 *      actually a fine ~5.5:1 white-on-red) — `document.elementFromPoint`
 *      at the button's center returned the `<canvas>`, not the button,
 *      even though the button is genuinely visible: the canvas is
 *      stacked on top for hit-testing but has a transparent/translucent
 *      backdrop, so DOM stacking order isn't a reliable proxy for what's
 *      visually on top of what at a given pixel here.
 *
 * This version instead: screenshots the viewport once with all overlay
 * text visible, then again with every text element's color forced
 * transparent, and diffs the two images pixel-by-pixel per candidate
 * element's box. Pixels that changed are text-ink pixels; the single
 * pixel with the largest change (the purest ink sample, least diluted by
 * anti-aliased edge blending — averaging every changed pixel instead
 * systematically underestimates contrast for small/thin glyphs) is taken
 * as the true rendered foreground color. Every pixel in the second
 * screenshot is true rendered background — canvas, gradients, scrims,
 * blending, whatever actually painted there, with no assumption about DOM
 * stacking order. This is what a sighted user actually sees, so it can't
 * be fooled by this engine's canvas/overlay layering.
 *
 * Only checks the scene visible at initial scroll position (scrollTop 0).
 * Later scenes reuse the same engine code path (readableTextColor() /
 * scrim), so this still catches an engine-level regression, but it is not
 * a substitute for scrolling through a build manually before shipping.
 *
 * Usage:
 *   node scripts/qa-accessibility.mjs <url>
 *
 * Requires `playwright` and `pngjs` (npm install, see package.json
 * devDependencies) and a chromium browser (npx playwright install
 * chromium).
 *
 * Exit code 0 = pass, 1 = fail (reason printed to stderr).
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node qa-accessibility.mjs <url>');
  process.exit(1);
}

function relativeLuminance({ r, g, b }) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function isLargeText(fontSizePx, fontWeight) {
  const bold = fontWeight >= 700;
  return fontSizePx >= 24 || (bold && fontSizePx >= 18.66);
}

function pixelAt(png, x, y) {
  const idx = (png.width * y + x) << 2;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

/**
 * Same rationale as qa-reproducibility.mjs's waitForStableFrame: a headless
 * WebGL context can take a variable amount of time to actually paint (or can
 * render one transient black frame during init/context-loss recovery). Waiting
 * for consecutive identical screenshots avoids scoring a transient bad frame
 * instead of the real, settled scene.
 */
async function waitForStableFrame(page, { stableChecks = 3, intervalMs = 300, maxWaitMs = 20000 } = {}) {
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
  const browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  const canvasCount = await page.locator('canvas').count();
  if (canvasCount === 0) {
    console.error(
      'FAIL: no <canvas> found — WebGL2 is unavailable with this browser/flag combo, so ' +
      'the page rendered the static fallback instead of the real scene. A contrast check ' +
      "against the fallback wouldn't catch bugs that only exist against the real scene."
    );
    await browser.close();
    process.exit(1);
  }

  // The copy overlay is only shown once the visitor starts scrolling (the initial
  // scrollTop-0 state is a bare hero/intro with no text at all) — nudge forward so
  // there is something to check.
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 400);

  // Let scroll-driven copy/CTA overlays reach a resting state before scoring contrast,
  // and confirm the frame is a real settled render, not a transient black/init frame.
  try {
    await waitForStableFrame(page);
  } catch (e) {
    console.error(`FAIL: initial frame never stabilized — ${e.message}.`);
    await browser.close();
    process.exit(1);
  }

  const candidates = await page.evaluate(() => {
    const results = [];
    let counter = 0;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    document.querySelectorAll('body *').forEach((el) => {
      const hasOwnText = Array.from(el.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
      );
      if (!hasOwnText) return;

      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      // Scene panels are toggled by setting opacity on an ANCESTOR container
      // (all scenes' panels are stacked at the same screen position, only one
      // visible at a time) — getComputedStyle(el).opacity only ever reflects the
      // element's own opacity, not an ancestor's, so an element inside a hidden
      // (opacity: 0) panel still reports opacity '1' and would otherwise be
      // measured as if it were the panel that's actually on screen.
      let effectiveOpacity = 1;
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        effectiveOpacity *= parseFloat(getComputedStyle(node).opacity);
        if (effectiveOpacity < 0.05) break;
      }
      if (effectiveOpacity < 0.05) return;

      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewportW || rect.top >= viewportH) return;

      const id = `qa-contrast-${counter++}`;
      el.setAttribute('data-qa-id', id);
      results.push({
        id,
        text: el.textContent.trim().slice(0, 40),
        fontSize: parseFloat(style.fontSize),
        fontWeight: parseInt(style.fontWeight, 10) || 400,
        rect: {
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width: Math.round(Math.min(rect.right, viewportW) - Math.max(0, rect.left)),
          height: Math.round(Math.min(rect.bottom, viewportH) - Math.max(0, rect.top)),
        },
      });
    });
    return results;
  });

  const withText = PNG.sync.read(await page.screenshot());

  await page.evaluate(() => {
    document.querySelectorAll('[data-qa-id]').forEach((el) => {
      el.dataset.qaPrevColor = el.style.color;
      el.style.setProperty('color', 'transparent', 'important');
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('text-shadow', 'none', 'important');
      el.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    });
  });
  await page.waitForTimeout(300);
  const textHidden = PNG.sync.read(await page.screenshot());

  await page.evaluate(() => {
    document.querySelectorAll('[data-qa-id]').forEach((el) => {
      el.style.color = el.dataset.qaPrevColor || '';
      delete el.dataset.qaPrevColor;
    });
  });
  await browser.close();

  const CHANGE_THRESHOLD = 24; // combined per-channel delta to count a pixel as text ink

  const failures = [];
  const checked = [];

  for (const candidate of candidates) {
    const { x, y, width, height } = candidate.rect;
    if (width < 2 || height < 2) continue;

    let bgSum = { r: 0, g: 0, b: 0 };
    let bgCount = 0;
    // Track the single purest ink pixel (max delta from background) rather than
    // averaging every changed pixel: small/thin glyphs are mostly anti-aliased
    // edge pixels partially blended with the background, and averaging them in
    // dilutes the sample toward the background, systematically underestimating
    // contrast for small text (verified: a fully-opaque white 12.8px tag label
    // measured ~4.2:1 with averaging, i.e. visibly wrong for solid white text).
    let purestFg = null;
    let maxDelta = -1;

    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= textHidden.width || py >= textHidden.height) continue;

        const bgPixel = pixelAt(textHidden, px, py);
        bgSum.r += bgPixel.r; bgSum.g += bgPixel.g; bgSum.b += bgPixel.b;
        bgCount++;

        const fgPixel = pixelAt(withText, px, py);
        const delta = Math.abs(fgPixel.r - bgPixel.r) + Math.abs(fgPixel.g - bgPixel.g) + Math.abs(fgPixel.b - bgPixel.b);
        if (delta > CHANGE_THRESHOLD && delta > maxDelta) {
          maxDelta = delta;
          purestFg = fgPixel;
        }
      }
    }

    if (bgCount === 0 || !purestFg) continue; // no detectable ink in this box — not real rendered text here
    checked.push(candidate);

    const bg = { r: bgSum.r / bgCount, g: bgSum.g / bgCount, b: bgSum.b / bgCount };
    const fg = purestFg;

    const ratio = contrastRatio(fg, bg);
    const required = isLargeText(candidate.fontSize, candidate.fontWeight) ? 3.0 : 4.5;

    if (ratio < required) {
      failures.push({ ...candidate, ratio, required });
    }
  }

  if (checked.length === 0) {
    console.error('FAIL: no text-ink pixels detected anywhere — the check found nothing to measure.');
    process.exit(1);
  }

  if (failures.length === 0) {
    console.log(`PASS: ${checked.length} text element(s) checked, all meet WCAG AA contrast.`);
    return;
  }

  console.error(`FAIL: ${failures.length} of ${checked.length} text element(s) fail WCAG AA contrast:`);
  for (const f of failures) {
    console.error(
      `  - "${f.text}" — ratio ${f.ratio.toFixed(2)}:1, needs ${f.required}:1 ` +
      `(fontSize ${f.fontSize}px, weight ${f.fontWeight})`
    );
  }
  process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
