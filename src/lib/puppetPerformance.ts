/**
 * Body language for the cutout puppets — rung 4 of the in-house
 * cinematography ladder (movie grade, 2026-08-13).
 *
 * Rung 2 measured the repertory and the mouths spoke; this makes the BODIES
 * perform. Three behaviours, each earned from data the pipeline already
 * has rather than invented:
 *
 *   GESTURE.  While the measured speech spans say the character is talking,
 *             the body talks too: a slow lean oscillation, plus small
 *             emphasis bobs on syllable onsets taken from the SAME mouth
 *             cues that drive the lips. A mouth that moves on a statue was
 *             the rung-2 complaint; a mouth whose body agrees with it is
 *             the fix.
 *   FACING.   The 180-degree eyeline rule, decided over the whole plan: in
 *             a run of rigged shots where two characters trade coverage,
 *             the first faces right from the left third and the second
 *             faces left from the right third, so a cut reads as a
 *             conversation instead of two portraits. Facing is conveyed by
 *             PLACEMENT and LEAN, never by mirroring the sheet — a mirror
 *             flips wardrobe asymmetries and the title letters baked into
 *             ringJinni's crop.
 *   WALK.     Gait verbs in the shot's own words (the vfxKindFor honesty
 *             gate, applied to feet) pick an entrance walk-in or a slow
 *             cross-drift, with a per-step bounce and a weight-shift tilt
 *             about the feet. A carpet that FLIES earns no walk; absence
 *             is the correct default.
 *
 * EVERYTHING IS A PURE FUNCTION OF (frame, params). Remotion renders frames
 * out of order and in parallel processes; the render halves are cut at an
 * arbitrary frame, so any state that survives from one frame to the next
 * renders a different film per pass and tears at the seam. Phases come from
 * a seeded hash, never the clock.
 *
 * SELF-CONTAINED ON PURPOSE — no imports at all, for the same Node
 * type-stripping reason as particleField.ts: the story worker imports this
 * file directly, and one relative import here breaks it. The mouth-cue
 * shape is therefore STRUCTURAL ({ startFrame, viseme }) and the rest
 * viseme is the literal 'X' — visemes.ts owns that alphabet
 * (visemes.REST), and puppetPerformance.test.ts pins the two together.
 *
 * Amplitudes are FRACTIONS OF FIGURE HEIGHT (the BREATH_AMPLITUDE
 * convention) and degrees; the composition multiplies by drawn pixels. The
 * numbers are small on purpose: a cutout puppet overdriven reads as a
 * paper doll on sticks, and every period here is deliberately
 * non-commensurate with the rig's 4.5s breath and 7.3s sway so nothing
 * phase-locks into a metronome.
 */

export type Facing = "left" | "right";

export type WalkKind = "enter" | "drift";

/** The per-shot performance the worker attaches (movie grade only). */
export type PuppetPerformance = {
  /** Eyeline from the conversation grammar. Absent = played to camera. */
  facing?: Facing;
  /** Horizontal centre override, fraction of frame width. */
  center?: number;
  /** Gait, when the shot's words earn one. */
  walk?: WalkKind;
  /** Whether THIS character speaks the shot's dialogue line. */
  speaking?: boolean;
  /** Deterministic phase seed, hashed from the shot's identity. */
  seed: number;
};

/** What the body does at one frame. Fractions of figure height; degrees. */
export type PuppetPose = {
  dx: number;
  dy: number;
  rotDeg: number;
};

/** One measured speech run, [start, end) in shot frames. */
export type SpeechSpan = readonly [number, number];

/**
 * The slice of a mouth cue this module reads. Structural on purpose — see
 * the header. `viseme` 'X' is rest (visemes.REST); anything else is a
 * mouth in motion.
 */
export type CueLike = {
  startFrame: number;
  viseme: string;
};

// Gesture: the talking-body oscillation. 2.9s beats nothing else in the rig
// (breath 4.5, sway 7.3, idle turn 9.7) and the ramp keeps span edges from
// popping.
const GESTURE_PERIOD_SECONDS = 2.9;
const GESTURE_LEAN_DEG = 1.1;
const GESTURE_RAMP_SECONDS = 0.35;
/** The constant angle toward the interlocutor, when facing is set. */
const FACING_BIAS_DEG = 0.7;

// Emphasis: one bob per spoken beat, ~0.3s long, capped where beats crowd.
const EMPHASIS_BOB = 0.006;
const EMPHASIS_ROT_DEG = 0.35;
const EMPHASIS_FRAMES = 9;
const EMPHASIS_CAP = 1.5;
/** Fewest frames between beats — syllables arrive faster than gestures do. */
export const BEAT_GAP_FRAMES = 9;

// Walk: cadence and step mechanics. 1.9 steps/s is a purposeful screen walk;
// the |sin| bounce puts two footfalls in every cycle the tilt swings once.
const STEP_HZ = 1.9;
const STEP_BOB = 0.008;
const STEP_TILT_DEG = 0.7;
/** An entrance crosses this much of the figure's height, then stands. */
const ENTER_DISTANCE = 0.18;
const ENTER_SECONDS = 2.2;
/** Longest fraction of the shot an entrance may spend walking. */
const ENTER_MAX_FRACTION = 0.4;
/** A drift wanders this far across the whole shot. */
const DRIFT_DISTANCE = 0.06;

// Idle: a very slow micro-turn so a silent, standing character is not a
// photograph between lines. Seeded phase; amplitude under half a degree.
const IDLE_TURN_PERIOD_SECONDS = 9.7;
const IDLE_TURN_DEG = 0.45;

/** Hard ceilings, asserted by tests over adversarial inputs. */
export const POSE_LIMITS = {
  dx: 0.25,
  dy: 0.02,
  rotDeg: 3,
} as const;

/** FNV-1a, the same mix particleField uses — stability, not cryptography. */
function hash01(seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  h = Math.imul(h, 0x01000193);
  h ^= h >>> 13;
  h = Math.imul(h, 0x01000193);
  return (h >>> 0) / 0xffffffff;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Smoothstep, for eases that must be at rest at both ends. */
const smooth = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/**
 * Gait verbs in the shot's own words, or nothing.
 *
 * The vocabulary is deliberately FEET-ONLY: flying, riding and sailing are
 * motion but not walks, and a puppet bobbing to a step cadence on a flying
 * carpet is the kind of wrong that reads instantly. The traps are guarded
 * the particleField way, because prose is adversarial: "ran out of
 * patience" goes nowhere, a "run-down" house never moves, and "entering
 * into an agreement" signs papers rather than doors.
 */
export function walkFor(text: string): WalkKind | null {
  const t = text.toLowerCase();
  // enter...\b(?!\s+into\b): walking into a room, not entering into a
  // bargain — the \b BEFORE the lookahead matters, or the optional suffix
  // backtracks ("entered" re-read as "enter"+"ed") and slips past the
  // guard. arriv|approach|return: all imply covering ground on screen.
  if (
    /\b(?:enter(?:s|ed|ing)?\b(?!\s+into\b)|arriv\w*|approach\w*|return(?:s|ed|ing)?\s+(?:to|home)\b)/.test(
      t,
    )
  ) {
    return "enter";
  }
  // (?:ran|runs|running)(?!\s+out\b)(?!-): running feet, not running out of
  // luck and not a run-down house ("run" bare is never matched at all).
  if (
    /\b(?:walk\w*|strid\w*|stroll\w*|wander\w*|pac(?:es|ed|ing)\b|march\w*|trudg\w*|ambl\w*|hurr(?:y|ies|ied|ying)|rush\w*|chas(?:es|ed|ing)\b|flee(?:s|ing)?\b|fled\b|cross(?:es|ed|ing)\b|climb\w*|(?:ran|runs|running)\b(?!\s+out\b)(?!-))/.test(
      t,
    )
  ) {
    return "drift";
  }
  return null;
}

/**
 * The eyeline pass — one facing per shot, decided over the whole plan.
 *
 * A CONVERSATION is a run of rigged shots in which at least two distinct
 * rigs appear, tolerating a single rigless shot inside the run (films cut
 * to an insert mid-exchange constantly; one cutaway does not end the
 * scene). Within a conversation, rigs face by order of first appearance:
 * first right, second left, third right again — so any pair of adjacent
 * speakers looks across the cut at each other.
 *
 * Outside a conversation (a solo run, or one character carrying every
 * shot) facing is null and the puppet plays to camera, exactly as rung 2
 * shipped it.
 */
export function conversationFacings(
  shots: ReadonlyArray<{ rig: string | null }>,
): (Facing | null)[] {
  const facings: (Facing | null)[] = shots.map(() => null);

  // Split into runs: consecutive rigged shots, bridging single rigless gaps.
  let runStart = -1;
  let gap = 0;
  const runs: Array<[number, number]> = [];
  for (let i = 0; i <= shots.length; i++) {
    const rigged = i < shots.length && shots[i].rig !== null;
    if (rigged) {
      if (runStart < 0) runStart = i;
      gap = 0;
    } else if (runStart >= 0) {
      gap += 1;
      // A second consecutive rigless shot — or the end of the plan — closes
      // the run just after the last rigged shot seen: `gap` rigless indices
      // have passed since it, so it sits at i - gap.
      if (gap > 1 || i === shots.length) {
        runs.push([runStart, i - gap + 1]);
        runStart = -1;
        gap = 0;
      }
    }
  }

  for (const [start, end] of runs) {
    const order: string[] = [];
    for (let i = start; i < end; i++) {
      const rig = shots[i].rig;
      if (rig !== null && !order.includes(rig)) order.push(rig);
    }
    if (order.length < 2) continue;
    for (let i = start; i < end; i++) {
      const rig = shots[i].rig;
      if (rig === null) continue;
      facings[i] = order.indexOf(rig) % 2 === 0 ? "right" : "left";
    }
  }
  return facings;
}

/**
 * Where a facing character STANDS: on the third looking across the frame.
 * A speaker on the left third facing right is film blocking; a speaker
 * dead centre facing sideways is a passport photo gone wrong.
 */
export function centerForFacing(facing: Facing): number {
  return facing === "right" ? 0.38 : 0.62;
}

/**
 * Does the plan's speaker name mean this rig? "The Magician" is prose and
 * "magician" is a key, so the match strips "the " and every
 * non-alphanumeric before comparing — the same normalisation the worker's
 * rig matcher applies to cast names.
 */
export function speakerMatchesRig(speaker: string, rigKey: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/[^a-z0-9]/g, "");
  const a = norm(speaker);
  return a.length > 0 && a === norm(rigKey);
}

/**
 * Spoken beats from the mouth track: onsets of non-rest cues, thinned to
 * one per BEAT_GAP_FRAMES. The lips move per phoneme; the body moves per
 * emphasis — un-thinned, a fast line would shake the puppet like a paint
 * mixer.
 */
export function beatFrames(cues: ReadonlyArray<CueLike>): number[] {
  const beats: number[] = [];
  let last = -Infinity;
  for (const cue of cues) {
    if (cue.viseme === "X") continue;
    if (cue.startFrame - last < BEAT_GAP_FRAMES) continue;
    beats.push(cue.startFrame);
    last = cue.startFrame;
  }
  return beats;
}

export type PoseParams = {
  durationInFrames: number;
  fps: number;
  /** Measured speech runs, shot-relative. */
  speech: ReadonlyArray<SpeechSpan>;
  /** Thinned spoken beats, from beatFrames(). */
  beats: ReadonlyArray<number>;
  facing?: Facing | null;
  walk?: WalkKind | null;
  /**
   * Whether the voice in the spans is THIS character's own line. A speaker
   * gestures at full size; a character standing under narration moves at
   * NARRATED_GAIN of it — present but not orating.
   */
  speaking?: boolean;
  seed: number;
};

/** Gesture gain for a character who is mouthing narration, not their line. */
const NARRATED_GAIN = 0.6;

/** How deep inside a speech span this frame is, 0 outside, ramped at edges. */
function speechEnvelope(frame: number, speech: ReadonlyArray<SpeechSpan>, fps: number): number {
  const ramp = Math.max(1, GESTURE_RAMP_SECONDS * fps);
  let env = 0;
  for (const [start, end] of speech) {
    if (frame < start || frame >= end) continue;
    const into = (frame - start) / ramp;
    const left = (end - 1 - frame) / ramp;
    env = Math.max(env, clamp(Math.min(into, left), 0, 1));
  }
  return env;
}

/**
 * The whole performance at one frame. Deterministic, bounded by
 * POSE_LIMITS, and identity-shaped when nothing is happening: no speech,
 * no walk and no facing leaves only the sub-half-degree idle turn.
 */
export function puppetPoseAt(frame: number, params: PoseParams): PuppetPose {
  const { durationInFrames, fps, speech, beats, facing, walk, seed } = params;
  const facingSign = facing === "left" ? -1 : facing === "right" ? 1 : 0;
  const voiceGain = params.speaking ? 1 : NARRATED_GAIN;

  let dx = 0;
  let dy = 0;
  let rot = 0;

  // IDLE TURN — always on, seeded phase so a two-shot of the same rig in
  // consecutive scenes does not turn in lockstep.
  const idlePhase = hash01(seed) * Math.PI * 2;
  rot += IDLE_TURN_DEG * Math.sin((frame / (IDLE_TURN_PERIOD_SECONDS * fps)) * Math.PI * 2 + idlePhase);

  // FACING BIAS — a constant angle toward the interlocutor, full-shot.
  rot += facingSign * FACING_BIAS_DEG;

  // GESTURE — the body talks while the voice does.
  const env = speechEnvelope(frame, speech, fps);
  if (env > 0) {
    const gesturePhase = hash01(seed ^ 0x9e3779b9) * Math.PI * 2;
    const lean = Math.sin((frame / (GESTURE_PERIOD_SECONDS * fps)) * Math.PI * 2 + gesturePhase);
    rot += env * voiceGain * GESTURE_LEAN_DEG * lean;
  }

  // EMPHASIS — one smooth bob per spoken beat, summed where they overlap
  // and capped so a dense line cannot stack into a shudder.
  let pulse = 0;
  for (const b of beats) {
    const u = (frame - b) / EMPHASIS_FRAMES;
    if (u < 0 || u >= 1) continue;
    pulse += Math.sin(Math.PI * u);
  }
  pulse = Math.min(pulse, EMPHASIS_CAP) * voiceGain;
  if (pulse > 0) {
    dy += EMPHASIS_BOB * pulse;
    rot += facingSign * EMPHASIS_ROT_DEG * pulse * 0.5;
  }

  // WALK — mechanics only inside the walking window, at rest outside it.
  if (walk) {
    const dir = facingSign !== 0 ? facingSign : 1;
    let walking = 0; // 0..1 strength of the gait at this frame
    if (walk === "enter") {
      const window = Math.min(ENTER_SECONDS * fps, durationInFrames * ENTER_MAX_FRACTION);
      if (window >= 1 && frame < window) {
        const t = frame / window;
        // Arrives AT the mark: offset runs from -distance to 0, eased so the
        // last step settles rather than halts.
        dx += dir * -ENTER_DISTANCE * (1 - smooth(t));
        walking = 1 - smooth(clamp((t - 0.75) / 0.25, 0, 1));
      }
    } else {
      // drift: a slow, whole-shot wander toward the eyeline, eased at both
      // ends so the cut lands on a standing figure.
      const t = durationInFrames > 1 ? frame / (durationInFrames - 1) : 1;
      dx += dir * DRIFT_DISTANCE * (smooth(t) - 0.5);
      walking = smooth(clamp(t / 0.15, 0, 1)) * smooth(clamp((1 - t) / 0.15, 0, 1));
    }
    if (walking > 0) {
      const tSec = frame / fps;
      dy += walking * STEP_BOB * Math.abs(Math.sin(Math.PI * STEP_HZ * tSec));
      rot += walking * STEP_TILT_DEG * Math.sin(Math.PI * STEP_HZ * tSec);
    }
  }

  return {
    dx: clamp(dx, -POSE_LIMITS.dx, POSE_LIMITS.dx),
    dy: clamp(dy, -POSE_LIMITS.dy, POSE_LIMITS.dy),
    rotDeg: clamp(rot, -POSE_LIMITS.rotDeg, POSE_LIMITS.rotDeg),
  };
}
