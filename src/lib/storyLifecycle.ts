/**
 * A Story's life on our servers, and the guarantee that it ends.
 *
 * The product promise is specific: the video sits on the app server only while
 * it is being made, the user previews it, it transfers to their device, and
 * then it is deleted from our storage. "We are not responsible for what you
 * make" is only honest if that deletion actually happens — a Story still
 * sitting in a bucket a week later is content we are hosting, whatever the
 * copy says.
 *
 * So the lifecycle is a state machine with one property that matters more than
 * the rest: EVERY path ends in `purged`. There is no terminal state that leaves
 * bytes behind. Failure purges. Abandonment purges. Success purges. The only
 * difference between them is how long we waited first.
 *
 * PURE. No Supabase, no clock passed implicitly — `now` is always an argument.
 * A lifecycle that reads the wall clock cannot be tested for the one case that
 * matters, which is what happens hours later to a job nobody came back for.
 */

export type StoryStatus =
  /** Accepted, quota claimed, nothing generated yet. */
  | "queued"
  /** Stills and clips being generated. Nothing assembled. */
  | "generating"
  /** Clips exist on the server, being concatenated into one file. */
  | "assembling"
  /** One finished file on the server, waiting for the user to look at it. */
  | "ready"
  /** The user has previewed it; transfer to the device is in progress. */
  | "delivering"
  /** On the device. Server copy must go. */
  | "delivered"
  /** Generation or assembly failed. Whatever partial bytes exist must go. */
  | "failed"
  /** Nothing of this Story remains in our storage. The only terminal state. */
  | "purged";

/**
 * How long a finished Story is kept.
 *
 * THIRTY DAYS, and ONIQ is now knowingly a video host for that window.
 *
 * It was two hours, which worked only because "Save to my device" existed as
 * the escape hatch: make a film, save it, and we deleted ours. The owner
 * removed that hatch on 2026-08-12 — films are shared straight out of Your
 * videos and nothing is copied onto the phone — and a two-hour clock under
 * that rule is not a compromise, it is a shredder. Every film would become
 * unshareable two hours after it finished, with no copy anywhere.
 *
 * Thirty days rather than forever because a bounded promise is one we can
 * keep and cost: storage grows with films made, not with users, and an
 * unbounded window is a bill nobody chose. The sweeper still runs on the same
 * cadence; it now finds far less to do, which is the point.
 *
 * MIRRORED in supabase/functions/story-sweep/index.ts, which is the copy that
 * actually deletes. Change both or the deletion outlives the promise.
 */
export const READY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a Story may sit mid-generation before we treat it as dead.
 *
 * Generation is one call per shot and a minute of video is eight or nine shots,
 * so a healthy job finishes in minutes. Thirty minutes means a worker died
 * holding the job, and the bytes it already wrote are ours to clean up.
 */
export const STALE_TTL_MS = 30 * 60 * 1000;

/**
 * How long a Story may sit ACTIVELY RENDERING before we treat it as dead.
 *
 * Distinct from STALE_TTL_MS because the old "a render is minutes" assumption
 * predates the in-house engine. The worker writes updated_at when it enters
 * `assembling` and not again until the film is `ready`; in between it is inside
 * one long Remotion render whose wall clock scales with the film. Measured at
 * 0.178x realtime, a 300s film renders in ~40 minutes and the 600s ceiling in
 * ~80–100, all far past the 30-minute queued TTL — which is why every 300s job
 * was swept mid-render and died while 120s films (~11 minutes assembling→ready)
 * sailed through.
 *
 * The bound is not a guessed larger number: it is the render workflow's OWN hard
 * cap (`timeout-minutes: 150` in .github/workflows/story-worker.yml). While that
 * clock has not expired the runner may still be rendering, so the job is not
 * abandoned; once it has, GitHub has force-killed the run and the job genuinely
 * is. A queued job that no runner ever claimed is still dead at 30 minutes — the
 * long TTL applies only to the render-active states.
 */
export const RENDER_ACTIVE_TTL_MS = 150 * 60 * 1000;

/**
 * The staleness clock for a not-yet-finished job, by status. `queued` means no
 * runner has claimed it (dead at 30 min); `generating`/`assembling` mean a
 * runner is actively working (dead only once its workflow could not still be).
 */
export function staleTtlForActive(status: StoryStatus): number {
  return status === "generating" || status === "assembling"
    ? RENDER_ACTIVE_TTL_MS
    : STALE_TTL_MS;
}

export type StoryJob = {
  id: string;
  status: StoryStatus;
  /** When the row last changed state, epoch ms. */
  updatedAt: number;
  /** Whether any bytes exist in storage for this job right now. */
  hasBytes: boolean;
};

/** The states from which a purge is the correct next action. */
const PURGE_ON_ENTRY: ReadonlySet<StoryStatus> = new Set(["delivered", "failed"]);

/**
 * Legal transitions. Anything not listed here is a bug, not a shortcut.
 *
 * `ready -> delivering -> delivered` is the happy path and is deliberately
 * three steps rather than two: the device confirms receipt before we delete,
 * because deleting on "download started" loses the video of anyone whose
 * connection drops mid-transfer.
 *
 * EXPORTED because the database enforces the same table in
 * `story_jobs_guard_transition()`, and `storyJobsSchema.test.ts` parses that
 * function and compares it to this one. Two copies of a state machine drift;
 * two copies with a test between them do not.
 */
export const STORY_TRANSITIONS: Readonly<Record<StoryStatus, readonly StoryStatus[]>> = {
  queued: ["generating", "failed", "purged"],
  generating: ["assembling", "failed", "purged"],
  assembling: ["ready", "failed", "purged"],
  ready: ["delivering", "failed", "purged"],
  delivering: ["delivered", "ready", "failed", "purged"],
  delivered: ["purged"],
  failed: ["purged"],
  purged: [],
};

export function canTransition(from: StoryStatus, to: StoryStatus): boolean {
  return STORY_TRANSITIONS[from].includes(to);
}

/** Throws on an illegal move, so a bad transition fails at the write, not later. */
export function assertTransition(from: StoryStatus, to: StoryStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`story lifecycle: cannot go ${from} -> ${to}`);
  }
}

/**
 * Does this job still owe us a deletion?
 *
 * The question a sweeper asks. Note it is about BYTES, not status: a row marked
 * `delivered` whose file was never actually removed still owes a deletion, and
 * that is exactly the case a status-only check would miss.
 */
export function owesPurge(job: StoryJob, now: number): boolean {
  if (!job.hasBytes) return false;
  if (job.status === "purged") return true; // marked purged but bytes remain — a failed delete
  if (PURGE_ON_ENTRY.has(job.status)) return true;

  const age = now - job.updatedAt;
  if (job.status === "ready") return age > READY_TTL_MS;
  if (job.status === "queued" || job.status === "generating" || job.status === "assembling") {
    // A render that already wrote bytes and then stalled still gets the full
    // render window before its bytes are ours — the same reason the reap below
    // waits: mid-render is not abandoned.
    return age > staleTtlForActive(job.status);
  }
  // `delivering` is excluded on purpose: a transfer in flight must not have its
  // source deleted underneath it. It ages out via the stale sweep only after it
  // falls back to `ready`.
  return false;
}

/** Why a job is being purged, for the audit line. */
export type PurgeReason = "delivered" | "failed" | "expired" | "stale" | "orphaned";

export function purgeReason(job: StoryJob, now: number): PurgeReason | null {
  if (!owesPurge(job, now)) return null;
  if (job.status === "delivered") return "delivered";
  if (job.status === "failed") return "failed";
  if (job.status === "purged") return "orphaned";
  if (job.status === "ready") return "expired";
  return "stale";
}

/**
 * Every job that should have its bytes removed right now.
 *
 * Returned rather than acted on, so the caller owns the deletion and this stays
 * testable without a storage client.
 */
export function jobsToPurge(jobs: readonly StoryJob[], now: number): StoryJob[] {
  return jobs.filter((j) => owesPurge(j, now));
}
