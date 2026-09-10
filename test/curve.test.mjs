import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { layoutAnchors, sceneControlPoints, buildWorldCurve } from '../references/scrub-engine.js';

const SCENE_RADIUS = 6;

test('layoutAnchors places one anchor per scene, evenly spaced', () => {
  for (const count of [1, 2, 5, 9]) {
    const anchors = layoutAnchors(count);
    assert.equal(anchors.length, count);
    anchors.forEach((anchor, i) => {
      assert.ok(anchor.isVector3, `anchor ${i} is not a Vector3`);
      assert.equal(anchor.x, i * 24, `anchor ${i} x`);
      assert.ok(Number.isFinite(anchor.y) && Number.isFinite(anchor.z), `anchor ${i} has a non-finite component`);
    });
  }
});

test('layoutAnchors arcs up and back down', () => {
  const anchors = layoutAnchors(5);
  const heights = anchors.map((a) => a.y);
  assert.ok(Math.abs(heights[0]) < 1e-12, 'first anchor should sit at ground height');
  assert.ok(Math.abs(heights.at(-1)) < 1e-12, 'last anchor should sit at ground height');
  assert.ok(Math.max(...heights) > 3.9, 'the arc never reaches its peak');
  assert.equal(Math.max(...heights), heights[2], 'the peak should be the middle scene');
});

test('a single-scene layout does not divide by zero', () => {
  const [only] = layoutAnchors(1);
  assert.ok(Number.isFinite(only.x) && Number.isFinite(only.y) && Number.isFinite(only.z));
});

test('layoutAnchors honours a custom spacing', () => {
  const anchors = layoutAnchors(4, 40);
  assert.deepEqual(anchors.map((a) => a.x), [0, 40, 80, 120]);
});

test('control points sit behind, at, and ahead of the anchor', () => {
  // The sign trap: approach must be BEHIND the anchor along the direction of travel
  // and depart AHEAD of it. Flip one and the camera arrives at each scene already
  // facing away from it — a bug that looks like "the scenes are in the wrong order"
  // and is invisible in any single screenshot.
  const anchor = new THREE.Vector3(10, 2, -3);
  const forward = new THREE.Vector3(1, 0, 0);
  const [approach, dive, depart] = sceneControlPoints(anchor, forward, SCENE_RADIUS);

  const along = (p) => p.clone().sub(anchor).dot(forward);
  assert.ok(along(approach) < 0, `approach is not behind the anchor (${along(approach)})`);
  assert.ok(Math.abs(along(dive)) < 1e-12, `dive is not level with the anchor (${along(dive)})`);
  assert.ok(along(depart) > 0, `depart is not ahead of the anchor (${along(depart)})`);
  assert.ok(along(approach) < along(dive) && along(dive) < along(depart), 'control points are out of order');

  // All three stay above the anchor, and the dive point is the lowest of them — that
  // is what makes the camera swoop down into the scene rather than through its floor.
  assert.ok(approach.y > anchor.y && dive.y > anchor.y && depart.y > anchor.y);
  assert.ok(dive.y < approach.y && dive.y < depart.y, 'the dive point should be the lowest of the three');
});

test('control points scale with the scene radius', () => {
  const anchor = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const small = sceneControlPoints(anchor, forward, 1);
  const large = sceneControlPoints(anchor, forward, 10);
  for (let i = 0; i < 3; i++) {
    assert.ok(
      large[i].length() > small[i].length() * 9,
      `control point ${i} did not scale with the radius`,
    );
  }
});

test('buildWorldCurve emits three control points per scene', () => {
  for (const count of [1, 2, 4, 8]) {
    const curve = buildWorldCurve(layoutAnchors(count), SCENE_RADIUS);
    assert.equal(curve.points.length, count * 3, `${count} scenes`);
    assert.equal(curve.closed, false);
  }
});

test('the flight never doubles back on itself', () => {
  // Sampled by arc length, the same way updateCameraOnCurve reads it. A dip in x here
  // means the camera reverses mid-flight while the scroll bar keeps going forward.
  const curve = buildWorldCurve(layoutAnchors(6), SCENE_RADIUS);
  let previousX = -Infinity;
  for (let i = 0; i <= 400; i++) {
    const point = curve.getPointAt(i / 400);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), `non-finite point at ${i}`);
    assert.ok(point.x >= previousX - 1e-6, `curve reversed at t=${i / 400} (${point.x} after ${previousX})`);
    previousX = point.x;
  }
});

test('the curve visits every scene it was given', () => {
  const anchors = layoutAnchors(5);
  const curve = buildWorldCurve(anchors, SCENE_RADIUS);
  const samples = Array.from({ length: 801 }, (_, i) => curve.getPointAt(i / 800));
  for (const [i, anchor] of anchors.entries()) {
    const closest = Math.min(...samples.map((p) => p.distanceTo(anchor)));
    assert.ok(closest < SCENE_RADIUS * 1.5, `scene ${i} is ${closest.toFixed(2)} away from the flight path`);
  }
});

test('tangents stay well-defined along the whole flight', () => {
  // createBanking differences two tangents to estimate curvature; a zero-length or
  // non-finite tangent would put NaN into camera.up and blank the render.
  const curve = buildWorldCurve(layoutAnchors(4), SCENE_RADIUS);
  for (let i = 0; i <= 200; i++) {
    const tangent = curve.getTangentAt(i / 200);
    assert.ok(Number.isFinite(tangent.x) && Number.isFinite(tangent.y) && Number.isFinite(tangent.z), `non-finite tangent at ${i}`);
    assert.ok(Math.abs(tangent.length() - 1) < 1e-6, `tangent at ${i} is not unit length`);
  }
});
