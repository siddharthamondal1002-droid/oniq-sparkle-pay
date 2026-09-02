// Character motion, as a routed capability rather than a lookup.
//
// THE DEFECT THIS OPENS, measured 2026-09-02 on job 64874747. `rigFor()` maps a
// shot's text onto ELEVEN measured characters — the Arabian Nights season cast.
// "The Last Gaslamp" stars Arthur, a Victorian lamplighter, so it matched
// nothing and the film reported `0 rig-sourced`: nine shots of camera and
// parallax with no character motion at all. That was not a bug in rigFor. It
// was the shape of the system — measured rigs WERE the definition of CPU
// character motion, so a story outside the repertory had no tier to fall to.
//
// The architectural change is one sentence: measured rigs stop being the
// definition and become the OPTIMISED BRANCH of CPU character motion. UCMA —
// the Universal Character Motion Adapter — becomes the general branch.
//
//   known character   -> measured rig  (hand-measured, highest confidence)
//   unknown character -> UCMA          (derived at runtime)
//   neither           -> camera-only, said out loud
//
// WHAT UCMA ACTUALLY HAS TO PRODUCE, and why that is smaller than it sounds.
// A CharacterRig is not a skeleton. It is a cut-out sheet plus
// `{ crop, mouth, interocular, eyes? }`, and PuppetPose — what the body does in
// one frame — is `{ dx, dy, rotDeg }` bounded to 0.25 / 0.02 / 3°. The eleven
// specialists are RIGID CUT-OUTS that breathe, sway, walk, lean on speech
// beats, lip-sync and blink. There is no upper_arm_L anywhere in this codebase.
//
// So parity, not superiority, is v1: UCMA derives the same representation for
// an arbitrary character and hands it to the SAME pose, walk, gesture and blink
// engine the rigs already drive. Articulated limbs would make the generalist
// exceed the specialists it exists to generalise, and would introduce tearing
// and duplicated-limb failure modes this pipeline has never had. That is a v2
// behind its own gate, not a v1 obligation.
//
// NOTHING HERE KNOWS A CHARACTER'S IDENTITY. No name, no ethnicity, no gender,
// no occupation appears in this module or may be added to it. UCMA works from
// the character's own pixels and the shot's words; a rig is selected by the
// existing repertory lookup and nothing else. The eleven rig KEYS are data in
// characterRig.ts, and they stay there.
//
// PURE. No image decoding, no model, no clock, no filesystem — every decision
// is a function of its arguments, so the whole routing layer is testable
// without a render. The stages that must touch pixels are injected as an
// analyser, which is how the Arthur case is testable at all.

import type { PuppetPose } from "./puppetPerformance";

/**
 * WHERE THE MOTION CAME FROM — reported per shot, never inferred.
 *
 * `rig-sourced` as a single boolean could not distinguish "a specialist drove
 * this" from "nothing did", which is how nine motionless shots reported a
 * number instead of a problem. These five are mutually exclusive and every
 * one of them is falsifiable against the metrics below.
 */
export type MotionSource =
  /** One of the hand-measured repertory rigs. */
  | "measured_rig"
  /** Derived at runtime from the character's own pixels. */
  | "ucma"
  /** Ken Burns and parallax only. HONEST: this is not character motion. */
  | "camera_only"
  /** Not even a camera move. */
  | "static"
  /** A tier was selected, ran, and did not produce usable motion. */
  | "failed";

/**
 * The character's pixels.
 *
 * `imagePath` is usually THE SHOT'S OWN STILL. A user story has no published
 * character asset — job 64874747 carried `actor_refs = false` and a null
 * `cast_json` — so the only image of Arthur that exists anywhere is the frame
 * the still engine just drew. UCMA isolates the figure inside that frame. When
 * a canonical character WAS resolved, its reference is better and is used
 * instead; `characterRefId` records which it was.
 */
export type CharacterReference = {
  imagePath: string;
  characterRefId?: string | null;
};

/** The slice of a shot that motion planning reads. Structural on purpose. */
export type MotionShot = {
  still: string;
  narration: string;
  dialogue?: { speaker: string; line: string } | null;
};

export type CharacterMotionInput = {
  /** Opaque. A name from the plan's cast, used for identity of the ANALYSIS
   *  cache and for nothing else — never matched against a known-character list
   *  inside UCMA. */
  characterId: string;
  characterReference: CharacterReference;
  shot: MotionShot;
  durationFrames: number;
  fps: number;
};

export type MotionCapability =
  | { supported: true; confidence: number }
  | { supported: false; reason: string };

/** One frame of body pose, in the units the existing engine already speaks. */
export type PoseFrame = PuppetPose & { frame: number };

/** One frame of whole-figure placement, fractions of frame width/height. */
export type TransformFrame = { frame: number; x: number; y: number; scale: number };

/**
 * WHAT MOVED, IN PIXELS — the evidence, not the claim.
 *
 * Every number here describes the CHARACTER. Camera movement is computed
 * elsewhere and is deliberately absent: a Ken Burns push moves every pixel in
 * the frame, so counting it here would let a static cut-out report motion
 * forever. That substitution is the specific dishonesty this type exists to
 * make impossible.
 */
export type MotionMetrics = {
  bodyMotionPx: number;
  headMotionPx: number;
  limbMotionPx: number;
  framesWithMotion: number;
};

export type CharacterMotionPlan = {
  source: MotionSource;
  confidence: number;
  poseTimeline: PoseFrame[];
  transformTimeline: TransformFrame[];
  motionMetrics: MotionMetrics;
  fallbackReason?: string;
};

export type CharacterMotionFailure = {
  source: "failed";
  reason: string;
};

export type CharacterMotionResult = CharacterMotionPlan | CharacterMotionFailure;

export function isPlan(r: CharacterMotionResult): r is CharacterMotionPlan {
  return r.source !== "failed";
}

/**
 * The adapter contract. Two methods, and the split matters: `canHandle` must be
 * cheap and must not spend the analysis, so the router can ask every tier
 * before committing to one.
 */
export interface CharacterMotionAdapter {
  readonly source: Exclude<MotionSource, "camera_only" | "static" | "failed">;
  canHandle(input: CharacterMotionInput): MotionCapability;
  buildMotion(input: CharacterMotionInput): Promise<CharacterMotionResult>;
}

/**
 * THE QUALITY GATE (spec §9), and the reason it is a floor and not a boolean.
 *
 * A cut-out that breathes moves a couple of pixels; a cut-out that does nothing
 * moves zero. Without a floor, "the pose timeline exists" would pass as motion
 * and the system would report success for a shot indistinguishable from Ken
 * Burns. The floor is in PIXELS of character displacement so it means the same
 * thing at any resolution, and it is deliberately low: the bar is "a viewer can
 * see this figure is alive", not "the figure acts".
 */
export const MIN_CHARACTER_MOTION_PX = 6;
/** A figure that moves in only a handful of frames is a glitch, not motion. */
export const MIN_FRAMES_WITH_MOTION = 8;

export type GateVerdict = { ok: true } | { ok: false; reason: string };

export function gateMotion(plan: CharacterMotionPlan): GateVerdict {
  const m = plan.motionMetrics;
  const total = m.bodyMotionPx + m.headMotionPx + m.limbMotionPx;
  if (m.framesWithMotion === 0) return { ok: false, reason: "UCMA_NO_MOVING_FRAMES" };
  if (total < MIN_CHARACTER_MOTION_PX) {
    return { ok: false, reason: `UCMA_BELOW_MOTION_FLOOR (${total.toFixed(1)}px)` };
  }
  if (m.framesWithMotion < MIN_FRAMES_WITH_MOTION) {
    return { ok: false, reason: `UCMA_TOO_FEW_MOVING_FRAMES (${m.framesWithMotion})` };
  }
  return { ok: true };
}

/**
 * Pixels of character displacement implied by a pose timeline.
 *
 * PuppetPose speaks fractions of FIGURE HEIGHT and degrees, which is the right
 * unit for the renderer and the wrong one for a gate — 0.02 means nothing until
 * you know how tall the figure is. This converts once, at the boundary, so the
 * gate compares like with like and the renderer keeps its own units.
 */
export function metricsOfPoses(
  poses: readonly PoseFrame[],
  figureHeightPx: number,
): MotionMetrics {
  let bodyMotionPx = 0;
  let headMotionPx = 0;
  let framesWithMotion = 0;
  for (let i = 1; i < poses.length; i += 1) {
    const a = poses[i - 1];
    const b = poses[i];
    const dx = (b.dx - a.dx) * figureHeightPx;
    const dy = (b.dy - a.dy) * figureHeightPx;
    const step = Math.hypot(dx, dy);
    // A rotation about the figure's base swings the head by roughly
    // height * angle; that is head travel, not body travel, and is counted as
    // such so a nodding figure is not reported as a walking one.
    const swing = (Math.abs(b.rotDeg - a.rotDeg) * Math.PI) / 180 * figureHeightPx;
    bodyMotionPx += step;
    headMotionPx += swing;
    if (step > 0.05 || swing > 0.05) framesWithMotion += 1;
  }
  return {
    bodyMotionPx,
    headMotionPx,
    // v1 is parity with the measured rigs, which have no limbs. Reported as 0
    // rather than omitted: the field is the place articulated motion will land,
    // and a reader must be able to see that it is genuinely absent today.
    limbMotionPx: 0,
    framesWithMotion,
  };
}

/**
 * THE FALLBACK HIERARCHY (spec §16), as data.
 *
 * Written down rather than expressed as nested ifs so that every downgrade has
 * a name a log can carry, and so the ORDER is reviewable in one place. Nothing
 * may report character motion after landing on the last two.
 */
export const MOTION_TIERS = ["measured_rig", "ucma", "camera_only", "static"] as const;

export type ResolveOptions = {
  /** UCMA_ENABLED. Off = the system behaves exactly as it did before UCMA. */
  ucmaEnabled: boolean;
};

export type ResolvedMotion = {
  source: MotionSource;
  plan: CharacterMotionPlan | null;
  /** Every tier that was tried and declined, in order, with its reason. */
  downgrades: { from: MotionSource; reason: string }[];
};

/**
 * THE ROUTER — the key architectural change.
 *
 * rigFor() does not disappear and is not weakened: it is the first adapter
 * asked, it keeps its exact matching, and a known character still takes the
 * hand-measured path. What changes is only what happens on `null`.
 *
 * ADAPTERS ARE INJECTED, in order. The router knows nothing about rigs, sheets,
 * segmentation or models — it knows that tiers are tried in order, that a tier
 * may decline cheaply, that a tier that runs must pass the gate, and that every
 * refusal is recorded. That is why the Arthur case can be tested without a
 * renderer, and why a future tier costs no change here.
 */
export async function resolveCharacterMotion(
  input: CharacterMotionInput,
  adapters: readonly CharacterMotionAdapter[],
  opts: ResolveOptions,
): Promise<ResolvedMotion> {
  const downgrades: { from: MotionSource; reason: string }[] = [];
  for (const adapter of adapters) {
    if (adapter.source === "ucma" && !opts.ucmaEnabled) {
      downgrades.push({ from: "ucma", reason: "UCMA_DISABLED" });
      continue;
    }
    const can = adapter.canHandle(input);
    if (!can.supported) {
      downgrades.push({ from: adapter.source, reason: can.reason });
      continue;
    }
    const built = await adapter.buildMotion(input);
    if (!isPlan(built)) {
      downgrades.push({ from: adapter.source, reason: built.reason });
      continue;
    }
    const verdict = gateMotion(built);
    if (!verdict.ok) {
      // A tier that RAN and produced nothing usable is a failure of that tier,
      // recorded as such. Passing it through would be the exact claim this
      // module exists to prevent: motion reported for a shot that has none.
      downgrades.push({ from: adapter.source, reason: verdict.reason });
      continue;
    }
    return { source: adapter.source, plan: built, downgrades };
  }
  // NO TIER SERVED THIS SHOT. camera_only is the truth, and it is not character
  // motion — the caller must never round it up to one.
  return { source: "camera_only", plan: null, downgrades };
}

/**
 * The telemetry line for one shot. Shaped so `motionSource` is always present
 * and the metrics are absent rather than zeroed when no character moved —
 * zeros read as "measured nothing", absence reads as "nothing to measure".
 */
export function characterMotionTelemetry(resolved: ResolvedMotion) {
  return {
    source: resolved.source,
    ...(resolved.plan
      ? {
          confidence: resolved.plan.confidence,
          ...resolved.plan.motionMetrics,
        }
      : {}),
    ...(resolved.downgrades.length
      ? { downgrades: resolved.downgrades.map((d) => `${d.from}:${d.reason}`) }
      : {}),
  };
}
