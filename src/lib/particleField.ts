/**
 * Procedural particle atmosphere — rung 3 of the in-house cinematography
 * ladder (movie grade, 2026-08-13). Embers over a fire scene, dust motes in
 * a sunlit bazaar, rain, snow, fireflies in a night garden: the cheap,
 * visible layer a real 2D pipeline composites over nearly every shot, drawn
 * here by arithmetic instead of a rented model.
 *
 * EVERYTHING IS A PURE FUNCTION OF (seed, frame). Remotion renders frames
 * out of order and in parallel processes; a particle system that integrates
 * velocity or calls Math.random renders a DIFFERENT film on every pass and
 * tears between the render halves. So each particle's whole trajectory is
 * parametric — position at frame N is computed from N directly, wrapping
 * through the frame on a per-particle period — and the randomness is a
 * seeded hash, never the clock.
 *
 * THE SCENE CHOOSES THE EFFECT, or nothing. vfxKindFor matches the shot's
 * own words; a scene that names no weather and no light gets NO overlay.
 * The same honesty gate as the parallax coverage bounds: the layer appears
 * where the text earns it, and absence is the correct default.
 *
 * SELF-CONTAINED ON PURPOSE — no imports at all, for the same Node
 * type-stripping reason as parallaxPlanes.ts: the story worker imports this
 * file directly, and one relative import here breaks it.
 *
 * Coordinates are NORMALISED: x, y in 0..1 of the frame, r as a fraction of
 * frame HEIGHT. The composition scales; the math never sees pixels.
 */

export type VfxKind = "embers" | "dust" | "rain" | "snow" | "fireflies";

export type Particle = {
  /**
   * Centre, as fractions of frame width/height. y is always in [0, 1); x may
   * overhang by up to the kind's sway amplitude (~0.02) on either side,
   * because sway rides OUTSIDE the wrap — see the note in particlesAt. The
   * overlay clips the overhang.
   */
  x: number;
  y: number;
  /** Radius as a fraction of frame height. */
  r: number;
  /** 0..1. The composition multiplies its own layer opacity on top. */
  opacity: number;
};

/**
 * Which effect a shot's words earn. Checked in priority order — a rainy
 * night scene reads as rain, not fireflies, because water beats light.
 * Returns null for a scene that names nothing: no overlay is the default.
 *
 * The vocabularies are THESAURUS-WIDE on purpose (owner directive,
 * 2026-08-13): a scene saying "blazing brazier" or "a deluge over the
 * harbour" earns its effect as surely as one saying "fire" or "rain". But
 * every stem is boundary-anchored and the traps are guarded individually,
 * because prose is adversarial: "grain" contains rain, "sparkling" jewels
 * are not sparks, a "soothing" voice is not soot, "ashamed" is not ash,
 * and a crowd that "hailed the king" brings no hailstones.
 */
export function vfxKindFor(text: string): VfxKind | null {
  const t = text.toLowerCase();
  // fire(?!fl): "fires" and "firelight" are embers, "fireflies" are not.
  // spark(?!l): "sparks" fly, "sparkling" jewels do not.
  // burn(?!ish): a fire burns, a "burnished" shield only shines.
  // forge(?!t): a smith's forge, not "forget"/"forgetting".
  if (
    /\b(ember|flame|fire(?!fl)|torch|burn(?!ish)|coal|bonfire|campfire|hearth|forge(?!t)|blaze|ablaze|inferno|cinder|spark(?!l)|smoulder|smolder|pyre|brazier|furnace|kiln|candl|volcan)/.test(
      t,
    )
  ) {
    return "embers";
  }
  // storm: not snowstorm/sandstorm/duststorm (those belong to their own
  // kinds), and not the verb — a hero "storming" a gate brings no weather.
  if (
    /\b(rain|(?<!snow)(?<!snow )(?<!sand)(?<!sand )(?<!dust)(?<!dust )storm(?!ed|ing)|monsoon|downpour|drizzle|deluge|cloudburst|squall|torrential|tempest)/.test(
      t,
    )
  ) {
    return "rain";
  }
  if (/\b(snow|frost|blizzard|sleet|winter|wintry|flurr|hailst|avalanche)/.test(t)) return "snow";
  // twinkling, not twinkl: "a twinkle in his eye" is a smile, not weather.
  if (
    /\b(firefl|glow-?worm|starlit|starry|starlight|moonlit|moonbeam|lightning bug|twinkling|lantern|night garden)/.test(
      t,
    )
  ) {
    return "fireflies";
  }
  // soot(?!h): a chimney's soot, not a "soothing" voice. ash(es)?\b: ash and
  // ashes, not "ashamed". sand(?!al): the desert, not "sandals"/"sandalwood".
  if (
    /\b(dust|desert|sand(?!al)|dune|bazaar|market|cave|cellar|sunbeam|haze|attic|ash(es)?\b|soot(?!h)|cobweb|pollen|smok)/.test(
      t,
    )
  ) {
    return "dust";
  }
  return null;
}

/** Deterministic 32-bit seed from a shot's identity (id, index — any string). */
export function vfxSeed(id: string): number {
  // FNV-1a. The point is stability across runs, not cryptography.
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One uniform draw in [0,1) from a (seed, lane) pair. Stateless. */
function draw(seed: number, lane: number): number {
  let h = (seed ^ Math.imul(lane + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** frac(v) that is safe for negative v — wraps into [0, 1). */
function wrap01(v: number): number {
  const w = v - Math.floor(v);
  // v - floor(v) rounds to exactly 1.0 for tiny negative v (|v| < ~1.1e-16),
  // which would violate the [0,1) contract the composition trusts.
  return w >= 1 ? 0 : w;
}

type KindSpec = {
  count: number;
  /** Vertical speed in frame-heights per second. Positive = falling. */
  vy: [number, number];
  /** Horizontal drift in frame-widths per second. */
  vx: [number, number];
  /** Radius range, as a fraction of frame height. */
  r: [number, number];
  /** Base opacity range. */
  opacity: [number, number];
  /** Sway amplitude (fraction of width) and its cycle seconds; 0 = none. */
  sway: [number, number];
  /** Twinkle depth 0..1 (0 = steady) and its cycle seconds. */
  twinkle: [number, number];
};

/**
 * The look of each effect, one place. Numbers are first cuts in the same
 * sense as the parallax rates: sized from reference footage descriptions,
 * to be tuned against rendered shots. Counts stay small — this layer reads
 * as air, not weather charts, and 60-140 divs is nothing to the renderer.
 */
export const VFX: Readonly<Record<VfxKind, KindSpec>> = {
  embers: {
    count: 60,
    vy: [-0.1, -0.035], // rising
    vx: [-0.015, 0.015],
    r: [0.0012, 0.0034],
    opacity: [0.35, 0.85],
    sway: [0.012, 3.1],
    twinkle: [0.45, 1.7],
  },
  dust: {
    count: 90,
    vy: [-0.012, 0.012], // hanging
    vx: [-0.02, 0.02],
    r: [0.0008, 0.002],
    opacity: [0.12, 0.35],
    sway: [0.008, 5.3],
    twinkle: [0.3, 4.1],
  },
  rain: {
    count: 140,
    vy: [0.9, 1.4], // falling hard
    vx: [0.06, 0.1], // wind-slanted, one direction
    r: [0.0008, 0.0014],
    opacity: [0.18, 0.4],
    sway: [0, 0],
    twinkle: [0, 0],
  },
  snow: {
    count: 110,
    vy: [0.05, 0.11],
    vx: [-0.012, 0.012],
    r: [0.0014, 0.0032],
    opacity: [0.35, 0.8],
    sway: [0.018, 4.3],
    twinkle: [0.15, 3.7],
  },
  fireflies: {
    count: 22,
    vy: [-0.008, 0.008],
    vx: [-0.012, 0.012],
    r: [0.0016, 0.0028],
    opacity: [0.2, 0.9],
    sway: [0.02, 6.1],
    twinkle: [0.9, 2.3], // the blink IS the effect
  },
};

function lerp(range: [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/**
 * Every particle of one effect at one absolute frame. Pure: same arguments,
 * same array, on any machine, in any render order.
 */
export function particlesAt(kind: VfxKind, seed: number, frame: number, fps: number): Particle[] {
  const spec = VFX[kind];
  const t = frame / Math.max(1, fps);
  const out: Particle[] = new Array(spec.count);
  for (let i = 0; i < spec.count; i++) {
    const base = i * 8;
    const x0 = draw(seed, base);
    const y0 = draw(seed, base + 1);
    const vy = lerp(spec.vy, draw(seed, base + 2));
    const vx = lerp(spec.vx, draw(seed, base + 3));
    const r = lerp(spec.r, draw(seed, base + 4));
    const baseOpacity = lerp(spec.opacity, draw(seed, base + 5));
    const phase = draw(seed, base + 6) * Math.PI * 2;

    // WRAP THE DRIFT, THEN ADD SWAY — never the other way. The drift term is
    // monotonic, so it crosses an integer boundary at most once per 1/|vx|
    // seconds and wrap01 turns that into the intended single recycle. The
    // review's determinism pass EXECUTED the first version (sway inside the
    // wrap) and counted seven full-width teleports in a ten-second embers
    // shot: sway's peak velocity exceeds |vx|, so a particle near the seam
    // re-crossed it every half-cycle and ping-ponged edge to edge. Sway now
    // rides outside the wrap, overhanging the frame by at most its amplitude;
    // the overlay clips the overhang.
    let x = wrap01(x0 + vx * t);
    if (spec.sway[0] > 0) {
      x += Math.sin(phase + (t / spec.sway[1]) * Math.PI * 2) * spec.sway[0];
    }
    const y = wrap01(y0 + vy * t);

    let opacity = baseOpacity;
    if (spec.twinkle[0] > 0) {
      const tw = 0.5 + 0.5 * Math.sin(phase * 1.7 + (t / spec.twinkle[1]) * Math.PI * 2);
      opacity *= 1 - spec.twinkle[0] * tw;
    }
    // Depth cue for free: smaller particles are fainter, reading as farther.
    opacity *= 0.55 + 0.45 * ((r - spec.r[0]) / Math.max(1e-9, spec.r[1] - spec.r[0]));

    out[i] = { x, y, r, opacity };
  }
  return out;
}
