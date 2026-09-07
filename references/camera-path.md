# Camera path construction

This is the free, code-based replacement for the AI-video "seam rule." There is no
frame-matching problem here — continuity is automatic because the camera position is
one continuous mathematical function of scroll, never a stitch of separate clips.

## 1. Lay out scene anchors

Space scenes along a gentle arc so the world reads as one connected place instead of a
straight conveyor belt:

```js
function layoutAnchors(count, spacing = 24, arcHeight = 4) {
  const anchors = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    anchors.push(new THREE.Vector3(
      i * spacing,
      Math.sin(t * Math.PI) * arcHeight,   // gentle rise-and-fall across the whole journey
      Math.cos(t * Math.PI * 0.6) * spacing * 0.3,
    ));
  }
  return anchors;
}
```

Keep spacing roughly uniform between consecutive anchors — uneven spacing is the #1
cause of the curve "speeding up" or "slowing down" oddly (Gotchas, SKILL.md).

## 2. Approach / dive / depart control points per scene

For each anchor `P_i`, generate three curve control points relative to it:

```js
function sceneControlPoints(anchor, forwardDir, sceneRadius) {
  const up = new THREE.Vector3(0, 1, 0);
  const approach = anchor.clone()
    .addScaledVector(forwardDir.clone().negate(), sceneRadius * 1.8)
    .addScaledVector(up, sceneRadius * 1.1);          // wide, elevated, outside the island
  const dive = anchor.clone()
    .addScaledVector(up, sceneRadius * 0.25);          // low, close, near the focal prop
  const depart = anchor.clone()
    .addScaledVector(forwardDir, sceneRadius * 1.6)
    .addScaledVector(up, sceneRadius * 0.9);           // lifted back out, angled toward next scene
  return [approach, dive, depart];
}
```

`forwardDir` is the normalized direction from this anchor to the next one (or from the
previous anchor to this one, for the last scene).

## 3. Build the full curve

```js
function buildWorldCurve(anchors) {
  const points = [];
  anchors.forEach((anchor, i) => {
    const next = anchors[i + 1] ?? anchor.clone().add(new THREE.Vector3(10, 0, 0));
    const prev = anchors[i - 1] ?? anchor.clone().sub(new THREE.Vector3(10, 0, 0));
    const forward = next.clone().sub(prev).normalize();
    points.push(...sceneControlPoints(anchor, forward, 6 /* sceneRadius */));
  });
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}
```

## 4. Scroll → position/look-at

```js
function updateCamera(curve, camera, scrollT, lookAhead = 0.015) {
  const t = THREE.MathUtils.clamp(scrollT, 0, 1);
  const pos = curve.getPointAt(t);
  const aheadT = THREE.MathUtils.clamp(t + lookAhead, 0, 1);
  const lookAt = curve.getPointAt(aheadT);
  camera.position.copy(pos);
  camera.lookAt(lookAt);
}
```

`scrollT` comes straight from `window.scrollY / (document.body.scrollHeight -
window.innerHeight)`, or from a dedicated scroll-length container — see
`scrub-engine.js`.

## 5. Dwell-time easing (spend more of the scroll range near each dive point)

Uniform `t` makes transit segments and dive segments take equal scroll distance, which
feels rushed at the interesting parts. Fix with a monotonic easing lookup instead of
moving control points:

```js
function buildDwellEasing(sceneCount, dwellWeight = 2.5) {
  // Each scene gets `dwellWeight` "shares" of scroll range around its dive point;
  // transit segments between scenes get 1 share. Build a piecewise-linear remap
  // from uniform t to eased t.
  const segments = sceneCount * 2 - 1; // scene, transit, scene, transit, ... scene
  const weights = [];
  for (let i = 0; i < segments; i++) weights.push(i % 2 === 0 ? dwellWeight : 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const boundaries = [0];
  weights.forEach(w => boundaries.push(boundaries[boundaries.length - 1] + w / total));
  const uniformStep = 1 / segments;

  return function ease(t) {
    const seg = Math.min(Math.floor(t / uniformStep), segments - 1);
    const localT = (t - seg * uniformStep) / uniformStep;
    const a = boundaries[seg], b = boundaries[seg + 1];
    return a + localT * (b - a);
  };
}
// Usage: updateCamera(curve, camera, ease(rawScrollT))
```

Tune `dwellWeight` per build — higher means scenes feel longer/slower relative to
transit; 2–3 is a reasonable start.

## 6. Curvature-based banking ("fly and swoop" only, Step 1.6)

```js
function applyBanking(curve, camera, t, maxBankRad = 0.35) {
  const tangent = curve.getTangentAt(THREE.MathUtils.clamp(t, 0, 1));
  const tangentNext = curve.getTangentAt(THREE.MathUtils.clamp(t + 0.01, 0, 1));
  const curvature = tangentNext.clone().sub(tangent).length();
  const bank = THREE.MathUtils.clamp(curvature * 8, -maxBankRad, maxBankRad);
  camera.up.set(Math.sin(bank), Math.cos(bank), 0); // tilt the up vector, not a raw z-rotation
}
```

Smooth `curvature` with a small moving average (keep the last 5 samples and average)
before mapping it to `bank` — raw per-frame curvature is noisy on a Catmull-Rom curve
and produces visible jitter otherwise (Gotchas: "banking looks drunk").

"Steady glide" (Step 1.6) skips this function entirely — leave `camera.up = (0,1,0)`
fixed.
