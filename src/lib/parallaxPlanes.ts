/**
 * Depth planes for 2.5D parallax — the pure arithmetic.
 *
 * The measured research (2026-08-12) settled the architecture: a monocular
 * depth model runs ONCE per shot, the depth map is cut into alpha planes,
 * and the planes translate at different rates during the Ken Burns move —
 * near moves more. That relative motion is what sells "the camera moved
 * through the scene" over "the image was zoomed". The licence-clean stack is
 * MiDaS v2.1 small (MIT) or Depth Anything V2 SMALL (Apache-2.0) — never
 * the famous sniklaus/3d-ken-burns implementation (CC BY-NC), never DA
 * Large/DA3 (non-commercial weights). The model is a parameter of the stage
 * precisely so it can be swapped without touching this math.
 *
 * SELF-CONTAINED ON PURPOSE — no imports at all. The story worker reaches
 * this file through Node's TypeScript stripping, which cannot resolve
 * extensionless relative imports; one `import x from "./y"` here and the
 * worker breaks the way visemes.ts already cannot be imported. The vitest
 * suite reaches it through the bundler like everything else.
 *
 * MiDaS emits INVERSE depth: bigger numbers are NEARER. Everything here
 * works in that convention, normalised to 0..1 where 1 is nearest.
 */

/** Normalise a raw inverse-depth map to 0..1, nearest = 1. */
export function normalizeDepth(depth: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (const v of depth) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const out = new Float32Array(depth.length);
  const range = max - min;
  // A flat map (single-colour still, model failure) normalises to all-zero:
  // everything reads as FAR, the near plane comes out empty, and the shot
  // degrades to plain Ken Burns — the correct step-down, for free.
  if (!(range > 1e-6)) return out;
  for (let i = 0; i < depth.length; i++) out[i] = (depth[i] - min) / range;
  return out;
}

/** Hermite smoothstep, clamped. The feather that stops plane edges banding. */
function smoothstep(lo: number, hi: number, v: number): number {
  if (hi <= lo) return v >= hi ? 1 : 0;
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * Alpha mask for the plane holding everything NEARER than `threshold`.
 *
 * Feathered with smoothstep over `feather` of normalised depth on each side,
 * because a hard cut at the threshold reads as a sticker edge the moment the
 * plane moves — the exact cardboarding the research warned about. Returned
 * as bytes because that is what an RGBA channel is.
 */
export function nearPlaneAlpha(
  depth01: Float32Array,
  threshold: number,
  feather = 0.08,
): Uint8Array {
  if (!(threshold > 0) || !(threshold < 1)) {
    throw new Error(`nearPlaneAlpha: threshold ${threshold} must be inside (0, 1)`);
  }
  const out = new Uint8Array(depth01.length);
  const lo = threshold - feather;
  const hi = threshold + feather;
  for (let i = 0; i < depth01.length; i++) {
    out[i] = Math.round(smoothstep(lo, hi, depth01[i]) * 255);
  }
  return out;
}

/**
 * Alpha mask for the BAND of depth between `lo` and `hi` — rung 1 of the
 * in-house cinematography ladder (movie grade, 2026-08-13). Three planes
 * instead of two: base carries the far field exactly as shipped, the MID
 * band rides a little faster, the near plane faster still. Feathered on
 * both edges for the same anti-sticker reason as nearPlaneAlpha; the two
 * feathers overlap deliberately so adjacent planes cross-fade instead of
 * leaving a dark seam where neither is fully opaque.
 */
export function bandAlpha(
  depth01: Float32Array,
  lo: number,
  hi: number,
  feather = 0.08,
): Uint8Array {
  if (!(lo >= 0) || !(hi <= 1) || !(lo < hi)) {
    throw new Error(`bandAlpha: band [${lo}, ${hi}) must sit inside [0, 1] with lo < hi`);
  }
  const out = new Uint8Array(depth01.length);
  for (let i = 0; i < depth01.length; i++) {
    const enter = smoothstep(lo - feather, lo + feather, depth01[i]);
    const exit = 1 - smoothstep(hi - feather, hi + feather, depth01[i]);
    out[i] = Math.round(enter * exit * 255);
  }
  return out;
}

/**
 * How much of the frame the near plane actually covers, 0..1.
 *
 * The gate that keeps the effect honest: a shot whose "near plane" is 2% of
 * the frame (a distant landscape) or 95% (a face filling the screen) gains
 * nothing from parallax and shows its seams instead. Between those bounds
 * the layer earns its render cost.
 */
export function planeCoverage(alpha: Uint8Array): number {
  if (alpha.length === 0) return 0;
  let sum = 0;
  for (const a of alpha) sum += a;
  return sum / (alpha.length * 255);
}

/**
 * The motion rates, one place. Base carries EXACTLY the shipped Ken Burns —
 * a film with no depth plane is pixel-identical to yesterday's — and the
 * near plane rides 35% faster on top with enough extra scale to cover its
 * own excursion. Two planes, not three: the full-frame base backs every
 * pixel the near plane's edge reveals, which is what makes the no-inpaint
 * shortcut sound at these move sizes (the research's own recommendation).
 */
export const PARALLAX = {
  nearRate: 1.35,
  /** Extra scale on the near plane per unit of travel, covering its drift. */
  nearCoverGain: 0.5,
  /** Depth threshold cutting the near plane, in normalised inverse depth. */
  threshold: 0.55,
  /** Coverage gate: outside these bounds the shot ships without parallax. */
  minCoverage: 0.05,
  maxCoverage: 0.85,
  /**
   * Rung 1, the movie grade's mid plane: the band [midThreshold, threshold)
   * riding between base and near. Rate sits a little under halfway to the
   * near plane's — depth perception is logarithmic-ish and the mid field is
   * mostly large surfaces, which show seams sooner than foreground objects
   * do; its cover gain scales the same way. First-cut values, tuned the way
   * nearRate was: against rendered shots, not theory.
   */
  midRate: 1.16,
  midCoverGain: 0.25,
  midThreshold: 0.3,
} as const;
