# Visual fidelity — why procedural scenes look "basic," and the fix

If a build looks like a Three.js tutorial, the cause is almost never polygon count.
Adding more props or more subdivisions to the same flat-lit primitives makes a scene
*busier*, not better. The gap is in **render setup and silhouette**, and it closes with
five techniques — all free, all offline, none requiring a paid service or an artist.

Apply them in this order. §1–§3 give the biggest jump per line of code and should be
considered **mandatory** for any build the user will show a client.

---

## §1 — Tone mapping + correct color space (2 lines, biggest single win)

Raw WebGL output is linear and clips highlights to flat white, which is most of why
untuned scenes look like plastic. ACES Filmic tone mapping is what film/game engines
use; it rolls off highlights and deepens midtones.

```js
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;      // 0.9–1.3; tune per palette
renderer.outputColorSpace = THREE.SRGBColorSpace;   // default in r152+, set it explicitly anyway
```

Do this before touching anything else. If a scene still looks flat afterward, the
problem is §2.

## §2 — Environment map (procedurally generated — no HDRI file)

`MeshStandardMaterial` is a PBR material: with no environment to reflect, its
roughness/metalness channels do almost nothing, which is why palette-colored primitives
read as matte cardboard. Generate an environment from a tiny procedural scene with
`PMREMGenerator` — no downloaded HDRI, no asset hosting.

```js
function buildProceduralEnv(renderer, palette) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  // A miniature scene whose only job is to be reflected: a sky-colored box interior,
  // plus a couple of emissive planes acting as soft studio lights.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(palette.colors[1]);
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(12, 12, 12),
    new THREE.MeshBasicMaterial({ color: palette.colors[1], side: THREE.BackSide }),
  );
  envScene.add(room);
  const key = new THREE.Mesh(new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  key.position.set(0, 5.5, 0); key.rotation.x = Math.PI / 2;
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(5, 5),
    new THREE.MeshBasicMaterial({ color: palette.accent }));
  fill.position.set(-5, 1, 2); fill.rotation.y = Math.PI / 2;
  envScene.add(key, fill);

  const target = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  return target.texture;   // assign to scene.environment
}

scene.environment = buildProceduralEnv(renderer, PALETTE);
```

Then materials must actually *use* it — flat matte settings waste the env:

```js
new THREE.MeshStandardMaterial({
  color, roughness: 0.35,      // NOT 0.85 — high roughness kills all reflection
  metalness: 0.15,             // a little metalness makes the env visible
  envMapIntensity: 0.8,
});
```

**This is the single most common reason a build "looks basic."** The default recipes in
`scene-recipes.md` use `roughness: 0.85, metalness: 0.02`, which is deliberately safe
and deliberately dull — override it once §1 and §2 are in place.

## §3 — Bevel every hard edge

Nothing says "primitive" like a perfectly sharp 90° corner: real objects catch a
highlight along every edge. Two ways, both free:

```js
// (a) Rounded boxes — drop-in replacement for BoxGeometry
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, 0.08), material);  // segments, radius

// (b) Custom silhouettes with a bevel — the real upgrade over boxes.
// Draw any 2D outline, extrude it with a bevel. This is how you get shapes that
// aren't in Three.js's primitive list, which is what actually makes a world
// look designed rather than assembled.
function extrudeProfile(points, depth = 0.6, material) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3,
  });
  geo.center();
  return new THREE.Mesh(geo, material);
}
```

Rule of thumb: **bevel radius ≈ 2–4% of the object's smallest dimension.** Larger reads
as "toy" (fine if that's the chosen shape language), smaller is invisible.

`LatheGeometry` deserves a mention too — spin a profile curve to get vases, columns,
domes, bottles. One line, and the result never reads as a cylinder.

## §4 — Post-processing: bloom + a touch of vignette

Bloom makes the accent color and any emissive prop feel like it emits light rather than
being painted. Use `EffectComposer` — part of Three.js's own addons, not a third-party
library.

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.45,   // strength — 0.3–0.6; above 0.8 everything smears
  0.7,    // radius
  0.85,   // threshold — only the brightest pixels bloom; lower = more of the scene glows
);
composer.addPass(bloom);
// then render with composer.render() instead of renderer.render(scene, camera)
```

Pair it with **one emissive prop** in the peak scene:

```js
new THREE.MeshStandardMaterial({
  color: palette.accent,
  emissive: new THREE.Color(palette.accent),
  emissiveIntensity: 1.4,     // above the bloom threshold, so it actually glows
});
```

**Cost warning:** bloom is a full-screen pass — roughly 1.3–1.6× frame cost. Gate it to
the "Rich" tier and disable on mobile (`SKILL.md` Step 7). A build that looks
cinematic at 20fps is worse than one that looks clean at 60.

## §5 — Shadows and contact

Objects that don't touch anything float. One shadow-casting directional light with a
tuned camera frustum grounds the whole scene:

```js
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const d = 40;
Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 160 });
sun.shadow.bias = -0.0004;          // fixes shadow acne; too negative causes peter-panning
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
```

Every prop needs `castShadow = true`, every platform `receiveShadow = true` — a
missed flag is the usual cause of "shadows look wrong."

---

## Fidelity checklist

Before showing a build to anyone, verify all of these. Most "it looks basic" reports
are two or more unchecked:

- [ ] `ACESFilmicToneMapping` set (§1)
- [ ] `scene.environment` assigned from `buildProceduralEnv` (§2)
- [ ] Material roughness ≤ 0.5 and metalness ≥ 0.1 on at least the hero props (§2)
- [ ] No perfectly sharp box edges in frame — rounded or extruded-with-bevel (§3)
- [ ] At least one silhouette that is NOT a Three.js primitive (extrude or lathe) (§3)
- [ ] Bloom on, with exactly one emissive prop above threshold (§4, Rich tier only)
- [ ] Shadows on with a tuned frustum; every prop casts, every platform receives (§5)
- [ ] Fog color matches the sky's lower gradient stop, not an arbitrary dark value

## Performance budget for fidelity

| Feature | Rich | Light (mobile) |
|---|---|---|
| Tone mapping | on | on (free) |
| Procedural env map | on, 256px PMREM | on, 128px — still worth it |
| Bevels / extrudes | everywhere | hero props only |
| Bloom | on (strength ≤ 0.5) | **off** |
| Shadows | 2048 map, PCFSoft | 1024 map, or off |
| Emissive props | 1–2 | 1 |

Tone mapping and the env map are cheap enough to keep on every tier — they are pure
render-setup, not extra geometry. Bloom and shadows are the ones to cut.
