import test from 'node:test';
import assert from 'node:assert/strict';
import { mountScrollFlyover } from '../references/scrub-engine.js';
import { createEffects, resolveEffectsOptions } from '../references/scrub-effects.js';

// The passes themselves need a GPU and are checked by `npm run qa:render`. What Node
// can reach is everything decided before the first frame: which options are valid,
// what they default to, and what the engine accepts as a hook.

const fakeContainer = () => ({ style: {}, appendChild() {}, querySelector: () => null });
const validConfig = (overrides = {}) => ({
  palette: { colors: ['#0e1c2b', '#1d3a52'] },
  scenes: [{ build: () => ({ isObject3D: true, position: { copy() {} } }) }],
  ...overrides,
});

function rejects(fn, matcher) {
  assert.throws(fn, (error) => {
    assert.match(error.message, /^scroll-flyover: /, `unprefixed message: ${error.message}`);
    assert.match(error.message, matcher);
    return true;
  });
}

test('every effect is off unless named', () => {
  assert.deepEqual(resolveEffectsOptions(), { grain: 0, motionBlur: null });
  assert.deepEqual(resolveEffectsOptions({}), { grain: 0, motionBlur: null });
  assert.deepEqual(resolveEffectsOptions({ grain: false, motionBlur: false }), { grain: 0, motionBlur: null });
});

test('true turns an effect on with its defaults', () => {
  const resolved = resolveEffectsOptions({ grain: true, motionBlur: true });
  assert.equal(resolved.grain, 0.06);
  assert.deepEqual(resolved.motionBlur, { shutter: 0.5, samples: 8, maxPixels: 48 });
});

test('an object overrides only what it names', () => {
  const resolved = resolveEffectsOptions({ grain: { amount: 0.1 }, motionBlur: { samples: 4 } });
  assert.equal(resolved.grain, 0.1);
  assert.deepEqual(resolved.motionBlur, { shutter: 0.5, samples: 4, maxPixels: 48 });
  assert.equal(resolveEffectsOptions({ grain: {} }).grain, 0.06);
});

test('a closed shutter or a zero-length smear is no blur, not an empty pass', () => {
  assert.equal(resolveEffectsOptions({ motionBlur: { shutter: 0 } }).motionBlur, null);
  assert.equal(resolveEffectsOptions({ motionBlur: { maxPixels: 0 } }).motionBlur, null);
});

test('options outside their range are rejected by name', () => {
  rejects(() => resolveEffectsOptions({ grain: { amount: 2 } }), /grain: \{ amount \} \}\) must be a number from 0 to 0\.5, got a number 2/);
  rejects(() => resolveEffectsOptions({ grain: { amount: '0.1' } }), /amount.*got a string/);
  rejects(() => resolveEffectsOptions({ motionBlur: { shutter: 1.5 } }), /shutter.*from 0 to 1/);
  rejects(() => resolveEffectsOptions({ motionBlur: { samples: 1 } }), /samples.*from 2 to 32/);
  rejects(() => resolveEffectsOptions({ motionBlur: { samples: 4.5 } }), /samples.*whole number/);
  rejects(() => resolveEffectsOptions({ motionBlur: { maxPixels: NaN } }), /maxPixels/);
});

test('the wrong shape for an option, or an option that does not exist, is rejected', () => {
  rejects(() => resolveEffectsOptions('grain'), /needs an object.*got a string/);
  rejects(() => resolveEffectsOptions({ grain: 0.1 }), /grain \}\) must be true, false or \{ amount \}, got a number/);
  rejects(() => resolveEffectsOptions({ motionBlur: 'fast' }), /motionBlur \}\) must be true, false or/);
  rejects(() => resolveEffectsOptions({ bloom: true }), /no "bloom" option\. The effects are grain and motionBlur/);
  rejects(() => createEffects({ dof: true }), /no "dof" option/);
});

test('createEffects returns the hook the engine takes', () => {
  const effects = createEffects({ grain: true });
  assert.equal(typeof effects.render, 'function');
  assert.equal(typeof effects.dispose, 'function');
  // Nothing is allocated until the first frame, so disposing an unused one is safe.
  assert.doesNotThrow(() => effects.dispose());
});

test('config.effects must be a hook with a render function', () => {
  const mount = (effects) => () => mountScrollFlyover(fakeContainer(), validConfig({ effects }));
  rejects(mount(true), /config\.effects must be an object with a render\(renderer, scene, camera, frame\) method.*got a boolean/s);
  rejects(mount({}), /got an object without a render function/);
  rejects(mount({ render: 'yes' }), /without a render function/);
  rejects(mount({ render() {}, dispose: 1 }), /config\.effects\.dispose must be a function, got a number/);
});

test('a valid hook, or none, gets past validation', () => {
  for (const effects of [undefined, null, { render() {} }, createEffects(), createEffects({ grain: true, motionBlur: true })]) {
    try {
      mountScrollFlyover(fakeContainer(), validConfig({ effects }));
    } catch (error) {
      // No window in Node: it fails on the browser being absent, not on the config.
      assert.doesNotMatch(error.message, /^scroll-flyover: /, `valid effects rejected: ${error.message}`);
    }
  }
});
