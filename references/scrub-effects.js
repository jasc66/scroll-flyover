/**
 * scroll-flyover effects (opt-in since 1.9.0)
 * -----------------------------------------------------------------------
 * Film grain and camera motion blur for a flight, handed to the engine as
 * `config.effects`. Off unless asked for, and in its own module so that a page which
 * does not ask imports nothing new: the engine only knows the shape of the object
 * this returns, and without one it calls renderer.render() as it always has.
 *
 *   import { mountScrollFlyover } from 'scroll-flyover';
 *   import { createEffects } from 'scroll-flyover/effects';
 *   mountScrollFlyover(el, { ...config, effects: createEffects({ grain: true, motionBlur: true }) });
 *
 * Needs nothing but 'three' — no three/addons — so an import map that already
 * resolves 'three' for the engine resolves everything this file uses too.
 *
 * The scene is always drawn straight to the screen, exactly as it is without effects,
 * and the effects work on top of that finished frame. The obvious alternative — draw
 * into an offscreen buffer and tone-map at the end — changes the look: three mixes fog
 * in AFTER tone mapping and sRGB encoding, inside every material, so moving those to
 * a final pass puts the fog in a different colour space and the distance washes out.
 *
 * Both effects make a frame depend on that frame's own inputs alone, never on the
 * frames drawn before it, which is what keeps renderAt() captures reproducible:
 *
 * - Grain is STATIC. Animated grain would be idle motion the visitor never asked for,
 *   and prefers-reduced-motion could not turn it off without changing the look. A
 *   fixed pattern reads as texture, not movement.
 * - Motion blur comes from the camera's VELOCITY, which the engine reports per frame:
 *   each pixel is smeared back to where its surface was when the shutter opened. At
 *   rest the velocity is 0 and there is no blur — a visitor who stops scrolling gets a
 *   sharp frame, and renderAt(), which draws a settled frame, always lands sharp.
 *   Only on the 'rich' tier: the engine reports 'light' for phones and coarse
 *   pointers, where the extra passes cost more than they give.
 *
 * Depth of field is deliberately absent: it is a per-pixel gather at every frame, at
 * rest included, and a landing page cannot afford it on the GPUs it meets.
 */
import * as THREE from 'three';

const DEFAULT_SHUTTER = 0.5;   // fraction of a 60fps frame the shutter is open — the 180° rule
const DEFAULT_SAMPLES = 8;
const DEFAULT_MAX_PIXELS = 48; // longest smear, in drawing-buffer pixels
const DEFAULT_GRAIN = 0.06;    // ± half this, as a fraction of each pixel's own value

function typeName(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function fail(message) {
  throw new Error(`scroll-flyover: ${message}`);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberOption(owner, key, value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(
      `createEffects({ ${owner}: { ${key} } }) must be a number from ${min} to ${max}, ` +
      `got ${typeName(value)}${typeof value === 'number' ? ` ${value}` : ''}.`,
    );
  }
  return value;
}

/**
 * Turns the options a caller wrote into the settings the passes read, rejecting by
 * name anything that would otherwise render as a silently wrong frame. Pure, so the
 * Node test suite can reach it without a GPU.
 */
export function resolveEffectsOptions(options = {}) {
  if (!isPlainObject(options)) {
    fail(`createEffects(options) needs an object like { grain: true, motionBlur: true }, got ${typeName(options)}.`);
  }
  const known = ['grain', 'motionBlur'];
  Object.keys(options).forEach((key) => {
    if (!known.includes(key)) {
      fail(`createEffects() has no ${JSON.stringify(key)} option. The effects are ${known.join(' and ')}.`);
    }
  });

  const { grain = false, motionBlur = false } = options;

  let grainAmount = 0;
  if (grain === true) grainAmount = DEFAULT_GRAIN;
  else if (isPlainObject(grain)) grainAmount = numberOption('grain', 'amount', grain.amount, DEFAULT_GRAIN, 0, 0.5);
  else if (grain !== false) fail(`createEffects({ grain }) must be true, false or { amount }, got ${typeName(grain)}.`);

  let blur = null;
  if (motionBlur === true || isPlainObject(motionBlur)) {
    const o = motionBlur === true ? {} : motionBlur;
    blur = {
      shutter: numberOption('motionBlur', 'shutter', o.shutter, DEFAULT_SHUTTER, 0, 1),
      samples: numberOption('motionBlur', 'samples', o.samples, DEFAULT_SAMPLES, 2, 32),
      maxPixels: numberOption('motionBlur', 'maxPixels', o.maxPixels, DEFAULT_MAX_PIXELS, 0, 512),
    };
    if (!Number.isInteger(blur.samples)) {
      fail(`createEffects({ motionBlur: { samples } }) must be a whole number, got ${blur.samples}.`);
    }
    // A closed shutter or a zero-length smear is no blur at all; skip its passes.
    if (blur.shutter === 0 || blur.maxPixels === 0) blur = null;
  } else if (motionBlur !== false) {
    fail(`createEffects({ motionBlur }) must be true, false or { shutter, samples, maxPixels }, got ${typeName(motionBlur)}.`);
  }

  return { grain: grainAmount, motionBlur: blur };
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Dave Hoskins' hash12: float-only and stable at large coordinates, unlike the
// sin()-based one, whose precision falls apart on mobile GPUs. Seeded by the pixel's
// position alone, which is what makes the grain static.
const HASH = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`;

// Reads the finished frame (already tone-mapped and encoded, fog and all) and smears
// each pixel back along the path its surface took while the shutter was open. The
// result is written as it is: no tone mapping, no encoding — it is display colour
// already. Grain rides along in the same pass so a moving frame is one draw, not two.
const BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tFrame;
  uniform sampler2D tDepth;
  uniform mat4 uCurrentToWorld;   // inverse(projection * view) of the frame's camera
  uniform mat4 uWorldToShutter;   // projection * view where the shutter opened
  uniform vec2 uResolution;
  uniform float uMaxPixels;
  uniform float uGrain;
  varying vec2 vUv;
  ${HASH}
  void main() {
    float depth = texture2D(tDepth, vUv).x;
    vec4 world = uCurrentToWorld * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    world /= world.w;
    vec4 then = uWorldToShutter * world;
    vec2 delta = vUv - ((then.xy / then.w) * 0.5 + 0.5);
    float len = length(delta * uResolution);
    if (len > uMaxPixels) delta *= uMaxPixels / len;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < SAMPLES; i++) {
      sum += texture2D(tFrame, vUv - delta * (float(i) / float(SAMPLES - 1))).rgb;
    }
    vec3 color = sum / float(SAMPLES);
    color *= 1.0 + (hash12(gl_FragCoord.xy) - 0.5) * uGrain;
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Grain on a still frame, without reading it back: drawn over the finished frame with
// blending that computes dst * src * 2, so a source of 0.5 leaves a pixel untouched
// and the noise scales it up or down by a fraction of its own value. Multiplying
// rather than adding keeps black black and keeps the grain off the copy panels'
// contrast budget in the darks.
const GRAIN_FRAGMENT = /* glsl */ `
  uniform float uGrain;
  ${HASH}
  void main() {
    gl_FragColor = vec4(vec3(0.5 + (hash12(gl_FragCoord.xy) - 0.5) * uGrain * 0.5), 1.0);
  }
`;

/**
 * Returns the object `config.effects` takes. Each effect is off unless named:
 *
 *   grain:      true | { amount }                      amount 0–0.5, default 0.06
 *   motionBlur: true | { shutter, samples, maxPixels }  shutter 0–1 (default 0.5),
 *                                                       samples 2–32 (8), maxPixels (48)
 *
 * With neither, the hook draws straight to the screen, as the engine does without it.
 */
export function createEffects(options = {}) {
  const settings = resolveEffectsOptions(options);
  const blurSettings = settings.motionBlur;

  // Built on first use and rebuilt on resize: a flight that never moves never pays for
  // the motion blur's buffers, and grain alone allocates no buffer at all.
  let depthTarget = null;
  let frameTexture = null;
  let depthOnly = null;
  let blurMaterial = null;
  let grainMaterial = null;
  let quad = null;
  let quadScene = null;
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();

  function ensureQuad() {
    if (quad) return;
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    quadScene = new THREE.Scene();
    quadScene.add(quad);
  }

  function ensureGrain() {
    if (grainMaterial) return;
    ensureQuad();
    grainMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: GRAIN_FRAGMENT,
      uniforms: { uGrain: { value: settings.grain } },
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcColorFactor,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  function ensureBlur(renderer) {
    renderer.getDrawingBufferSize(size);
    if (!depthTarget || depthTarget.width !== size.x || depthTarget.height !== size.y) {
      disposeBlurBuffers();
      depthTarget = new THREE.WebGLRenderTarget(size.x, size.y);
      depthTarget.depthTexture = new THREE.DepthTexture(size.x, size.y);
      depthTarget.depthTexture.type = THREE.UnsignedIntType;
      // The format is passed for three before r155, whose constructor took it as a third
      // argument with no default — and an unformatted texture cannot be copied into.
      // Later versions ignore it and default to the same RGBA.
      frameTexture = new THREE.FramebufferTexture(size.x, size.y, THREE.RGBAFormat);
      // Sampled between pixels along the smear, so filtered, not nearest.
      frameTexture.minFilter = frameTexture.magFilter = THREE.LinearFilter;
    }
    if (blurMaterial) return;
    ensureQuad();
    // Writes depth and nothing else, for the pass that only exists to fill tDepth.
    depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    blurMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      defines: { SAMPLES: blurSettings.samples },
      uniforms: {
        tFrame: { value: null },
        tDepth: { value: null },
        uCurrentToWorld: { value: new THREE.Matrix4() },
        uWorldToShutter: { value: new THREE.Matrix4() },
        uResolution: { value: new THREE.Vector2() },
        uMaxPixels: { value: blurSettings.maxPixels },
        uGrain: { value: settings.grain },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  function disposeBlurBuffers() {
    depthTarget?.depthTexture?.dispose();
    depthTarget?.dispose();
    frameTexture?.dispose();
    depthTarget = frameTexture = null;
  }

  // three swapped this method's arguments in r165: (position, texture) before, (texture,
  // position) after. The arity tells them apart — 2 before the default parameter in
  // the old form, 1 in the new — across the whole three range the engine supports.
  function copyFrame(renderer) {
    if (renderer.copyFramebufferToTexture.length >= 2) {
      renderer.copyFramebufferToTexture(new THREE.Vector2(0, 0), frameTexture);
    } else {
      renderer.copyFramebufferToTexture(frameTexture);
    }
  }

  // The overlay passes draw on top of the frame, so the renderer must not clear it first.
  function drawOver(renderer, material) {
    quad.material = material;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(quadScene, quadCamera);
    renderer.autoClear = autoClear;
  }

  return {
    render(renderer, scene, camera, frame) {
      // How far the camera travels while the shutter is open, in path position.
      const travel = blurSettings ? frame.velocity * (blurSettings.shutter / 60) : 0;
      const blurring = blurSettings !== null && frame.performance === 'rich' && travel !== 0;

      if (!blurring) {
        renderer.render(scene, camera);
        if (settings.grain > 0) {
          ensureGrain();
          drawOver(renderer, grainMaterial);
        }
        return;
      }

      ensureBlur(renderer);

      // Depth only: no colour and no background. The shadow map this pass renders (from
      // the scene's own materials, not the override) is the one the real pass would
      // render next, so the real pass reuses it instead of drawing it twice.
      const { background, overrideMaterial } = scene;
      const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
      const previousTarget = renderer.getRenderTarget();
      scene.background = null;
      scene.overrideMaterial = depthOnly;
      renderer.setRenderTarget(depthTarget);
      renderer.render(scene, camera);
      scene.background = background;
      scene.overrideMaterial = overrideMaterial;
      renderer.setRenderTarget(previousTarget);

      // The real frame, to the screen, exactly as without effects — then read it back.
      renderer.shadowMap.autoUpdate = false;
      renderer.render(scene, camera);
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      copyFrame(renderer);

      const u = blurMaterial.uniforms;
      u.tFrame.value = frameTexture;
      u.tDepth.value = depthTarget.depthTexture;
      u.uResolution.value.copy(size);
      u.uCurrentToWorld.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
      const then = frame.cameraAt(THREE.MathUtils.clamp(frame.position - travel, 0, 1));
      u.uWorldToShutter.value.multiplyMatrices(then.projectionMatrix, then.matrixWorldInverse);
      drawOver(renderer, blurMaterial);
    },

    dispose() {
      disposeBlurBuffers();
      quad?.geometry.dispose();
      depthOnly?.dispose();
      blurMaterial?.dispose();
      grainMaterial?.dispose();
      quad = quadScene = depthOnly = blurMaterial = grainMaterial = null;
    },
  };
}
