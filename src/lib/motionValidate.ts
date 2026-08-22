/**
 * MOTION_VALIDATE — does a shot have a source of real CHARACTER motion?
 *
 * WHY THIS EXISTS. A 43-shot film once passed a "motion PASS" on the strength
 * of depth-plane and camera evidence, and that was wrong: depth parallax and a
 * camera move are not a character walking, gesturing or talking. This validator
 * makes the distinction the earlier check could not, at the one place it is
 * knowable without guessing — the shot's rendered composition.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT. In the current engine a
 * shot's character can move ONLY from one of two sources:
 *   - a temporal CLIP (image-to-video), when that stage ran, or
 *   - a measured RIG puppet (`shot.character`), which lip-syncs, blinks and
 *     gestures — and which the worker attaches ONLY when the plan's cast names
 *     one of the measured rigs (story-worker.mjs `rigFor`).
 * A still with neither has no source of character motion at all: whatever it
 * does on screen is camera + parallax + VFX over frozen pixels. So this module
 * classifies the SOURCE (clip / rig / none) and, for a shot whose own action
 * text calls for movement, FAILS a still-only render.
 *
 * IT NEVER MANUFACTURES A PASS. Having a rig or a clip is a CAPABILITY, not
 * proof that the character visibly moved — that needs pixel evidence over the
 * character region, which this v1 does not have. So `PASS` is in the vocabulary
 * but is never returned here; the honest outcomes today are FAIL (provably
 * still-only where motion was called for) and UNKNOWN (everything else). This
 * matches the directive: UNKNOWN is acceptable, PASS is never fabricated, and
 * nothing here triggers regeneration.
 */

export type MotionSource = "clip" | "rig" | "none";

/** PASS is reserved for a future pixel-level check; v1 emits only FAIL/UNKNOWN. */
export type MotionVerdict = "PASS" | "FAIL" | "UNKNOWN";

/** The minimal shot facts the check needs — a subset of the rendered shot. */
export type ShotMotionInput = {
  /** The shot's own action/scene text (e.g. `shot.still` + narration). */
  action: string;
  /** A temporal clip (image-to-video) was rendered for this shot. */
  hasClip: boolean;
  /** A measured rig puppet is attached (`shot.character` present). */
  hasRig: boolean;
};

export type ShotMotionReport = {
  index: number;
  source: MotionSource;
  /** The shot's action text asks for character movement. */
  motionCalledFor: boolean;
  verdict: MotionVerdict;
  reason: string;
};

export type FilmMotionReport = {
  shots: ShotMotionReport[];
  total: number;
  /** Shots with no character-motion source (clip or rig). */
  stillOnly: number;
  /** Shots that FAILED: motion called for but rendered still-only. */
  failed: number;
  /** Shots carrying a real motion source (clip or rig). */
  withSource: number;
  /** FAIL if any shot failed; otherwise UNKNOWN (never PASS without pixels). */
  verdict: MotionVerdict;
};

/**
 * Verbs and words that call for visible CHARACTER motion — locomotion, body,
 * head, hands, face and speech. Deliberately about the character, not the
 * camera: "pan", "zoom" and "dolly" are camera words and are NOT here.
 */
const MOTION_WORDS = [
  // locomotion
  "walk", "walks", "walking", "walked",
  "run", "runs", "running", "ran",
  "step", "steps", "stepping", "stride", "strides",
  "approach", "approaches", "approaching",
  "enter", "enters", "entering", "leave", "leaves", "leaving",
  "climb", "climbs", "climbing", "dance", "dances", "dancing",
  "chase", "chases", "chasing", "flee", "flees", "fleeing",
  // posture change
  "sit", "sits", "sitting", "stand", "stands", "standing",
  "kneel", "kneels", "rise", "rises", "rising", "bow", "bows", "bowing",
  "turn", "turns", "turning", "lean", "leans", "leaning",
  // hands / body / interaction
  "gesture", "gestures", "gesturing", "wave", "waves", "waving",
  "reach", "reaches", "reaching", "grab", "grabs", "grabbing",
  "hold", "holds", "holding", "lift", "lifts", "lifting",
  "throw", "throws", "throwing", "push", "pushes", "pull", "pulls",
  "point", "points", "pointing", "clap", "claps", "nod", "nods", "nodding",
  "shake", "shakes", "shaking", "hug", "hugs", "hugging",
  // head / gaze / face
  "look", "looks", "looking", "glance", "glances", "smile", "smiles",
  "smiling", "frown", "frowns", "laugh", "laughs", "laughing",
  "cry", "cries", "crying",
  // speech (visible lip motion)
  "say", "says", "saying", "said", "speak", "speaks", "speaking",
  "talk", "talks", "talking", "tell", "tells", "shout", "shouts",
  "whisper", "whispers", "sing", "sings", "singing", "call", "calls",
  "ask", "asks", "asking", "reply", "replies",
];

const wordRe = new RegExp(`\\b(${MOTION_WORDS.join("|")})\\b`, "i");

/**
 * Does this shot's action text ask for character movement? A conservative
 * word match — false for pure scenery ("a wide, empty harbour at dawn"), true
 * when the text names a body/speech action. Intentionally errs toward false:
 * a missed motion cue lands as UNKNOWN, never a false FAIL.
 */
export function motionCalledFor(action: string): boolean {
  return wordRe.test(action ?? "");
}

/** The character-motion source actually rendered for this shot. */
export function motionSourceOf(input: ShotMotionInput): MotionSource {
  if (input.hasClip) return "clip";
  if (input.hasRig) return "rig";
  return "none";
}

/**
 * Classify ONE shot. FAIL only when a shot whose action calls for movement was
 * rendered still-only (no clip, no rig). Never returns PASS — see the header.
 */
export function validateShotMotion(input: ShotMotionInput, index: number): ShotMotionReport {
  const source = motionSourceOf(input);
  const called = motionCalledFor(input.action);
  if (source === "none" && called) {
    return {
      index,
      source,
      motionCalledFor: called,
      verdict: "FAIL",
      reason:
        "the shot's action calls for character motion but it was rendered " +
        "still-only (no image-to-video clip and no measured rig puppet) — " +
        "camera and parallax are not character motion",
    };
  }
  const reason =
    source === "none"
      ? "still-only, but the action does not clearly call for character motion — not judged"
      : `carries a ${source} motion source; visible character motion is not pixel-verified here`;
  return { index, source, motionCalledFor: called, verdict: "UNKNOWN", reason };
}

/**
 * Validate a whole film. The film FAILS if any shot failed; otherwise UNKNOWN.
 * A PASS is never issued from descriptors alone — that awaits a pixel-level
 * character-motion measurement.
 */
export function validateFilmMotion(shots: ShotMotionInput[]): FilmMotionReport {
  const reports = shots.map((s, i) => validateShotMotion(s, i));
  const stillOnly = reports.filter((r) => r.source === "none").length;
  const failed = reports.filter((r) => r.verdict === "FAIL").length;
  const withSource = reports.length - stillOnly;
  return {
    shots: reports,
    total: reports.length,
    stillOnly,
    failed,
    withSource,
    verdict: failed > 0 ? "FAIL" : "UNKNOWN",
  };
}
