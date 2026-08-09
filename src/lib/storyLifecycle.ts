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
 * How long a finished Story waits for a user who may never come back.
 *
 * Two hours is a compromise, and worth naming as one. Shorter and a user who
 * generates on the bus and opens the app at home loses their video. Longer and
 * we are quietly a video host. If this is ever raised, raise the sweeper
 * frequency with it, not just this number.
 */
export const READY_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * How long a Story may sit mid-generation before we treat it as dead.
 *
 * Generation is one call per shot and a minute of video is eight or nine shots,
 * so a healthy job finishes in minutes. Thirty minutes means a worker died
 * holding the job, and the bytes it already wrote are ours to clean up.
 */
export const STALE_TTL_MS = 30 * 60 * 1000;

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
 */
const ALLOWED: Readonly<Record<StoryStatus, readonly StoryStatus[]>> = {
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
  return ALLOWED[from].includes(to);
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
    return age > STALE_TTL_MS;
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
