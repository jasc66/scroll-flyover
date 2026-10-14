/**
 * Type declarations for scroll-flyover's optional effects (references/scrub-effects.js),
 * imported as `scroll-flyover/effects`. Hand-written, like scrub-engine.d.ts, and held
 * by the same types-test/ fixture.
 */
import type { FlyoverEffects } from './scrub-engine.js';

export type { EffectsFrame, FlyoverEffects } from './scrub-engine.js';

export interface GrainOptions {
  /** Strength, 0–0.5, as a fraction of each pixel's own value. Default 0.06. */
  amount?: number;
}

export interface MotionBlurOptions {
  /** Fraction of a 60fps frame the shutter stays open, 0–1. Default 0.5 (the 180° rule). */
  shutter?: number;
  /** Taps along each pixel's smear, a whole number from 2 to 32. Default 8. */
  samples?: number;
  /** Longest smear, in drawing-buffer pixels, 0–512. Default 48. */
  maxPixels?: number;
}

export interface EffectsOptions {
  /** Static film grain. Never animated, so it is not motion. */
  grain?: boolean | GrainOptions;
  /**
   * Camera motion blur, from the camera's velocity: none at rest, and none on the
   * `'light'` tier (phones, coarse pointers).
   */
  motionBlur?: boolean | MotionBlurOptions;
}

/** The settings the passes read, after validation and defaults. */
export interface ResolvedEffectsOptions {
  grain: number;
  motionBlur: Required<MotionBlurOptions> | null;
}

/** Builds the object `config.effects` takes. Each effect is off unless named. */
export function createEffects(options?: EffectsOptions): Required<FlyoverEffects>;

/** Validates options and fills in defaults; throws `scroll-flyover:` errors by name. */
export function resolveEffectsOptions(options?: EffectsOptions): ResolvedEffectsOptions;
