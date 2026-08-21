/**
 * LIVING-SUBJECT MOTION — the in-house fix for "nobody moves".
 *
 * The story composition animates the CAMERA (Ken Burns + multi-plane parallax)
 * and the WEATHER (particles), but the subject in a generated still only ever
 * moved when it matched one of the hard-coded character rigs. For every other
 * story the person was a dead plate under a moving camera — the slideshow.
 *
 * This adds organic idle motion to the depth-cut NEAR plane (the foreground /
 * subject the worker already isolates for parallax), INDEPENDENT of the camera:
 * a slow breathing scale, a gentle sway and bob, each on its own seeded rhythm.
 * It is the "living photo" ceiling for an in-house engine with no video model —
 * not full articulation, but a subject that is visibly alive rather than frozen.
 *
 * PURE and deterministic: same (frame, fps, seed) → same offset, so the render
 * is reproducible. Amplitudes are deliberately small — the near plane is a
 * cutout backed by the full-frame base, and motion beyond a couple of percent
 * would drag its edge past what the base can cover.
 */

export type LivingOffset = {
  /** Extra horizontal translate, in PERCENT (same units as the plane transform). */
  dx: number;
  /** Extra vertical translate, in PERCENT. */
  dy: number;
  /** Extra scale, as a fraction added to the plane's scale (e.g. 0.01 = +1%). */
  scale: number;
};

/** Horizontal sway amplitude, percent of frame. */
export const LIVING_SWAY_PCT = 0.55;
/** Vertical bob amplitude, percent of frame. */
export const LIVING_BOB_PCT = 0.45;
/** Breathing amplitude, fraction of scale (1% in/out). */
export const LIVING_BREATH = 0.011;

/** Slow, life-like rates in Hz — a calm breath, a slower sway, a slower bob. */
const BREATH_HZ = 0.22;
const SWAY_HZ = 0.11;
const BOB_HZ = 0.15;

/** A seeded phase in [0, 2π) for one lane, so every shot moves on its own clock. */
function phase(seed: number, lane: number): number {
  const h = (Math.imul(seed ^ lane, 0x9e3779b9) >>> 0) / 0xffffffff;
  return h * Math.PI * 2;
}

/**
 * Idle living motion for a subject layer at `frame` (fps for the clock), seeded
 * from the shot's identity. `gain` scales the whole thing (1 for the near
 * plane, less for the gentler mid plane); `zero` gain returns no motion.
 */
export function livingSubjectMotion(
  frame: number,
  fps: number,
  seed: number,
  gain = 1,
): LivingOffset {
  if (gain === 0 || !Number.isFinite(frame) || !Number.isFinite(fps) || fps <= 0) {
    return { dx: 0, dy: 0, scale: 0 };
  }
  const t = frame / fps;
  const breath = Math.sin(t * 2 * Math.PI * BREATH_HZ + phase(seed, 1));
  const sway = Math.sin(t * 2 * Math.PI * SWAY_HZ + phase(seed, 2));
  const bob = Math.sin(t * 2 * Math.PI * BOB_HZ + phase(seed, 3));
  return {
    dx: sway * LIVING_SWAY_PCT * gain,
    dy: bob * LIVING_BOB_PCT * gain,
    scale: breath * LIVING_BREATH * gain,
  };
}
