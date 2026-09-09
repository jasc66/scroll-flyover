/**
 * scroll-flyover scrub engine
 * -----------------------------------------------------------------------
 * Zero external assets. Zero paid services. Renders a live Three.js world
 * and maps scroll position to a point along a Catmull-Rom camera path.
 *
 * Usage:
 *   import { mountScrollFlyover } from './scrub-engine.js';
 *   const handle = mountScrollFlyover(document.getElementById('world'), config);
 *   // later, if unmounting (SPA route change, React unmount, etc.):
 *   handle.dispose();
 *
 * `three` is expected to be importable as a bare module named 'three' — either
 * via an import map pointing at a CDN build (see index-template.html) or via
 * `npm install three` in a bundled app. Nothing else in this file is
 * framework-specific.
 */
import * as THREE from 'three';

const SCENE_RADIUS = 6;
const DEFAULT_SPACING = 24;

/**
 * WCAG relative luminance (sRGB), used to pick a readable text color against an
 * arbitrary hex background rather than assuming one fixed color always works.
 */
function relativeLuminance(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.substring(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// 0.179 is the luminance where black-on-bg and white-on-bg contrast ratios cross over —
// below it white text reads better, above it black does. Palettes are 3D-material hexes
// picked for how they look lit in WebGL, not validated as flat HTML colors (see
// references/gotchas.md), so a build's accent can land on either side.
function readableTextColor(bgHex) {
  return relativeLuminance(bgHex) > 0.179 ? '#111' : '#fff';
}

/**
 * Deterministic RNG (mulberry32). Scene builders MUST use this instead of
 * Math.random(): with Math.random() a brand's page renders differently on every
 * reload and on every visitor's screen, which is wrong for a brand site (you can't
 * approve a layout you can't reproduce, and screenshots never match the live page).
 * Seeded from config.seed, so a build is reproducible and re-editable forever.
 */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mountScrollFlyover(container, config) {
  const {
    palette,
    shapeLanguage = 'lowpoly',
    cameraFeel = 'swoop',
    performance = 'rich',
    scenes = [],
    photos = null,
    dwellWeight = 2.5,
    seed = 1,
    layout = null,
  } = config;

  if (!scenes.length) throw new Error('scroll-flyover: config.scenes must be non-empty');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 860;
  const effectivePerf = isCoarsePointer ? 'light' : performance;

  // ---- WebGL feature check -------------------------------------------------
  const testCanvas = document.createElement('canvas');
  const probeContext = testCanvas.getContext('webgl2');
  const hasWebGL2 = !!probeContext;
  // This probe is never drawn to, but it holds a real WebGL context against the
  // browser's per-page limit until the canvas happens to be garbage collected — so a
  // page that mounts repeatedly was spending two context slots per mount, not one.
  probeContext?.getExtension('WEBGL_lose_context')?.loseContext();
  if (!hasWebGL2) {
    renderStaticFallback(container, palette, scenes);
    // Still has to clean up after itself: on this path dispose() used to be a no-op,
    // so an SPA route change left the fallback card behind in the host's container.
    return {
      dispose() {
        container.querySelector('[data-sf-fallback]')?.remove();
      },
    };
  }

  // ---- renderer / scene / camera ------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = effectivePerf === 'rich';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Mandatory on every tier — see references/visual-fidelity.md §1. Raw WebGL clips
  // highlights to flat white; this is most of why untuned scenes look like plastic.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // `container` itself must stay the TALL, non-sticky element — currentScrollT()
  // below reads real scroll progress from ITS getBoundingClientRect().top, which
  // only decreases as the page scrolls if container is a normal-flow element.
  // The visual pin effect needs a SEPARATE, SHORTER, `position: sticky` wrapper:
  // a sticky element only has "room" to stick while its own containing block is
  // taller than it is (see references/production-lessons.md) — making `container`
  // itself sticky would freeze its own rect.top at 0 and break scroll tracking,
  // while making the canvas position:absolute directly inside the tall (non-
  // sticky) `container` leaves it scrolling away with the rest of the page
  // instead of staying pinned. This wrapper is what production-lessons.md calls
  // "the visually-sticky canvas wrapper" — everything visual (canvas, copy
  // overlay) mounts inside it; `container` keeps only this wrapper plus the
  // scroll-length spacer and the crawlable SEO block, both added further below.
  // `container` belongs to the host page, not to the engine — dispose() restores these
  // two inline values instead of assuming it may reset the element wholesale.
  const prevInlineHeight = container.style.height;
  const prevInlinePosition = container.style.position;
  container.style.position = container.style.position || 'relative';
  const pinWrapper = document.createElement('div');
  pinWrapper.className = 'sf-pin';
  Object.assign(pinWrapper.style, {
    position: 'sticky', top: '0', height: '100vh', overflow: 'hidden', display: 'block',
  });
  container.appendChild(pinWrapper);
  pinWrapper.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', display: 'block' });

  const scene = new THREE.Scene();
  scene.background = makeGradientTexture(palette.colors[0], palette.colors[1] || palette.colors[0]);
  scene.fog = new THREE.Fog(new THREE.Color(palette.colors[palette.colors.length - 1]), 20, 90);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);

  const hemi = new THREE.HemisphereLight(palette.colors[0], palette.colors[palette.colors.length - 1], 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(10, 20, 10);
  sun.castShadow = effectivePerf === 'rich';
  if (sun.castShadow) {                       // visual-fidelity.md §5
    sun.shadow.mapSize.set(2048, 2048);
    const d = 40;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 160 });
    sun.shadow.bias = -0.0004;
  }
  scene.add(hemi, sun);

  // ---- procedural environment map (visual-fidelity.md §2) -----------------
  // Without this, MeshStandardMaterial's roughness/metalness do nothing and every
  // prop reads as matte cardboard. Generated from a tiny throwaway scene — no HDRI
  // file, no download, no hosting.
  // Keeps the render TARGET, not just its texture: the target owns the GPU allocation,
  // and dispose() cannot free what it has no reference to.
  const envRenderTarget = (function buildProceduralEnv() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(palette.colors[1] || palette.colors[0]);
    envScene.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12),
      new THREE.MeshBasicMaterial({ color: palette.colors[1] || palette.colors[0], side: THREE.BackSide })));
    const key = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    key.position.set(0, 5.5, 0); key.rotation.x = Math.PI / 2;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(5, 5),
      new THREE.MeshBasicMaterial({ color: palette.accent || palette.colors[2] }));
    fill.position.set(-5, 1, 2); fill.rotation.y = Math.PI / 2;
    envScene.add(key, fill);
    const target = pmrem.fromScene(envScene, 0.04);
    pmrem.dispose();
    // The throwaway env scene was uploaded to the GPU to bake the map; drop it now
    // rather than waiting for dispose(), since nothing references it after this.
    envScene.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
    return target;
  })();
  scene.environment = envRenderTarget.texture;

  // ---- materials, built once -----------------------------------------------
  // Roughness/metalness are tuned so the env map above is actually visible; the
  // matte 0.85/0.02 defaults are what make procedural builds look flat.
  const materials = palette.colors.map(hex => new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    flatShading: shapeLanguage !== 'lowpoly',
    roughness: 0.42,
    metalness: 0.14,
    envMapIntensity: 0.85,
  }));

  // ---- optional user photos (Step 2.5 — free, local, never AI-generated) --
  // Loaded once here and handed to every build() as a second argument, so only the
  // 1-2 scenes that opted into a photo (Step 1.8) need to read from it.
  const textures = {};
  if (photos) {
    const textureLoader = new THREE.TextureLoader();
    Object.entries(photos).forEach(([key, url]) => {
      textures[key] = textureLoader.load(
        url,
        (loaded) => {
          loaded.colorSpace = THREE.SRGBColorSpace; // otherwise photos render flat/washed out
          loaded.userData.aspect = loaded.image.width / loaded.image.height;
        },
        undefined,
        () => { textures[key] = null; }, // scene builders must check truthiness and fall back
      );
    });
  }

  // ---- lay out scenes + build the world curve ------------------------------
  // config.layout lets an archetype (camera-archetypes.md) replace the default
  // island-hop anchor layout without touching the engine.
  const anchors = (layout || layoutAnchors)(scenes.length);
  const tickers = []; // groups exposing userData.tick(elapsed) — e.g. animated water
  scenes.forEach((sceneCfg, i) => {
    // Each scene gets its OWN deterministic stream, derived from the build seed, so
    // editing scene 3 never reshuffles scene 1's prop placement.
    const rng = makeRng(seed + i * 7919);
    const group = sceneCfg.build(materials, textures, {
      shapeLanguage, performance: effectivePerf, rng, palette,
    });
    group.position.copy(anchors[i]);
    scene.add(group);
    group.traverse((child) => { if (child.userData?.tick) tickers.push(child.userData.tick); });
    if (group.userData?.tick) tickers.push(group.userData.tick);
  });

  const curve = buildWorldCurve(anchors, SCENE_RADIUS);
  const ease = buildDwellEasing(scenes.length, dwellWeight);
  const applyBanking = createBanking();

  // ---- copy overlay (plain HTML, pinned) -----------------------------------
  const overlay = document.createElement('div');
  overlay.className = 'sf-overlay';
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  pinWrapper.appendChild(overlay); // must live in the sticky wrapper, not container — see above

  const sectionEls = scenes.map((sceneCfg) => {
    const el = document.createElement('div');
    el.className = 'sf-section';
    Object.assign(el.style, {
      position: 'absolute', left: '6%', bottom: '10%', maxWidth: '440px', boxSizing: 'border-box',
      opacity: '0', transition: 'opacity 0.5s ease', color: '#fff',
      fontFamily: 'system-ui, sans-serif',
      // A flat text-shadow over live WebGL isn't reliable contrast — the scene
      // gradient behind this panel is picked per-build for how it looks lit, not
      // for HTML contrast (references/gotchas.md), and can land near-white (e.g.
      // a light palette's top stop), leaving white text unreadable. A solid-ish
      // scrim guarantees contrast against ANY background, unlike a blur shadow.
      background: 'rgba(10,10,16,0.62)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      padding: '1.1em 1.3em', borderRadius: '12px',
    });
    const ctaTextColor = readableTextColor(palette.accent || '#e8a33d');
    el.innerHTML = `
      ${sceneCfg.eyebrow ? `<div style="letter-spacing:0.1em;text-transform:uppercase;font-size:0.75rem;opacity:0.8">${sceneCfg.eyebrow}</div>` : ''}
      <h2 style="font-size:2rem;margin:0.3em 0;font-weight:700">${sceneCfg.title || ''}</h2>
      <p style="font-size:1rem;line-height:1.5;opacity:0.9">${sceneCfg.body || ''}</p>
      ${(sceneCfg.tags || []).map(t => `<span style="display:inline-block;margin:0.3em 0.4em 0 0;padding:0.2em 0.7em;border:1px solid rgba(255,255,255,0.5);border-radius:999px;font-size:0.8rem">${t}</span>`).join('')}
      ${sceneCfg.cta ? `<div style="margin-top:1em"><button style="pointer-events:auto;min-height:44px;min-width:44px;padding:0.6em 1.4em;border:none;border-radius:8px;background:${palette.accent || '#e8a33d'};color:${ctaTextColor};font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">${sceneCfg.cta}</button></div>` : ''}
    `;
    overlay.appendChild(el);
    return el;
  });

  // ---- route rail (Zeigarnik effect: a visible "how much is left" keeps ----
  // visitors scrolling — an unfinished sequence pulls attention more than a
  // finished one). One dot per scene; the current dwell range fills its dot.
  // Each hit area is a full 44x44px tap target (Fitts's law) even though the
  // visible dot is much smaller — a thumb is also driving scroll here, so a
  // near-miss tap is more disruptive mid-flight than on a static page.
  const rail = document.createElement('div');
  Object.assign(rail.style, {
    position: 'absolute', right: '18px', top: '50%', transform: 'translateY(-50%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'auto', zIndex: '2',
  });
  const railDots = scenes.map((_, i) => {
    const hit = document.createElement('button');
    hit.setAttribute('aria-label', `Ir a la escena ${i + 1} de ${scenes.length}`);
    Object.assign(hit.style, {
      width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', padding: '0', cursor: 'pointer',
    });
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      display: 'block', width: '8px', height: '8px', borderRadius: '50%',
      background: 'rgba(255,255,255,0.35)', transition: 'background 0.25s ease, transform 0.25s ease',
    });
    hit.appendChild(dot);
    hit.addEventListener('click', () => {
      const targetT = (i + 0.5) / scenes.length;
      const total = container.offsetHeight - window.innerHeight;
      window.scrollTo({ top: container.offsetTop + targetT * total, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    rail.appendChild(hit);
    return dot;
  });
  overlay.appendChild(rail);

  function updateRail(t) {
    const active = Math.min(scenes.length - 1, Math.floor(t * scenes.length));
    railDots.forEach((dot, i) => {
      const isActive = i === active;
      dot.style.background = isActive ? '#fff' : 'rgba(255,255,255,0.35)';
      dot.style.transform = isActive ? 'scale(1.4)' : 'scale(1)';
    });
  }

  // ---- crawlable SEO / no-JS content block --------------------------------
  // A WebGL page is invisible to crawlers and to anyone with JS disabled. Every
  // scene's copy also exists here as real, semantic, in-flow HTML — visually hidden
  // but fully readable by search engines, screen readers in browse mode, and
  // link-preview scrapers. Costs nothing at runtime.
  const seoBlock = document.createElement('div');
  seoBlock.setAttribute('data-sf-seo', '');
  Object.assign(seoBlock.style, {
    position: 'absolute', width: '1px', height: '1px', overflow: 'hidden',
    clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
  });
  seoBlock.innerHTML = scenes.map((s) => `
    <section>
      ${s.eyebrow ? `<p>${s.eyebrow}</p>` : ''}
      <h2>${s.title || ''}</h2>
      <p>${s.body || ''}</p>
      ${(s.tags || []).length ? `<ul>${s.tags.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
    </section>`).join('');
  container.appendChild(seoBlock);

  // ---- scroll driver: a tall spacer sets total scrollable length -----------
  const scrollLength = window.innerHeight * (scenes.length * 2.2);
  const spacer = document.createElement('div');
  spacer.style.height = `${scrollLength}px`;
  spacer.style.pointerEvents = 'none';
  container.appendChild(spacer);
  container.style.height = `${scrollLength}px`;

  let rafId = null;
  let disposed = false;
  // `running` is DERIVED from two independent pause reasons, never set directly —
  // see references/gotchas.md "Host-page integration": folding multiple reasons
  // into one flag means whichever handler fires last "wins," and a context-loss
  // event with no matching restore handler freezes the flight permanently even
  // after the browser recovers the context (confirmed happening with this exact
  // shape of bug during development — swiftshader/software-rendered contexts in
  // particular can drop and restore under load).
  let running = true;
  let isOnScreen = true;
  let contextLost = false;
  function updateRunning() { running = isOnScreen && !contextLost; }

  function currentScrollT() {
    const rect = container.getBoundingClientRect();
    const total = container.offsetHeight - window.innerHeight;
    if (total <= 0) return 0;
    const scrolled = -rect.top;
    return THREE.MathUtils.clamp(scrolled / total, 0, 1);
  }

  function updateCopyVisibility(t) {
    const dwellCenters = scenes.map((_, i) => (i + 0.5) / scenes.length);
    // Window half-width MUST be <= 0.5 * (spacing between centers) = 0.5/scenes.length,
    // or adjacent scenes' windows mathematically overlap and both show at opacity:1
    // simultaneously — two headlines stacked unreadably on top of each other at every
    // transition, in every build (found while testing example builds; confirmed the
    // previous 1.4 multiplier guarantees overlap for any scene count, since the
    // windows only avoid touching when multiplier <= 1). 0.9 keeps a small gap.
    const halfWidth = (0.5 / scenes.length) * 0.9;
    sectionEls.forEach((el, i) => {
      const dist = Math.abs(t - dwellCenters[i]);
      el.style.opacity = dist < halfWidth ? '1' : '0';
    });
  }

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function frame() {
    if (disposed) return;
    if (running) {
      const t = reducedMotion ? nearestDwellCenter(scenes.length, currentScrollT()) : ease(currentScrollT());
      updateCameraOnCurve(curve, camera, t);
      if (cameraFeel === 'swoop') applyBanking(curve, camera, t);
      updateCopyVisibility(reducedMotion ? t : ease.invertNearest ? t : t);
      updateRail(t);
      // Material animations (scrolling water ripples, etc). Frozen under
      // reduced-motion — the scene stays fully legible, just still.
      if (!reducedMotion && tickers.length) {
        const elapsed = (window.performance?.now?.() ?? Date.now()) / 1000;
        for (const tick of tickers) tick(elapsed);
      }
      renderer.render(scene, camera);
    }
    rafId = requestAnimationFrame(frame);
  }

  // Pause the render loop when off-screen — a live scene keeps costing GPU
  // even when unseen, unlike a paused video.
  const io = new IntersectionObserver((entries) => {
    isOnScreen = entries[0]?.isIntersecting ?? true;
    updateRunning();
  }, { threshold: 0 });
  io.observe(container);

  window.addEventListener('resize', resize);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    // dispose() releases the context on purpose (see forceContextLoss below), which
    // fires this handler synchronously — without the guard, tearing down would paint a
    // fallback card into the container on its way out.
    if (disposed) return;
    contextLost = true;
    updateRunning();
    renderStaticFallback(container, palette, scenes, /*keepExisting*/ true);
  });
  // Without this, a context that the browser successfully restores (Chromium logs
  // "Context Restored" — this is normal recovery, not a fatal error) leaves the
  // flight frozen forever, stuck showing the static fallback card.
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    if (disposed) return;
    contextLost = false;
    updateRunning();
    container.querySelector('[data-sf-fallback]')?.remove();
  });

  resize();
  frame();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      io.disconnect();
      window.removeEventListener('resize', resize);

      // Everything below is GPU memory, which dropping JS references does NOT free.
      // A mount/dispose cycle is the normal case in an SPA (route change, React
      // unmount), so anything missed here accumulates until the tab is reloaded.
      scene.traverse((obj) => {
        obj.geometry?.dispose?.();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m?.dispose?.());
      });
      materials.forEach((m) => m.dispose());
      Object.values(textures).forEach(tex => tex?.dispose?.());
      scene.background?.dispose?.();
      envRenderTarget.dispose();

      // renderer.dispose() tears down three's internal caches but does NOT release the
      // WebGL context — verified by reading three r186, where dispose() only clears
      // caches and forceContextLoss() is the sole caller of WEBGL_lose_context. Since
      // browsers cap how many contexts a page may hold at once, leaving each mount's
      // context alive until GC gets around to the canvas puts an SPA at the mercy of
      // collection timing for a resource it is supposed to own.
      renderer.forceContextLoss();
      renderer.dispose();

      // Remove only what this engine appended — the host may own other children of
      // `container`, which the previous `innerHTML = ''` destroyed along with them.
      pinWrapper.remove();
      seoBlock.remove();
      spacer.remove();
      container.style.height = prevInlineHeight;
      container.style.position = prevInlinePosition;
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry / curve helpers (see references/camera-path.md for the math notes)
// ---------------------------------------------------------------------------

function layoutAnchors(count, spacing = DEFAULT_SPACING, arcHeight = 4) {
  const anchors = [];
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    anchors.push(new THREE.Vector3(
      i * spacing,
      Math.sin(t * Math.PI) * arcHeight,
      Math.cos(t * Math.PI * 0.6) * spacing * 0.3,
    ));
  }
  return anchors;
}

function sceneControlPoints(anchor, forwardDir, sceneRadius) {
  const up = new THREE.Vector3(0, 1, 0);
  const approach = anchor.clone()
    .addScaledVector(forwardDir.clone().negate(), sceneRadius * 1.8)
    .addScaledVector(up, sceneRadius * 1.1);
  const dive = anchor.clone().addScaledVector(up, sceneRadius * 0.25);
  const depart = anchor.clone()
    .addScaledVector(forwardDir, sceneRadius * 1.6)
    .addScaledVector(up, sceneRadius * 0.9);
  return [approach, dive, depart];
}

function buildWorldCurve(anchors, sceneRadius) {
  const points = [];
  anchors.forEach((anchor, i) => {
    const next = anchors[i + 1] ?? anchor.clone().add(new THREE.Vector3(10, 0, 0));
    const prev = anchors[i - 1] ?? anchor.clone().sub(new THREE.Vector3(10, 0, 0));
    const forward = next.clone().sub(prev).normalize();
    points.push(...sceneControlPoints(anchor, forward, sceneRadius));
  });
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
}

function updateCameraOnCurve(curve, camera, t, lookAhead = 0.015) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  const pos = curve.getPointAt(clamped);
  const aheadT = THREE.MathUtils.clamp(clamped + lookAhead, 0, 1);
  const lookAt = curve.getPointAt(aheadT);
  camera.position.copy(pos);
  camera.lookAt(lookAt);
}

// The 5-frame smoothing window is per-flight STATE, so each mount gets its own via this
// factory. As a module-level array it was shared by every flyover on the page (two
// mounts fed each other's curvature into one history) and it survived dispose(), so a
// remount started banking from the previous flight's turns instead of level.
function createBanking(maxBankRad = 0.35) {
  const history = [];
  return function applyBanking(curve, camera, t) {
    const c0 = THREE.MathUtils.clamp(t, 0, 1);
    const c1 = THREE.MathUtils.clamp(t + 0.01, 0, 1);
    const tangent = curve.getTangentAt(c0);
    const tangentNext = curve.getTangentAt(c1);
    const curvature = tangentNext.clone().sub(tangent).length();
    history.push(curvature);
    if (history.length > 5) history.shift();
    const avgCurvature = history.reduce((a, b) => a + b, 0) / history.length;
    const bank = THREE.MathUtils.clamp(avgCurvature * 8, -maxBankRad, maxBankRad);
    camera.up.set(Math.sin(bank), Math.cos(bank), 0);
  };
}

function buildDwellEasing(sceneCount, dwellWeight = 2.5) {
  const segments = sceneCount * 2 - 1;
  const weights = [];
  for (let i = 0; i < segments; i++) weights.push(i % 2 === 0 ? dwellWeight : 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const boundaries = [0];
  weights.forEach(w => boundaries.push(boundaries[boundaries.length - 1] + w / total));
  const uniformStep = 1 / segments;

  const ease = function (t) {
    const seg = Math.min(Math.floor(t / uniformStep), segments - 1);
    const localT = (t - seg * uniformStep) / uniformStep;
    const a = boundaries[seg], b = boundaries[seg + 1];
    return a + localT * (b - a);
  };
  return ease;
}

function nearestDwellCenter(sceneCount, t) {
  const centers = Array.from({ length: sceneCount }, (_, i) => (i + 0.5) / sceneCount);
  return centers.reduce((best, c) => Math.abs(c - t) < Math.abs(best - t) ? c : best, centers[0]);
}

function makeGradientTexture(colorTop, colorBottom, size = 512) {
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

function renderStaticFallback(container, palette, scenes, keepExisting = false) {
  if (!keepExisting) container.innerHTML = '';
  const fallback = document.createElement('div');
  fallback.setAttribute('data-sf-fallback', ''); // lets webglcontextrestored remove just this
  Object.assign(fallback.style, {
    minHeight: '60vh', display: 'flex', flexDirection: 'column', justifyContent: 'center',
    alignItems: 'center', textAlign: 'center', padding: '2rem',
    background: `linear-gradient(${palette.colors[0]}, ${palette.colors[palette.colors.length - 1]})`,
    fontFamily: 'system-ui, sans-serif',
  });
  // Same reasoning as the copy overlay: the gradient stops are 3D-material hexes, not
  // WCAG-checked HTML colors, so fixed white text can land on a near-white stop. This
  // path also carries no-WebGL/reduced-motion visitors, so it must not silently fail.
  fallback.innerHTML = `<div style="background:rgba(10,10,16,0.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:12px;padding:1.3em 1.6em;color:#fff"><h2 style="font-size:1.6rem;margin:0 0 0.4em">${scenes[0]?.title || ''}</h2><p style="margin:0">${scenes[0]?.body || ''}</p></div>`;
  container.appendChild(fallback);
}
