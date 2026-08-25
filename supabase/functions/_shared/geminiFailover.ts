// geminiFailover — one narrow escape hatch, for one named provider failure.
//
// WHY THIS EXISTS. On 2026-08-25 the Anthropic account ran out of credit
// mid-way through a measurement battery. Every searching function in ONIQ —
// smart-scout, ting, health-scan, hotel-scout — returned HTTP 400
// "Your credit balance is too low to access the Anthropic API", and every
// search feature was simply down. There was no second provider to fall to:
// `callClaude`'s existing Gemini path was refused by the spend guard as
// `unpriced-model`, because `gemini-3.6-flash` has no published rate in
// MODEL_RATES.
//
// WHAT THIS IS NOT. It is not a retry, and it is not a general-purpose
// second chance. Turning "Claude said no" into "ask someone else" is how a
// guard refusal becomes a bill: a request refused for being over-cap would
// simply be re-run somewhere else, and the ceiling the owner set would mean
// nothing. So the trigger is ONE failure class, tested by construction, and
// every other way a request can fail is an explicit non-trigger below.
//
// THE FAILURE CLASS. Anthropic rejects a credit-exhausted request BEFORE
// serving it — no tokens are generated and nothing is billed. That is why this
// class, uniquely, can release the Claude reservation rather than settling it:
// we are not guessing that nothing was spent, the provider refused the work.
// Every ambiguous failure (timeout, 5xx, a body we cannot parse) keeps the
// existing charge-the-estimate behaviour, because the request may have been
// served.

import {
  GEMINI_FAILOVER_MODEL,
  GEMINI_FAILOVER_MODEL_AVAILABLE,
  type SearchBudget,
  searchUnitUsdFor,
} from "./searchBudget.ts";
import { groundedQueriesToReserve } from "./geminiSearch.ts";
import type { GuardedResult, ServiceRpc } from "./financialLedger.ts";
import { type GuardSpec, type ProviderRun, withSearchSpendGuard } from "./searchGuard.ts";

// ---------------------------------------------------------------- classifying
/**
 * How a Claude attempt ended. Exactly ONE member is a failover trigger.
 *
 * The non-triggers are enumerated rather than defaulted so that adding a new
 * failure mode is a deliberate act: an unrecognised class lands on
 * `PROVIDER_OTHER`, which does not fail over.
 */
export type ClaudeFailureClass =
  /** HTTP 400 invalid_request_error whose message names the credit balance. */
  | "CREDIT_EXHAUSTION"
  /** The spend guard declined admission. Re-running elsewhere would defeat it. */
  | "GUARD_REFUSAL"
  /** Settled above the request ceiling. A second call spends more, not less. */
  | "OVER_CAP"
  /** The reservation was too small. The fix is the estimate, not the provider. */
  | "UNDER_RESERVED"
  /** Model answered but the output did not match the schema. */
  | "SCHEMA_FAILURE"
  /** Our code threw. A different model does not fix our bug. */
  | "APPLICATION_ERROR"
  /** We sent something malformed. Same request, same rejection. */
  | "MALFORMED_REQUEST"
  /** Refused on safety grounds. Shopping for a permissive model is not allowed. */
  | "SAFETY_REFUSAL"
  /** The user went away. Spending again would be spending for nobody. */
  | "USER_CANCELLED"
  /** Output failed URL/price/source validation. */
  | "VALIDATION_FAILURE"
  /** Any other provider-side failure: timeout, 429, 5xx, unparseable body. */
  | "PROVIDER_OTHER"
  /** The call succeeded. */
  | "NONE";

/** The one and only class that may fail over. */
export const FAILOVER_TRIGGER: ClaudeFailureClass = "CREDIT_EXHAUSTION";

export type ClaudeAttempt = {
  ok: boolean;
  status?: number | null;
  /** Parsed response body, when there was one. */
  body?: unknown;
  /** A class the CALLER already knows (schema/validation/cancel). Wins outright. */
  knownClass?: ClaudeFailureClass;
};

/**
 * Anthropic's credit-exhaustion shape, matched narrowly.
 *
 * Deliberately all three of: status 400, `error.type === "invalid_request_error"`,
 * and a message naming the credit balance. A bare 400 is a malformed request,
 * and treating it as exhaustion would fail over on our own bugs — spending
 * Google's money to paper over a broken payload.
 */
export function isAnthropicCreditExhaustion(status: number, body: unknown): boolean {
  if (status !== 400) return false;
  const err = (body as { error?: unknown } | null)?.error;
  if (!err || typeof err !== "object") return false;
  const e = err as { type?: unknown; message?: unknown };
  if (e.type !== "invalid_request_error") return false;
  return typeof e.message === "string" && /credit balance/i.test(e.message);
}

export function classifyClaudeFailure(a: ClaudeAttempt): ClaudeFailureClass {
  if (a.knownClass) return a.knownClass;
  if (a.ok) return "NONE";
  const status = typeof a.status === "number" ? a.status : 0;
  if (isAnthropicCreditExhaustion(status, a.body)) return "CREDIT_EXHAUSTION";
  return "PROVIDER_OTHER";
}

// ---------------------------------------------------------------- eligibility
export type FailoverBlock =
  | "not-credit-exhaustion"
  | "failover-disabled"
  | "model-unavailable"
  | "gemini-not-configured"
  | "search-request-unpriceable-on-gemini";

export type FailoverDecision = { eligible: true } | { eligible: false; block: FailoverBlock };

export type FailoverEnv = {
  /** Owner gate. Absent or anything but "true" keeps the failover off. */
  enabled: boolean;
  /** Whether GOOGLE_AI_API_KEY is present. */
  configured: boolean;
  /**
   * Whether the model actually answers on ONIQ's key — measured, not assumed.
   * Production always takes this from GEMINI_FAILOVER_MODEL_AVAILABLE; it is a
   * field so the ladder below it can still be exercised by tests.
   */
  modelAvailable: boolean;
};

/**
 * May this request fail over to Gemini?
 *
 * The searching case USED to be refused outright, on two grounds that have
 * both since been resolved by measurement:
 *
 *   1. Google's grounding rate is now known per model generation — $14 per
 *      1,000 queries on the 3.x family — so a grounded call can be reserved
 *      rather than guessed at.
 *   2. `geminiSearch.ts` now translates `web_search_20250305` into Google's
 *      `google_search` tool instead of dropping it, and validates every
 *      claimed source against the grounding chunks that came back.
 *
 * The unpriceable check below is kept as a guard, not as dead code: if anyone
 * points GEMINI_FAILOVER_MODEL at a model whose grounding rate is unknown, a
 * searching request must go back to being refused rather than reserved
 * against nothing.
 */
export function failoverDecision(
  cls: ClaudeFailureClass,
  budget: Pick<SearchBudget, "maxSearches">,
  env: FailoverEnv,
): FailoverDecision {
  if (cls !== FAILOVER_TRIGGER) return { eligible: false, block: "not-credit-exhaustion" };
  // TWO LOCKS, checked in this order. `modelAvailable` is a MEASURED
  // engineering fact; `enabled` is the owner's business decision.
  //
  // They are separate because of how the first attempt failed. The originally
  // specified gemini-2.5-flash-lite passes a free metadata lookup and then
  // 404s on generateContent — catalogue presence is not availability. An
  // operator flipping the owner's flag must never be able to start calling a
  // model that cannot answer, so the measured fact is checked first and is
  // not readable from the environment.
  if (!env.modelAvailable) return { eligible: false, block: "model-unavailable" };
  if (!env.enabled) return { eligible: false, block: "failover-disabled" };
  if (!env.configured) return { eligible: false, block: "gemini-not-configured" };
  if (budget.maxSearches > 0 && searchUnitUsdFor(GEMINI_FAILOVER_MODEL) === null) {
    return { eligible: false, block: "search-request-unpriceable-on-gemini" };
  }
  return { eligible: true };
}

/** Reads the owner gate. Default OFF — an unset variable never enables spend. */
export function failoverEnvFrom(get: (k: string) => string | undefined): FailoverEnv {
  return {
    enabled: get("GEMINI_FAILOVER_ENABLED") === "true",
    configured: Boolean(get("GOOGLE_AI_API_KEY")),
    // Not readable from the environment on purpose: availability is something
    // ONIQ measured against the provider, not something an operator asserts.
    modelAvailable: GEMINI_FAILOVER_MODEL_AVAILABLE,
  };
}

// ------------------------------------------------------------- request ids
/**
 * The Gemini leg's request id.
 *
 * It MUST differ from the Claude leg's. `admit_provider_spend` refuses a
 * repeated id as `duplicate-request`, so reusing it would make the second
 * reservation impossible; and if it somehow succeeded, the two legs would
 * share one ledger row and one of the two costs would vanish. A deterministic
 * suffix also means a retry of the same user request collides with itself
 * rather than reserving twice.
 */
export function geminiRequestId(claudeRequestId: string): string {
  return `${claudeRequestId}-gx`.slice(0, 64);
}

/**
 * The budget for the Gemini leg.
 *
 * Searches are no longer ZEROED — they are reserved WITH HEADROOM, because
 * Google's `google_search` has no `max_uses`. On the Anthropic path the hop
 * ceiling is enforced by the provider; here it is only an input to the
 * reservation, and Gemini decides how many queries to run. Settlement then
 * counts the queries Google actually reports.
 *
 * `maxEstimatedUsd` is inherited unchanged: the failover never gets a more
 * generous ceiling than the call it replaces.
 */
export function geminiBudgetFrom(b: SearchBudget): SearchBudget {
  return {
    ...b,
    maxSearches: groundedQueriesToReserve(b),
    maxProviderCalls: 1,
    maxLlmCalls: 1,
  };
}

// ------------------------------------------------------------ orchestration
/**
 * Claude first, Gemini only on credit exhaustion. Two reservations, never one,
 * never three.
 *
 * The two legs are strictly sequential: the Gemini reservation is requested
 * only after the Claude leg has finished and its own reservation has been
 * released. `withProviderSpendGuard` always ends a leg in exactly one of
 * settle or release — including when the callback throws — so no path here can
 * strand a reservation, and no path can hold two open at once.
 */
export type FailoverResult<T> = {
  /** Which provider produced `result`. */
  provider: "anthropic" | "google";
  /** The guarded result of whichever leg was last run. */
  result: GuardedResult<T>;
  /** How the Claude leg ended. */
  claudeClass: ClaudeFailureClass;
  /** The Claude leg, kept so callers can see both reservations. */
  claudeResult: GuardedResult<T>;
  /** Why no failover happened, when none did. */
  block?: FailoverBlock;
};

/** A Claude leg reports its provider outcome AND enough to classify it. */
export type ClaudeLeg<T> = ProviderRun<T> & { attempt: ClaudeAttempt };

export async function withCreditExhaustionFailover<T>(
  rpc: ServiceRpc | null,
  spec: GuardSpec,
  env: FailoverEnv,
  runClaude: () => Promise<ClaudeLeg<T>>,
  runGemini: () => Promise<ProviderRun<T>>,
): Promise<FailoverResult<T>> {
  let claudeClass: ClaudeFailureClass = "NONE";

  const claudeResult = await withSearchSpendGuard<T>(rpc, spec, async () => {
    const leg = await runClaude();
    claudeClass = classifyClaudeFailure(leg.attempt);
    if (claudeClass === FAILOVER_TRIGGER) {
      // Anthropic refused the work before doing any of it, so nothing was
      // billed and the reservation goes back. This is the ONLY failure class
      // that may claim that; every other one keeps charge-the-estimate.
      return { ...leg, neverCalled: true, terminationReason: "PROVIDER_ERROR" as const };
    }
    return leg;
  });

  if (!claudeResult.admitted) {
    // Admission was refused. Re-running the same request on another provider
    // is precisely what a ceiling exists to prevent.
    return {
      provider: "anthropic",
      result: claudeResult,
      claudeResult,
      claudeClass: "GUARD_REFUSAL",
      block: "not-credit-exhaustion",
    };
  }

  const decision = failoverDecision(claudeClass, spec.budget, env);
  if (!decision.eligible) {
    return {
      provider: "anthropic",
      result: claudeResult,
      claudeResult,
      claudeClass,
      block: decision.block,
    };
  }

  const geminiResult = await withSearchSpendGuard<T>(
    rpc,
    {
      ...spec,
      requestId: geminiRequestId(spec.requestId),
      provider: "google",
      model: GEMINI_FAILOVER_MODEL,
      budget: geminiBudgetFrom(spec.budget),
      // Google's API has no Anthropic-style cache-write line. Carrying the
      // Claude figure over would reserve for a charge that cannot occur.
      cacheWriteTokens: 0,
    },
    runGemini,
  );

  return { provider: "google", result: geminiResult, claudeResult, claudeClass };
}
