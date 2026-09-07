# Procedural material library

Every texture here is drawn at runtime into a `<canvas>` and fed to
`THREE.CanvasTexture` — no image files, no downloads, no generation API. This is the
visual-depth layer: flat `MeshStandardMaterial` colors alone are what make procedural
3D read as "generic Three.js tutorial," and these recipes are the cheapest fix.

**The rule that makes this a differentiator, not just a texture dump:** every
generator below takes the build's **brand palette** as input rather than hardcoded
"marble white" / "wood brown" constants. A marble veined in the client's accent color
is theirs; a stock grey marble is everyone's. Always pass palette colors in — see
§0.

## §0 — Deriving material colors from the brand palette

```js
// Given the Step 1.3 palette, produce the light/dark pair any generator needs.
// Never hardcode "#fff"/"#8b5a2b" — derive, so materials inherit the brand.
function deriveTones(hex, { lightenBy = 0.35, darkenBy = 0.4 } = {}) {
  const base = new THREE.Color(hex);
  const light = base.clone().lerp(new THREE.Color(0xffffff), lightenBy);
  const dark  = base.clone().lerp(new THREE.Color(0x000000), darkenBy);
  return { base: '#' + base.getHexString(), light: '#' + light.getHexString(), dark: '#' + dark.getHexString() };
}
```

## §1 — Veined marble / stone

```js
function makeMarbleTexture(paletteHex, accentHex, size = 512, seed = 1) {
  const rng = makeRng(seed);                    // deterministic — see seeded-randomness in SKILL.md
  const { light, dark } = deriveTones(paletteHex);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = light; ctx.fillRect(0, 0, size, size);

  // Veins: a few wandering polylines, each thinner and fainter than the last.
  for (let v = 0; v < 14; v++) {
    ctx.beginPath();
    let x = rng() * size, y = rng() * size;
    ctx.moveTo(x, y);
    for (let step = 0; step < 26; step++) {
      x += (rng() - 0.5) * size * 0.12;
      y += (rng() - 0.5) * size * 0.12;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = v % 4 === 0 ? accentHex : dark;   // occasional accent vein = brand signature
    ctx.globalAlpha = 0.10 + rng() * 0.18;
    ctx.lineWidth = 0.6 + rng() * 2.2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

## §2 — Wood grain

```js
function makeWoodTexture(paletteHex, size = 512, seed = 2) {
  const rng = makeRng(seed);
  const { base, light, dark } = deriveTones(paletteHex, { lightenBy: 0.22, darkenBy: 0.35 });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);

  // Grain: nested arcs of alternating tone, offset by a wandering center.
  let cx = -size * 0.4;
  for (let ring = 0; ring < 60; ring++) {
    ctx.beginPath();
    ctx.arc(cx + rng() * 6, size / 2, ring * (size / 55), -Math.PI / 2.2, Math.PI / 2.2);
    ctx.strokeStyle = ring % 2 ? dark : light;
    ctx.globalAlpha = 0.16 + rng() * 0.12;
    ctx.lineWidth = 1 + rng() * 3;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

## §3 — Animated water (no shader, no library)

A real water shader is overkill and hard to keep cheap on mobile. Two offset
semi-transparent planes with slowly-scrolling procedural ripple textures read as water
at diorama scale for a fraction of the cost.

```js
function makeRippleTexture(paletteHex, size = 256, seed = 3) {
  const rng = makeRng(seed);
  const { light } = deriveTones(paletteHex, { lightenBy: 0.5 });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = light;
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    const y = rng() * size;
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.06 + i) * 3);
    ctx.globalAlpha = 0.06 + rng() * 0.10;
    ctx.lineWidth = 1 + rng() * 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildAnimatedWater(radius, paletteHex, accentHex) {
  const group = new THREE.Group();
  const layers = [0, 1].map((i) => {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(paletteHex),
      map: makeRippleTexture(accentHex, 256, 3 + i),
      transparent: true, opacity: i ? 0.35 : 0.7,
      roughness: 0.12, metalness: 0.15,
    });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = i * 0.02;
    group.add(mesh);
    return mat;
  });
  // Animate in the render loop; the engine calls any group.userData.tick(elapsed).
  group.userData.tick = (t) => {
    layers[0].map.offset.set(t * 0.012, t * 0.008);
    layers[1].map.offset.set(-t * 0.009, t * 0.014);
  };
  return group;
}
```

## §4 — Fresnel rim glow (a real shader, but a tiny one)

The cheapest way to make a hero prop look expensive. Use it on ONE prop — the peak
scene's focal object (SKILL.md Step 1.5) — never on everything.

```js
function makeFresnelMaterial(accentHex, power = 2.5) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(accentHex) }, uPower: { value: power } },
    vertexShader: `
      varying vec3 vNormal; varying vec3 vView;
      void main(){
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower;
      varying vec3 vNormal; varying vec3 vView;
      void main(){
        float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), uPower);
        gl_FragColor = vec4(uColor * rim, rim);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}
// Apply as a slightly scaled shell around the prop:
function addRimGlow(mesh, accentHex) {
  const shell = new THREE.Mesh(mesh.geometry, makeFresnelMaterial(accentHex));
  shell.scale.multiplyScalar(1.06);
  mesh.add(shell);
  return shell;
}
```

## §5 — Gradient sky dome (richer than `scene.background`)

A flat background texture never picks up fog or parallax. An actual inverted sphere
does, and costs one draw call.

```js
function buildSkyDome(radius, topHex, bottomHex) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(topHex) }, uBottom: { value: new THREE.Color(bottomHex) } },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vPos;
      void main(){ float h = normalize(vPos).y * 0.5 + 0.5; gl_FragColor = vec4(mix(uBottom, uTop, h), 1.0); }`,
    side: THREE.BackSide, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
}
```

## Performance budget

Materials are where a "Rich" build silently becomes a slideshow. Hard limits per build:

| Material | Rich tier | Light tier |
|---|---|---|
| Marble/wood canvas textures | ≤4 distinct (reuse across scenes) | ≤2, at 256px not 512px |
| Animated water | ≤2 water groups total | 1, or static plane (scene-recipes §6) |
| Fresnel rim glow | 1 prop only (the peak scene's focal object) | skip entirely |
| Sky dome | 1 (always fine — one draw call) | 1 |

Generate every canvas texture ONCE at mount and share the resulting `THREE.Texture`
across scenes. Regenerating per scene is the single most common cause of a build that
looks fine but stutters — see SKILL.md Gotchas.
