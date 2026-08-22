/**
 * MOTION RUNTIME CONTRACT — the worker's per-shot character-motion decision,
 * made explicit (character-motion production-closure loop, 2026-08-22).
 *
 * WHY. The 2026-08-22 organic movie job (49da5c31, 43 shots) rendered with
 * ZERO character-motion sources: the Veo clip stage is an owner-only
 * experiment (`STORY_MOVIE=on`, off in production by the 2026-08-13 in-house
 * engine directive), the measured rigs cover only the 11-character demo
 * repertory, and the whole motion-provider fabric (motionProvider/motionCost)
 * was never wired into the worker at all. The worker's only motion decision
 * was a single `if (movie)` that, when armed, bought a Veo clip for EVERY
 * shot — static scenery included — at ~₹100 a clip. Nothing recorded WHY a
 * shot ended up still-only.
 *
 * WHAT THIS IS. The pure decision + bookkeeping layer between the shot plan
 * and the clip stage:
 *
 *   planShotMotion    — classify the shot (the existing motionProvider/
 *                       motionCost classifiers) and decide whether THIS run's
 *                       clip-stage mode attempts a clip for it.
 *   resolveShotMotion — after the shot is assembled, name the outcome with an
 *                       explicit status. No ambiguous "success".
 *   summarizeShotMotion — the film-level counts the log prints beside
 *                       MOTION_VALIDATE.
 *   temporalAliveness — the deterministic pixel check for a generated clip:
 *                       a clip whose frames do not change is a still wearing
 *                       a video container, and attaching it as "motion" is
 *                       exactly the false-PASS class MOTION_VALIDATE exists
 *                       to kill. Frozen output falls back to the honest
 *                       still + parallax path.
 *
 * THE STATUS VOCABULARY (explicit, per the production-closure contract):
 *   NOT_REQUESTED — the shot's own grammar calls for no character motion.
 *   REQUESTED / GENERATING — transient, logged live during a clip attempt.
 *   GENERATED  — a motion source exists but its pixels are not verified here
 *                (the measured-rig puppet: deterministic, render-time).
 *   VALIDATED  — a generated clip that passed the deterministic clip gates.
 *   FAILED     — a clip was attempted and did not survive (provider error,
 *                refusal, timeout, or a frozen result) — the shot fell back.
 *   FALLBACK   — motion was called for but no provider is enabled/available,
 *                so the shot rendered on the still path, reason named.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It enables nothing and spends nothing:
 * with `STORY_MOVIE` unset (every production dispatch) the plan never attempts
 * a clip and the film is byte-identical to before — this layer only writes the
 * evidence down. Enabling any engine (Veo money, a GPU host) stays an owner
 * decision; the recorded gates (ENGINE_AUDIT §5, MOTION_L4_READINESS) hold.
 *
 * PURE — no fs, no child_process, no network. The worker owns frame decode
 * (ffmpeg → raw RGBA, the sheetPanel pattern); this module only decides.
 */

import {
  classNeedsClip,
  classifyMotionDriver,
  VEO_META,
  type MotionClass,
  type MotionDriverClass,
  type MotionShot,
} from "./motionProvider.ts";
import { selectMotionLevel, type MotionLevel } from "./motionCost.ts";
import type { RawImage } from "./sheetPanel.ts";

/**
 * The clip-stage mode for one run, from `STORY_MOVIE`:
 *   off    — production default. No clip is ever attempted.
 *   on     — the owner's original every-shot experiment, semantics preserved
 *            byte-for-byte: every shot of a movie job attempts a clip.
 *   select — the spend-guarded experiment: only shots whose own grammar CALLS
 *            for character motion, and which no free tier (a measured rig)
 *            already serves, attempt a clip. On the 49da5c31 baseline that is
 *            25 of 43 shots — the other 18 were static/camera-only scenery
 *            that a ₹100 clip cannot improve into character motion.
 */
export type ClipStageMode = "off" | "on" | "select";

export type MotionStatus =
  | "NOT_REQUESTED"
  | "REQUESTED"
  | "GENERATING"
  | "GENERATED"
  | "VALIDATED"
  | "FAILED"
  | "FALLBACK";

export type ShotMotionPlan = {
  motionClass: MotionClass;
  driverClass: MotionDriverClass | null;
  /** The cheapest tier the cost ladder lands on under this run's policy. */
  level: MotionLevel;
  /** The shot's own grammar calls for character motion a still cannot carry. */
  needsCharacterMotion: boolean;
  /** This run will attempt a clip for this shot (mode + ladder decided). */
  attemptClip: boolean;
  reason: string;
};

/**
 * Decide ONE shot's motion plan for this run. `hasMeasuredRig` is the worker's
 * own rigFor() answer (the 11-character repertory); the ladder treats a rig as
 * the free tier that beats a paid clip, so `select` mode never buys a clip for
 * a shot the puppet already animates. Pose-warp and diffusion stay off here —
 * they are owner-gated engines with no deployed host (MOTION_L4_READINESS).
 */
export function planShotMotion(
  shot: MotionShot,
  opts: { hasMeasuredRig: boolean; clipStage: ClipStageMode },
): ShotMotionPlan {
  const decision = selectMotionLevel(
    shot,
    { hasMeasuredRig: opts.hasMeasuredRig, poseWarpEligible: false },
    { allowPoseWarp: false, allowDiffusion: false, allowPremium: opts.clipStage !== "off" },
  );
  const needs = classNeedsClip(decision.motionClass);
  const attemptClip =
    opts.clipStage === "on"
      ? true // the original experiment: every shot, semantics preserved
      : opts.clipStage === "select"
        ? decision.level === 5 // the ladder chose premium: motion needed, no free tier
        : false;
  return {
    motionClass: decision.motionClass,
    driverClass: classifyMotionDriver(shot),
    level: decision.level,
    needsCharacterMotion: needs,
    attemptClip,
    reason: decision.reason,
  };
}

export type ShotMotionOutcome = {
  status: MotionStatus;
  source: "clip" | "rig" | "none";
  provider: string | null;
  fallbackReason: string | null;
};

/**
 * Name what actually happened to one shot, from the facts the worker holds
 * after assembly. `clipError` carries the failure text for an attempted clip
 * that did not survive (provider error, refusal, timeout, frozen pixels).
 */
export function resolveShotMotion(
  plan: ShotMotionPlan,
  result: { clipAttached: boolean; clipError: string | null; hasRig: boolean },
): ShotMotionOutcome {
  if (result.clipAttached) {
    // Only a clip that survived the deterministic gates is ever attached.
    return { status: "VALIDATED", source: "clip", provider: VEO_META.name, fallbackReason: null };
  }
  if (plan.attemptClip && result.clipError) {
    // Tried and lost — the still path carried the shot instead.
    return { status: "FAILED", source: result.hasRig ? "rig" : "none", provider: null, fallbackReason: result.clipError };
  }
  if (result.hasRig) {
    // The deterministic puppet renders this character at composition time.
    // GENERATED, not VALIDATED: its pixels are not verified in this process.
    return { status: "GENERATED", source: "rig", provider: "measured-rig", fallbackReason: null };
  }
  if (plan.needsCharacterMotion) {
    return {
      status: "FALLBACK",
      source: "none",
      provider: null,
      fallbackReason: "no motion provider enabled (owner-gated) — still + camera carried the shot",
    };
  }
  return { status: "NOT_REQUESTED", source: "none", provider: null, fallbackReason: null };
}

export type FilmMotionSummary = {
  total: number;
  validatedClips: number;
  rigSourced: number;
  failed: number;
  fallback: number;
  notRequested: number;
};

export function summarizeShotMotion(outcomes: ShotMotionOutcome[]): FilmMotionSummary {
  const count = (s: MotionStatus) => outcomes.filter((o) => o.status === s).length;
  return {
    total: outcomes.length,
    validatedClips: count("VALIDATED"),
    rigSourced: count("GENERATED"),
    failed: count("FAILED"),
    fallback: count("FALLBACK"),
    notRequested: count("NOT_REQUESTED"),
  };
}

// ── TEMPORAL ALIVENESS — is a generated clip actually moving? ────────────────

/**
 * Minimum mean luminance change (0..255 per pixel, averaged over sampled
 * pixels and consecutive frame pairs) for a clip to count as alive. The
 * separation is not subtle: two identical frames score exactly 0, an encoder's
 * noise floor on a frozen scene stays well under 0.5, and real generated
 * motion (subject or scene, measured on the ep3-era clips) scores several
 * whole units. 0.75 sits in the empty gap between those bands — low enough
 * that gentle drift passes, high enough that a still in a video container
 * cannot. A discarded clip costs its generation fee but never poisons the
 * film with fake "motion"; the still + parallax path takes the shot.
 */
export const CLIP_ALIVENESS_MIN = 0.75;

/**
 * Mean absolute luminance difference between two same-sized RGBA frames,
 * sampled every other pixel. Mismatched frames return NaN — the caller's
 * aliveness collapses to 0 (fail closed: an unmeasurable clip is not "alive").
 */
export function frameLuminanceDiff(a: RawImage, b: RawImage): number {
  if (
    a.width !== b.width ||
    a.height !== b.height ||
    a.data.length !== b.data.length ||
    a.data.length !== a.width * a.height * 4
  ) {
    return Number.NaN;
  }
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 8) {
    const la = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
    const lb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2];
    sum += Math.abs(la - lb);
    n++;
  }
  return n === 0 ? Number.NaN : sum / n;
}

/**
 * Aliveness of a sampled frame sequence: the mean of consecutive-pair
 * differences. Fewer than two frames, or any unmeasurable pair, scores 0 —
 * a clip whose motion cannot be established is treated as frozen, never
 * waved through.
 */
export function temporalAliveness(frames: RawImage[]): number {
  if (frames.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < frames.length; i++) {
    const d = frameLuminanceDiff(frames[i - 1], frames[i]);
    if (!Number.isFinite(d)) return 0;
    sum += d;
  }
  return sum / (frames.length - 1);
}

export function clipTemporallyAlive(score: number, min: number = CLIP_ALIVENESS_MIN): boolean {
  return Number.isFinite(score) && score >= min;
}
