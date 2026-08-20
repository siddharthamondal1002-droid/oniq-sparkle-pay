/**
 * Which machine assembles a Story, and what happens when it cannot.
 *
 * Two backends, chosen per job rather than per deployment:
 *
 *   EDGE  — a Supabase Edge Function running ffmpeg compiled to WASM. No new
 *           host, answers in seconds, and memory-capped. This is the path
 *           almost every Story should take.
 *   CI    — a GitHub Actions workflow, the same pattern the ep3 clip transfer
 *           already proves works. Effectively unlimited memory and disk, and
 *           minutes of latency because a runner has to boot.
 *
 * WHY EDGE WORKS AT ALL, given a ~256 MB cap. Assembling a Story is a REMUX,
 * not a render. Every clip comes back from the generator identically encoded,
 * so `-c copy` rewrites the container without touching a single frame — the
 * same operation that joined episode 3's two halves instantly. Re-encoding
 * would be hopeless in WASM; stream-copying is cheap and roughly linear in
 * file size.
 *
 * WHY CI IS STILL NEEDED. Linear in file size still runs out eventually, and
 * WASM ffmpeg holds input and output in memory at once. Past a few minutes of
 * video the Edge Function will fail, and it will fail late — after the clips
 * have been generated and paid for. Routing long jobs away from it up front is
 * cheaper than discovering the ceiling per user.
 *
 * PURE. The routing decision is arithmetic on a plan; neither backend is
 * touched here. That is what makes the ceiling testable without provisioning
 * anything.
 */

export type RenderTarget = "edge" | "ci";

export type RenderRoute = {
  target: RenderTarget;
  /** Plain-language reason, safe to log and to show an admin. */
  reason: string;
  /** Bytes we expect to hold in memory at once, for the ceiling check. */
  estimatedBytes: number;
};

/**
 * Bitrate a generated Story comes back at, bits per second.
 *
 * Episode 3 measured ~2.0 Mbps at crf 28, 1080x1920, 30fps — real generated
 * motion rather than a slow pan over a painting, so this is the honest figure
 * rather than an optimistic one.
 */
export const STORY_BITRATE_BPS = 2_000_000;

/**
 * How many bytes the Edge Function may be asked to hold.
 *
 * A Supabase Edge Function gets a couple of hundred megabytes, and WASM ffmpeg
 * holds the inputs AND the output at once during a concat — so the working set
 * is roughly twice the finished file. 48 MB of video means ~96 MB in flight,
 * which leaves real headroom under the cap for the wasm module itself (~30 MB)
 * and the runtime.
 *
 * DELIBERATELY CONSERVATIVE. The cost of routing an Edge-capable job to CI is
 * a minute of the user's patience. The cost of the reverse is a failure after
 * every clip has been generated and billed. Those are not symmetric, so the
 * threshold sits well below where Edge actually breaks.
 */
export const EDGE_MAX_BYTES = 48 * 1024 * 1024;

/** Seconds of video that fits under EDGE_MAX_BYTES at the measured bitrate. */
export const EDGE_MAX_SECONDS = Math.floor(EDGE_MAX_BYTES / (STORY_BITRATE_BPS / 8));

export function estimateBytes(seconds: number): number {
  return Math.round(seconds * (STORY_BITRATE_BPS / 8));
}

/**
 * Pick a backend for a Story of this length.
 *
 * `forceTarget` exists for operations, not for features: pinning everything to
 * CI is how you keep the product alive if the Edge Function is broken, and
 * pinning to Edge is how you test it. It is not a per-user setting.
 */
export function chooseRenderer(
  seconds: number,
  opts: { forceTarget?: RenderTarget; edgeMaxBytes?: number } = {},
): RenderRoute {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`chooseRenderer: ${seconds} is not a duration`);
  }
  const estimatedBytes = estimateBytes(seconds);
  const cap = opts.edgeMaxBytes ?? EDGE_MAX_BYTES;

  if (opts.forceTarget) {
    return {
      target: opts.forceTarget,
      reason: `forced to ${opts.forceTarget} by configuration`,
      estimatedBytes,
    };
  }
  if (estimatedBytes > cap) {
    return {
      target: "ci",
      reason:
        `${seconds}s is about ${Math.round(estimatedBytes / 1024 / 1024)} MB, over the ` +
        `${Math.round(cap / 1024 / 1024)} MB the edge function can hold`,
      estimatedBytes,
    };
  }
  return {
    target: "edge",
    reason: `${seconds}s fits in the edge function`,
    estimatedBytes,
  };
}

/**
 * Where to go after a backend failed.
 *
 * ONE DIRECTION ONLY: edge may fall back to CI, CI may not fall back to edge.
 * CI failing on a job edge already declined would mean edge is certain to fail
 * too, and retrying there converts one failure into two while the user waits.
 *
 * Returns null when there is nowhere left to go, which the caller must treat as
 * a real failure — mark the job failed so the sweeper reclaims its bytes, and
 * refund the quota, because the user got no video.
 */
export function fallbackAfter(failed: RenderTarget): RenderTarget | null {
  return failed === "edge" ? "ci" : null;
}

/**
 * Should this attempt be retried at all, or is the failure permanent?
 *
 * A timeout or an out-of-memory means the wrong backend was chosen and the
 * other one may succeed. A malformed input means every backend will fail the
 * same way, and retrying spends CI minutes to reach the same answer — the same
 * reasoning that keeps the generation path free of retry loops.
 */
export function isRetryable(kind: "timeout" | "oom" | "bad-input" | "unknown"): boolean {
  return kind === "timeout" || kind === "oom";
}

/* -------------------------------------------------------------------------- *
 *  Stage-aware recovery inside a single CI render.
 *
 *  chooseRenderer/fallbackAfter above decide WHICH backend runs a job. This
 *  section governs what happens INSIDE one CI run once the expensive work is
 *  already done — the lifecycle the worker walks after Veo has been paid for:
 *
 *    RENDER  → VALIDATE → UPLOAD → FINALIZE
 *   (minutes)  (ffprobe)  (a PUT)  (a callback)
 *
 *  The rule these encode, learned the expensive way: a run that renders a full
 *  film (every still, every clip, every voice already generated and billed) and
 *  then loses it to a transient PUT flake, only to REGENERATE from scratch on
 *  the retry, has thrown away the one stage that cost real money and minutes to
 *  recover from the one that costs neither. The render is precious; the upload
 *  is a network hiccup. So the upload retries in place, and a successful render
 *  is never recomputed to recover from a later stage's failure.
 *
 *  PURE, and mirrored by remotion/scripts/story-worker.mjs — pinned against
 *  drift by storyStageRecovery.test.ts, the same discipline the capability
 *  matrix uses against story-clip's own constants.
 * -------------------------------------------------------------------------- */

/**
 * How many times the UPLOAD stage may be attempted before the film is declared
 * lost. Four, because the object path is derived from the job id, so a re-PUT
 * overwrites the same object — the retry is idempotent, and the master already
 * on disk is worth several paced attempts before regeneration is even considered.
 */
export const UPLOAD_MAX_ATTEMPTS = 4;

/**
 * Backoff before upload attempt N (1-indexed). Linear, matching the browser
 * retry's cadence in the same worker: attempt 2 waits 3s, attempt 3 waits 6s,
 * attempt 4 waits 9s. Attempt 1 never waits.
 */
export function uploadBackoffMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`uploadBackoffMs: ${attempt} is not an attempt number`);
  }
  return (attempt - 1) * 3_000;
}

/**
 * The lower bound on a valid master's duration, as a fraction of the duration
 * the shots add up to. A finished concat re-encoded by the film-look grade keeps
 * its duration, so a master that comes back at less than half of what its shots
 * measured is truncated or empty — a broken render, not a short film. Kept well
 * below 1 so a real film with normal rounding never trips it.
 */
export const MASTER_MIN_DURATION_RATIO = 0.5;

/**
 * Does the rendered master look like a whole film, or like a broken render?
 *
 * `actualSeconds` is what ffprobe reads off the mp4; `expectedSeconds` is the
 * sum of the shot durations that went into it (omit when unknown — then only
 * the "playable at all" floor applies). Returns false for the failures worth
 * catching BEFORE upload — an unreadable, zero-length, or truncated master —
 * so the run fails honestly instead of shipping a stub the user paid for.
 *
 * Deliberately one-sided: it never rejects a master for being too LONG, because
 * an over-long file is still a watchable film and a false rejection here would
 * discard a real, fully-paid render — the exact waste this section exists to
 * prevent.
 */
export function masterLooksValid(actualSeconds: number, expectedSeconds?: number): boolean {
  if (!Number.isFinite(actualSeconds) || actualSeconds <= 0) return false;
  if (expectedSeconds === undefined) return true;
  if (!Number.isFinite(expectedSeconds) || expectedSeconds <= 0) return true;
  return actualSeconds >= expectedSeconds * MASTER_MIN_DURATION_RATIO;
}
