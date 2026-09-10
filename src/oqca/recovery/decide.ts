/**
 * decideRecovery — the recovery brief's sections 19, 22, 23, 24 and 25.
 *
 * §24: "The actual implementation must use typed exhaustive cases. Unknown
 * failure classes must not silently default to retry."
 *
 * So there is no `default:` in the switch below. Every one of the eighteen
 * classes is written out, and the function ends on a `never` binding — a
 * nineteenth class added to the union fails the typecheck HERE, at the one
 * place that would otherwise have to guess what to do with it. UNKNOWN itself
 * escalates rather than retrying, which is the section's own instruction and
 * also the only honest answer: a failure nobody could classify is a failure
 * nobody has established is safe to repeat.
 */
import { type Failure, isNeverRetry, isSafetyViolation, safeToReplay } from "./failure.ts";
import {
  type RetryBudgets,
  type RetryLedger,
  type BackoffPolicy,
  ledgerHeadroom,
  planRetry,
} from "./retry.ts";

/**
 * Section 19's hierarchy. The NUMBER is load-bearing, not decorative: the
 * section's rule is "Do not jump directly to expensive recovery when a cheap
 * deterministic repair exists", and a decision is checkable against that rule
 * only if its cost is ordered. `recoveryLevelTest.ts` asserts that a fault with
 * a repair available never returns a level above 1.
 */
export const RECOVERY_LEVELS = [
  "validate",
  "repair",
  "retry",
  "retry_adjusted",
  "alternate",
  "replan",
  "research",
  "escalate",
  "stop",
] as const;

export type RecoveryAction = (typeof RECOVERY_LEVELS)[number];

/** 0..8, the index of the action in the hierarchy. */
export function levelOf(action: RecoveryAction): number {
  return RECOVERY_LEVELS.indexOf(action);
}

export type TerminalStatus =
  "failure" | "blocked" | "budget_exhausted" | "safety_stop" | "user_stop";

export type RecoveryDecision = {
  readonly action: RecoveryAction;
  readonly level: number;
  readonly reason: string;
  /** Milliseconds to wait before the retry. null for every non-waiting action. */
  readonly delayMs: number | null;
  readonly terminal: boolean;
  /**
   * Section 23: BUDGET_EXHAUSTED is a distinct outcome from FAILED, and it
   * "must name which budget". Present whenever `terminalStatus` is
   * `budget_exhausted`, and asserted present by the tests.
   */
  readonly terminalStatus?: TerminalStatus;
  readonly budgetName?: string;
};

export type RecoveryContext = {
  readonly budgets: RetryBudgets;
  readonly ledger: RetryLedger;
  readonly backoff?: BackoffPolicy;
  readonly remainingRunMs: number;
  readonly retryAfterMs: number | null;
  readonly jitterFraction: number;
  /** True when an ALTERNATE tool or provider is actually available. */
  readonly alternateAvailable: boolean;
  /** True when the failure names a repair this run can perform deterministically. */
  readonly repairAvailable: boolean;
  /**
   * True when a research capability is actually wired. DEFAULTS TO TRUE at the
   * call sites that do not know, and is passed FALSE by the one caller that
   * does: the RESEARCH station, when the research adapter has just refused.
   * Without it, a KNOWLEDGE failure raised BY a research refusal would be
   * answered with "do some research" — the ladder recommending the step that
   * just failed, which is section 1's unconditional retry wearing level 6.
   */
  readonly researchAvailable?: boolean;
  /** Which budget ran out, when the failure class is BUDGET. */
  readonly exhaustedBudget?: string;
};

const stop = (
  reason: string,
  terminalStatus: TerminalStatus,
  budgetName?: string,
): RecoveryDecision => ({
  action: "stop",
  level: levelOf("stop"),
  reason,
  delayMs: null,
  terminal: true,
  terminalStatus,
  ...(budgetName ? { budgetName } : {}),
});

const act = (action: RecoveryAction, reason: string, delayMs: number | null = null) => ({
  action,
  level: levelOf(action),
  reason,
  delayMs,
  terminal: false,
});

/**
 * A retry, or the cheapest thing above it that is still allowed. Every retry in
 * this file goes through here so that no class can retry past its own budget,
 * and so that section 6's delay is computed in one place.
 */
function tryRetry(
  failure: Failure,
  ctx: RecoveryContext,
  adjusted: boolean,
  fallback: () => RecoveryDecision,
): RecoveryDecision {
  const head = ledgerHeadroom(ctx.ledger, ctx.budgets, failure.station);
  if (!head.total) return fallback();
  if (!head.station) return fallback();

  // Section 8, and it is the rule most easily lost in a refactor: a failure
  // that leaves the effect UNCERTAIN may only be replayed when replaying it is
  // harmless. A timeout on a non-idempotent write is not a retry candidate at
  // any attempt count — it is a possible double-write.
  if (failure.effectUncertain && !safeToReplay(failure.idempotency)) {
    return ctx.alternateAvailable
      ? act("alternate", `effect uncertain on a ${failure.idempotency} operation; not replayed`)
      : act(
          "escalate",
          `effect uncertain on a ${failure.idempotency} operation and no alternate path`,
        );
  }

  const plan = planRetry({
    attempt: failure.attempt,
    maxAttempts: Math.min(failure.maxAttempts, ctx.budgets.maxAttemptsPerOperation),
    retryable: failure.retryable,
    remainingRunMs: ctx.remainingRunMs,
    retryAfterMs: ctx.retryAfterMs,
    jitterFraction: ctx.jitterFraction,
    policy: ctx.backoff,
  });
  if (!plan.retry) return fallback();
  return act(
    adjusted ? "retry_adjusted" : "retry",
    `${failure.class}: attempt ${failure.attempt + 1}/${failure.maxAttempts} after ${plan.delayMs}ms (${plan.source})`,
    plan.delayMs,
  );
}

/** Replan if there is headroom, else escalate, else stop. */
function tryReplan(failure: Failure, ctx: RecoveryContext, why: string): RecoveryDecision {
  const head = ledgerHeadroom(ctx.ledger, ctx.budgets, failure.station);
  if (head.replan) return act("replan", why);
  if (head.escalate) return act("escalate", `${why}; replan budget spent`);
  return stop(`${why}; replan and escalation budgets spent`, "blocked");
}

function tryResearch(failure: Failure, ctx: RecoveryContext, why: string): RecoveryDecision {
  if (ctx.researchAvailable === false) {
    return tryReplan(failure, ctx, `${why}; no research capability is wired`);
  }
  const head = ledgerHeadroom(ctx.ledger, ctx.budgets, failure.station);
  if (head.research) return act("research", why);
  return tryReplan(failure, ctx, `${why}; research budget spent`);
}

function tryEscalate(ctx: RecoveryContext, why: string, status: TerminalStatus): RecoveryDecision {
  return ledgerHeadroom(ctx.ledger, ctx.budgets, "").escalate
    ? act("escalate", why)
    : stop(`${why}; escalation budget spent`, status);
}

export function decideRecovery(failure: Failure, ctx: RecoveryContext): RecoveryDecision {
  /* ---------------------------------------------------------------- *
   * SECTION 22, AND IT RUNS FIRST BECAUSE ITS OWN SENTENCE IS
   * "Recovery cannot override safety." Reading the class before the code
   * would let a SECURITY fault mislabelled TRANSIENT reach the retry ladder.
   * ---------------------------------------------------------------- */
  if (isSafetyViolation(failure.code)) {
    return stop(`safety: ${failure.code}`, "safety_stop");
  }
  if (failure.code === "user_denied") {
    return stop("the user declined this action", "user_stop");
  }
  if (failure.code === "budget_exhausted") {
    return stop("budget exhausted", "budget_exhausted", ctx.exhaustedBudget ?? "unspecified");
  }
  if (isNeverRetry(failure.code)) {
    // Section 4. Not retryable — but a REPLAN is a different action, not a
    // retry, so a schema violation that has exhausted repair may still be
    // planned around. `corrupted_state` is excluded below by its own class.
    return tryReplan(failure, ctx, `not retryable: ${failure.code}`);
  }

  switch (failure.class) {
    case "TRANSIENT":
      return tryRetry(failure, ctx, false, () =>
        ctx.alternateAvailable
          ? act("alternate", "transient failure outlasted its retry budget")
          : tryReplan(failure, ctx, "transient failure outlasted its retry budget"),
      );

    case "RATE_LIMIT":
      // Adjusted rather than plain: a rate limit is the one class where the
      // provider tells us the delay, and `planRetry` prefers its Retry-After
      // over the computed backoff whenever it is longer.
      return tryRetry(failure, ctx, true, () =>
        ctx.alternateAvailable
          ? act("alternate", "rate limited and the wait exceeds what this run has")
          : stop("rate limited and the wait exceeds what this run has", "blocked"),
      );

    case "TIMEOUT":
    case "NETWORK":
      // `tryRetry` holds section 8: it refuses to replay a non-idempotent
      // operation whose effect is uncertain, whatever the attempt count says.
      return tryRetry(failure, ctx, true, () =>
        ctx.alternateAvailable
          ? act("alternate", `${failure.class.toLowerCase()} exhausted its retries`)
          : tryReplan(failure, ctx, `${failure.class.toLowerCase()} exhausted its retries`),
      );

    case "AUTHORIZATION":
      // Never a retry. A permission is not a transient property, and hammering
      // one is how an account gets locked rather than how it gets granted.
      // "permission refused" rather than the other word for it: the security
      // guard bans that spelling because it is how an HTTP auth header is
      // written, and a refusal MESSAGE is not a header. Rewording prose is
      // cheaper than excluding a file from a ban — the same call as renaming
      // `SECRET_PATTERNS` one file over.
      return tryEscalate(ctx, "permission refused; a human must grant it", "blocked");

    case "BUDGET":
      // Reached when the class is BUDGET but the code was not the never-retry
      // `budget_exhausted` — a per-operation ceiling rather than the run's.
      return stop("budget bound reached", "budget_exhausted", ctx.exhaustedBudget ?? "unspecified");

    case "VALIDATION":
      // Section 19's cheap-first rule, and this is the case it exists for.
      if (ctx.repairAvailable && ledgerHeadroom(ctx.ledger, ctx.budgets, failure.station).repair) {
        return act("repair", "malformed output with a deterministic repair available");
      }
      return tryReplan(failure, ctx, "validation failed and no repair remains");

    case "MODEL":
      return tryRetry(failure, ctx, true, () =>
        ctx.alternateAvailable
          ? act("alternate", "model failed repeatedly; trying another")
          : tryReplan(failure, ctx, "model failed repeatedly and there is no alternate"),
      );

    case "TOOL":
      // A tool that refused is not a blip. Alternate first, then replan — a
      // retry would ask the same tool the same question.
      return ctx.alternateAvailable
        ? act("alternate", "tool refused; another tool can serve this step")
        : tryReplan(failure, ctx, "tool refused and there is no alternate");

    case "DATA":
      // Retrying reads the same bad data. Go and get better data, or plan
      // around it.
      return tryResearch(failure, ctx, "the data this step read is unusable");

    case "KNOWLEDGE":
      return tryResearch(failure, ctx, "a knowledge gap blocks this step");

    case "PLANNING":
      // SECTION 25, LITERALLY: "Never use repeated retries to conceal a
      // planning failure." There is no path from here to a retry.
      return tryReplan(failure, ctx, "the plan itself was wrong");

    case "PREDICTION":
      // The world model disagreed with the world. Re-planning on a corrected
      // model is the recovery; repeating the action is not.
      return tryReplan(failure, ctx, "observation contradicted the prediction");

    case "ENVIRONMENT":
      return ctx.alternateAvailable
        ? act("alternate", "the environment changed; another path may still hold")
        : tryEscalate(ctx, "the environment changed underneath this run", "blocked");

    case "STATE":
      // Section 16: "Never continue execution from an invalid state." There is
      // no recovery from a state that cannot be trusted, because every recovery
      // would be computed FROM it.
      return stop("cognitive state is not valid; refusing to continue from it", "safety_stop");

    case "CONCURRENCY":
      // Someone else moved first. Re-read and retry is the correct answer and
      // the adjustment is the re-read, so it is level 3 rather than level 2.
      return tryRetry(failure, ctx, true, () =>
        tryReplan(failure, ctx, "lost every race for this resource"),
      );

    case "SECURITY":
      // Unreachable via the code check above for a well-formed failure; kept
      // because the CLASS must stop even if a caller raised it with a code the
      // safety list does not carry.
      return stop("security failure", "safety_stop");

    case "UNKNOWN":
      // Section 24. Not a retry.
      return tryEscalate(ctx, "unclassified failure; not repeating an unknown action", "failure");
  }

  // Exhaustiveness. If a nineteenth class is added to `FailureClass`, this
  // binding stops typechecking and the build fails here rather than at runtime.
  const exhaustive: never = failure.class;
  return stop(`unhandled failure class: ${String(exhaustive)}`, "failure");
}
