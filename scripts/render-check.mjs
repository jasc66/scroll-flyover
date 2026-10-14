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
const renderAt = (progress, opts, target = page) => target.evaluate(([p, o]) => {
  const drawn = window.__sfHandle.renderAt(p, o);
  return { drawn, png: document.querySelector('#world canvas').toDataURL('image/png') };
}, [progress, opts]);

// Read the frame the scroll loop paints. Two frames in, our callback runs right after
// the engine's in the same frame (rAF callbacks run in registration order), so the
// buffer still holds what the engine just drew.
const scrollFrame = (target = page) => target.evaluate(() => new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve(document.querySelector('#world canvas').toDataURL('image/png'));
  }));
}));

// The frame a visitor who has stopped scrolling sees. The swoop bank averages five
// frames, so "stopped" means five frames at rest, not a fixed wait: on a CI runner
// SwiftShader can draw only a few frames a second, and 300ms was measured to fall
// short there (first CI run of 1.8.0 failed at 0.83 only). Read until the frame has
// held for longer than that window. Two agreeing reads were not enough: during 1.9.0
// a pair matched while the bank was still converging, repeatably, at one of sixteen
// positions — a frame that renderAt() at the same progress did not draw.
const SETTLED_READS = 6;
const settledScrollFrame = async (target = page, maxReads = 80) => {
  let last = await scrollFrame(target);
  let streak = 0;
  for (let i = 0; i < maxReads; i++) {
    const next = await scrollFrame(target);
    streak = next === last ? streak + 1 : 0;
    if (streak >= SETTLED_READS) return next;
    last = next;
  }
  throw new Error(`scroll-driven frame never settled in ${maxReads} reads`);
};

// The composited page once it stops changing — same idea, for the checks that have to
// read the screen rather than the canvas. If the loop were repainting from the scroll
// position, the page would settle on that frame instead, so waiting hides nothing.
const stableScreenshot = async (maxReads = 40) => {
  let last = await page.screenshot();
  for (let i = 0; i < maxReads; i++) {
    await page.waitForTimeout(150);
    const next = await page.screenshot();
    if (next.equals(last)) return next;
    last = next;
  }
  throw new Error(`page never settled in ${maxReads} screenshots`);
};

// The exact progress the engine computes for the current scroll position — the same
// arithmetic as currentScrollT(), in the same float order: the spacer is
// innerHeight * (scenes * 2.2) tall, and the scrollable span is that minus the
// viewport it was built from. Not world.offsetHeight: that rounds to whole pixels, and
// 844 * 6.6 = 5570.4 became 5570 — enough to move the camera 4e-5 along the path and
// fail a byte comparison at 390x844, while 900 * 6.6 = 5940 hid it at 1440x900.
const scrollProgress = (target = page) => target.evaluate(() => {
  const world = document.getElementById('world');
  const scenes = document.querySelectorAll('.sf-section').length;
  return -world.getBoundingClientRect().top / (window.innerHeight * (scenes * 2.2) - window.innerHeight);
});

const scrollTo = async (fraction, target = page) => {
  await target.evaluate((f) => {
    const world = document.getElementById('world');
    window.scrollTo(0, world.offsetTop + Math.round(f * (world.offsetHeight - window.innerHeight)));
  }, fraction);
  await target.waitForTimeout(300);
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
const heldShot = await stableScreenshot();
await scrollTo(0.8);
const scrolledShot = await stableScreenshot();
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
  const scrolled = await settledScrollFrame();
  const requested = await renderAt(p);
  check(`scroll-driven frame at ${p.toFixed(4)} equals renderAt(${p.toFixed(4)})`, scrolled === requested.png);
}
// And at a phone size, where the spacer's height is not a whole number of pixels —
// the case a rounded measurement got wrong until 1.9.0.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on('pageerror', (e) => errors.push(e.message));
phone.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await phone.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await phone.waitForFunction(() => window.__sfReady === true, null, { timeout: 30000 });
for (const target of [0.25, 0.5, 0.83]) {
  await phone.evaluate(() => window.__sfHandle.resume());
  await scrollTo(target, phone);
  const p = await scrollProgress(phone);
  const scrolled = await settledScrollFrame(phone);
  const requested = await renderAt(p, undefined, phone);
  check(`390x844: scroll-driven frame at ${p.toFixed(7)} equals renderAt(${p.toFixed(7)})`, scrolled === requested.png);
}
await phone.close();

console.log('\n=== 5) resume() hands the camera back to the scroll position ===');
await renderAt(0.05);
await page.evaluate(() => window.__sfHandle.resume());
await scrollTo(0.9);
const resumed = await settledScrollFrame();
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

console.log('\n=== 8) effects (1.9.0): sharp at rest, static grain, blur from velocity alone ===');
// Fresh pages in the same, already warmed-up browser. `a1` above is the no-effects
// frame at 0.37; the rest frames below are compared against it.
const openFixture = async (effects) => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(`${url}?effects=${encodeURIComponent(JSON.stringify(effects))}`, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForFunction(() => window.__sfReady === true, null, { timeout: 30000 });
  return p;
};
// Largest per-channel difference between two frames, decoded in the page.
const maxDelta = (target, a, b) => target.evaluate(async ([a, b]) => {
  const load = (src) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = src; });
  const pixels = (img) => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  };
  const [pa, pb] = (await Promise.all([load(a), load(b)])).map(pixels);
  let max = 0;
  for (let i = 0; i < pa.length; i++) if ((i & 3) !== 3) max = Math.max(max, Math.abs(pa[i] - pb[i]));
  return max;
}, [a, b]);

// Scrolls a stretch of the flight a little per frame, the way a wheel or a thumb does,
// so the loop sees the camera move between consecutive frames. A single scrollTo is a
// jump the loop may see only once, at which point there is no previous frame to
// measure a velocity from.
const scrollThrough = (target, from, to, steps = 12) => target.evaluate(([from, to, steps]) => new Promise((resolve) => {
  const world = document.getElementById('world');
  const span = world.offsetHeight - window.innerHeight;
  let i = 0;
  const step = () => {
    window.scrollTo(0, world.offsetTop + Math.round((from + (to - from) * (i / steps)) * span));
    if (i++ < steps) requestAnimationFrame(step); else resolve();
  };
  requestAnimationFrame(step);
}), [from, to, steps]);

const blurPage = await openFixture({ motionBlur: true });
const blurRest = await renderAt(0.37, undefined, blurPage);
check('motion blur alone: a renderAt frame is byte-identical to no effects', blurRest.png === a1.png,
  'renderAt draws a settled frame, and a camera at rest gets no blur pass at all');
const reported = await blurPage.evaluate(() => window.__sfFrames.at(-1));
check('renderAt reports velocity 0 to the effects', reported?.velocity === 0, JSON.stringify(reported));
await blurPage.evaluate(() => window.__sfHandle.resume());
await scrollThrough(blurPage, 0.3, 0.5);
const blurScrolled = await settledScrollFrame(blurPage);
const blurAtHalf = await renderAt(await scrollProgress(blurPage), undefined, blurPage);
check('motion blur alone: the frame a visitor stops on is the sharp renderAt frame', blurScrolled === blurAtHalf.png);
const velocities = await blurPage.evaluate(() => window.__sfFrames.map((f) => f.velocity));
check('scrolling reports a non-zero velocity while the camera moves', velocities.some((v) => v !== 0));
await blurPage.close();

const fxPage = await openFixture({ grain: true, motionBlur: true });
const grained = await renderAt(0.37, undefined, fxPage);
const grainedAgain = await renderAt(0.37, undefined, fxPage);
check('grain is static: the same request draws the same frame', grained.png === grainedAgain.png);
const grainDelta = await maxDelta(fxPage, grained.png, a1.png);
check('grain changes the frame by grain only — at most 8/255 per channel',
  grained.png !== a1.png && grainDelta <= 8, `largest channel difference ${grainDelta}`);

// A moving frame, forced onto renderAt so it is the same on every run and runner.
const moving = () => fxPage.evaluate(() => {
  window.__sfForceVelocity = 0.08;
  window.__sfHandle.renderAt(0.37);
  window.__sfForceVelocity = null;
  return document.querySelector('#world canvas').toDataURL('image/png');
});
const moved = await moving();
await renderAt(0.9, undefined, fxPage);
const movedAgain = await moving();
const blurDelta = await maxDelta(fxPage, moved, grained.png);
check('a moving frame is smeared, not the still one', blurDelta > 8, `largest channel difference ${blurDelta}`);
check('a moving frame is the same however it was reached', moved === movedAgain,
  'the blur reads velocity and nothing else — no history from earlier frames');

await fxPage.emulateMedia({ reducedMotion: 'reduce' });
await fxPage.reload({ waitUntil: 'networkidle', timeout: 60000 });
await fxPage.waitForFunction(() => window.__sfReady === true, null, { timeout: 30000 });
await scrollThrough(fxPage, 0.1, 0.7, 24);
const reducedVelocities = await fxPage.evaluate(() => window.__sfFrames.map((fr) => fr.velocity));
check('under prefers-reduced-motion the engine reports no velocity, so nothing smears',
  reducedVelocities.length > 0 && reducedVelocities.every((v) => v === 0), `${reducedVelocities.length} frames`);
const disposedFx = await fxPage.evaluate(() => { window.__sfHandle.dispose(); return window.__sfHandle.renderAt(0.5); });
check('dispose() with effects mounted tears down cleanly', disposedFx === false);
await fxPage.close();

await browser.close();
server.close();

if (errors.length) {
  console.log(`\n  FAIL  console/page errors:\n    ${errors.join('\n    ')}`);
  failures++;
}
console.log(`\n${failures ? `${failures} check(s) failed` : 'all render checks passed'}`);
process.exit(failures ? 1 : 0);
