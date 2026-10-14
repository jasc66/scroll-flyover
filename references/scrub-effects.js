/**
 * scroll-flyover effects (opt-in since 1.9.0)
 * -----------------------------------------------------------------------
 * Film grain, camera motion blur and depth of field for a flight, handed to the engine as
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
 * - Depth of field (since 1.10.0) comes from where the camera is on the PATH: none
 *   while it dwells at a scene, opening up as it travels between two, focused on the
 *   scene it is heading for. So the flight is read at the landings, a landing costs
 *   nothing — the pass is skipped whenever the engine reports `landing` 1 — and
 *   renderAt(p) draws the same lens every time, moving or not. 'rich' tier only, like
 *   the blur. Gathered at half resolution and blended back by each pixel's depth.
 */
import * as THREE from 'three';

const DEFAULT_SHUTTER = 0.5;   // fraction of a 60fps frame the shutter is open — the 180° rule
const DEFAULT_SAMPLES = 8;
const DEFAULT_MAX_PIXELS = 48; // longest smear, in drawing-buffer pixels
const DEFAULT_GRAIN = 0.06;    // ± half this, as a fraction of each pixel's own value
const DEFAULT_DOF_SAMPLES = 24;
const DEFAULT_DOF_PIXELS = 10; // widest blur circle, in drawing-buffer pixels, mid-transit

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
  const known = ['grain', 'motionBlur', 'depthOfField'];
  Object.keys(options).forEach((key) => {
    if (!known.includes(key)) {
      fail(`createEffects() has no ${JSON.stringify(key)} option. The effects are grain, motionBlur and depthOfField.`);
    }
  });

  const { grain = false, motionBlur = false, depthOfField = false } = options;

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

  let dof = null;
  if (depthOfField === true || isPlainObject(depthOfField)) {
    const o = depthOfField === true ? {} : depthOfField;
    dof = {
      samples: numberOption('depthOfField', 'samples', o.samples, DEFAULT_DOF_SAMPLES, 4, 64),
      maxPixels: numberOption('depthOfField', 'maxPixels', o.maxPixels, DEFAULT_DOF_PIXELS, 0, 64),
    };
    if (!Number.isInteger(dof.samples)) {
      fail(`createEffects({ depthOfField: { samples } }) must be a whole number, got ${dof.samples}.`);
    }
    if (dof.maxPixels === 0) dof = null;
  } else if (depthOfField !== false) {
    fail(`createEffects({ depthOfField }) must be true, false or { samples, maxPixels }, got ${typeName(depthOfField)}.`);
  }

  return { grain: grainAmount, motionBlur: blur, depthOfField: dof };
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

// A thin-lens blur over the finished frame. Each pixel's circle of confusion grows with
// how far its depth is from the focus, as a fraction of its own depth — 0 in focus, 1 at
// infinity and anywhere nearer than half the focus distance — times uRadius, which the
// engine's `landing` scales from 0 at a scene to maxPixels mid-transit.
//
// A gather over a golden-angle spiral, after Dennis Gustafsson's single-pass bokeh: a
// tap counts only as far as its OWN blur circle reaches back to this pixel, so a sharp
// subject does not smear over its blurred backdrop. A tap behind this pixel may reach at
// most twice this pixel's circle, which keeps a blurred background from bleeding over a
// sharp edge in front of it. Taps that do not count add the running average instead,
// so the weight stays even and the result stays in range.
//
// Drawn at HALF resolution, into its own buffer: a quarter of the pixels, so a quarter
// of the gather. The gather was the cost — measured on an Apple M2 at a 2x pixel ratio,
// at full resolution it added about 15ms to a frame, three times the motion blur. What
// is lost is detail inside the blur, where there is none to lose. Two reads per tap,
// colour and depth; folding the circle into the frame copy's alpha so each tap is one
// read was tried, and the extra pass cost what the saved reads did.
const DOF_FRAGMENT = /* glsl */ `
  uniform sampler2D tFrame;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uFocus;
  uniform float uRadius;
  varying vec2 vUv;
  float viewDepth(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return uNear * uFar / (uFar - d * (uFar - uNear));
  }
  float blurCircle(float depth) {
    return clamp(abs(depth - uFocus) / depth, 0.0, 1.0) * uRadius;
  }
  void main() {
    float depth = viewDepth(vUv);
    float circle = blurCircle(depth);
    vec3 color = texture2D(tFrame, vUv).rgb;
    float weight = 1.0;
    for (int i = 0; i < SAMPLES; i++) {
      float reach = uRadius * sqrt((float(i) + 0.5) / float(SAMPLES));
      float angle = float(i) * 2.39996323;
      vec2 uv = vUv + vec2(cos(angle), sin(angle)) * reach / uResolution;
      float tapDepth = viewDepth(uv);
      float tapCircle = blurCircle(tapDepth);
      if (tapDepth > depth) tapCircle = min(tapCircle, circle * 2.0);
      color += mix(color / weight, texture2D(tFrame, uv).rgb, smoothstep(reach - 0.5, reach + 0.5, tapCircle));
      weight += 1.0;
    }
    gl_FragColor = vec4(color / weight, 1.0);
  }
`;

// Back to full resolution: each pixel takes the half-resolution blur as far as its own
// circle of confusion, read from the full-resolution depth, says it should. In focus it
// stays the untouched frame, so a sharp subject keeps every pixel of its edge; the soft
// half-resolution image only shows where the lens has blurred it anyway.
const DOF_COMPOSITE_FRAGMENT = /* glsl */ `
  uniform sampler2D tFrame;
  uniform sampler2D tDepth;
  uniform sampler2D tBlur;
  uniform float uNear;
  uniform float uFar;
  uniform float uFocus;
  uniform float uRadius;
  uniform float uGrain;
  varying vec2 vUv;
  ${HASH}
  void main() {
    float d = texture2D(tDepth, vUv).x;
    float depth = uNear * uFar / (uFar - d * (uFar - uNear));
    float circle = clamp(abs(depth - uFocus) / depth, 0.0, 1.0) * uRadius;
    vec3 sharp = texture2D(tFrame, vUv).rgb;
    vec3 color = mix(sharp, texture2D(tBlur, vUv).rgb, smoothstep(0.5, 2.0, circle));
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
 *   depthOfField: true | { samples, maxPixels }         samples 4–64 (24),
 *                                                       maxPixels 0–64 (10)
 *
 * With none of them, the hook draws straight to the screen, as the engine does without it.
 */
export function createEffects(options = {}) {
  const settings = resolveEffectsOptions(options);
  const blurSettings = settings.motionBlur;
  const dofSettings = settings.depthOfField;

  // Built on first use and rebuilt on resize: a flight that never moves never pays for
  // the motion blur's buffers, a flight that never leaves a landing never pays for the
  // depth of field's, and grain alone allocates no buffer at all.
  let depthTarget = null;
  let frameTexture = null;
  let depthOnly = null;
  let blurMaterial = null;
  let dofMaterial = null;
  let compositeMaterial = null;
  let halfTarget = null;
  let grainMaterial = null;
  let quad = null;
  let quadScene = null;
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const size = new THREE.Vector2();
  const halfSize = new THREE.Vector2();

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

  // The depth buffer and the copy of the finished frame that every pass reads.
  function ensureBuffers(renderer) {
    renderer.getDrawingBufferSize(size);
    if (!depthTarget || depthTarget.width !== size.x || depthTarget.height !== size.y) {
      disposeBuffers();
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
    if (depthOnly) return;
    ensureQuad();
    // Writes depth and nothing else, for the pass that only exists to fill tDepth.
    depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  }

  function ensureBlur() {
    if (blurMaterial) return;
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

  function ensureDof() {
    halfSize.set(Math.ceil(size.x / 2), Math.ceil(size.y / 2));
    if (!halfTarget || halfTarget.width !== halfSize.x || halfTarget.height !== halfSize.y) {
      halfTarget?.dispose();
      halfTarget = new THREE.WebGLRenderTarget(halfSize.x, halfSize.y, { depthBuffer: false });
    }
    if (dofMaterial) return;
    const lens = () => ({
      tFrame: { value: null },
      tDepth: { value: null },
      uNear: { value: 0.1 },
      uFar: { value: 300 },
      uFocus: { value: 1 },
      uRadius: { value: 0 },
    });
    dofMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: DOF_FRAGMENT,
      defines: { SAMPLES: dofSettings.samples },
      uniforms: { ...lens(), uResolution: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: DOF_COMPOSITE_FRAGMENT,
      uniforms: { ...lens(), tBlur: { value: null }, uGrain: { value: settings.grain } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  function disposeBuffers() {
    depthTarget?.depthTexture?.dispose();
    depthTarget?.dispose();
    frameTexture?.dispose();
    halfTarget?.dispose();
    depthTarget = frameTexture = halfTarget = null;
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
      const rich = frame.performance === 'rich';
      // How far the camera travels while the shutter is open, in path position.
      const travel = blurSettings ? frame.velocity * (blurSettings.shutter / 60) : 0;
      const blurring = blurSettings !== null && rich && travel !== 0;
      // An engine before 1.10.0 reports no landing; treat it as always landed.
      const radius = dofSettings ? dofSettings.maxPixels * (1 - (frame.landing ?? 1)) : 0;
      const focusing = dofSettings !== null && rich && radius > 0;

      if (!blurring && !focusing) {
        renderer.render(scene, camera);
        if (settings.grain > 0) {
          ensureGrain();
          drawOver(renderer, grainMaterial);
        }
        return;
      }

      ensureBuffers(renderer);

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

      // The lens first, then the shutter: the blur smears the image the lens made. Each
      // pass draws to the screen; the next one reads that back. Grain goes on in the last.
      if (focusing) {
        ensureDof();
        for (const material of [dofMaterial, compositeMaterial]) {
          const u = material.uniforms;
          u.tFrame.value = frameTexture;
          u.tDepth.value = depthTarget.depthTexture;
          u.uNear.value = camera.near;
          u.uFar.value = camera.far;
          u.uFocus.value = frame.focusDistance;
        }
        // The gather, at half resolution, so its radius is in half-resolution pixels.
        dofMaterial.uniforms.uResolution.value.copy(halfSize);
        dofMaterial.uniforms.uRadius.value = radius / 2;
        quad.material = dofMaterial;
        renderer.setRenderTarget(halfTarget);
        renderer.render(quadScene, quadCamera);
        renderer.setRenderTarget(previousTarget);

        const c = compositeMaterial.uniforms;
        c.tBlur.value = halfTarget.texture;
        c.uRadius.value = radius;
        c.uGrain.value = blurring ? 0 : settings.grain;
        drawOver(renderer, compositeMaterial);
        if (!blurring) return;
        copyFrame(renderer);
      }

      ensureBlur();
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
      disposeBuffers();
      quad?.geometry.dispose();
      depthOnly?.dispose();
      blurMaterial?.dispose();
      dofMaterial?.dispose();
      compositeMaterial?.dispose();
      grainMaterial?.dispose();
      quad = quadScene = depthOnly = blurMaterial = dofMaterial = compositeMaterial = grainMaterial = null;
    },
  };
}
