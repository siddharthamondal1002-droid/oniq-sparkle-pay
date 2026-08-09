/**
 * Planning a user-generated Story: how many clips, how long each, what it costs.
 *
 * This is the ONIQ Originals pipeline pointed at a user's prompt instead of a
 * scripted episode. The generator caps a clip at ten seconds, so anything
 * longer is several clips cut together — the same constraint that made Episode
 * 3 sixty clips rather than one, and the same arithmetic solves it.
 *
 * WHAT IS DIFFERENT FROM AN EPISODE. An episode is planned by a person against
 * measured narration, and rendered out of band on a machine with Chromium. A
 * Story is planned from one prompt, generated on demand, and ASSEMBLED ON THE
 * USER'S DEVICE. That last part is not a workaround: the product promise is
 * that the file lands in device memory and is only inspected if the user shares
 * it back through the app, and client-side assembly makes that literally true —
 * the finished film never exists on our servers at all.
 *
 * WE DO NOT SAVE THE VIDEO. Not to Supabase Storage, not to the CDN, not
 * anywhere. Generated clips go straight to the device, the device assembles
 * them, and the finished file lives in the user's memory alone. What the server
 * keeps is a seconds counter for the free allowance — a number, not pixels.
 *
 * That is a product decision with three consequences worth stating, because
 * someone will eventually be tempted to "just cache it":
 *   1. It is what makes "we are not responsible for what you make" honest. We
 *      cannot moderate what we never hold, and we do not claim to.
 *   2. A Story shared back THROUGH the app is a different act: that upload is
 *      ours, and it goes through provenance scanning like any other media.
 *   3. There is no re-download. If the user loses the file it is gone, and the
 *      UI must say so before generation rather than after.
 *
 * PURE. No network, no clock, no Supabase. Same arrangement as
 * `shotAllocation.ts` and `audioDuck.ts`, and for the same reason: money and
 * quota decisions derived in two places will drift, and the drift is only
 * visible on a bill.
 */
import { MAX_SHOT_SECONDS, MIN_SHOT_SECONDS, minimumShots } from "@/lib/shotAllocation";

/** What a Story runs to when the user does not say. */
export const DEFAULT_STORY_SECONDS = 60;

/**
 * The shortest Story worth generating.
 *
 * Below this the shot list collapses to one clip and the result is
 * indistinguishable from a single generation, which the product already offers
 * nowhere and does not need a planner for.
 */
export const MIN_STORY_SECONDS = 10;

/**
 * The longest a single Story may be.
 *
 * NOT a technical limit — the planner and the device assembler both scale
 * linearly. It is a cost limit, and it is the one number in this file that
 * directly bounds what a single tap can spend: every second of finished Story
 * is one still and a share of one clip, both billable. Ten minutes is already
 * ~85 shots and ~170 generations.
 *
 * Raise it deliberately, with the quota in view, never to satisfy one request.
 */
export const MAX_STORY_SECONDS = 600;

/**
 * Shots per minute of finished video, from the Episode 3 build.
 *
 * Measured, not assumed: 60 shots covered 6:54, which is 8.7. The naive
 * "ten seconds per clip" figure says 6 per minute and is about 30% low, because
 * shots are allocated by weight and none of them lands exactly on the ceiling.
 */
export const SHOTS_PER_MINUTE = 8.5;

export type StoryShot = {
  index: number;
  /** Seconds of finished video this shot covers. Never above the clip ceiling. */
  seconds: number;
};

export type StoryPlan = {
  /** What the user asked for, after clamping. */
  seconds: number;
  shots: StoryShot[];
  /** One still and one clip per shot — the billable unit count. */
  generations: number;
};

/**
 * Split a requested duration into generatable shots.
 *
 * Even shots rather than weighted ones. An episode weights them because a
 * person wrote a shot list and knows which beats deserve room; a Story has one
 * prompt and no such information, and inventing weights would be a guess
 * dressed as a decision. Even shots are honest and land inside the limits by
 * construction.
 *
 * The remainder is spread one frame-second at a time from the front, the same
 * largest-remainder idea `allocateFrames` uses, so the total is exact rather
 * than approximately right.
 */
export type StoryLimits = {
  maxShotSeconds?: number;
  minShotSeconds?: number;
  shotsPerMinute?: number;
};

export function planStory(requestedSeconds: number, limits: StoryLimits = {}): StoryPlan {
  if (!Number.isFinite(requestedSeconds)) {
    throw new Error(`planStory: ${requestedSeconds} is not a duration`);
  }
  const seconds = Math.round(
    Math.min(MAX_STORY_SECONDS, Math.max(MIN_STORY_SECONDS, requestedSeconds)),
  );

  // Enough shots that none exceeds the generator's ceiling, and enough that the
  // result reads as an edit rather than one long take.
  // LIMITS ARE PARAMETERS, not constants read from module scope, and that is
  // deliberate. With the shipped values the pacing count (~0.142 per second)
  // always exceeds both the clip-ceiling count (0.1) and the floor cap (0.667),
  // so neither clamp can ever fire — they are unreachable, and a mutation that
  // deletes them passes every test. Taking them as arguments makes them
  // reachable from a test, which is the only way they are worth keeping.
  const maxShot = limits.maxShotSeconds ?? MAX_SHOT_SECONDS;
  const minShot = limits.minShotSeconds ?? MIN_SHOT_SECONDS;
  const perMinute = limits.shotsPerMinute ?? SHOTS_PER_MINUTE;

  const byCeiling = minimumShots(seconds, maxShot);
  const byPacing = Math.round((seconds / 60) * perMinute);
  let count = Math.max(byCeiling, byPacing, 1);

  // Never so many that a shot falls under the editorial floor. A sub-second cut
  // reads as a flash, not a shot.
  const maxCount = Math.max(1, Math.floor(seconds / minShot));
  if (count > maxCount) count = maxCount;

  const base = Math.floor(seconds / count);
  let remainder = seconds - base * count;
  const shots: StoryShot[] = [];
  for (let i = 0; i < count; i++) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    shots.push({ index: i, seconds: base + extra });
  }

  const total = shots.reduce((a, s) => a + s.seconds, 0);
  if (total !== seconds) {
    throw new Error(`planStory: shots sum to ${total}, expected ${seconds}`);
  }
  for (const s of shots) {
    if (s.seconds > maxShot) {
      throw new Error(`planStory: shot ${s.index} is ${s.seconds}s, over the ${maxShot}s ceiling`);
    }
  }

  return { seconds, shots, generations: shots.length * 2 };
}

/** Why a Story was refused, in words a screen can show unchanged. */
export type QuotaRefusal = {
  reason: "disabled" | "exhausted" | "too-long";
  message: string;
  /** Seconds of free allowance left. */
  remaining: number;
};

export type QuotaState = {
  enabled: boolean;
  /** Free seconds of finished video this user is granted in total. */
  freeSeconds: number;
  /** Seconds they have already generated. */
  usedSeconds: number;
};

/**
 * Decide whether a Story may be generated, BEFORE anything billable happens.
 *
 * Returns a refusal rather than throwing, so a screen can render the reason and
 * the remaining balance in one pass. The order matters and mirrors the one the
 * Runway path already enforces: kill switch first, then allowance, then the
 * request itself. Checking the request first would spend effort deciding
 * whether to honour something the switch has already turned off.
 *
 * A partial grant is deliberately NOT offered. Silently making a 20-second
 * Story because 60 would not fit is a worse outcome than saying so — the user
 * asked for a length, and quietly delivering a third of it looks like a bug.
 */
export function checkStoryQuota(state: QuotaState, requestedSeconds: number): QuotaRefusal | null {
  const remaining = Math.max(0, state.freeSeconds - state.usedSeconds);

  if (!state.enabled) {
    return {
      reason: "disabled",
      message: "Story generation is paused right now. Try again later.",
      remaining,
    };
  }
  if (remaining <= 0) {
    return {
      reason: "exhausted",
      message: "You have used all your free Story time.",
      remaining: 0,
    };
  }
  const wanted = Math.round(requestedSeconds);
  if (wanted > remaining) {
    return {
      reason: "too-long",
      message: `That is ${wanted}s and you have ${remaining}s of free time left.`,
      remaining,
    };
  }
  return null;
}

/** Seconds of free allowance left, floored at zero. */
export function remainingSeconds(state: QuotaState): number {
  return Math.max(0, state.freeSeconds - state.usedSeconds);
}
