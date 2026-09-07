# Camera archetypes

`camera-path.md` covers the *mechanics* (Catmull-Rom construction, dwell easing,
banking). This file covers the *choice*: which spatial structure the journey takes.
Picking one is a Step 1.6 interview question — it changes the anchor layout, not the
engine.

**Why this matters for uniqueness (SKILL.md "Deliberate uniqueness"):** the
island-hop is the recognizable default of this genre. Two builds that both hop across
floating islands look related no matter how different their palettes are. The archetype
is the *structural* differentiator — the one choice that changes a build's silhouette
rather than its skin.

Each archetype below defines only `layoutAnchors()` and, where relevant, the
approach/dive/depart offsets. Everything downstream (spline, easing, rail, copy fade)
is unchanged.

---

## 1. Island hop — the default

Scenes as separate platforms on a gentle arc; camera dives into each and lifts out.
Best for: value chains with genuinely distinct stages (farm → roastery → café).

```js
function layoutIslandHop(count, spacing = 24, arcHeight = 4) {
  return Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0;
    return new THREE.Vector3(i * spacing, Math.sin(t * Math.PI) * arcHeight,
                             Math.cos(t * Math.PI * 0.6) * spacing * 0.3);
  });
}
```

## 2. Continuous terrain — one unbroken world

No gaps between scenes; one large ground mesh with scenes as regions on it. The camera
never leaves the surface's vicinity. Best for: subjects that are genuinely one place
(a campus, a farm, a city district) where island-hopping would misrepresent them.

```js
function layoutTerrain(count, spacing = 30) {
  return Array.from({ length: count }, (_, i) =>
    new THREE.Vector3(i * spacing, 2.5 + Math.sin(i * 1.7) * 1.2, Math.sin(i * 0.9) * spacing * 0.45));
}
// Build ONE ground plane spanning all anchors (PlaneGeometry with displaced vertices)
// instead of per-scene platforms; scenes add props onto it at their anchor.
```

## 3. Vertical descent — a stack, not a line

Scenes stacked on the Y axis; scroll drops the camera through layers. Best for: depth
metaphors — org structure, geological/technical layers, a funnel, "surface to core."

```js
function layoutDescent(count, drop = 22, drift = 6) {
  return Array.from({ length: count }, (_, i) =>
    new THREE.Vector3(Math.sin(i * 1.1) * drift, -i * drop, Math.cos(i * 1.1) * drift));
}
// Pair with cameraFeel:'glide' — banking on a vertical drop reads as tumbling.
```

## 4. Corridor / tunnel — enclosed forward flight

Scenes are chambers along an enclosed path; walls carry the sense of speed. Best for:
process/pipeline subjects, and the archetype most tolerant of low prop counts (the
tunnel geometry itself does the visual work).

```js
function layoutCorridor(count, spacing = 26, curve = 8) {
  return Array.from({ length: count }, (_, i) =>
    new THREE.Vector3(i * spacing, 0, Math.sin(i * 0.5) * curve));
}
// Each scene contributes a tube segment (TorusGeometry arc or extruded ring) around
// its anchor; props mount to the inner wall. Fog is essential here — set it tight.
```

## 5. Orbit showcase — one hero, many angles

A single central object; scenes are viewing positions around it rather than separate
places. Best for: single-product brands where "the journey" is really "the details."

```js
function layoutOrbit(count, radius = 18, rise = 3) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 1.8;   // not a full loop — end ≠ start
    return new THREE.Vector3(Math.cos(a) * radius, 2 + i * rise * 0.4, Math.sin(a) * radius);
  });
}
// The dive point aims INWARD at the hero, not down at a platform — override
// sceneControlPoints so `dive` = anchor moved toward origin, not toward -Y.
```

## 6. Spiral ascent — orbit + climb

Circles a central axis while rising; each loop reveals more. Best for: growth/progress
narratives, and the strongest "wow" per unit of geometry because the same props are
re-seen from new heights.

```js
function layoutSpiral(count, radius = 16, climb = 7) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 3;
    return new THREE.Vector3(Math.cos(a) * radius, i * climb, Math.sin(a) * radius);
  });
}
```

---

## Choosing (Step 1.6)

Don't offer all six — that's Hick's law working against you (`ux-principles.md`).
Infer 2–3 plausible archetypes from the subject and offer those:

| If the subject is… | Offer |
|---|---|
| Distinct sequential stages | Island hop, Corridor |
| One physical place | Continuous terrain, Corridor |
| A single product | Orbit showcase, Spiral ascent |
| Depth/layers/hierarchy | Vertical descent, Spiral ascent |
| Growth or progress over time | Spiral ascent, Island hop |

**Non-obvious pairings are where distinctiveness lives.** A logistics company gets
island-hop by default and it's fine; a logistics company rendered as a *vertical
descent* through the layers of a supply chain is memorable. Offer the obvious one and
one deliberate departure, and say which is which.

## Compatibility notes

- `cameraFeel: 'swoop'` (curvature banking) fights **vertical descent** and
  **corridor** — use `'glide'` for both.
- **Orbit** and **spiral** need the dive point redirected inward (see §5 comment) or
  the camera dives at empty ground.
- **Continuous terrain** is the only archetype where per-scene platforms should NOT be
  built — one shared ground mesh instead, or the seams between platforms show.
- Every archetype uses the same route rail, copy fade, dwell easing, and photo support
  without modification.
