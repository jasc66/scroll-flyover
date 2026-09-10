import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeLuminance, readableTextColor, makeRng } from '../references/scrub-engine.js';

const AA_NORMAL_TEXT = 4.5; // WCAG 2.2 SC 1.4.3

function contrastRatio(aHex, bHex) {
  const [hi, lo] = [relativeLuminance(aHex), relativeLuminance(bHex)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('luminance matches the WCAG reference values', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(relativeLuminance('#ffffff'), 1);
  // Mid grey #808080 is ~0.2159 by the sRGB formula, not 0.5 — the gamma curve is
  // the whole reason this cannot be eyeballed from the hex digits.
  assert.ok(Math.abs(relativeLuminance('#808080') - 0.2159) < 0.001);
});

test('shorthand #rgb is expanded, not misparsed', () => {
  // Regression: the shorthand form used to read its third channel from an empty
  // substring, producing NaN luminance. NaN fails every comparison, so
  // readableTextColor took the "dark background" branch and painted white text on
  // #eee — a 1.1:1 result from the function whose entire job is contrast.
  for (const [short, long] of [['#eee', '#eeeeee'], ['#000', '#000000'], ['#fff', '#ffffff'], ['#f80', '#ff8800']]) {
    assert.equal(relativeLuminance(short), relativeLuminance(long), `${short} != ${long}`);
  }
  assert.equal(readableTextColor('#eee'), '#000');
});

test('hex is accepted with or without #, in any case, with surrounding space', () => {
  const expected = relativeLuminance('#e8a33d');
  for (const variant of ['e8a33d', '#E8A33D', '  #e8a33d  ', '#E8a33D']) {
    assert.equal(relativeLuminance(variant), expected, `${JSON.stringify(variant)} parsed differently`);
  }
});

test('text color flips at the documented crossover', () => {
  assert.equal(readableTextColor('#000000'), '#fff');
  assert.equal(readableTextColor('#ffffff'), '#000');
  // The engine's own default accent is light enough to need dark text — the case the
  // original hardcoded white CTA label got wrong.
  assert.equal(readableTextColor('#e8a33d'), '#000');
  assert.equal(readableTextColor('#0e1c2b'), '#fff');
});

test('the chosen text color always clears WCAG AA against its background', () => {
  // This is the guarantee the function exists to make, so it is asserted over a wide
  // sweep rather than a handful of examples: the worst case sits in a narrow band
  // around the crossover that spot-checks walk straight past.
  const rng = makeRng(20260909);
  const samples = ['#000000', '#ffffff', '#e8a33d', '#808080', '#2b6777', '#52ab98', '#c8d8e4', '#f2f2f2'];
  for (let i = 0; i < 4000; i++) {
    samples.push('#' + Array.from({ length: 6 }, () => '0123456789abcdef'[Math.floor(rng() * 16)]).join(''));
  }
  // Plus a dense walk across the grey axis, which is where the crossover lives.
  for (let v = 0; v < 256; v++) {
    const h = v.toString(16).padStart(2, '0');
    samples.push(`#${h}${h}${h}`);
  }

  let worst = { ratio: Infinity, bg: null };
  for (const bg of samples) {
    const ratio = contrastRatio(bg, readableTextColor(bg));
    if (ratio < worst.ratio) worst = { ratio, bg };
  }
  assert.ok(
    worst.ratio >= AA_NORMAL_TEXT,
    `worst case ${worst.ratio.toFixed(3)}:1 on ${worst.bg} is below the ${AA_NORMAL_TEXT}:1 AA floor`,
  );
});
