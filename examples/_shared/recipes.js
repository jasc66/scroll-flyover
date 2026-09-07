/**
 * examples/_shared/recipes.js
 * -----------------------------------------------------------------------
 * Shared building blocks for the example builds in examples/*, adapted
 * directly from references/scene-recipes.md, references/materials.md, and
 * references/camera-archetypes.md. One difference from those reference
 * docs: every function here that places/sizes/colors something takes an
 * `rng` parameter and uses ONLY that — no bare `Math.random()` — per
 * SKILL.md Step 2 ("NEVER call Math.random() in a scene builder"). The
 * reference docs use Math.random() in a couple of spots for brevity as
 * illustrative snippets; a real build (this gallery included) must not.
 */
import * as THREE from 'three';

// ---- scene-recipes.md §1: canvas-generated textures -----------------------

export function makeGradientTexture(colorTop, colorBottom, size = 512) {
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

// ---- scene-recipes.md §2: shared material palette --------------------------

export function buildMaterialPalette(hexColors, { flat = false } = {}) {
  return hexColors.map((hex) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    flatShading: flat,
    roughness: 0.85,
    metalness: 0.02,
  }));
}

// ---- scene-recipes.md §3: base island platform ------------------------------

export function buildIslandBase(radius, height, material, rng, { irregular = true } = {}) {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.08, height, 7, 1);
  if (irregular) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) {
        pos.setX(i, pos.getX(i) + (rng() - 0.5) * radius * 0.12);
        pos.setZ(i, pos.getZ(i) + (rng() - 0.5) * radius * 0.12);
      }
    }
    geo.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

// ---- scene-recipes.md §4: shape-language vocabularies -----------------------

// Low-poly organic
export function buildRock(radius, material) {
  return new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), material);
}
export function buildTree(height, trunkMat, leafMat) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(height * 0.05, height * 0.07, height * 0.5, 5), trunkMat);
  trunk.position.y = height * 0.25;
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(height * 0.35, 0), leafMat);
  leaves.position.y = height * 0.6;
  g.add(trunk, leaves);
  return g;
}

// Geometric / architectural
export function buildBlock(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
export function buildTower(baseSize, floors, material) {
  const g = new THREE.Group();
  for (let i = 0; i < floors; i++) {
    const s = baseSize * (1 - i * 0.04);
    const floor = buildBlock(s, baseSize * 0.4, s, material);
    floor.position.y = i * baseSize * 0.4;
    g.add(floor);
  }
  return g;
}
export function addGridOverlay(radius, color) {
  const grid = new THREE.PolarGridHelper(radius, 8, 4, 32, color, color);
  grid.position.y = 0.01;
  return grid;
}

// Toy / rounded
export function buildBlob(radius, material) {
  const geo = new THREE.SphereGeometry(radius, 12, 10);
  geo.scale(1, 0.8, 1);
  return new THREE.Mesh(geo, material);
}

// ---- scene-recipes.md §5: instanced repeated props --------------------------

export function scatterInstances(baseGeometry, material, count, radius, rng) {
  const mesh = new THREE.InstancedMesh(baseGeometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    dummy.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    dummy.rotation.y = rng() * Math.PI * 2;
    const s = 0.7 + rng() * 0.6;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ---- scene-recipes.md §6 / materials.md §3: water --------------------------

export function buildWaterPlane(size, color) {
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: true, opacity: 0.75, roughness: 0.15, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(size, 24), mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// ---- materials.md §0: derive tones from a brand palette color --------------

export function deriveTones(hex, { lightenBy = 0.35, darkenBy = 0.4 } = {}) {
  const base = new THREE.Color(hex);
  const light = base.clone().lerp(new THREE.Color(0xffffff), lightenBy);
  const dark = base.clone().lerp(new THREE.Color(0x000000), darkenBy);
  return { base: '#' + base.getHexString(), light: '#' + light.getHexString(), dark: '#' + dark.getHexString() };
}

// ---- materials.md §4: Fresnel rim glow — ONE prop per build, the peak scene's focal object

export function makeFresnelMaterial(accentHex, power = 2.5) {
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
export function addRimGlow(mesh, accentHex) {
  const shell = new THREE.Mesh(mesh.geometry, makeFresnelMaterial(accentHex));
  shell.scale.multiplyScalar(1.06);
  mesh.add(shell);
  return shell;
}

// ---- camera-archetypes.md: layout functions (config.layout) ----------------

export function layoutIslandHop(spacing = 24, arcHeight = 4) {
  return (count) => Array.from({ length: count }, (_, i) => {
    const t = count > 1 ? i / (count - 1) : 0;
    return new THREE.Vector3(i * spacing, Math.sin(t * Math.PI) * arcHeight,
      Math.cos(t * Math.PI * 0.6) * spacing * 0.3);
  });
}

export function layoutCorridor(spacing = 26, curve = 8) {
  return (count) => Array.from({ length: count }, (_, i) =>
    new THREE.Vector3(i * spacing, 0, Math.sin(i * 0.5) * curve));
}

export function layoutDescent(drop = 22, drift = 6) {
  return (count) => Array.from({ length: count }, (_, i) =>
    new THREE.Vector3(Math.sin(i * 1.1) * drift, -i * drop, Math.cos(i * 1.1) * drift));
}

export function layoutOrbit(radius = 18, rise = 3) {
  return (count) => Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 1.8; // not a full loop
    return new THREE.Vector3(Math.cos(a) * radius, 2 + i * rise * 0.4, Math.sin(a) * radius);
  });
}

export function layoutSpiral(radius = 16, climb = 7) {
  return (count) => Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 3;
    return new THREE.Vector3(Math.cos(a) * radius, i * climb, Math.sin(a) * radius);
  });
}
