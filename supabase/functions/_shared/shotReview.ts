/**
 * The automated film reviewer, and the repairs it prescribes.
 *
 * Owner directive 2026-08-27: "Do not simply accept HTTP 200." A shot is
 * accepted on MEASURED evidence — the worker's own reported metrics plus,
 * where frames were sampled, what the pixels actually did. Anything else
 * is a repair with a named cause, so the next attempt changes something
 * specific rather than repeating the prompt and hoping.
 */

import { CLIP_ALIVENESS_MIN } from "./motionGate.ts";

/** Why a shot was rejected. The taxonomy the repair planner switches on. */
export type FailureCode =
  | "ENCODE_FAILURE"
  | "DURATION_FAILURE"
  | "STATIC_MOTION"
  | "VISUAL_CORRUPTION"
  | "AUDIO_FAILURE"
  | "WRONG_RESOLUTION"
  | "MISSING_ARTIFACT";

export type ShotEvidence = {
  /** What the worker measured and returned. */
  ok?: boolean;
  outputRef?: string;
  outputBytes?: number;
  videoSeconds?: number;
  frames?: number;
  width?: number;
  height?: number;
  format?: string;
  hasAudio?: boolean;
  audioPeakDbfs?: number;
  /** Pixel evidence, when frames were sampled. Absent = not measured. */
  aliveness?: number;
  residualMotion?: number;
  subjectMotionRatio?: number;
};

export type ShotExpectation = {
  durationSeconds: number;
  width: number;
  height: number;
  /** Movie grade demands real motion; classic does not. */
  requiresMotion: boolean;
  requiresAudio: boolean;
};

export type ReviewVerdict =
  | { verdict: "PASS"; notes: string[] }
  | { verdict: "REPAIR_REQUIRED"; code: FailureCode; reason: string; notes: string[] };

/** How far a delivered shot may drift from the length it was planned at. */
export const SHOT_DURATION_TOLERANCE = 0.25;

/**
 * Review one shot.
 *
 * The order matters: a missing artifact is not a motion problem, and a
 * clip that does not decode cannot be asked whether it moved. Each check
 * is the cheapest one that can still refuse.
 */
export function reviewShot(evidence: ShotEvidence, expect: ShotExpectation): ReviewVerdict {
  const notes: string[] = [];

  if (evidence.ok !== true || !evidence.outputRef) {
    return fail("MISSING_ARTIFACT", "the worker reported no artifact", notes);
  }
  if (!evidence.outputBytes) {
    return fail("ENCODE_FAILURE", "the artifact is empty", notes);
  }
  if (expect.requiresMotion) {
    if (!evidence.frames || !evidence.videoSeconds) {
      return fail("ENCODE_FAILURE", "the clip reports no frames or duration", notes);
    }
    const drift = Math.abs(evidence.videoSeconds - expect.durationSeconds) / expect.durationSeconds;
    if (drift > SHOT_DURATION_TOLERANCE) {
      return fail(
        "DURATION_FAILURE",
        `${evidence.videoSeconds}s against a ${expect.durationSeconds}s shot`,
        notes,
      );
    }
  }
  if (
    (evidence.width && evidence.width !== expect.width) ||
    (evidence.height && evidence.height !== expect.height)
  ) {
    return fail(
      "WRONG_RESOLUTION",
      `${evidence.width}x${evidence.height} is not the film's canvas`,
      notes,
    );
  }

  // MOTION. Gated on the aliveness minimum, which was calibrated against
  // real clips. The camera-compensated numbers are recorded as evidence
  // and never gate on their own — see subjectMotionRatio's note: their
  // bands overlap on synthetic clips and no real clip has placed a line
  // between them yet. A repair costs GPU money and needs a real cause.
  if (expect.requiresMotion && evidence.aliveness !== undefined) {
    if (evidence.aliveness < CLIP_ALIVENESS_MIN) {
      return fail(
        "STATIC_MOTION",
        `aliveness ${evidence.aliveness.toFixed(2)} is below ${CLIP_ALIVENESS_MIN}`,
        notes,
      );
    }
    if (evidence.residualMotion !== undefined && evidence.residualMotion < CLIP_ALIVENESS_MIN) {
      // Alive overall, but nothing the camera does not explain: the shot
      // may be a still under a move. Recorded for the operator, not acted
      // on, because acting on it would be spending on an uncalibrated line.
      notes.push(
        `camera-only suspected: residual ${evidence.residualMotion.toFixed(2)} ` +
          `with aliveness ${evidence.aliveness.toFixed(2)} — advisory, not gated`,
      );
    }
  }

  if (expect.requiresAudio) {
    if (evidence.hasAudio !== true) {
      return fail("AUDIO_FAILURE", "the shot should speak and carries no audio", notes);
    }
    if (evidence.audioPeakDbfs !== undefined && evidence.audioPeakDbfs <= -60) {
      return fail(
        "AUDIO_FAILURE",
        `audio peaks at ${evidence.audioPeakDbfs} dBFS — silence with extra steps`,
        notes,
      );
    }
  }

  return { verdict: "PASS", notes };
}

function fail(code: FailureCode, reason: string, notes: string[]): ReviewVerdict {
  return { verdict: "REPAIR_REQUIRED", code, reason, notes };
}

/* ------------------------------------------------------------- repairs */

export type RepairInstruction = {
  code: FailureCode;
  /** What to change on the next attempt, in the caller's own vocabulary. */
  action: "sharpen-motion" | "redraw-reference" | "reencode" | "respeak" | "shorten" | "abandon";
  /** Appended to the motion prompt, when the repair is a prompt change. */
  promptSuffix?: string;
  /** Whether the shot's reference still must be drawn again first. */
  redrawReference: boolean;
  detail: string;
};

/**
 * Turn a diagnosis into a DIFFERENT next attempt.
 *
 * The rule the directive names: never blindly repeat the same prompt. A
 * static clip gets a more specific action to perform; a corrupt frame gets
 * its reference redrawn; a clip that is merely the wrong length gets
 * re-encoded rather than re-imagined, because its content was fine.
 */
export function planRepair(code: FailureCode, attemptsLeft: number): RepairInstruction {
  if (attemptsLeft <= 0) {
    return {
      code,
      action: "abandon",
      redrawReference: false,
      detail: "out of attempts; the shot is marked failed and the film stops safely",
    };
  }
  switch (code) {
    case "STATIC_MOTION":
      return {
        code,
        action: "sharpen-motion",
        promptSuffix:
          " The subject performs the action visibly and continuously through the shot; " +
          "the movement is the point of the frame, not the camera.",
        redrawReference: false,
        detail: "the clip was alive but the action did not read; make the action explicit",
      };
    case "VISUAL_CORRUPTION":
      return {
        code,
        action: "redraw-reference",
        redrawReference: true,
        detail: "the frame itself was damaged; draw the reference again before animating",
      };
    case "MISSING_ARTIFACT":
    case "ENCODE_FAILURE":
      return {
        code,
        action: "reencode",
        redrawReference: false,
        detail: "nothing usable came back; run the same plan again before changing it",
      };
    case "DURATION_FAILURE":
      return {
        code,
        action: "shorten",
        redrawReference: false,
        detail: "the clip was not the planned length; regenerate at the planned clock",
      };
    case "WRONG_RESOLUTION":
      return {
        code,
        action: "redraw-reference",
        redrawReference: true,
        detail: "the canvas was wrong at the source; redraw at the film's canvas",
      };
    case "AUDIO_FAILURE":
      return {
        code,
        action: "respeak",
        redrawReference: false,
        detail: "the picture is fine; only the voice needs running again",
      };
  }
}

/** Does this repair need the shot's picture regenerated, or only its audio? */
export function repairTouchesPicture(instruction: RepairInstruction): boolean {
  return instruction.action !== "respeak" && instruction.action !== "abandon";
}
