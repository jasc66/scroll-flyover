import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../references/scrub-engine.js';

const draw = (rng, n) => Array.from({ length: n }, () => rng());

test('the same seed always produces the same stream', () => {
  assert.deepEqual(draw(makeRng(20260906), 50), draw(makeRng(20260906), 50));
});

test('different seeds produce different streams', () => {
  assert.notDeepEqual(draw(makeRng(1), 20), draw(makeRng(2), 20));
});

test('every value lands in [0, 1)', () => {
  const values = draw(makeRng(99), 5000);
  for (const v of values) {
    assert.ok(Number.isFinite(v), `${v} is not finite`);
    assert.ok(v >= 0 && v < 1, `${v} is outside [0, 1)`);
  }
});

test('the stream is not degenerate', () => {
  // A seeded RNG that has silently become a constant would still pass the
  // reproducibility QA in references/qa-reproducibility.mjs — identical reloads is
  // exactly what a constant gives you — so the "it actually varies" half has to be
  // checked here instead.
  const values = draw(makeRng(7), 2000);
  assert.ok(new Set(values).size > 1900, 'stream repeats itself far too often');

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(Math.abs(mean - 0.5) < 0.03, `mean ${mean} is not near 0.5`);

  const buckets = new Array(10).fill(0);
  for (const v of values) buckets[Math.floor(v * 10)]++;
  for (const [i, count] of buckets.entries()) {
    assert.ok(count > 120, `decile ${i} holds only ${count} of 2000 draws`);
  }
});

test('the default seed is 1', () => {
  assert.deepEqual(draw(makeRng(), 10), draw(makeRng(1), 10));
});

test('adjacent integer seeds do not correlate', () => {
  // mountScrollFlyover derives each scene's stream as `seed + i * 7919`. If nearby
  // seeds produced nearby first draws, every scene in a build would place its props
  // almost identically — the failure this spacing exists to prevent.
  const firstDraws = Array.from({ length: 12 }, (_, i) => makeRng(1 + i * 7919)());
  assert.equal(new Set(firstDraws).size, 12);
  const spread = Math.max(...firstDraws) - Math.min(...firstDraws);
  assert.ok(spread > 0.5, `first draws span only ${spread}`);
});

test('a negative or fractional seed still yields a usable stream', () => {
  for (const seed of [-1, -20260906, 3.7]) {
    const values = draw(makeRng(seed), 100);
    assert.ok(values.every((v) => v >= 0 && v < 1), `seed ${seed} produced out-of-range values`);
    assert.ok(new Set(values).size > 90, `seed ${seed} produced a degenerate stream`);
  }
});
