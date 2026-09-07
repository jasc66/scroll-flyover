# Scene recipes (no external assets, ever)

Every recipe here produces geometry/materials/textures from code only. No
`TextureLoader`, no fetched images, no AI generation calls. This file is the direct
replacement for an AI-image "prompt template": instead of describing a scene in
English for a model, you describe it in these primitive building blocks.

## 1. Canvas-generated textures (sky, ground gradient, "grain")

The one place a flat `MeshStandardMaterial` color feels cheap is large background
surfaces (sky, ground). Fix it with a tiny runtime canvas texture — costs nothing,
looks designed:

```js
function makeGradientTexture(colorTop, colorBottom, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, colorTop);
  grad.addColorStop(1, colorBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Sky:
scene.background = makeGradientTexture(palette.sky1, palette.sky2, 512);

// Optional grain overlay (breaks up flat-shaded banding cheaply):
function makeGrainTexture(size = 128, alpha = 0.04) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i+1] = img.data[i+2] = v;
    img.data[i+3] = alpha * 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 20);
  return tex;
}
```

## 2. Shared material palette (build once, reuse everywhere)

```js
function buildMaterialPalette(hexColors, { flat = false } = {}) {
  return hexColors.map(hex => new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    flatShading: flat,        // true for 'geometric'/'toy' language, false for smoother 'lowpoly'
    roughness: 0.85,
    metalness: 0.02,
  }));
}
// Call ONCE per page load with the Step 1.3 palette, pass the array into every
// scene builder. Never `new THREE.MeshStandardMaterial(...)` per-mesh in a loop.
```

## 3. Base island platform (every scene needs exactly one)

```js
function buildIslandBase(radius, height, material, { irregular = true } = {}) {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.08, height, 7, 1);
  if (irregular) {
    // Nudge each top-ring vertex slightly for a hand-made, non-CAD silhouette.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * radius * 0.12);
        pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * radius * 0.12);
      }
    }
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}
```

## 4. Shape-language vocabularies

Pick ONE per build (Step 1.4) and reuse its functions across every scene.

### Low-poly organic (nature / food / travel / wellness)

```js
function buildRock(radius, material) {
  const geo = new THREE.IcosahedronGeometry(radius, 0); // facets on purpose
  return new THREE.Mesh(geo, material);
}
function buildTree(height, trunkMat, leafMat) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(height*0.05, height*0.07, height*0.5, 5), trunkMat);
  trunk.position.y = height * 0.25;
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(height*0.35, 0), leafMat);
  leaves.position.y = height * 0.6;
  g.add(trunk, leaves);
  return g;
}
```

### Geometric / architectural (tech / finance / logistics / real estate)

```js
function buildBlock(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function buildTower(baseSize, floors, material) {
  const g = new THREE.Group();
  for (let i = 0; i < floors; i++) {
    const s = baseSize * (1 - i * 0.04); // slight taper
    const floor = buildBlock(s, baseSize * 0.4, s, material);
    floor.position.y = i * baseSize * 0.4;
    g.add(floor);
  }
  return g;
}
// Grid lines on the platform reinforce the "architectural" read:
function addGridOverlay(radius, color) {
  const grid = new THREE.PolarGridHelper(radius, 8, 4, 32, color, color);
  grid.position.y = 0.01;
  return grid;
}
```

### Toy / rounded (playful consumer / kids' products)

```js
function buildBlob(radius, material) {
  const geo = new THREE.SphereGeometry(radius, 12, 10);
  // Squash slightly for a "soft toy" proportion instead of a perfect sphere.
  geo.scale(1, 0.8, 1);
  return new THREE.Mesh(geo, material);
}
// Toy language favors MeshToonMaterial or flatShading:true + strong rim light
// for a candy look, and rounded-radius torus/capsule primitives over boxes.
```

## 5. Repeated props → InstancedMesh (forests, crowds, stacks)

Never `.clone()` a mesh N times in a loop for anything you'll repeat more than ~10x.

```js
function scatterInstances(baseGeometry, material, count, radius) {
  const mesh = new THREE.InstancedMesh(baseGeometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    dummy.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.7 + Math.random() * 0.6;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
```

## 6. Water / flat reflective surfaces (cheap version, no post-processing)

A real reflective water shader is overkill for this skill. A flat, semi-transparent,
slightly emissive plane reads as "water/glass" at diorama scale for near-zero cost:

```js
function buildWaterPlane(size, color) {
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: true, opacity: 0.75, roughness: 0.15, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(size, 24), mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
```

## 7. Drifting particles ("Rich" performance tier only, Step 4)

```js
function buildParticles(count, spread, material) {
  const mesh = scatterInstances(new THREE.IcosahedronGeometry(0.05, 0), material, count, spread);
  mesh.userData.baseY = [];
  for (let i = 0; i < count; i++) mesh.userData.baseY.push(Math.random() * spread);
  return mesh; // animate in the render loop: dummy.position.y = baseY[i] + Math.sin(t + i)*0.3
}
```

## 8. User photos (optional — see SKILL.md Step 2.5)

Only relevant if the interview (Step 1.8) turned up real photos the user wants
featured. This is the one place the "no external images" rule doesn't apply — the
photo is the user's own file, loaded locally, not fetched or generated. Keep it to
1–2 scenes; every other scene stays procedural (Step 2.5 explains why).

### Loading (with downscale + color space + error fallback)

```js
function loadPhotoTexture(url, { maxDim = 1024, onReady, onFail } = {}) {
  const loader = new THREE.TextureLoader();
  loader.load(
    url,
    (texture) => {
      const { width, height } = texture.image;
      // Downscale via an offscreen canvas if the source exceeds maxDim — keeps GPU
      // memory sane for a prop that may only render at a few hundred px on screen.
      if (Math.max(width, height) > maxDim) {
        const scale = maxDim / Math.max(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        canvas.getContext('2d').drawImage(texture.image, 0, 0, canvas.width, canvas.height);
        texture.image = canvas;
        texture.needsUpdate = true;
      }
      texture.colorSpace = THREE.SRGBColorSpace; // critical — otherwise looks flat/washed out
      onReady?.(texture, texture.image.width / texture.image.height);
    },
    undefined,
    (err) => onFail?.(err), // caller swaps in a flat accent panel — see buildPhotoPanel below
  );
}

// Called once per config.photos entry when the engine mounts (see scrub-engine.js);
// scene builders receive the already-loaded texture map, not raw URLs.
```

### Framed photo panel (a designed object, not a floating rectangle)

```js
function buildPhotoPanel(texture, aspect, height, accentMaterial) {
  const g = new THREE.Group();
  const width = height * aspect;
  const frameMat = accentMaterial; // reuse the shared accent material, don't allocate a new one
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.12, height * 1.12), frameMat);
  const photoMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 });
  const photo = new THREE.Mesh(new THREE.PlaneGeometry(width, height), photoMat);
  photo.position.z = 0.01; // avoid z-fighting with the frame behind it
  g.add(frame, photo);
  return g;
}

// Fallback when a photo fails to load (Step 2.5 / SKILL.md Gotchas):
function buildFlatAccentPanel(aspect, height, accentMaterial) {
  return new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), accentMaterial);
}
```

### Wiring one photo into a scene (example: a hero product shot in the last scene)

```js
function buildHeroScene(materials, textures) {
  const g = new THREE.Group();
  g.add(buildIslandBase(6, 1.2, materials[0]));
  if (textures?.hero) {
    // aspect was computed at load time (see loadPhotoTexture's onReady) and stashed
    // on the texture's userData by the engine — see scrub-engine.js.
    const panel = buildPhotoPanel(textures.hero, textures.hero.userData.aspect ?? 1.5, 3, materials[3]);
    panel.position.set(0, 2.2, 0);
    g.add(panel);
  } else {
    g.add(buildFlatAccentPanel(1.5, 3, materials[3]));
  }
  return g;
}
```

Every scene builder that doesn't use a photo simply ignores the second `textures`
argument — it costs nothing to pass it everywhere.

## 9. Assembling one scene function

Every scene builder follows the same shape so they're interchangeable in the config:

```js
function buildFarmScene(materials) {
  const group = new THREE.Group();
  const base = buildIslandBase(6, 1.2, materials[0]);
  group.add(base);
  group.add(buildWaterPlane(2, materials[3].color));
  for (let i = 0; i < 6; i++) {
    const tree = buildTree(1.5 + Math.random(), materials[1], materials[2]);
    tree.position.set((Math.random()-0.5)*8, 0.6, (Math.random()-0.5)*8);
    group.add(tree);
  }
  return group; // scrub-engine positions this group along the world axis for you
}
```

Keep each scene builder under ~30 lines by composing the primitives above — if a scene
needs a genuinely new primitive type, add it to this file as a new numbered recipe so
later scenes in the same build can reuse it too, rather than inlining one-off geometry
in the scene function itself.
