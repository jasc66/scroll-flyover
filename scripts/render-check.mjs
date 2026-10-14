#!/usr/bin/env node
// render-check.mjs — asserts renderAt() draws the frame it promises, and only that one.
//
// renderAt(progress, { time }) exists so a host can capture the flight frame by frame —
// rendering it to video, or screenshotting a scene at an exact point. That is only
// worth anything if the frame is (a) the same every time it is asked for, (b) the same
// frame a visitor scrolled to that point sees, and (c) not overwritten by the scroll
// loop a frame later. Each of those is a pixel comparison, which the DOM-free unit
// suite cannot make.
//
// Frames are read with canvas.toDataURL() in the same task that drew them: the
// renderer does not preserve its drawing buffer, so after the browser composites, the
// canvas reads back blank.
//
// Usage: npm run qa:render  (needs: npx playwright install chromium)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createStaticServer, listen } from './serve.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createStaticServer(REPO_ROOT);
const port = await listen(server, 0);
const url = `http://127.0.0.1:${port}/test/fixtures/render-at.html`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
// Warm-up load, discarded. The first page in a freshly launched SwiftShader browser
// loses its WebGL context about two seconds in and gets it back a second later —
// measured with the 1.7.0 engine as well, so it is the software GPU starting up, not
// renderAt. Inside that window the engine is correctly showing its fallback card and
// renderAt correctly returns false, which is not what this check is here to test.
// qa-reproducibility.mjs warms up the same way.
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => window.__sfReady === true, null, { timeout: 30000 });
const fallbackShown = await page.evaluate(() => !!document.querySelector('[data-sf-fallback]'));
if (fallbackShown) {
  console.error('FAIL: the fixture is showing the no-WebGL fallback after warm-up, so nothing below would test a real scene.');
  process.exit(1);
}

let failures = 0;
const check = (name, pass, detail) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

// Draw on request and read back in the same task.
const renderAt = (progress, opts) => page.evaluate(([p, o]) => {
  const drawn = window.__sfHandle.renderAt(p, o);
  return { drawn, png: document.querySelector('#world canvas').toDataURL('image/png') };
}, [progress, opts]);

// Read the frame the scroll loop paints. Two frames in, our callback runs right after
// the engine's in the same frame (rAF callbacks run in registration order), so the
// buffer still holds what the engine just drew.
const scrollFrame = () => page.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve(document.querySelector('#world canvas').toDataURL('image/png'));
  }));
}));

// The exact progress the engine computes for the current scroll position — same
// formula as currentScrollT(): the container is the spacer's height, and the
// scrollable span is that minus the viewport the spacer was built from.
const scrollProgress = () => page.evaluate(() => {
  const world = document.getElementById('world');
  return -world.getBoundingClientRect().top / (world.offsetHeight - window.innerHeight);
});

const scrollTo = async (fraction) => {
  await page.evaluate((f) => {
    const world = document.getElementById('world');
    window.scrollTo(0, world.offsetTop + Math.round(f * (world.offsetHeight - window.innerHeight)));
  }, fraction);
  await page.waitForTimeout(300);
};

console.log('\n=== 1) the same request draws the same frame ===');
const a1 = await renderAt(0.37);
const a2 = await renderAt(0.37);
check('renderAt reports that it drew', a1.drawn === true && a2.drawn === true);
check('two calls with the same progress are byte-identical', a1.png === a2.png);
const b = await renderAt(0.62);
check('a different progress draws a different frame', b.png !== a1.png);
// The swoop bank is smoothed over the last five frames, so without settling, the frame
// at 0.37 depended on which frame was drawn before it. A video captured in a different
// order — or seeked backwards in an editor — would then get different pixels.
await renderAt(0.95);
const afterLate = await renderAt(0.37);
await renderAt(0.02);
const afterEarly = await renderAt(0.37);
check('the frame does not depend on what was drawn before it',
  afterLate.png === a1.png && afterEarly.png === a1.png);

console.log('\n=== 2) time reaches the material animations, and only through the argument ===');
const t0 = await renderAt(0.1);
const t15 = await renderAt(0.1, { time: 1.5 });
const t15again = await renderAt(0.1, { time: 1.5 });
check('time 1.5 draws a different frame than the default', t15.png !== t0.png,
  'the fixture spins a box from its tick(elapsed)');
check('time 1.5 asked twice is byte-identical', t15.png === t15again.png);
const t0explicit = await renderAt(0.1, { time: 0 });
check('the default time is 0, not the clock', t0explicit.png === t0.png);

console.log('\n=== 3) the held frame survives the scroll loop ===');
// A held frame is one the engine stops redrawing, so its drawing buffer is cleared
// after the next composite and toDataURL can no longer see it. What the visitor sees
// is the composited page, so compare screenshots — the pin wrapper is sticky, so the
// canvas and overlay sit at the same place on screen at any scroll position.
await renderAt(0.2);
await page.waitForTimeout(300);
const heldShot = await page.screenshot();
await scrollTo(0.8);
const scrolledShot = await page.screenshot();
check('scrolling while held does not repaint the canvas', heldShot.equals(scrolledShot),
  'if the loop read the scroll position, the screen would now show the frame at 0.8');
const copyWhileHeld = await page.$$eval('.sf-section', (els) => els.map((el) => el.style.opacity));
check('the copy overlay follows the held frame, not the scroll position',
  copyWhileHeld[0] === '1' && copyWhileHeld[2] === '0', `opacities ${copyWhileHeld.join(',')}`);

console.log('\n=== 4) renderAt(p) is the frame a visitor scrolled to p sees ===');
for (const target of [0.25, 0.5, 0.83]) {
  await page.evaluate(() => window.__sfHandle.resume());
  await scrollTo(target);
  const p = await scrollProgress();
  const scrolled = await scrollFrame();
  const requested = await renderAt(p);
  check(`scroll-driven frame at ${p.toFixed(4)} equals renderAt(${p.toFixed(4)})`, scrolled === requested.png);
}

console.log('\n=== 5) resume() hands the camera back to the scroll position ===');
await renderAt(0.05);
await page.evaluate(() => window.__sfHandle.resume());
await scrollTo(0.9);
const resumed = await scrollFrame();
const atNinety = await renderAt(await scrollProgress());
check('after resume, the loop paints the scrolled-to frame', resumed === atNinety.png);
await page.evaluate(() => window.__sfHandle.resume());

console.log('\n=== 6) bad arguments are rejected by name ===');
const rejections = await page.evaluate(() => {
  const attempt = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
  const h = window.__sfHandle;
  return {
    string: attempt(() => h.renderAt('0.5')),
    nan: attempt(() => h.renderAt(NaN)),
    time: attempt(() => h.renderAt(0.5, { time: '1s' })),
  };
});
check('a string progress throws', /^scroll-flyover: renderAt\(progress\)/.test(rejections.string ?? ''), rejections.string);
check('NaN progress throws', /^scroll-flyover: renderAt\(progress\)/.test(rejections.nan ?? ''), rejections.nan);
check('a non-number time throws', /^scroll-flyover: renderAt\(progress, \{ time \}\)/.test(rejections.time ?? ''), rejections.time);

const outOfRange = await page.evaluate(() => {
  const h = window.__sfHandle;
  const read = () => document.querySelector('#world canvas').toDataURL('image/png');
  h.renderAt(1); const one = read();
  h.renderAt(7); const seven = read();
  h.renderAt(0); const zero = read();
  h.renderAt(-2); const minusTwo = read();
  return { high: one === seven, low: zero === minusTwo };
});
check('progress above 1 clamps to 1', outOfRange.high);
check('progress below 0 clamps to 0', outOfRange.low);

console.log('\n=== 7) after dispose, renderAt draws nothing and says so ===');
const afterDispose = await page.evaluate(() => {
  window.__sfHandle.dispose();
  return window.__sfHandle.renderAt(0.5);
});
check('renderAt returns false once disposed', afterDispose === false);

await browser.close();
server.close();

if (errors.length) {
  console.log(`\n  FAIL  console/page errors:\n    ${errors.join('\n    ')}`);
  failures++;
}
console.log(`\n${failures ? `${failures} check(s) failed` : 'all render checks passed'}`);
process.exit(failures ? 1 : 0);
