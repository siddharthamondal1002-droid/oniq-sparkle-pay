/**
 * PREFLIGHT — prove a Story job is renderable BEFORE the expensive stage runs.
 *
 * The Story worker generates every still, voice and clip, assembles a shot list,
 * and only then opens Chromium and renders with Remotion — the one stage that
 * costs minutes of a runner. Run 73 and its successors kept reaching that stage
 * with a broken input (an absolute path staticFile() rejects, a zero-byte still,
 * a narration that never measured) and discovering it AFTER the render, or after
 * paying for every asset. The cheap way to find those is to look at what is on
 * disk before the browser starts.
 *
 * THIS MODULE IS PURE. It does no filesystem or ffprobe work itself — the worker
 * gathers the descriptors (existence, byte size, measured duration) and hands
 * them here, exactly the split storyPlan.ts uses so money-and-quota arithmetic
 * stays testable without provisioning anything. The worker mirrors these codes
 * and the insertion point is pinned by storyPreflight source assertions in
 * src/lib/__tests__/storyStageRecovery.test.ts.
 *
 * WHAT IT WILL AND WON'T DO. It fails a job cheaply with a structured code and
 * the exact shot/asset at fault; it never launches the browser, never
 * regenerates an asset, never re-decides billing. A failure here flows through
 * the worker's existing markFailed → refund path, the same as any other job
 * failure — the user got no video, so the seconds go back.
 */
// Relative + explicit .ts, because the Story worker imports this directly under
// Node — the same reason storyPlan.ts and shotAllocation.ts avoid the "@/lib"
// alias. One validator shared by the app and the renderer is the whole point.
import { MAX_STORY_SECONDS, MIN_STORY_SECONDS } from "./storyPlan.ts";

/** The composition's fixed format, mirrored from remotion StoryFilm/StoryRoot. */
export const STORY_FPS = 30;
export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

/**
 * The smallest a real asset can honestly be.
 *
 * A 1080x1920 still is tens of kilobytes; anything under a kilobyte is a
 * truncated write or an error page, not a frame. A WAV is at least its 44-byte
 * RIFF header, and a file that IS only the header carries no samples — silence
 * that reads as a dropped narration. Both are heuristics against the corruption
 * fs.existsSync() cannot see; kept deliberately low so they only ever catch the
 * plainly-broken.
 */
export const IMAGE_MIN_BYTES = 1024;
export const AUDIO_MIN_BYTES = 45;
export const VIDEO_MIN_BYTES = 1024;

/**
 * The timeline band, as a fraction of the requested (clamped) seconds.
 *
 * The finished film's length is the sum of its shots' measured narration, which
 * drifts from the requested length with TTS pace and, in verbatim mode, with the
 * user's own text. verbatimNarration.ts already binds that to [0.5, 1.25] of the
 * purchased seconds, so preflight's floor must sit AT that floor and its ceiling
 * ABOVE it — never rejecting a film the fit band already accepted. The point of
 * the check is the gross miss: a 300-second request whose timeline comes out at
 * 60 seconds (ratio 0.2) is a duration that was silently truncated somewhere,
 * and that is exactly what this catches without tripping on honest drift.
 */
export const DURATION_MIN_RATIO = 0.5;
export const DURATION_MAX_RATIO = 1.6;

export type PreflightCode =
  | "PREFLIGHT_JOB_INVALID"
  | "PREFLIGHT_SHOT_INVALID"
  | "PREFLIGHT_MANIFEST_INVALID"
  | "PREFLIGHT_ASSET_MISSING"
  | "PREFLIGHT_ASSET_CORRUPT"
  | "PREFLIGHT_TIMELINE_INVALID"
  | "PREFLIGHT_DURATION_MISMATCH";

export type AssetRole =
  "still" | "audio" | "clip" | "parallax-near" | "parallax-mid" | "ambience" | "score";

export type AssetKind = "image" | "audio" | "video";

/** What the worker measured about one file on disk. */
export type AssetProbe = {
  role: AssetRole;
  /** The public-relative path, for the failure message. */
  path: string;
  kind: AssetKind;
  present: boolean;
  /** Byte size; 0 when absent or unreadable. */
  bytes: number;
  /** ffprobe duration for audio/video; undefined for images or an unreadable file. */
  seconds?: number;
  /** A floor the measured duration must clear, when one is known (e.g. a clip). */
  minSeconds?: number;
};

export type ShotManifest = {
  index: number;
  /** The shot's planned/measured length, the value that reaches the timeline. */
  seconds: number;
  assets: AssetProbe[];
};

export type JobManifest = {
  id: string;
  requestedSeconds: number;
  verbatim: boolean;
  fps: number;
  width: number;
  height: number;
  shots: ShotManifest[];
};

export type PreflightFailure = {
  code: PreflightCode;
  detail: string;
  shot?: number;
  asset?: string;
};

export type TimelineReport = {
  /** Sum of the shots' seconds — the finished film's real length. */
  timelineSeconds: number;
  /** Requested seconds after clamping to the sellable band. */
  expectedSeconds: number;
  ratio: number;
};

export type PreflightResult =
  { ok: true; timeline: TimelineReport } | { ok: false; failure: PreflightFailure };

const REQUIRED_ROLES: readonly AssetRole[] = ["still", "audio"];

/** Job-level sanity: identity, a sane requested length, the fixed format, shots. */
export function validateJobManifest(job: JobManifest): PreflightFailure | null {
  if (typeof job.id !== "string" || job.id.length === 0) {
    return { code: "PREFLIGHT_JOB_INVALID", detail: "job has no id" };
  }
  if (!Number.isFinite(job.requestedSeconds) || job.requestedSeconds <= 0) {
    return {
      code: "PREFLIGHT_JOB_INVALID",
      detail: `requested seconds is not a duration (${job.requestedSeconds})`,
    };
  }
  if (job.requestedSeconds < MIN_STORY_SECONDS || job.requestedSeconds > MAX_STORY_SECONDS) {
    return {
      code: "PREFLIGHT_JOB_INVALID",
      detail:
        `requested ${job.requestedSeconds}s is outside the sellable band ` +
        `${MIN_STORY_SECONDS}-${MAX_STORY_SECONDS}s`,
    };
  }
  if (job.fps !== STORY_FPS) {
    return { code: "PREFLIGHT_JOB_INVALID", detail: `fps ${job.fps} != ${STORY_FPS}` };
  }
  if (job.width !== STORY_WIDTH || job.height !== STORY_HEIGHT) {
    return {
      code: "PREFLIGHT_JOB_INVALID",
      detail: `resolution ${job.width}x${job.height} != ${STORY_WIDTH}x${STORY_HEIGHT}`,
    };
  }
  if (!Array.isArray(job.shots) || job.shots.length === 0) {
    return { code: "PREFLIGHT_MANIFEST_INVALID", detail: "no shots in the manifest" };
  }
  return null;
}

/** Shot indexes must be 0..n-1 exactly once — no gaps, no duplicates. */
export function validateShotIndexes(shots: ShotManifest[]): PreflightFailure | null {
  const seen = new Set<number>();
  for (const s of shots) {
    if (!Number.isInteger(s.index) || s.index < 0) {
      return {
        code: "PREFLIGHT_SHOT_INVALID",
        detail: `shot index ${s.index} is not a non-negative integer`,
        shot: typeof s.index === "number" ? s.index : undefined,
      };
    }
    if (seen.has(s.index)) {
      return {
        code: "PREFLIGHT_SHOT_INVALID",
        detail: `duplicate shot index ${s.index}`,
        shot: s.index,
      };
    }
    seen.add(s.index);
  }
  for (let i = 0; i < shots.length; i++) {
    if (!seen.has(i)) {
      return {
        code: "PREFLIGHT_SHOT_INVALID",
        detail: `missing shot index ${i} (have ${shots.length} shots)`,
        shot: i,
      };
    }
  }
  return null;
}

/** One asset on disk: present, non-empty, the right kind, not truncated. */
export function validateAsset(probe: AssetProbe, shotIndex: number): PreflightFailure | null {
  if (!probe.present) {
    return {
      code: "PREFLIGHT_ASSET_MISSING",
      detail: `${probe.role} asset is missing: ${probe.path}`,
      shot: shotIndex,
      asset: probe.path,
    };
  }
  if (!(probe.bytes > 0)) {
    return {
      code: "PREFLIGHT_ASSET_CORRUPT",
      detail: `${probe.role} asset is zero-byte: ${probe.path}`,
      shot: shotIndex,
      asset: probe.path,
    };
  }
  const floor =
    probe.kind === "image"
      ? IMAGE_MIN_BYTES
      : probe.kind === "video"
        ? VIDEO_MIN_BYTES
        : AUDIO_MIN_BYTES;
  if (probe.bytes < floor) {
    return {
      code: "PREFLIGHT_ASSET_CORRUPT",
      detail: `${probe.role} asset is ${probe.bytes}B, under the ${floor}B floor (truncated): ${probe.path}`,
      shot: shotIndex,
      asset: probe.path,
    };
  }
  if (probe.kind === "audio" || probe.kind === "video") {
    if (probe.seconds === undefined || !Number.isFinite(probe.seconds) || probe.seconds <= 0) {
      return {
        code: "PREFLIGHT_ASSET_CORRUPT",
        detail: `${probe.role} asset has no readable duration: ${probe.path}`,
        shot: shotIndex,
        asset: probe.path,
      };
    }
    if (probe.minSeconds !== undefined && probe.seconds < probe.minSeconds) {
      return {
        code: "PREFLIGHT_ASSET_CORRUPT",
        detail:
          `${probe.role} asset is ${probe.seconds.toFixed(2)}s, under its ` +
          `${probe.minSeconds.toFixed(2)}s floor (truncated): ${probe.path}`,
        shot: shotIndex,
        asset: probe.path,
      };
    }
  }
  return null;
}

/** A shot: a sane duration, the required roles present, every listed asset valid. */
export function validateShot(shot: ShotManifest): PreflightFailure | null {
  if (!Number.isFinite(shot.seconds) || shot.seconds <= 0) {
    return {
      code: "PREFLIGHT_SHOT_INVALID",
      detail: `shot ${shot.index} has no valid duration (${shot.seconds})`,
      shot: shot.index,
    };
  }
  if (!Array.isArray(shot.assets) || shot.assets.length === 0) {
    return {
      code: "PREFLIGHT_MANIFEST_INVALID",
      detail: `shot ${shot.index} has no assets`,
      shot: shot.index,
    };
  }
  const roles = new Set(shot.assets.map((a) => a.role));
  for (const req of REQUIRED_ROLES) {
    if (!roles.has(req)) {
      return {
        code: "PREFLIGHT_MANIFEST_INVALID",
        detail: `shot ${shot.index} is missing its required ${req} asset`,
        shot: shot.index,
      };
    }
  }
  for (const probe of shot.assets) {
    const fail = validateAsset(probe, shot.index);
    if (fail) return fail;
  }
  return null;
}

/**
 * The whole film's length against what was requested.
 *
 * Returns the report on success so the worker can EXPOSE the real duration in
 * the job result rather than let a truncation pass silently — item 4's "if the
 * duration changed, say so" made concrete.
 */
export function validateTimeline(job: JobManifest): PreflightFailure | TimelineReport {
  const timelineSeconds = job.shots.reduce((a, s) => a + (Number(s.seconds) || 0), 0);
  if (!(timelineSeconds > 0)) {
    return { code: "PREFLIGHT_TIMELINE_INVALID", detail: `timeline sums to ${timelineSeconds}s` };
  }
  const expectedSeconds = Math.min(
    MAX_STORY_SECONDS,
    Math.max(MIN_STORY_SECONDS, job.requestedSeconds),
  );
  const ratio = timelineSeconds / expectedSeconds;
  if (ratio < DURATION_MIN_RATIO || ratio > DURATION_MAX_RATIO) {
    return {
      code: "PREFLIGHT_DURATION_MISMATCH",
      detail:
        `timeline ${timelineSeconds.toFixed(1)}s is ${(ratio * 100).toFixed(0)}% of the ` +
        `requested ${expectedSeconds}s — outside the ` +
        `${(DURATION_MIN_RATIO * 100).toFixed(0)}-${(DURATION_MAX_RATIO * 100).toFixed(0)}% band`,
    };
  }
  return { timelineSeconds, expectedSeconds, ratio };
}

function isFailure(x: PreflightFailure | TimelineReport): x is PreflightFailure {
  return (x as PreflightFailure).code !== undefined;
}

/**
 * The gate. Job → shot indexes → each shot and its assets → the timeline.
 *
 * Ordered cheapest-first and short-circuiting on the first fault, so the failure
 * a log reader sees is the most fundamental one, and so a single missing still
 * does not bury the report under every other check.
 */
export function preflight(job: JobManifest): PreflightResult {
  const jobFail = validateJobManifest(job);
  if (jobFail) return { ok: false, failure: jobFail };

  const idxFail = validateShotIndexes(job.shots);
  if (idxFail) return { ok: false, failure: idxFail };

  for (const shot of job.shots) {
    const shotFail = validateShot(shot);
    if (shotFail) return { ok: false, failure: shotFail };
  }

  const timeline = validateTimeline(job);
  if (isFailure(timeline)) return { ok: false, failure: timeline };

  return { ok: true, timeline };
}
