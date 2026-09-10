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

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
