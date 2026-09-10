import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDwellEasing, nearestDwellCenter } from '../references/scrub-engine.js';

const sweep = (n = 1001) => Array.from({ length: n }, (_, i) => i / (n - 1));

test('the flight starts at the start and ends at the end', () => {
  for (const sceneCount of [1, 2, 3, 6, 12]) {
    const ease = buildDwellEasing(sceneCount);
    assert.equal(ease(0), 0, `${sceneCount} scenes: ease(0)`);
    assert.ok(Math.abs(ease(1) - 1) < 1e-12, `${sceneCount} scenes: ease(1) was ${ease(1)}`);
  }
});

test('easing is monotonic and stays inside [0, 1]', () => {
  // Non-monotonicity would show up as the camera briefly flying backwards mid-scroll,
  // which is the kind of thing a screenshot at one scroll position cannot catch.
  for (const sceneCount of [1, 2, 3, 6, 12]) {
    for (const dwellWeight of [0.5, 1, 2.5, 8]) {
      const ease = buildDwellEasing(sceneCount, dwellWeight);
      let previous = -Infinity;
      for (const t of sweep()) {
        const eased = ease(t);
        assert.ok(Number.isFinite(eased), `${sceneCount}/${dwellWeight}: ease(${t}) = ${eased}`);
        assert.ok(eased >= -1e-12 && eased <= 1 + 1e-12, `${sceneCount}/${dwellWeight}: ease(${t}) = ${eased}`);
        assert.ok(eased >= previous - 1e-12, `${sceneCount}/${dwellWeight}: went backwards at t=${t}`);
        previous = eased;
      }
    }
  }
});

test('dwellWeight 1 is the identity', () => {
  // Equal shares for every segment must collapse to "no remap at all" — if it does
  // not, the weighting is being applied to the wrong side of the mapping.
  for (const sceneCount of [1, 2, 5, 9]) {
    const ease = buildDwellEasing(sceneCount, 1);
    for (const t of sweep(201)) {
      assert.ok(Math.abs(ease(t) - t) < 1e-12, `${sceneCount} scenes: ease(${t}) = ${ease(t)}`);
    }
  }
});

test('there is no jump at a segment boundary', () => {
  // The remap is piecewise-linear; a discontinuity here is a visible camera teleport
  // at the exact moment one scene hands over to the next.
  const sceneCount = 5;
  const segments = sceneCount * 2 - 1;
  const ease = buildDwellEasing(sceneCount, 2.5);
  for (let seg = 1; seg < segments; seg++) {
    const boundary = seg / segments;
    const before = ease(boundary - 1e-9);
    const after = ease(boundary + 1e-9);
    assert.ok(Math.abs(after - before) < 1e-6, `jump of ${after - before} at boundary ${seg}`);
  }
});

test('a single scene needs no remapping at all', () => {
  const ease = buildDwellEasing(1, 2.5);
  for (const t of sweep(101)) {
    assert.ok(Math.abs(ease(t) - t) < 1e-12, `ease(${t}) = ${ease(t)}`);
  }
});

test('dwellWeight weights the curve axis, not the scroll axis', () => {
  // The direction of this mapping is the whole behaviour of the knob, and it is the
  // opposite of what the name suggests: scroll is divided uniformly, the curve is
  // divided by weight, so a scene segment gets an equal share of scroll and a 2.5x
  // share of path. Measured on the default layout, that leaves the camera moving
  // ~2.1-2.3x faster over a scene than between two — the pause it buys is in the
  // handover. camera-path.md §5 carries the measurements.
  //
  // Pinned on purpose. Every shipped build's pacing was tuned by eye against this, so
  // flipping the weighting to the scroll axis is a decision about other people's live
  // sites, not a cleanup. This test is what makes that flip impossible to do by
  // accident.
  const sceneCount = 4;
  const segments = sceneCount * 2 - 1;
  const dwellWeight = 2.5;
  const ease = buildDwellEasing(sceneCount, dwellWeight);

  const spans = [];
  for (let seg = 0; seg < segments; seg++) {
    spans.push(ease((seg + 1) / segments) - ease(seg / segments));
  }
  const sceneSpans = spans.filter((_, i) => i % 2 === 0);
  const transitSpans = spans.filter((_, i) => i % 2 === 1);

  for (const sceneSpan of sceneSpans) {
    for (const transitSpan of transitSpans) {
      assert.ok(
        Math.abs(sceneSpan / transitSpan - dwellWeight) < 1e-9,
        `expected a ${dwellWeight}x ratio, got ${sceneSpan / transitSpan}`,
      );
    }
  }
  assert.ok(Math.abs(spans.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test('nearestDwellCenter snaps to a scene centre', () => {
  // The reduced-motion path replaces the flight with a jump to the nearest resting
  // point, so it must land exactly on a centre and never between two.
  const sceneCount = 4;
  const centres = [0.125, 0.375, 0.625, 0.875];
  for (const [i, centre] of centres.entries()) {
    assert.equal(nearestDwellCenter(sceneCount, centre), centre, `centre ${i}`);
  }
  assert.equal(nearestDwellCenter(sceneCount, 0), 0.125);
  assert.equal(nearestDwellCenter(sceneCount, 1), 0.875);
  assert.equal(nearestDwellCenter(sceneCount, 0.3), 0.375);
  assert.equal(nearestDwellCenter(sceneCount, 0.51), 0.625);

  for (const t of sweep(501)) {
    assert.ok(centres.includes(nearestDwellCenter(sceneCount, t)), `t=${t} landed off-centre`);
  }
});

test('dwell centres never collide with their neighbours', () => {
  // updateCopyVisibility fades a scene's copy in over a window of
  // (0.5 / sceneCount) * 0.9 around each centre. Adjacent windows touching is the
  // "two headlines stacked on top of each other" bug from production-lessons.md, so
  // the spacing that prevents it is asserted here rather than re-discovered by eye.
  for (const sceneCount of [2, 3, 5, 9]) {
    const centres = Array.from({ length: sceneCount }, (_, i) => (i + 0.5) / sceneCount);
    const halfWidth = (0.5 / sceneCount) * 0.9;
    for (let i = 1; i < centres.length; i++) {
      const gap = (centres[i] - halfWidth) - (centres[i - 1] + halfWidth);
      assert.ok(gap > 0, `${sceneCount} scenes: windows ${i - 1} and ${i} overlap by ${-gap}`);
    }
  }
});
