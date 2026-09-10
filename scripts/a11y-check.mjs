#!/usr/bin/env node
// a11y-check.mjs — asserts the overlay stays operable by keyboard and assistive tech.
//
// These are DOM behaviours, so the DOM-free unit suite cannot see them: whether a
// hidden panel is still focusable, whether the rail announces which scene is current,
// whether a button defaults to type="submit" and silently posts a host page form.
// All three shipped broken in 1.5.0 and were found by an accessibility audit, not by
// a test — this file is what stops them coming back.
//
// Usage: npm run qa:a11y  (needs: npx playwright install chromium)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createStaticServer, listen } from './serve.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createStaticServer(REPO_ROOT);
const port = await listen(server, 0);
const url = `http://127.0.0.1:${port}/references/index-template.html`;

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

let failures = 0;
const check = (name, pass, detail) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

console.log('\n=== 7) the live region exists, and says nothing on load ===');
// aria-current tells someone who tabbed to the rail. Scrolling is how the flight is
// actually driven, and a visitor doing that from the document crosses every scene
// with nothing announced — WCAG 4.1.3. The region has to be in the DOM from mount
// (a live region added and filled in one go is not reliably spoken) and empty until
// the visitor has actually moved: announcing the landing scene talks over page load.
const liveRegion = await page.evaluate(() => {
  const el = document.querySelector('.sf-overlay [aria-live]');
  if (!el) return null;
  return {
    politeness: el.getAttribute('aria-live'),
    atomic: el.getAttribute('aria-atomic'),
    text: el.textContent.trim(),
    muted: !!el.closest('[inert]') || !!el.closest('[aria-hidden="true"]'),
    painted: el.getBoundingClientRect().width > 1 || el.getBoundingClientRect().height > 1,
  };
});
console.log(`  ${JSON.stringify(liveRegion)}`);
check('the overlay carries a live region', liveRegion !== null);
check('it is polite, not assertive', liveRegion?.politeness === 'polite',
  'a scene change must not interrupt what is being read');
check('it is atomic, so the whole line is read as one message', liveRegion?.atomic === 'true');
// A live region inside either is silently muted — the .sf-section panels are both.
check('it is in neither an inert nor an aria-hidden subtree', liveRegion?.muted === false);
check('it is visually hidden, not painted', liveRegion?.painted === false);
check('it is silent on load', liveRegion?.text === '', `announced: ${JSON.stringify(liveRegion?.text)}`);

console.log('\n=== 3) type="button" on every button the engine creates ===');
const buttonTypes = await page.$$eval('.sf-overlay button', (els) =>
  els.map((b) => ({ type: b.type, label: b.getAttribute('aria-label') || b.textContent.trim() })));
console.log(`  found ${buttonTypes.length} buttons`);
check('every button is type="button"', buttonTypes.every((b) => b.type === 'button'),
  buttonTypes.map((b) => `${b.label}=${b.type}`).join(', '));

console.log('\n=== 3b) a host <form> around the mount point is not submitted by a rail tap ===');
const submitted = await page.evaluate(async () => {
  const host = document.getElementById('world');
  const form = document.createElement('form');
  host.parentNode.insertBefore(form, host);
  form.appendChild(host);
  let didSubmit = false;
  form.addEventListener('submit', (e) => { didSubmit = true; e.preventDefault(); });
  document.querySelector('.sf-overlay button[aria-label]').click();
  await new Promise((r) => setTimeout(r, 200));
  // put it back so later checks see the original tree
  form.parentNode.insertBefore(host, form);
  form.remove();
  return didSubmit;
});
check('rail tap inside a <form> does not submit it', submitted === false, `submit fired: ${submitted}`);

console.log('\n=== 1) inactive panels are inert (focus, a11y tree, hit-testing) ===');
const panels = await page.$$eval('.sf-section', (els) =>
  els.map((el) => ({ opacity: el.style.opacity, inert: el.inert })));
panels.forEach((p, i) => console.log(`  panel ${i}: opacity=${p.opacity} inert=${p.inert}`));
check('every hidden panel is inert', panels.every((p) => (p.opacity === '0') === p.inert),
  'inert must track hidden-ness exactly');

const reachable = await page.$$eval('.sf-section button', (els) =>
  els.filter((b) => !b.closest('[inert]')).length);
const visiblePanels = panels.filter((p) => p.opacity === '1').length;
check('no CTA inside a hidden panel is reachable', reachable <= visiblePanels,
  `${reachable} reachable CTA(s), ${visiblePanels} visible panel(s)`);

console.log('\n=== 1b) keyboard tab order holds no invisible controls ===');
await page.evaluate(() => document.body.focus());
const tabbed = [];
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    const panel = el.closest('.sf-section');
    return {
      tag: el.tagName,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
      hiddenPanel: panel ? panel.style.opacity === '0' : false,
      offscreen: r.width === 0 || r.height === 0,
    };
  });
  if (info) tabbed.push(info);
}
const phantom = tabbed.filter((t) => t.hiddenPanel);
tabbed.slice(0, 8).forEach((t) => console.log(`  ${t.tag} "${t.label}" hiddenPanel=${t.hiddenPanel}`));
check('no focus landed inside a hidden panel', phantom.length === 0, `${phantom.length} phantom stop(s)`);

console.log('\n=== 2) aria-current marks the active scene on the rail ===');
const railState = await page.$$eval('.sf-overlay button[aria-label]', (els) =>
  els.map((b) => b.getAttribute('aria-current')));
console.log(`  aria-current values: [${railState.join(', ')}]`);
check('exactly one rail button is aria-current="true"',
  railState.filter((v) => v === 'true').length === 1);
check('every rail button carries the attribute', railState.every((v) => v !== null));

console.log('\n=== 2b) aria-current follows the visitor down the page ===');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.8));
await page.waitForTimeout(1200);
const railAfter = await page.$$eval('.sf-overlay button[aria-label]', (els) =>
  els.map((b) => b.getAttribute('aria-current')));
console.log(`  after scrolling to 80%: [${railAfter.join(', ')}]`);
check('the active rail button moved', railAfter.join() !== railState.join(),
  `${railState.join()} -> ${railAfter.join()}`);

console.log('\n=== 7b) ...and the live region says so once the scrolling settles ===');
// The scroll above has already outlasted the settle window, so the message is due.
const announced = await page.evaluate(() =>
  document.querySelector('.sf-overlay [aria-live]').textContent.trim());
const activeIndex = railAfter.indexOf('true') + 1;
console.log(`  announced: ${JSON.stringify(announced)} (rail says scene ${activeIndex} of ${railAfter.length})`);
check('a scene change reaches the live region', announced !== '');
// The position is the part that orients — a title alone does not say how far in it is.
check('the announcement carries the position, not just a title',
  announced.includes(String(activeIndex)) && announced.includes(String(railAfter.length)));
check('the announcement agrees with the rail',
  announced.includes(String(activeIndex)), `rail is at ${activeIndex}`);

// From here on the second scene is the one on screen — it is the one carrying a CTA.
await page.evaluate(() => {
  const c = document.getElementById('world');
  const total = c.offsetHeight - window.innerHeight;
  window.scrollTo(0, c.offsetTop + 0.75 * total); // dwell centre of scene 2 of 2
});
await page.waitForTimeout(1200);

console.log('\n=== 4) the CTA has somewhere to go, and is the element that goes there ===');
const cta = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('.sf-section')].find((p) => p.style.opacity === '1');
  const el = panel && panel.querySelector('a, button');
  if (!el) return null;
  return {
    tag: el.tagName, href: el.getAttribute('href'), text: el.textContent.trim(),
    ariaLabel: el.getAttribute('aria-label'), tabIndex: el.tabIndex,
    inAriaHidden: !!el.closest('[aria-hidden="true"]'),
    height: Math.round(el.getBoundingClientRect().height),
    width: Math.round(el.getBoundingClientRect().width),
  };
});
console.log(`  ${JSON.stringify(cta)}`);
check('the visible scene renders a CTA', cta !== null);
// Before 1.6.0 this was a <button> with no handler and no href: it looked like the
// page's primary action and did nothing at all when pressed.
check('a CTA with an href is an <a>, not a <button>', cta?.tag === 'A' && !!cta.href, `${cta?.tag} href=${cta?.href}`);
check('the CTA is NOT inside an aria-hidden subtree', cta?.inAriaHidden === false,
  'aria-hidden over a focusable control is a tab stop assistive tech cannot name');
check('the CTA is in the tab order', cta?.tabIndex === 0);
// The copy around it is aria-hidden, so the label alone would reach a screen reader
// as "Empezar", with nothing to say what it starts.
check('the accessible name names the scene', !!cta?.ariaLabel && cta.ariaLabel !== cta.text, cta?.ariaLabel);
// WCAG 2.5.3: speaking the visible label must still activate the control.
check('the accessible name begins with the visible label (WCAG 2.5.3)',
  !!cta?.ariaLabel && cta.ariaLabel.startsWith(cta.text));
// WCAG 2.5.8: a <button> is border-box and an <a> is not, so an unstated box-sizing
// made the same 44px rule produce a 44px button and a 60px link.
check('the CTA is at least a 44x44 tap target', (cta?.height ?? 0) >= 44 && (cta?.width ?? 0) >= 44,
  `${cta?.width}x${cta?.height}`);

console.log('\n=== 5) one heading per scene in the accessibility tree, not two ===');
// The decision this asserts: the linear block is the content, the overlay is the
// presentation. Heading navigation is why — it is how a screen reader user moves
// through a long page, and only the block can offer headings in reading order
// without scrubbing a 3D flight to reach them. Two exposed surfaces meant every
// scene was announced twice and the heading list had two competing copies of it.
const headings = await page.evaluate(() => {
  const all = [...document.querySelectorAll('h2')];
  const exposed = all.filter((h) => !h.closest('[aria-hidden="true"]') && !h.closest('[inert]'));
  return {
    total: all.length,
    exposed: exposed.map((h) => ({ text: h.textContent.trim(), inBlock: !!h.closest('[data-sf-seo]') })),
  };
});
const sceneCount = await page.$$eval('.sf-section', (els) => els.length);
console.log(`  ${headings.total} <h2> in the DOM, ${headings.exposed.length} exposed: ` +
  headings.exposed.map((h) => `"${h.text}"${h.inBlock ? ' [block]' : ' [overlay]'}`).join(', '));
check('exactly one exposed heading per scene', headings.exposed.length === sceneCount,
  `${headings.exposed.length} exposed for ${sceneCount} scenes`);
check('every exposed heading comes from the linear content block',
  headings.exposed.every((h) => h.inBlock));
check('no scene title is exposed twice',
  new Set(headings.exposed.map((h) => h.text)).size === headings.exposed.length);

console.log('\n=== 5b) the same, read off Chromium\'s real accessibility tree ===');
// Not the DOM heuristic above: the tree the browser actually hands assistive tech.
// Read over CDP rather than through Playwright's own snapshot: page.accessibility was
// removed in Playwright 1.5x, and Accessibility.getFullAXTree is the browser's real
// tree either way — including the `ignored` flag that says what aria-hidden removed.
const cdp = await page.context().newCDPSession(page);
await cdp.send('Accessibility.enable');
const { nodes: axNodes } = await cdp.send('Accessibility.getFullAXTree');
const axHeadings = axNodes
  .filter((n) => n.role?.value === 'heading' && n.ignored !== true)
  .map((n) => n.name?.value ?? '');
console.log(`  headings in the a11y tree: ${JSON.stringify(axHeadings)}`);
check('the a11y tree holds one heading per scene', axHeadings.length === sceneCount,
  `${axHeadings.length} heading(s) for ${sceneCount} scenes`);
check('no heading is announced twice',
  new Set(axHeadings).size === axHeadings.length, axHeadings.join(' | '));

console.log('\n=== 6) the content block is read before the visual layer ===');
const order = await page.evaluate(() => {
  const block = document.querySelector('[data-sf-seo]');
  const pin = document.querySelector('.sf-pin');
  if (!block || !pin) return null;
  return {
    blockFirst: !!(block.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING),
    blockSections: block.querySelectorAll('section').length,
    blockHasControls: block.querySelectorAll('a, button, input, [tabindex]').length,
  };
});
console.log(`  ${JSON.stringify(order)}`);
check('the linear block precedes the canvas in the DOM', order?.blockFirst === true);
check('the block carries one section per scene', order?.blockSections === sceneCount);
// A control in a 1px clipped block is a tab stop with nothing on screen to show it
// has focus. The rail is how assistive tech reaches a scene's button instead.
check('the block holds no focusable controls', order?.blockHasControls === 0);

console.log('\n=== 6b) the page shell the template models (SKILL.md Step 6) ===');
// Not the engine's doing — it is the host page's, which is exactly why it is asserted
// here: the template is the markup builders copy, so a landmark deleted from it
// propagates into every build made from it.
const shell = await page.evaluate(() => {
  const mains = document.querySelectorAll('main');
  return { count: mains.length, wrapsMount: !!document.getElementById('world')?.closest('main') };
});
console.log(`  ${JSON.stringify(shell)}`);
check('the page has exactly one <main>', shell.count === 1);
check('the mount container sits inside it', shell.wrapsMount === true);

console.log('\n=== 8) every control the engine creates shows a focus ring on the scene ===');
// What sits behind these controls is a live WebGL scene, free to be near-white in one
// frame and near-black in the next, so the browser's own thin outline is not reliably
// visible over it (WCAG 2.4.7 / 1.4.11). The engine paints its own two-tone ring — and
// it has to be :focus-visible, not :focus, or a mouse tap on a rail dot rings it too.
await page.evaluate(() => document.body.focus());
const rings = [];
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('Tab');
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || !el.classList.contains('sf-focusable')) return null;
    const s = getComputedStyle(el);
    return {
      tag: el.tagName,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: s.outlineStyle,
      outlineWidth: parseFloat(s.outlineWidth),
      boxShadow: s.boxShadow,
    };
  });
  if (info) rings.push(info);
}
rings.slice(0, 4).forEach((r) => console.log(
  `  ${r.tag} "${r.label}" outline=${r.outlineWidth}px ${r.outlineStyle} focus-visible=${r.focusVisible}`));
check('keyboard focus reached the engine\'s controls', rings.length > 0, `${rings.length} control(s)`);
check('every one matches :focus-visible when tabbed to', rings.every((r) => r.focusVisible));
// A real CSS outline, not a ring drawn with box-shadow alone: outline is what survives
// forced-colors mode, where box-shadow is dropped entirely.
check('every one paints a real outline', rings.every((r) => r.outlineStyle === 'solid' && r.outlineWidth >= 2),
  rings.map((r) => `${r.outlineWidth}px ${r.outlineStyle}`).join(', '));
// The second, darker ring is what keeps the light one visible over a light scene.
check('every one carries the contrasting outer ring',
  rings.every((r) => r.boxShadow && r.boxShadow !== 'none'));

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
