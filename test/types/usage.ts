// Compiled by `npm run check:types`, never run. Imports the package by name, so it
// resolves through package.json `exports` exactly as a consumer's would — a broken
// `types` condition fails here, not only a wrong declaration.
//
// Each `@ts-expect-error` is a mistake the engine rejects at runtime; if the
// declarations stop rejecting it too, the directive itself becomes the error.
import * as THREE from 'three';
import {
  mountScrollFlyover,
  makeRng,
  readableTextColor,
  buildDwellEasing,
  layoutAnchors,
  type FlyoverConfig,
  type FlyoverHandle,
  type SceneBuilder,
} from 'scroll-flyover';
// The deep-import passthrough has to carry the same types.
import { escapeHtml } from 'scroll-flyover/references/scrub-engine.js';

const island: SceneBuilder = (materials, textures, { rng, performance, palette }) => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 0), materials[0]);
  mesh.castShadow = performance === 'rich';
  mesh.rotation.y = rng() * Math.PI;
  const photo = textures.hero;
  if (photo) mesh.material.map = photo;
  group.userData.tick = (elapsed: number) => { group.rotation.y = elapsed * 0.1; };
  void palette.colors.length;
  return group;
};

const config: FlyoverConfig = {
  palette: { colors: ['#0e1c2b', '#1d3a52'], accent: '#e8a33d', sky: 'extra keys pass through' },
  seed: 7,
  cameraFeel: 'glide',
  shapeLanguage: 'faceted-crystal',
  photos: { hero: '/hero.jpg' },
  layout: (n) => layoutAnchors(n, 30),
  clock: () => 0,
  labels: {
    goToScene: (i, total) => `Ir a la escena ${i} de ${total}`,
    ctaInScene: (label, title) => `${label} — ${title}`,
  },
  scenes: [
    { title: 'Arrival', body: 'Copy.', tags: ['a', 'b'], build: island },
    { title: 'Link', cta: 'Sign up', ctaHref: '/signup', build: island },
    {
      title: 'Button',
      cta: 'Play',
      onCta: (event, { index, scene }) => { void event.clientX; void index; void scene.title; },
      build: island,
    },
  ],
};

const handle: FlyoverHandle = mountScrollFlyover(document.createElement('div'), config);
const drew: boolean = handle.renderAt(0.4, { time: 1.2 });
handle.renderAt(1);
handle.resume();
handle.dispose();
void drew;

const rng = makeRng(3);
const n: number = rng();
const ink: '#000' | '#fff' = readableTextColor('#eee');
const ease = buildDwellEasing(4, 2.5);
void [n, ink, ease(0.5), escapeHtml(null)];

// ---- mistakes the engine throws on ----------------------------------------

// @ts-expect-error — scenes are required
mountScrollFlyover(document.body, { palette: { colors: ['#000'] } });

// @ts-expect-error — every scene needs a build function
mountScrollFlyover(document.body, { palette: { colors: ['#000'] }, scenes: [{ title: 'x' }] });

mountScrollFlyover(document.body, {
  palette: { colors: ['#000'] },
  // @ts-expect-error — ctaHref and onCta are exclusive: an element is a link or a button
  scenes: [{ build: island, cta: 'Go', ctaHref: '/x', onCta: () => {} }],
});

mountScrollFlyover(document.body, {
  palette: { colors: ['#000'] },
  // @ts-expect-error — a destination with no label has nothing to render
  scenes: [{ build: island, ctaHref: '/x' }],
});

mountScrollFlyover(document.body, {
  palette: { colors: ['#000'] },
  scenes: [{ build: island }],
  // @ts-expect-error — a label function, not a fixed string (every dot would share it)
  labels: { goToScene: 'Go' },
});

// @ts-expect-error — time is an option, not a positional argument
handle.renderAt(0.5, 1.2);
