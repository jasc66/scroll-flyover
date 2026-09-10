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
