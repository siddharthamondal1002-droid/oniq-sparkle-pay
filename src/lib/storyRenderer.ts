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
