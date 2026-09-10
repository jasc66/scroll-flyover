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
 * Accepts both `#rgb` and `#rrggbb`: the shorthand form used to fall through the
 * 6-digit path and parse its third channel from an empty string, yielding NaN
 * luminance — which readableTextColor below silently read as "dark", so `#eee`
 * got white text on a near-white background.
 */
export function relativeLuminance(hex) {
  let c = String(hex).trim().replace(/^#/, '');
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.substring(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// 0.179 is the luminance where black-on-bg and white-on-bg contrast ratios cross over —
// below it white text reads better, above it black does. Palettes are 3D-material hexes
// picked for how they look lit in WebGL, not validated as flat HTML colors (see
// references/gotchas.md), so a build's accent can land on either side.
//
// The dark option is pure black rather than the softer #111 it used to be, because
// 0.179 is only the crossover for BLACK: #111 is not quite black, so around the
// crossover it returned 4.12:1 where the constant promised 4.58:1 — under the 4.5:1
// AA floor this function exists to hold. Either the constant or the color had to move,
// and moving the color keeps the guarantee provable at every luminance (worst case is
// now 4.58:1, exactly at the crossover).
export function readableTextColor(bgHex) {
  return relativeLuminance(bgHex) > 0.179 ? '#000' : '#fff';
}

/**
 * Scene copy is interpolated into markup, so it has to be escaped: as a vendored copy
 * of this file the strings were authored by whoever wrote the page, but an installed
 * library gets fed CMS/API content, and an unescaped `"` is enough to break out of an
 * attribute and inject one. Escapes `&` first so the other replacements aren't
 * double-encoded.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Every string the engine itself puts in front of a user. Functions rather than
 * templates because word order is not translatable with placeholders alone. English is
 * the default because the label ends up in the DOM of whatever site installs this —
 * override via `config.labels` to match the host page's language.
 */
const DEFAULT_LABELS = {
  goToScene: (index, total) => `Go to scene ${index} of ${total}`,
};

/**
 * Theming (opt-in, additive since 1.2.0): every color/blur/radius the overlay paints
 * is still a plain inline style, but the VALUE is `var(--sf-x, <default>)` instead of
 * a literal. A custom property set anywhere on `container` or an ancestor cascades down
 * to it exactly like `color` would — inline styles consult the cascade for the variable
 * even though the property itself can't be overridden from outside. Until a consumer
 * sets one of these, every default below reproduces the pre-1.2.0 hardcoded look
 * exactly, so this is non-breaking.
 */
const THEME_VARS = {
  overlayBg: ['--sf-overlay-bg', 'rgba(10,10,16,0.62)'],
  overlayBlur: ['--sf-overlay-blur', '6px'],
  overlayRadius: ['--sf-overlay-radius', '12px'],
  overlayPadding: ['--sf-overlay-padding', '1.1em 1.3em'],
  textColor: ['--sf-text-color', '#fff'],
  tagBorder: ['--sf-tag-border', 'rgba(255,255,255,0.5)'],
  ctaBg: ['--sf-cta-bg', '#e8a33d'],
  ctaTextColor: ['--sf-cta-text-color', '#fff'],
  ctaRadius: ['--sf-cta-radius', '8px'],
  railDot: ['--sf-rail-dot', 'rgba(255,255,255,0.35)'],
  railDotActive: ['--sf-rail-dot-active', '#fff'],
  // Layout, themable for the same reason the colours are: the defaults below are
  // tuned for this engine's own overlay, and a consumer laying their own chrome over
  // the canvas needs to move the copy panel out from under it without forking.
  // railGutter reserves the rail's 18px offset + 44px tap target + 12px breathing
  // room; set it to 0px if you hide the rail.
  railGutter: ['--sf-rail-gutter', '74px'],
  panelInline: ['--sf-panel-inline', '6%'],
  panelBottom: ['--sf-panel-bottom', '10%'],
  panelMaxWidth: ['--sf-panel-max-width', '440px'],
  titleSize: ['--sf-title-size', 'clamp(1.35rem, 5.2vw, 2rem)'],
  bodySize: ['--sf-body-size', 'clamp(0.9rem, 3.4vw, 1rem)'],
};
// `fallback` overrides the static default above — used where the real default is
// derived per-build (the CTA's palette accent / computed readable text color) rather
// than a fixed constant.
function cssVar(key, fallback) {
  const [name, defaultValue] = THEME_VARS[key];
  return `var(${name}, ${fallback ?? defaultValue})`;
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

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function typeName(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function fail(message) {
  throw new Error(`scroll-flyover: ${message}`);
}

/**
 * Fails fast, and in this engine's own words, on the config mistakes that otherwise
 * surface as something unrecognisable: a Three.js stack trace from deep inside a
 * constructor, or — worse — no error at all and a page that renders black. Runs before
 * any DOM or WebGL work on purpose, so the message names the property the caller got
 * wrong rather than the internal that tripped over it, and so it is reachable from a
 * plain Node test with no browser.
 *
 * Deliberately NOT validated: `shapeLanguage`, which is handed through to every
 * scene builder untouched and so may legitimately carry a vocabulary this file has
 * never heard of.
 */
function validateMountArgs(container, config) {
  if (!container || typeof container.appendChild !== 'function') {
    fail(
      `mountScrollFlyover(container, config) needs a DOM element as its first argument, got ${typeName(container)}. ` +
      `If that came from document.querySelector(), it returned null: the element is not in the document yet. ` +
      `Mount from an effect/onMounted hook, or after DOMContentLoaded.`,
    );
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail(`config must be an object, got ${typeName(config)}.`);
  }

  const { palette, scenes, seed, dwellWeight, layout, photos, labels, performance, cameraFeel } = config;

  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) {
    fail(`config.palette must be an object like { colors: ['#0e1c2b', '#1d3a52'], accent: '#e8a33d' }, got ${typeName(palette)}.`);
  }
  if (!Array.isArray(palette.colors) || palette.colors.length === 0) {
    fail(
      `config.palette.colors must be a non-empty array of CSS colors, got ${typeName(palette.colors)}. ` +
      `It is the source of the sky gradient, the fog, and one material per entry, so an empty palette leaves nothing to render with.`,
    );
  }
  palette.colors.forEach((color, i) => {
    if (typeof color !== 'string' || !color.trim()) {
      fail(`config.palette.colors[${i}] must be a non-empty CSS color string, got ${typeName(color)}.`);
    }
  });
  if (palette.accent !== undefined && (typeof palette.accent !== 'string' || !HEX_COLOR.test(palette.accent.trim()))) {
    fail(
      `config.palette.accent must be a hex color such as '#e8a33d' or '#fc0', got ${typeName(palette.accent)}. ` +
      `Hex specifically: the CTA's text color is chosen by measuring the accent's WCAG luminance, and a named or ` +
      `rgb() color has no channels to measure — the button would silently paint unreadable text on itself.`,
    );
  }

  if (!Array.isArray(scenes) || scenes.length === 0) {
    fail(`config.scenes must be a non-empty array — one entry per stop on the flight. Got ${typeName(scenes)}.`);
  }
  scenes.forEach((sceneCfg, i) => {
    if (!sceneCfg || typeof sceneCfg !== 'object' || Array.isArray(sceneCfg)) {
      fail(`config.scenes[${i}] must be an object, got ${typeName(sceneCfg)}.`);
    }
    if (typeof sceneCfg.build !== 'function') {
      fail(
        `config.scenes[${i}].build must be a function ` +
        `(materials, textures, { rng, performance, shapeLanguage, palette }) => THREE.Group, got ${typeName(sceneCfg.build)}.`,
      );
    }
  });

  if (seed !== undefined && !Number.isFinite(seed)) {
    fail(
      `config.seed must be a finite number, got ${typeName(seed)}. ` +
      `The RNG coerces whatever it is given through a bitwise operator, so a non-numeric seed collapses to 0 without ` +
      `complaining — every build seeded that way would come out identical instead of unique to itself.`,
    );
  }

  if (dwellWeight !== undefined && (!Number.isFinite(dwellWeight) || dwellWeight <= 0)) {
    fail(
      `config.dwellWeight must be a finite number greater than 0 (2–3 is the useful range), got ${typeName(dwellWeight)}. ` +
      `At 0 the easing's weights sum to 0, every segment boundary becomes NaN, and the camera is moved to NaN — a page ` +
      `that renders nothing and reports no error.`,
    );
  }

  if (layout !== undefined && layout !== null && typeof layout !== 'function') {
    fail(`config.layout must be a function (sceneCount) => THREE.Vector3[], got ${typeName(layout)}.`);
  }

  if (photos !== undefined && photos !== null) {
    if (typeof photos !== 'object' || Array.isArray(photos)) {
      fail(`config.photos must be an object mapping names to image URLs, got ${typeName(photos)}.`);
    }
    Object.entries(photos).forEach(([key, url]) => {
      if (typeof url !== 'string' || !url.trim()) {
        fail(`config.photos[${JSON.stringify(key)}] must be an image URL string, got ${typeName(url)}.`);
      }
    });
  }

  if (labels !== undefined && labels !== null) {
    if (typeof labels !== 'object' || Array.isArray(labels)) {
      fail(`config.labels must be an object, got ${typeName(labels)}.`);
    }
    if (labels.goToScene !== undefined && typeof labels.goToScene !== 'function') {
      fail(
        `config.labels.goToScene must be a function (index, total) => string, got ${typeName(labels.goToScene)}. ` +
        `It is called once per rail dot, so a fixed string would give every dot the same aria-label.`,
      );
    }
  }

  // Warnings, not errors: an unrecognised value here still renders a correct page, just
  // a quieter one than the caller asked for, and throwing would break a build that has
  // been shipping happily with a typo in it.
  if (performance !== undefined && performance !== 'rich' && performance !== 'light') {
    console.warn(`scroll-flyover: config.performance should be 'rich' or 'light'; ${JSON.stringify(performance)} behaves as 'light' (no shadows).`);
  }
  if (cameraFeel !== undefined && cameraFeel !== 'swoop' && cameraFeel !== 'glide') {
    console.warn(`scroll-flyover: config.cameraFeel should be 'swoop' or 'glide'; ${JSON.stringify(cameraFeel)} behaves as 'glide' (no banking).`);
  }
}

export function mountScrollFlyover(container, config) {
  validateMountArgs(container, config);

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
    labels = {},
  } = config;

  const text = { ...DEFAULT_LABELS, ...labels };

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
  // `vh` above is the fallback; `dvh` follows a mobile browser's URL bar as it
  // collapses and expands, which `vh` does not — a `100vh` pin is taller than the
  // visible area whenever the bar is showing, so the bottom of the overlay sits below
  // the fold on exactly the devices where there is least room. setProperty is how the
  // progressive enhancement is expressed: a browser without `dvh` drops this as an
  // invalid value and keeps the `100vh` already set above.
  pinWrapper.style.setProperty('height', '100dvh');
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
  // A custom layout that returns the wrong shape otherwise fails several lines later as
  // "cannot read properties of undefined", pointing at the engine rather than at the
  // layout function the caller wrote.
  if (!Array.isArray(anchors) || anchors.length < scenes.length) {
    fail(
      `config.layout(${scenes.length}) must return an array of at least ${scenes.length} THREE.Vector3 positions ` +
      `(one per scene), got ${typeName(anchors)}${Array.isArray(anchors) ? ` of length ${anchors.length}` : ''}.`,
    );
  }
  const tickers = []; // groups exposing userData.tick(elapsed) — e.g. animated water
  scenes.forEach((sceneCfg, i) => {
    // Each scene gets its OWN deterministic stream, derived from the build seed, so
    // editing scene 3 never reshuffles scene 1's prop placement.
    const rng = makeRng(seed + i * 7919);
    const group = sceneCfg.build(materials, textures, {
      shapeLanguage, performance: effectivePerf, rng, palette,
    });
    // A builder that computes its group but forgets to return it is the single easiest
    // mistake to make here, and undefined.position is not a message anyone can act on.
    if (!group || !group.isObject3D) {
      fail(
        `config.scenes[${i}].build() must return a THREE.Object3D (usually a THREE.Group), got ${typeName(group)}. ` +
        `A builder that ends without an explicit \`return group\` returns undefined.`,
      );
    }
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
      // `right` is what keeps the copy off the route rail. Without it the panel is
      // shrink-to-fit against the whole viewport, so on a narrow screen its text runs
      // underneath the rail's 44px tap targets; it also made maxWidth meaningless
      // below ~470px, since the available width bound first. The env() insets keep the
      // panel clear of a notch in landscape and of the home indicator.
      position: 'absolute',
      left: `calc(${cssVar('panelInline')} + env(safe-area-inset-left, 0px))`,
      right: `calc(${cssVar('railGutter')} + env(safe-area-inset-right, 0px))`,
      bottom: `calc(${cssVar('panelBottom')} + env(safe-area-inset-bottom, 0px))`,
      maxWidth: cssVar('panelMaxWidth'), boxSizing: 'border-box',
      opacity: '0', transition: 'opacity 0.5s ease', color: cssVar('textColor'),
      fontFamily: 'system-ui, sans-serif',
      // A flat text-shadow over live WebGL isn't reliable contrast — the scene
      // gradient behind this panel is picked per-build for how it looks lit, not
      // for HTML contrast (references/gotchas.md), and can land near-white (e.g.
      // a light palette's top stop), leaving white text unreadable. A solid-ish
      // scrim guarantees contrast against ANY background, unlike a blur shadow.
      // Overriding --sf-overlay-bg/--sf-text-color is the consumer's job to keep
      // that contrast if they retheme it (see README "Theming").
      background: cssVar('overlayBg'),
      backdropFilter: `blur(${cssVar('overlayBlur')})`,
      WebkitBackdropFilter: `blur(${cssVar('overlayBlur')})`,
      padding: cssVar('overlayPadding'), borderRadius: cssVar('overlayRadius'),
    });
    const accent = palette.accent || '#e8a33d';
    const ctaTextColor = readableTextColor(accent);
    el.innerHTML = `
      ${sceneCfg.eyebrow ? `<div style="letter-spacing:0.1em;text-transform:uppercase;font-size:0.75rem;opacity:0.8">${escapeHtml(sceneCfg.eyebrow)}</div>` : ''}
      <h2 style="font-size:${cssVar('titleSize')};margin:0.3em 0;font-weight:700">${escapeHtml(sceneCfg.title || '')}</h2>
      <p style="font-size:${cssVar('bodySize')};line-height:1.5;opacity:0.9">${escapeHtml(sceneCfg.body || '')}</p>
      ${(sceneCfg.tags || []).map(t => `<span style="display:inline-block;margin:0.3em 0.4em 0 0;padding:0.2em 0.7em;border:1px solid ${cssVar('tagBorder')};border-radius:999px;font-size:0.8rem">${escapeHtml(t)}</span>`).join('')}
      ${sceneCfg.cta ? `<div style="margin-top:1em"><button style="pointer-events:auto;min-height:44px;min-width:44px;padding:0.6em 1.4em;border:none;border-radius:${cssVar('ctaRadius')};background:${cssVar('ctaBg', escapeHtml(accent))};color:${cssVar('ctaTextColor', ctaTextColor)};font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">${escapeHtml(sceneCfg.cta)}</button></div>` : ''}
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
    position: 'absolute', right: 'calc(18px + env(safe-area-inset-right, 0px))',
    top: '50%', transform: 'translateY(-50%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'auto', zIndex: '2',
  });
  const railDots = scenes.map((_, i) => {
    const hit = document.createElement('button');
    hit.setAttribute('aria-label', text.goToScene(i + 1, scenes.length));
    Object.assign(hit.style, {
      width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', padding: '0', cursor: 'pointer',
    });
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      display: 'block', width: '8px', height: '8px', borderRadius: '50%',
      background: cssVar('railDot'), transition: 'background 0.25s ease, transform 0.25s ease',
    });
    hit.appendChild(dot);
    hit.addEventListener('click', () => {
      const targetT = (i + 0.5) / scenes.length;
      const total = scrollTotal();
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
      dot.style.background = isActive ? cssVar('railDotActive') : cssVar('railDot');
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
      ${s.eyebrow ? `<p>${escapeHtml(s.eyebrow)}</p>` : ''}
      <h2>${escapeHtml(s.title || '')}</h2>
      <p>${escapeHtml(s.body || '')}</p>
      ${(s.tags || []).length ? `<ul>${s.tags.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
    </section>`).join('');
  container.appendChild(seoBlock);

  // ---- scroll driver: a tall spacer sets total scrollable length -----------
  // This used to be computed once, at mount, and written as fixed pixels — while
  // currentScrollT() divided by the LIVE window.innerHeight. Numerator frozen,
  // denominator moving: after a phone rotation from 640px to 360px tall, the flight
  // stretched to ~1.8x its intended length and every scene's dwell window fell out of
  // step with where its copy fades. viewportBasis pins the divisor to the same height
  // the spacer was built from, so the two can never disagree again.
  let scrollLength = 0;
  let viewportBasis = 0;
  let lastLayoutWidth = 0;
  const spacer = document.createElement('div');
  spacer.style.pointerEvents = 'none';
  // Chromium's scroll anchoring tries to keep whatever is on screen on screen when
  // content resizes, which here means it fights the corrective scroll below: measured
  // 1740px where 1950px was asked for after a rotation. The spacer is an empty strut,
  // so there is nothing about it worth anchoring to.
  spacer.style.overflowAnchor = 'none';
  container.appendChild(spacer);

  function applyScrollLength() {
    viewportBasis = window.innerHeight;
    lastLayoutWidth = container.clientWidth || window.innerWidth;
    scrollLength = viewportBasis * (scenes.length * 2.2);
    spacer.style.height = `${scrollLength}px`;
    container.style.height = `${scrollLength}px`;
  }
  function scrollTotal() { return scrollLength - viewportBasis; }
  applyScrollLength();

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
    const total = scrollTotal();
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

    // Deliberately NOT rebuilding the scroll length on every resize. On mobile this
    // event fires continuously while scrolling, as the URL bar collapses and expands,
    // and re-laying out there would fight the user's own scroll with a corrective
    // scrollTo on every frame of it. A width change is the signal that the viewport
    // really changed shape — rotation, or a resized window — and that is when the
    // spacer has to be rebuilt.
    if (w === lastLayoutWidth) return;
    const t = currentScrollT();
    applyScrollLength();
    // Rebuilding the spacer moves every pixel offset underneath the visitor, so
    // restore the position in the flight they were at rather than the scrollTop they
    // happened to be on — otherwise a rotation drops them somewhere else in the story.
    // Deferred a frame on purpose: applied synchronously here it races the browser's
    // own post-resize scroll adjustment and loses.
    const restore = () => {
      const total = scrollTotal();
      if (total > 0) {
        window.scrollTo({ top: container.offsetTop + t * total, behavior: 'auto' });
      }
    };
    restore();
    requestAnimationFrame(restore);
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

export function layoutAnchors(count, spacing = DEFAULT_SPACING, arcHeight = 4) {
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

export function sceneControlPoints(anchor, forwardDir, sceneRadius) {
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

export function buildWorldCurve(anchors, sceneRadius) {
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

export function buildDwellEasing(sceneCount, dwellWeight = 2.5) {
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

export function nearestDwellCenter(sceneCount, t) {
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
  fallback.innerHTML = `<div style="background:${cssVar('overlayBg')};backdrop-filter:blur(${cssVar('overlayBlur')});-webkit-backdrop-filter:blur(${cssVar('overlayBlur')});border-radius:${cssVar('overlayRadius')};padding:${cssVar('overlayPadding', '1.3em 1.6em')};color:${cssVar('textColor')}"><h2 style="font-size:1.6rem;margin:0 0 0.4em">${escapeHtml(scenes[0]?.title || '')}</h2><p style="margin:0">${escapeHtml(scenes[0]?.body || '')}</p></div>`;
  container.appendChild(fallback);
}
