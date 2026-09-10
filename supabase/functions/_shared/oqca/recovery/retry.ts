/**
 * RETRY BUDGETS AND BACKOFF — the recovery brief's sections 5 and 6.
 *
 * "Defaults must be finite. No retry budget may be unlimited." (§5)
 * "Never sleep indefinitely." (§6)
 *
 * THIS MODULE COMPUTES A DELAY AND NEVER SLEEPS ONE. Sleeping needs a clock and
 * a timer, and `security.test.ts` walks this tree for exactly those. The
 * runtime does the waiting; the kernel decides how long, so the number is
 * recorded in the state and a replay waits for nothing at all.
 *
 * JITTER IS AN ARGUMENT, NOT A RANDOM CALL, for the same reason. `Math.random`
 * is banned here (it destroys replay), so the caller supplies a fraction in
 * [0,1] and the runtime supplies a real random one. The delay a run actually
 * used is then part of its record rather than a number nobody can reproduce.
 */

/**
 * Section 5's seven. Every one is a COUNT, every one is finite, and there is
 * deliberately no sentinel for "unlimited" — a budget that can be switched off
 * is a budget somebody switches off.
 */
export type RetryBudgets = {
  /** Attempts at one operation, including the first. 1 means "no retry". */
  readonly maxAttemptsPerOperation: number;
  /** Attempts across all operations at one station, per iteration. */
  readonly maxAttemptsPerStation: number;
  /** Retries of any kind across the whole run. */
  readonly maxTotalRetries: number;
  /** Level 1 deterministic repairs of one malformed output. */
  readonly maxRepairAttempts: number;
  /** Level 5 replans. A replan that replans is how a planning fault hides. */
  readonly maxReplans: number;
  /** Level 6 research recoveries. Research costs money, so this is small. */
  readonly maxResearchRecoveries: number;
  /** Level 7 escalations. More than one is a loop asking twice. */
  readonly maxEscalations: number;
};

/**
 * FINITE, SMALL, AND NOT ZERO — and the asymmetry with `Budgets` in `seams.ts`
 * is deliberate rather than an oversight. There, `maxToolCalls`/`maxTokens`/
 * `maxCostUsd` default to 0 because they authorise SPENDING and an unconfigured
 * system must spend nothing. A retry budget authorises nothing: it BOUNDS what
 * an already-authorised operation may do. Defaulting it to 0 would not fail
 * closed, it would fail dead — the first transient blip on a call the owner did
 * authorise would end the run — which is the `maxExecutionTimeMs: 0` lesson
 * from v1.2 in a second place.
 */
export const DEFAULT_RETRY_BUDGETS: RetryBudgets = {
  maxAttemptsPerOperation: 3,
  maxAttemptsPerStation: 6,
  maxTotalRetries: 12,
  maxRepairAttempts: 2,
  maxReplans: 2,
  maxResearchRecoveries: 1,
  maxEscalations: 1,
};

/** How many of each have been spent. Carried on the run, never module-level. */
export type RetryLedger = {
  readonly totalRetries: number;
  readonly repairs: number;
  readonly replans: number;
  readonly researchRecoveries: number;
  readonly escalations: number;
  /** Attempts this station has made this iteration, keyed by station name. */
  readonly perStation: Readonly<Record<string, number>>;
};

export const EMPTY_RETRY_LEDGER: RetryLedger = {
  totalRetries: 0,
  repairs: 0,
  replans: 0,
  researchRecoveries: 0,
  escalations: 0,
  perStation: {},
};

export type BackoffPolicy = {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Jitter as a fraction OF the computed delay. 0.2 = up to +20%. */
  readonly jitterRatio: number;
};

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  jitterRatio: 0.2,
};

/**
 * Why a retry cannot be made, when it cannot. Returned rather than thrown, so
 * the reason reaches the failure record and the log instead of a stack trace.
 */
export type NoRetryReason =
  "attempts_exhausted" | "not_retryable" | "no_time_left" | "retry_after_exceeds_run_budget";

export type RetryPlan =
  | { readonly retry: true; readonly delayMs: number; readonly source: "backoff" | "retry_after" }
  | { readonly retry: false; readonly reason: NoRetryReason };

export type RetryContext = {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly retryable: boolean;
  /** Milliseconds the run has left on its execution-time bound. */
  readonly remainingRunMs: number;
  /** The provider's own Retry-After, in ms. null when it did not send one. */
  readonly retryAfterMs: number | null;
  /** Deterministic jitter in [0,1]. The runtime randomises it; a replay does not. */
  readonly jitterFraction: number;
  readonly policy?: BackoffPolicy;
};

/**
 * Section 6's formula, and then three bounds on top of it that the formula
 * alone does not give:
 *
 *   min(base × 2^(attempt-1) + jitter, maxDelay)
 *
 * 1. A PROVIDER'S OWN Retry-After WINS over the computed delay when it is
 *    longer. A 429 carrying "wait 900s" is a wall with a clock on it, and
 *    backing off 2 seconds into it is what `providerError.ts` was written after.
 *    It does NOT win when it is shorter: the provider is telling us the earliest
 *    it will answer, not asking us to hurry.
 * 2. A delay that outlasts the run's execution-time budget is not a delay, it
 *    is a run that ends asleep. Refused, and the two refusals are distinct —
 *    `retry_after_exceeds_run_budget` names the provider, `no_time_left` names
 *    us — because they need different fixes.
 * 3. `attempt` is the attempt just FAILED, so attempt 1 waits base × 2^0.
 */
export function planRetry(ctx: RetryContext): RetryPlan {
  if (!ctx.retryable) return { retry: false, reason: "not_retryable" };
  if (ctx.attempt >= ctx.maxAttempts) return { retry: false, reason: "attempts_exhausted" };
  if (ctx.remainingRunMs <= 0) return { retry: false, reason: "no_time_left" };

  const policy = ctx.policy ?? DEFAULT_BACKOFF;
  const exponent = Math.max(0, ctx.attempt - 1);
  // Cap the exponent before it is used, not the result after: 2^1024 is
  // Infinity, and Infinity × anything stays Infinity through the min().
  const growth = Math.pow(2, Math.min(exponent, 30));
  const raw = policy.baseDelayMs * growth;
  const jitter = raw * policy.jitterRatio * clamp01(ctx.jitterFraction);
  const backoff = Math.min(raw + jitter, policy.maxDelayMs);

  const useRetryAfter = ctx.retryAfterMs !== null && ctx.retryAfterMs > backoff;
  const delayMs = Math.ceil(useRetryAfter ? ctx.retryAfterMs! : backoff);

  if (delayMs > ctx.remainingRunMs) {
    return {
      retry: false,
      reason: useRetryAfter ? "retry_after_exceeds_run_budget" : "no_time_left",
    };
  }
  return { retry: true, delayMs, source: useRetryAfter ? "retry_after" : "backoff" };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** Every budget consulted in one place, so a level cannot skip its own bound. */
export function ledgerHeadroom(
  ledger: RetryLedger,
  budgets: RetryBudgets,
  station: string,
): {
  readonly total: boolean;
  readonly station: boolean;
  readonly repair: boolean;
  readonly replan: boolean;
  readonly research: boolean;
  readonly escalate: boolean;
} {
  return {
    total: ledger.totalRetries < budgets.maxTotalRetries,
    station: (ledger.perStation[station] ?? 0) < budgets.maxAttemptsPerStation,
    repair: ledger.repairs < budgets.maxRepairAttempts,
    replan: ledger.replans < budgets.maxReplans,
    research: ledger.researchRecoveries < budgets.maxResearchRecoveries,
    escalate: ledger.escalations < budgets.maxEscalations,
  };
}
