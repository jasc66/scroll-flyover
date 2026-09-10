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

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
