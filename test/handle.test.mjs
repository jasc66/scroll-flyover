import test from 'node:test';
import assert from 'node:assert/strict';
import { mountScrollFlyover } from '../references/scrub-engine.js';

// The no-WebGL path is the one place in mount() Node can reach end to end: with
// getContext('webgl2') returning null, the engine paints its fallback card and returns
// before it touches three. These stubs are only as much DOM as that path reads.
function withNoWebGL(fn) {
  const saved = { window: globalThis.window, document: globalThis.document };
  const element = () => ({
    style: {}, innerHTML: '',
    setAttribute() {}, appendChild() {}, getContext: () => null,
  });
  globalThis.window = { matchMedia: () => ({ matches: false }), innerWidth: 1440 };
  globalThis.document = { createElement: element };
  try {
    return fn();
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
  }
}

const config = {
  palette: { colors: ['#0e1c2b', '#1d3a52'], accent: '#e8a33d' },
  scenes: [{ title: 'Arrival', build: () => ({ isObject3D: true, position: { copy() {} } }) }],
};

test('without WebGL the handle has the same shape, and renderAt says it drew nothing', () => {
  const container = { style: {}, innerHTML: '', appendChild() {}, querySelector: () => null };
  const handle = withNoWebGL(() => mountScrollFlyover(container, config));
  // A host capturing frames should not have to branch on WebGL support to call these.
  assert.equal(typeof handle.renderAt, 'function');
  assert.equal(typeof handle.resume, 'function');
  assert.equal(typeof handle.dispose, 'function');
  assert.equal(handle.renderAt(0.5), false);
  assert.doesNotThrow(() => handle.resume());
  assert.doesNotThrow(() => handle.dispose());
});
