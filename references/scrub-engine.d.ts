/**
 * Type declarations for scroll-flyover's scrub engine (references/scrub-engine.js).
 *
 * Hand-written rather than generated, so the engine stays a single build-free ES
 * module. Kept honest by types-test/, which `npm run check:types` compiles against
 * this file: a declaration that drifts from what the engine accepts breaks CI there.
 *
 * Three.js types come from `@types/three` — an optional peer, like `three` itself.
 */
import type {
  Camera,
  CatmullRomCurve3,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';

/** Rendering tier. Anything other than `'rich'` behaves as `'light'` (no shadows). */
export type Performance = 'rich' | 'light';

/** `'swoop'` banks the camera into turns; `'glide'` keeps it level. */
export type CameraFeel = 'swoop' | 'glide';

/**
 * Handed through to every scene builder untouched, so it may carry any vocabulary the
 * builders understand. The engine itself only checks whether it is `'lowpoly'`
 * (smooth shading) or anything else (flat shading).
 */
export type ShapeLanguage = 'lowpoly' | (string & {});

/** Deterministic RNG returning a float in [0, 1). See {@link makeRng}. */
export type Rng = () => number;

export interface Palette {
  /**
   * Non-empty list of CSS colors. Source of the sky gradient, the fog, and one
   * `MeshStandardMaterial` per entry, in this order.
   */
  colors: string[];
  /**
   * Hex color (`#rgb` or `#rrggbb`) for the CTA. Hex specifically: the CTA's text color
   * is picked by measuring its WCAG luminance.
   */
  accent?: string;
  /** Extra keys are passed through to builders untouched. */
  [key: string]: unknown;
}

export interface BuildContext {
  /** This scene's own RNG stream, derived from `config.seed` and the scene index. */
  rng: Rng;
  /** The effective tier — `'light'` on coarse pointers / narrow viewports regardless of config. */
  performance: Performance;
  shapeLanguage: ShapeLanguage;
  palette: Palette;
}

/**
 * Textures loaded from `config.photos`, by the same keys. An entry is `null` once its
 * image fails to load, so builders must check truthiness and fall back.
 * `texture.userData.aspect` holds width / height once loaded.
 */
export type SceneTextures = Record<string, Texture | null>;

/**
 * Builds one stop of the flight. Must return a `THREE.Object3D` (usually a `Group`);
 * the engine positions it on its layout anchor. Any object in the returned tree may
 * expose `userData.tick(elapsedSeconds)` to animate.
 */
export type SceneBuilder = (
  materials: MeshStandardMaterial[],
  textures: SceneTextures,
  context: BuildContext,
) => Object3D;

export interface CtaContext {
  index: number;
  scene: SceneConfig;
}

interface SceneCopy {
  /** Builds this scene's 3D content. */
  build: SceneBuilder;
  /** Small uppercase line above the title. */
  eyebrow?: string;
  title?: string;
  body?: string;
  tags?: string[];
}

/** A CTA that navigates: rendered as a real `<a href>`. */
interface LinkCta {
  cta: string;
  ctaHref: string;
  onCta?: never;
}

/** A CTA that acts on the page: rendered as a `<button>`. */
interface ButtonCta {
  cta: string;
  onCta: (event: MouseEvent, context: CtaContext) => void;
  ctaHref?: never;
}

/** No CTA. A `cta` label with no destination renders nothing and warns at mount. */
interface NoCta {
  cta?: string;
  ctaHref?: never;
  onCta?: never;
}

/**
 * One stop on the flight. `ctaHref` and `onCta` are mutually exclusive — which one is
 * set decides whether the CTA is a link or a button — and either requires `cta`.
 */
export type SceneConfig = SceneCopy & (LinkCta | ButtonCta | NoCta);

/**
 * Every string the engine puts in front of a user. English by default; override to
 * match the host page's language. Functions rather than templates because word order
 * is not translatable with placeholders alone.
 */
export interface Labels {
  /** aria-label of each rail dot. `index` is 1-based. */
  goToScene?: (index: number, total: number) => string;
  /**
   * Accessible name of a scene's CTA. Must begin with `label`, the visible text
   * (WCAG 2.5.3, Label in Name). `title` is `''` when the scene has none.
   */
  ctaInScene?: (label: string, title: string) => string;
  /** Spoken by the live region on every scene change. `index` is 1-based. */
  sceneAnnouncement?: (index: number, total: number, title: string) => string;
}

export interface FlyoverConfig {
  palette: Palette;
  /** Non-empty: one entry per stop on the flight. */
  scenes: SceneConfig[];
  /** Default `'lowpoly'`. */
  shapeLanguage?: ShapeLanguage;
  /** Default `'swoop'`. */
  cameraFeel?: CameraFeel;
  /** Default `'rich'`. Forced to `'light'` on coarse pointers / viewports under 860px. */
  performance?: Performance;
  /** Image URLs by name, loaded once and handed to every builder as `textures`. */
  photos?: Record<string, string> | null;
  /** How long the camera lingers at each scene relative to travel. > 0; 2–3 is useful. Default 2.5. */
  dwellWeight?: number;
  /** Finite number. Same seed, same world, on every reload. Default 1. */
  seed?: number;
  /**
   * Replaces the default island-hop layout. Must return at least `sceneCount`
   * positions, one per scene.
   */
  layout?: ((sceneCount: number) => Vector3[]) | null;
  labels?: Labels | null;
  /**
   * Seconds, read once per frame to drive material animations. Default: the page's
   * high-resolution clock. Pass one you control to make animation time reproducible.
   */
  clock?: (() => number) | null;
  /**
   * Post-processing, opt-in since 1.9.0 — usually `createEffects({ grain, motionBlur })`
   * from `scroll-flyover/effects`. Without it the engine calls `renderer.render()`
   * directly and draws exactly what it drew before 1.9.0.
   */
  effects?: FlyoverEffects | null;
  /**
   * Called once, one frame after there is something on screen: the first frame drawn
   * (`webgl: true`), or the static fallback card when WebGL2 is unavailable
   * (`webgl: false`). For taking down a loader. Not called after `dispose()`. A mount
   * that starts off-screen calls it when it first scrolls into view. Since 1.11.0.
   */
  onReady?: ((info: ReadyInfo) => void) | null;
}

/** What `config.onReady` is told. */
export interface ReadyInfo {
  /** `false` when the page is showing the static fallback instead of a WebGL scene. */
  webgl: boolean;
}

/** What the engine tells `config.effects` about each frame it draws. */
export interface EffectsFrame {
  /** Where the camera is on the flight path, 0–1, after the dwell easing. */
  position: number;
  /**
   * Path position per second. `0` for a camera at rest — after scrolling stops, for
   * every `renderAt()` frame, and always under `prefers-reduced-motion`.
   */
  velocity: number;
  /** The effective tier: `'light'` on coarse pointers / narrow viewports. */
  performance: Performance;
  /**
   * The camera as it would be at another path position (current bank kept). Returns a
   * shared scratch camera with its matrices updated; read it before calling again.
   */
  cameraAt(position: number): PerspectiveCamera;
  /**
   * How settled the camera is at a scene, 0–1: `1` anywhere in a scene's dwell stretch,
   * falling smoothly to `0` halfway between two scenes. Depends on `position` alone, so
   * it is the same for a `renderAt()` frame as for a stopped scroll. Since 1.10.0.
   */
  landing: number;
  /**
   * Distance from the camera to the scene it is at or heading for (the next one, during
   * a transit), in world units; never less than the camera's near plane. Where a lens
   * would focus. Since 1.10.0.
   */
  focusDistance: number;
}

/**
 * The hook `config.effects` takes. `render` replaces the engine's
 * `renderer.render(scene, camera)` and must draw the frame to the screen; `dispose`
 * is called from `handle.dispose()` to free whatever it allocated on the GPU.
 */
export interface FlyoverEffects {
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, frame: EffectsFrame): void;
  dispose?(): void;
}

export interface RenderAtOptions {
  /** Seconds handed to material animations. Default 0, so a capture is the same every run. */
  time?: number;
}

export interface FlyoverHandle {
  /**
   * Draws the frame a visitor scrolled to `progress` (0 = top, 1 = bottom) would see,
   * synchronously, and holds it until {@link FlyoverHandle.resume}. For capture —
   * video, exact screenshots. Returns `false` when there is nothing to draw: no WebGL
   * (static fallback), a lost context, or after `dispose()`.
   * @throws if `progress` or `time` is not a finite number.
   */
  renderAt(progress: number, options?: RenderAtOptions): boolean;
  /** Hands the camera back to the scroll position. */
  resume(): void;
  /**
   * Removes everything the engine added, restores `container`, and releases the WebGL
   * context. Safe to call on the no-WebGL fallback too.
   */
  dispose(): void;
}

/**
 * Mounts the flight into `container`, which must be a normal-flow element (not
 * `position: sticky`): the engine sets its height and adds its own sticky wrapper.
 * Browser only — touches `window`/`document` on call.
 * @throws with a `scroll-flyover:` message naming the property, on an invalid config.
 */
export function mountScrollFlyover(container: HTMLElement, config: FlyoverConfig): FlyoverHandle;

/** Deterministic mulberry32 RNG. Builders must use it instead of `Math.random()`. */
export function makeRng(seed?: number): Rng;

/** WCAG relative luminance (0–1) of a `#rgb` / `#rrggbb` color. */
export function relativeLuminance(hex: string): number;

/** `'#000'` or `'#fff'`, whichever holds at least 4.5:1 against `bgHex`. */
export function readableTextColor(bgHex: string): '#000' | '#fff';

/** Escapes `& < > " '` for interpolation into markup. `null`/`undefined` become `''`. */
export function escapeHtml(value: unknown): string;

/** The default island-hop layout: `count` anchors along a gentle arc. */
export function layoutAnchors(count: number, spacing?: number, arcHeight?: number): Vector3[];

/** Approach, dive and depart control points around one scene anchor. */
export function sceneControlPoints(
  anchor: Vector3,
  forwardDir: Vector3,
  sceneRadius: number,
): [Vector3, Vector3, Vector3];

/** The camera path through every anchor's control points. */
export function buildWorldCurve(anchors: Vector3[], sceneRadius: number): CatmullRomCurve3;

/** Maps scroll progress to path progress, lingering `dwellWeight`× longer at each scene. */
export function buildDwellEasing(sceneCount: number, dwellWeight?: number): (t: number) => number;

/**
 * For a path position (after the dwell easing): `landing`, 1 inside a scene's dwell
 * stretch and falling to 0 halfway along a transit, and `scene`, the index of the scene
 * the camera is at or heading for. Since 1.10.0.
 */
export function landingAt(
  sceneCount: number,
  dwellWeight?: number,
  position?: number,
): { landing: number; scene: number };

/** The scroll position (0–1) of the scene centre nearest `t`. */
export function nearestDwellCenter(sceneCount: number, t: number): number;
