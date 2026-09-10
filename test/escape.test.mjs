import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../references/scrub-engine.js';

test('the five HTML-significant characters are escaped', () => {
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('ampersands are escaped first, so nothing is double-encoded', () => {
  // Order matters: escaping < before & turns "<" into "&lt;" and then into
  // "&amp;lt;", which renders as literal "&lt;" on the page.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(escapeHtml('a & b < c'), 'a &amp; b &lt; c');
});

test('scene copy cannot break out of the attribute it is interpolated into', () => {
  // Scene copy reaches the overlay through a template literal, and an installed
  // library gets fed CMS content rather than hand-written strings.
  const payload = '"><img src=x onerror=alert(1)>';
  const escaped = escapeHtml(payload);
  assert.ok(!escaped.includes('<'), 'a raw < survived');
  assert.ok(!escaped.includes('>'), 'a raw > survived');
  assert.ok(!escaped.includes('"'), 'a raw " survived');
  assert.equal(escaped, '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
});

test('missing copy renders as empty, not as "undefined"', () => {
  // Every optional field (eyebrow, title, body, cta) goes through here, so the
  // nullish cases are the common ones, not the edge ones.
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(''), '');
});

test('non-string copy is coerced rather than thrown at', () => {
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(2026), '2026');
  assert.equal(escapeHtml(false), 'false');
});

test('ordinary copy passes through untouched', () => {
  const copy = 'Todo empieza aquí. Diseño, código y café — 100% procedural.';
  assert.equal(escapeHtml(copy), copy);
});
