/**
 * Film-level capacity admission — the Director's preflight.
 *
 * Owner directive 2026-08-27: "Do not create 86 jobs and hope the queue
 * handles it." A film is COSTED before a single job is dispatched, and a
 * film the current policy cannot carry is refused with the arithmetic
 * attached, not started optimistically and abandoned halfway.
 *
 * NOTHING HERE SETS A LIMIT. Every ceiling — the daily job cap, the
 * one-at-a-time rule, the clip clock — arrives as an argument from the
 * live config the operator owns. This module only does the multiplication
 * and says yes, queue, or no. Raising a cap is an owner decision, and a
 * module that could raise one is a module that eventually will.
 */

import { budgetFor } from "./storyIr.ts";

/** The assembly ceiling the worker enforces: 2..16 segments per concat. */
export const MAX_CONCAT_SEGMENTS = 16;

export type CapacityPolicy = {
  /** Jobs the endpoint may run per day. From video_gen_config.daily_cap. */
  dailyCap: number;
  /** Jobs already spent today. */
  usedToday: number;
  /** How many jobs may run at once. One worker, one at a time. */
  concurrency: number;
};

export type FilmCost = {
  shots: number;
  imageJobs: number;
  videoJobs: number;
  audioJobs: number;
  concatJobs: number;
  totalJobs: number;
  /** Seconds of GPU the film is expected to occupy, from measured rates. */
  estimatedGpuSeconds: number;
};

/**
 * Per-job GPU seconds. The video and audio figures are MEASURED (job
 * e010372d, 2026-08-27: 38.87s billed for a 4.04s clip, 2.35s for its
 * narration mux). The image figure is an ESTIMATE and is labelled as one:
 * the op is new and no live still has been timed, so it is derived from
 * the same model load plus a ninth of the frames. Nothing downstream
 * treats it as measured, and it is the first number to replace once a
 * still has actually run.
 */
export const GPU_SECONDS = {
  video: 38.87,
  audio: 2.35,
  imageEstimated: 20,
  concatEstimated: 15,
} as const;

/**
 * Cost a film without generating anything.
 *
 * Concat is hierarchical because the worker refuses more than 16 segments
 * in one call: a long film is assembled in groups and the groups are
 * assembled in turn, which is jobs, and jobs are what the cap counts.
 */
export function costFilm(
  targetSeconds: number,
  opts: { grade: "classic" | "movie"; speakingShots?: number } = { grade: "movie" },
): FilmCost {
  const budget = budgetFor(targetSeconds);
  const shots = budget.shots;
  const imageJobs = shots;
  const videoJobs = opts.grade === "movie" ? shots : 0;
  const audioJobs = opts.speakingShots ?? shots;

  let concatJobs = 0;
  let segments = opts.grade === "movie" ? shots : 0;
  while (segments > 1) {
    const groups = Math.ceil(segments / MAX_CONCAT_SEGMENTS);
    concatJobs += groups;
    segments = groups;
  }

  const totalJobs = imageJobs + videoJobs + audioJobs + concatJobs;
  return {
    shots,
    imageJobs,
    videoJobs,
    audioJobs,
    concatJobs,
    totalJobs,
    estimatedGpuSeconds: Math.round(
      imageJobs * GPU_SECONDS.imageEstimated +
        videoJobs * GPU_SECONDS.video +
        audioJobs * GPU_SECONDS.audio +
        concatJobs * GPU_SECONDS.concatEstimated,
    ),
  };
}

export type Admission =
  | { decision: "ADMIT"; cost: FilmCost; jobsRemainingToday: number }
  | { decision: "QUEUE"; cost: FilmCost; jobsToday: number; daysRequired: number; reason: string }
  | { decision: "REFUSE"; cost: FilmCost; reason: string };

/**
 * Decide whether this film may start.
 *
 * ADMIT  — today's remaining cap covers the whole film.
 * QUEUE  — the film fits the policy but not in one day; it runs across
 *          days, at the cap, which is the honest shape of a serial
 *          single-worker queue rather than a bypass of it.
 * REFUSE — the film cannot be delivered under this policy at all, or
 *          there is nothing left today and nothing to queue behind.
 *
 * A film is never admitted "partly": starting one that the policy cannot
 * finish spends real GPU money on an artifact nobody receives.
 */
export function admitFilm(cost: FilmCost, policy: CapacityPolicy): Admission {
  if (policy.dailyCap <= 0) {
    return { decision: "REFUSE", cost, reason: "generation is capped at zero jobs per day" };
  }
  if (policy.concurrency < 1) {
    return { decision: "REFUSE", cost, reason: "no worker is available to run the film" };
  }
  const remaining = Math.max(0, policy.dailyCap - policy.usedToday);
  if (cost.totalJobs <= remaining) {
    return { decision: "ADMIT", cost, jobsRemainingToday: remaining - cost.totalJobs };
  }
  const daysRequired = Math.ceil(cost.totalJobs / policy.dailyCap);
  return {
    decision: "QUEUE",
    cost,
    jobsToday: remaining,
    daysRequired,
    reason:
      `the film needs ${cost.totalJobs} jobs and the policy allows ` +
      `${policy.dailyCap}/day (${remaining} left today)`,
  };
}

/**
 * How many jobs the Director may dispatch on this pass.
 *
 * Bounded by BOTH the day's remaining cap and the worker's concurrency —
 * the smaller of the two, never their sum. This is the number that goes
 * to readyJobs(), which is why the graph can never outrun the policy.
 */
export function dispatchAllowance(policy: CapacityPolicy, inFlight: number): number {
  const remainingToday = Math.max(0, policy.dailyCap - policy.usedToday);
  const freeSlots = Math.max(0, policy.concurrency - inFlight);
  return Math.min(remainingToday, freeSlots);
}
