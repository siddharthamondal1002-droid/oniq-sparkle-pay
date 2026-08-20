/**
 * Planning a user-generated Story: how many clips, how long each, what it costs.
 *
 * This is the ONIQ Originals pipeline pointed at a user's prompt instead of a
 * scripted episode. The generator caps a clip at ten seconds, so anything
 * longer is several clips cut together — the same constraint that made Episode
 * 3 sixty clips rather than one, and the same arithmetic solves it.
 *
 * WHAT IS DIFFERENT FROM AN EPISODE. An episode is planned by a person against
 * measured narration and rendered out of band. A Story is planned from one
 * prompt and assembled on demand by the app's own renderer — an edge function
 * for anything that fits, a CI runner for the rest. See `storyRenderer.ts`.
 *
 * THE VIDEO IS TRANSIENT ON OUR SERVERS. It exists while it is being made, the
 * user previews it, it transfers to their device, and then it is deleted. That
 * deletion is a guarantee rather than an intention and lives in
 * `storyLifecycle.ts`, where every path ends in `purged`.
 *
 * Three consequences worth stating, because someone will be tempted to keep a
 * copy "just in case":
 *   1. A Story sitting in a bucket a week later is content we are hosting,
 *      whatever the disclaimer says. The window is minutes, not forever.
 *   2. A Story shared back THROUGH the app is a different act: that upload is
 *      ours, and it goes through provenance scanning like any other media.
 *   3. There is no re-download. Once it is on the device and purged from the
 *      server it is gone, and the UI must say so BEFORE generation.
 *
 * PURE. No network, no clock, no Supabase. Same arrangement as
 * `shotAllocation.ts` and `audioDuck.ts`, and for the same reason: money and
 * quota decisions derived in two places will drift, and the drift is only
 * visible on a bill.
 */
// RELATIVE, not "@/lib/...", because the Story worker imports this module
// directly under Node 22 and Node does not know the bundler's alias. Same
// reason shotGrammar.ts and visemes.ts avoid it. One planner shared by the app
// and the renderer is the whole point; an import path that only resolves in the
// bundle would force a second copy.
//
// The ".ts" extension is required, not stylistic: Node's ESM resolver does no
// extension guessing, so "./shotAllocation" fails there while resolving fine in
// the bundler. tsconfig already sets allowImportingTsExtensions for this.
import { MAX_SHOT_SECONDS, MIN_SHOT_SECONDS, minimumShots } from "./shotAllocation.ts";

/** What a Story runs to when the user does not say. */
export const DEFAULT_STORY_SECONDS = 60;

/**
 * The shortest Story on sale — one minute (owner directive, 2026-08-15).
 *
 * It was 10s, then 30s was the shortest thing anyone could buy. THE REASON IT
 * IS GONE IS ARITHMETIC, not taste: a flat ₹3 per-film infrastructure cost
 * cannot be recovered by a per-minute price, so half a minute paid all of the
 * flat cost while collecting half the rate and landed at ~21% against a 26%
 * floor. Every other duration clears it. Rather than break the one-rate policy
 * with a bent row — a row off the line is a tier again — the sub-minute
 * option was withdrawn.
 *
 * Mirrored by story_config.min_story_seconds, which is what the claim clamps
 * to and therefore the copy that actually binds.
 */
export const MIN_STORY_SECONDS = 60;

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

export function framesForStorySeconds(seconds: number, fps: number): number {
  return Math.max(1, Math.ceil(seconds * fps));
}

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
export type RefusalReason =
  | "disabled"
  | "capacity"
  | "daily"
  | "exhausted"
  | "too-long"
  | "verbatim-fit";

export type QuotaRefusal = {
  reason: RefusalReason;
  message: string;
  /** Seconds of free allowance left. */
  remaining: number;
  /**
   * Purchased seconds left, when the decider knew it. The screen uses this to
   * refresh the paid balance and to choose between "buy more" and "tomorrow".
   */
  paidSeconds?: number;
};

/** The numbers a refusal sentence may mention. */
export type RefusalNumbers = {
  remaining: number;
  dailyLeft: number;
  wanted: number;
};

/**
 * The sentence for a refusal. THE ONLY PLACE THIS COPY EXISTS.
 *
 * `claim_story_seconds` decides the same reasons in SQL, because the decision
 * has to happen under a row lock — but it returns a reason and three numbers,
 * never a sentence. Copy written twice is copy that drifts, and the drift is
 * only ever visible to a user.
 */
export function refusalMessage(reason: RefusalReason, n: RefusalNumbers): string {
  switch (reason) {
    case "disabled":
      return "Story generation is paused right now. Try again later.";
    case "capacity":
      return "Story generation is busy today. Try again tomorrow.";
    case "exhausted":
      return "You have used all your free Story time.";
    case "daily":
      return n.dailyLeft > 0
        ? `You have ${n.dailyLeft}s of Story time left today.`
        : "You have used your Story time for today. More tomorrow.";
    case "too-long":
      return `That is ${n.wanted}s and you have ${n.remaining}s of free time left.`;
    case "verbatim-fit":
      return `Your story does not fit a ${n.wanted}s film when read aloud. Pick a length that matches it, or trim the text.`;
  }
}

/**
 * The free allowance, in seconds of finished video. 300s = five 60s Stories.
 *
 * DERIVED, not chosen for roundness. At 8.5 shots per minute and two
 * generations per shot (a still and a clip), a second of finished video costs
 * 0.283 generations. So:
 *
 *     300s  ->  ~43 shots  ->   ~85 generations per user
 *    3000s  -> ~425 shots  ->  ~850 generations per user
 *
 * Fifty minutes was the original ask and it is ten times this. Five Stories is
 * enough to understand the product and decide you want more; fifty minutes is
 * enough to make a short film, for free, before anyone has shown they will pay.
 * Raise it from the config row once real spend is visible — that is the whole
 * reason it is a row and not a constant in a bundle.
 */
export const DEFAULT_FREE_SECONDS = 300;

/**
 * Per-user, per-day ceiling. Two default Stories.
 *
 * The lifetime allowance alone does not stop one account spending all of it in
 * an hour, and a compromised account is exactly the case where that happens.
 * This spreads the same total across days and costs an honest user nothing.
 */
export const DEFAULT_DAILY_SECONDS = 120;

/**
 * Total seconds of video the whole product may generate in a day.
 *
 * THE ONLY LAYER THAT BOUNDS ABSOLUTE SPEND. A per-user allowance multiplies by
 * signups, and signups are the number you least control — ten thousand users at
 * 300s each is 8.5 million generations of exposure. An hour of finished video a
 * day across everyone is ~1,020 generations, which is a bill you can look at
 * and reason about before it arrives.
 */
export const DEFAULT_GLOBAL_DAILY_SECONDS = 3600;

export type QuotaState = {
  enabled: boolean;
  /** Free seconds of finished video this user is granted in total. */
  freeSeconds: number;
  /** Seconds they have already generated, all time. */
  usedSeconds: number;
  /** Purchased seconds not yet spent. Spent after free, exempt from the caps. */
  paidSeconds?: number;
  /** Seconds this user has generated today. */
  dailyUsedSeconds?: number;
  /** Per-user daily ceiling. */
  dailySeconds?: number;
  /** Seconds generated across ALL users today. */
  globalDailyUsedSeconds?: number;
  /** Product-wide daily ceiling. */
  globalDailySeconds?: number;
};

/**
 * Decide whether a Story may be generated, BEFORE anything billable happens.
 *
 * Returns a refusal rather than throwing, so a screen can render the reason and
 * the remaining balance in one pass. The kill switch still comes first —
 * checking the request before the switch would spend effort deciding whether to
 * honour something already turned off.
 *
 * HOW A REQUEST IS FUNDED, mirroring `claim_story_seconds` exactly: free
 * seconds first (bounded by what is left of today), then purchased seconds for
 * the remainder. Paid time ignores the per-user daily cap — that cap bounds
 * what a free user can cost, and refusing to render five minutes somebody paid
 * for is not a limit, it is a complaint. The product-wide ceiling is checked
 * LAST and against the free portion only, because it exists to bound
 * infrastructure spend and a paid second is revenue-covered; that is also why
 * it moved below the personal checks — it cannot be computed until the split
 * says how much of the request is free.
 *
 * A partial grant is deliberately NOT offered. Silently making a 20-second
 * Story because 60 would not fit is a worse outcome than saying so — the user
 * asked for a length, and quietly delivering a third of it looks like a bug.
 */
export function checkStoryQuota(state: QuotaState, requestedSeconds: number): QuotaRefusal | null {
  const remaining = Math.max(0, state.freeSeconds - state.usedSeconds);
  const paid = Math.max(0, state.paidSeconds ?? 0);
  const dailyLeft = Math.max(
    0,
    (state.dailySeconds ?? DEFAULT_DAILY_SECONDS) - (state.dailyUsedSeconds ?? 0),
  );

  if (!state.enabled) {
    return {
      reason: "disabled",
      message: refusalMessage("disabled", { remaining, dailyLeft: 0, wanted: 0 }),
      remaining,
      paidSeconds: paid,
    };
  }
  const wanted = Math.round(requestedSeconds);

  // The split. Same two lines as the SQL, deliberately.
  const spendFree = Math.min(wanted, remaining, dailyLeft);
  const spendPaid = Math.min(wanted - spendFree, paid);

  if (spendFree + spendPaid < wanted) {
    // Not enough anywhere. The reason names the bucket that ran out, because
    // "buy more" and "come back tomorrow" are different instructions and the
    // wrong one either costs a sale or wastes somebody's afternoon.
    if (remaining <= 0 && paid <= 0) {
      return {
        reason: "exhausted",
        message: refusalMessage("exhausted", { remaining: 0, dailyLeft, wanted }),
        remaining: 0,
        paidSeconds: paid,
      };
    }
    if (spendFree < Math.min(wanted, remaining)) {
      return {
        reason: "daily",
        message: refusalMessage("daily", { remaining, dailyLeft, wanted }),
        remaining,
        paidSeconds: paid,
      };
    }
    return {
      reason: "too-long",
      message: refusalMessage("too-long", { remaining, dailyLeft, wanted }),
      remaining,
      paidSeconds: paid,
    };
  }

  // Product-wide ceiling, against the free portion only. A request funded
  // entirely out of purchased seconds passes even on a day that is otherwise
  // spent. Still the only layer bounding ABSOLUTE free spend — every other
  // limit multiplies by the number of people who sign up.
  const globalCap = state.globalDailySeconds ?? DEFAULT_GLOBAL_DAILY_SECONDS;
  const globalUsed = state.globalDailyUsedSeconds ?? 0;
  if (globalUsed + spendFree > globalCap) {
    return {
      reason: "capacity",
      message: refusalMessage("capacity", { remaining, dailyLeft, wanted }),
      remaining,
      paidSeconds: paid,
    };
  }
  return null;
}

/**
 * The result of `claim_story_seconds`, parsed.
 *
 * The RPC is the authority — it decided under a row lock, `checkStoryQuota`
 * only decided against numbers that were true a moment ago. So the client's
 * job is not to re-decide but to render, and this turns the RPC's jsonb into
 * the same `QuotaRefusal` shape the pure check already produces.
 *
 * DEFENSIVE about the payload. It arrives as `unknown` from a network call and
 * a malformed one must not read as a successful claim — an unrecognised shape
 * throws rather than falling through to "ok".
 */
export type StoryClaim =
  | {
      ok: true;
      jobId: string;
      seconds: number;
      remaining: number;
      dailyLeft: number;
      /** Purchased seconds left AFTER this claim drew its paid portion. */
      paidSeconds: number;
    }
  | { ok: false; refusal: QuotaRefusal };

const REFUSAL_REASONS: ReadonlySet<string> = new Set([
  "disabled",
  "capacity",
  "daily",
  "exhausted",
  "too-long",
  // Verbatim mode's fit band (owner directive, 2026-08-14): the server's
  // copy of the check the toggle already ran. Reaching here means the two
  // counted differently (or the RPC was called directly) — the message
  // must render as product copy, not as the review panel's raw-error dump.
  "verbatim-fit",
]);

export function parseClaimResult(payload: unknown): StoryClaim {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("claim_story_seconds: expected an object");
  }
  const p = payload as Record<string, unknown>;
  const num = (k: string): number => (typeof p[k] === "number" ? (p[k] as number) : 0);

  if (p.ok === true) {
    if (typeof p.jobId !== "string" || !p.jobId) {
      throw new Error("claim_story_seconds: claim succeeded without a job id");
    }
    return {
      ok: true,
      jobId: p.jobId,
      seconds: num("seconds"),
      remaining: num("remaining"),
      dailyLeft: num("dailyLeft"),
      paidSeconds: num("paidSeconds"),
    };
  }
  if (p.ok !== false) {
    throw new Error("claim_story_seconds: no ok flag");
  }
  const reason = p.reason;
  if (typeof reason !== "string" || !REFUSAL_REASONS.has(reason)) {
    // A reason this build does not know about is a migration ahead of the
    // bundle. Refusing loudly beats inventing a sentence for it.
    throw new Error(`claim_story_seconds: unknown refusal ${String(reason)}`);
  }
  const numbers: RefusalNumbers = {
    remaining: num("remaining"),
    dailyLeft: num("dailyLeft"),
    wanted: num("wanted"),
  };
  return {
    ok: false,
    refusal: {
      reason: reason as RefusalReason,
      message: refusalMessage(reason as RefusalReason, numbers),
      remaining: numbers.remaining,
      paidSeconds: num("paidSeconds"),
    },
  };
}

/** Seconds of free allowance left, floored at zero. */
export function remainingSeconds(state: QuotaState): number {
  return Math.max(0, state.freeSeconds - state.usedSeconds);
}
