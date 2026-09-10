import test from 'node:test';
import assert from 'node:assert/strict';
import { mountScrollFlyover } from '../references/scrub-engine.js';

// Config is validated before the engine touches the DOM, which is what lets these run
// in plain Node with no browser: a container only has to look like one to get past the
// first check, and nothing further along is reached on the failing paths below.
const fakeContainer = () => ({ style: {}, appendChild() {}, querySelector: () => null });

const validScene = { title: 'Arrival', build: () => ({ isObject3D: true, position: { copy() {} } }) };
const validConfig = (overrides = {}) => ({
  palette: { colors: ['#0e1c2b', '#1d3a52'], accent: '#e8a33d' },
  scenes: [validScene],
  ...overrides,
});

function expectRejection(container, config, matcher) {
  assert.throws(() => mountScrollFlyover(container, config), (error) => {
    assert.ok(error instanceof Error, 'not an Error');
    assert.match(error.message, /^scroll-flyover: /, `unprefixed message: ${error.message}`);
    assert.match(error.message, matcher);
    return true;
  });
}

test('a null container is named as such, with the usual cause', () => {
  expectRejection(null, validConfig(), /DOM element.*querySelector\(\).*returned null/s);
  expectRejection(undefined, validConfig(), /got undefined/);
  expectRejection('#world', validConfig(), /got a string/);
});

test('a missing or non-object config is rejected', () => {
  expectRejection(fakeContainer(), undefined, /config must be an object, got undefined/);
  expectRejection(fakeContainer(), null, /config must be an object, got null/);
  expectRejection(fakeContainer(), [], /config must be an object, got an array/);
});

test('the palette must actually contain colors', () => {
  expectRejection(fakeContainer(), { scenes: [validScene] }, /config\.palette must be an object/);
  expectRejection(fakeContainer(), validConfig({ palette: { colors: [] } }), /palette\.colors must be a non-empty array/);
  expectRejection(fakeContainer(), validConfig({ palette: { colors: '#fff' } }), /palette\.colors must be a non-empty array of CSS colors, got a string/);
  expectRejection(fakeContainer(), validConfig({ palette: { colors: ['#fff', 42] } }), /palette\.colors\[1\].*got a number/);
});

test('a non-hex accent is refused, because its contrast cannot be measured', () => {
  // A named color renders fine as the button's background and then silently defeats
  // the luminance check that picks the button's text color.
  expectRejection(fakeContainer(), validConfig({ palette: { colors: ['#fff'], accent: 'orange' } }), /accent must be a hex color/);
  expectRejection(fakeContainer(), validConfig({ palette: { colors: ['#fff'], accent: 'rgb(255,0,0)' } }), /accent must be a hex color/);
  expectRejection(fakeContainer(), validConfig({ palette: { colors: ['#fff'], accent: 0xe8a33d } }), /accent must be a hex color/);
});

test('scenes must be a non-empty array of builders', () => {
  expectRejection(fakeContainer(), validConfig({ scenes: [] }), /scenes must be a non-empty array/);
  expectRejection(fakeContainer(), validConfig({ scenes: undefined }), /scenes must be a non-empty array/);
  expectRejection(fakeContainer(), validConfig({ scenes: [validScene, null] }), /scenes\[1\] must be an object/);
  expectRejection(fakeContainer(), validConfig({ scenes: [{ title: 'no builder' }] }), /scenes\[0\]\.build must be a function/);
  expectRejection(fakeContainer(), validConfig({ scenes: [validScene, { build: 'nope' }] }), /scenes\[1\]\.build must be a function.*got a string/s);
});

test('a non-numeric seed is refused rather than silently collapsing to 0', () => {
  // `seed >>> 0` turns any non-numeric value into 0, so without this check every
  // build seeded with a string would render identically to every other one.
  expectRejection(fakeContainer(), validConfig({ seed: 'my-brand' }), /seed must be a finite number/);
  expectRejection(fakeContainer(), validConfig({ seed: NaN }), /seed must be a finite number/);
  expectRejection(fakeContainer(), validConfig({ seed: null }), /seed must be a finite number/);
  expectRejection(fakeContainer(), validConfig({ seed: Infinity }), /seed must be a finite number/);
});

test('dwellWeight must be positive, since 0 renders nothing at all', () => {
  expectRejection(fakeContainer(), validConfig({ dwellWeight: 0 }), /dwellWeight must be a finite number greater than 0/);
  expectRejection(fakeContainer(), validConfig({ dwellWeight: -2 }), /dwellWeight must be a finite number greater than 0/);
  expectRejection(fakeContainer(), validConfig({ dwellWeight: '2.5' }), /dwellWeight must be a finite number greater than 0/);
});

test('the remaining optional properties are shape-checked', () => {
  expectRejection(fakeContainer(), validConfig({ layout: [1, 2, 3] }), /layout must be a function/);
  expectRejection(fakeContainer(), validConfig({ photos: 'hero.jpg' }), /photos must be an object/);
  expectRejection(fakeContainer(), validConfig({ photos: { hero: null } }), /photos\["hero"\] must be an image URL string/);
  expectRejection(fakeContainer(), validConfig({ labels: { goToScene: 'Ir a la escena' } }), /labels\.goToScene must be a function/);
  // A fixed string here is the tempting mistake — it reads like a label but is spoken
  // on every scene change, so all of them would announce the same thing.
  expectRejection(fakeContainer(), validConfig({ labels: { sceneAnnouncement: 'Escena' } }), /labels\.sceneAnnouncement must be a function/);
});

test('a valid config gets past validation untouched', () => {
  // It cannot mount here — there is no window — but the failure must come from the
  // browser being absent, not from the validator rejecting good input.
  const configs = [
    validConfig(),
    validConfig({ seed: 0 }),
    validConfig({ seed: -20260906 }),
    validConfig({ dwellWeight: 0.1 }),
    validConfig({ palette: { colors: ['red', 'rgb(0,0,0)', '#fc0'] } }),
    validConfig({ palette: { colors: ['#fff'], accent: '#FC0' } }),
    validConfig({ layout: () => [], photos: { hero: '/hero.jpg' }, labels: { goToScene: () => 'x' } }),
    validConfig({ labels: { sceneAnnouncement: (i, total, title) => `${i}/${total} ${title}` } }),
  ];
  for (const config of configs) {
    try {
      mountScrollFlyover(fakeContainer(), config);
    } catch (error) {
      assert.doesNotMatch(
        error.message,
        /^scroll-flyover: /,
        `valid config was rejected: ${error.message}`,
      );
    }
  }
});

test('an unrecognised enum warns instead of throwing', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    for (const config of [validConfig({ performance: 'high' }), validConfig({ cameraFeel: 'smooth' })]) {
      try {
        mountScrollFlyover(fakeContainer(), config);
      } catch (error) {
        assert.doesNotMatch(error.message, /^scroll-flyover: /, `should not throw: ${error.message}`);
      }
    }
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /config\.performance should be 'rich' or 'light'/);
  assert.match(warnings[1], /config\.cameraFeel should be 'swoop' or 'glide'/);
});

// --- the CTA's destination (1.6.0) -----------------------------------------
// Up to 1.5.1 a `cta` string painted a <button> with no handler, no href and no
// documented way to attach one. These cover the two ways to give it something to do,
// and the one case that is warned about rather than thrown on.
const ctaScene = (extra) => ({ ...validScene, cta: 'Start', ...extra });

test('a CTA cannot be a link and a button at the same time', () => {
  // Which one is set decides which ELEMENT is rendered, so "both" has no rendering.
  expectRejection(fakeContainer(), validConfig({ scenes: [ctaScene({ ctaHref: '/signup', onCta: () => {} })] }),
    /sets both ctaHref and onCta — pick one/);
});

test('a CTA destination must be the shape it claims to be', () => {
  expectRejection(fakeContainer(), validConfig({ scenes: [ctaScene({ ctaHref: '' })] }), /ctaHref must be a non-empty URL string/);
  expectRejection(fakeContainer(), validConfig({ scenes: [ctaScene({ ctaHref: '   ' })] }), /ctaHref must be a non-empty URL string/);
  expectRejection(fakeContainer(), validConfig({ scenes: [ctaScene({ ctaHref: 42 })] }), /ctaHref must be.*got a number/s);
  expectRejection(fakeContainer(), validConfig({ scenes: [ctaScene({ onCta: 'go()' })] }), /onCta must be a function.*got a string/s);
});

test('a destination with no label has nothing to render', () => {
  // The label is both the visible text and the accessible name.
  expectRejection(fakeContainer(), validConfig({ scenes: [{ ...validScene, ctaHref: '/signup' }] }),
    /destination but no cta label/);
  expectRejection(fakeContainer(), validConfig({ scenes: [{ ...validScene, onCta: () => {} }] }),
    /destination but no cta label/);
});

test('a CTA with nowhere to go warns and names the scene, rather than throwing', () => {
  // Throwing here would turn a button that has never worked into a page that renders
  // nothing at all — a worse failure than the one being fixed.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    // The mount goes on to fail in Node for want of a DOM; the warning is what matters,
    // and it is emitted during validation, before any of that is reached.
    try { mountScrollFlyover(fakeContainer(), validConfig({ scenes: [validScene, ctaScene()] })); } catch { /* no DOM in Node */ }
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 1, `expected exactly one warning, got ${warnings.length}`);
  assert.match(warnings[0], /^scroll-flyover: config\.scenes\[1\]\.cta is "Start"/);
  assert.match(warnings[0], /no button is rendered/);
  assert.match(warnings[0], /ctaHref/);
  assert.match(warnings[0], /onCta/);
});

test('a CTA that can act does not warn', () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    try { mountScrollFlyover(fakeContainer(), validConfig({ scenes: [ctaScene({ ctaHref: '/signup' })] })); } catch { /* no DOM in Node */ }
    try { mountScrollFlyover(fakeContainer(), validConfig({ scenes: [ctaScene({ onCta: () => {} })] })); } catch { /* no DOM in Node */ }
  } finally {
    console.warn = realWarn;
  }
  assert.deepEqual(warnings, []);
});

test('the CTA accessible-name label can be overridden, and must be a function', () => {
  expectRejection(fakeContainer(), validConfig({ labels: { ctaInScene: 'Start — {title}' } }),
    /labels\.ctaInScene must be a function.*WCAG 2\.5\.3/s);
});
