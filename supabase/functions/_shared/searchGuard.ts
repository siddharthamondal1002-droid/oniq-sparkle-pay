// searchGuard — the SEARCH adapter over the central financial ledger.
//
// This used to be a standalone spend guard with its own tables and its own
// admission SQL. It is now one capability adapter on `financialLedger`, because
// video needed the same reserve-call-measure-settle discipline and two copies
// of check-then-spend is two places for the check to drift from the spend.
//
// WHAT STAYED HERE: everything specific to SEARCH — turning searches, tokens
// and cache reads into dollars, and turning an upload's byte count into an
// input-token bound. What LEFT: the accounting, the row lock, the ceilings.
//
// The exported surface is unchanged, so smart-scout, hotel-scout, ting and
// health-scan did not have to be touched to move underneath them.

import {
  type SearchBudget,
  type TerminationReason,
  actualUsdFromUsage,
  type ProviderUsage,
  readUsage,
  worstCaseUsd,
} from "./searchBudget.ts";
import {
  type GuardedResult,
  type RefusalReason,
  type ServiceRpc,
  refusalMessage as ledgerRefusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withProviderSpendGuard,
} from "./financialLedger.ts";

export { requestIdFrom, serviceRoleRpc };
export type { GuardedResult, ServiceRpc };

// --- attachment input bounds -------------------------------------------------
//
// A reservation is only honest if it covers the input the caller is about to
// send, and an uploaded file is input. These bounds exist so a 6 MB upload
// cannot be reserved as if it were a one-line question.

/**
 * Anthropic downscales images before billing, so an image's token cost is
 * bounded by the resize ceiling and NOT by the upload's byte count. 8,000 is
 * comfortably above that ceiling; it is a bound, not an estimate.
 */
export const IMAGE_TOKEN_CEILING = 8_000;

/**
 * PDF worst case: ~25,000 tokens per 100 kB of text-dense content, from
 * Anthropic's own published guidance. It is a genuine WORST case — a scanned
 * PDF of the same size bills as a handful of page images and costs far less —
 * so a large text PDF may be refused for a spend it would not actually have
 * incurred. That is the safe direction, and the owner can widen it by raising
 * the SEARCH capability's `request_usd_cap`.
 */
export const PDF_TOKENS_PER_BYTE = 0.25;

/** Decoded byte count of a base64 payload, without decoding it. */
export function base64Bytes(b64: string): number {
  if (typeof b64 !== "string" || b64.length === 0) return 0;
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Upper bound on the input tokens one attachment can add. */
export function attachmentTokenCeiling(
  kind: "image" | "pdf" | "text" | null | undefined,
  b64OrText: string | null | undefined,
): number {
  if (!kind || !b64OrText) return 0;
  if (kind === "image") return IMAGE_TOKEN_CEILING;
  if (kind === "pdf") return Math.ceil(base64Bytes(b64OrText) * PDF_TOKENS_PER_BYTE);
  // Plain text goes in as characters; ~4 characters per token, rounded down to
  // 3 so the bound stays above the real count for dense scripts.
  return Math.ceil(b64OrText.length / 3);
}

// --- the seam ----------------------------------------------------------------
/** What the guarded callback hands back. */
export type ProviderRun<T> = {
  /** The callback's own result, returned to the caller untouched. */
  value: T;
  /**
   * Set true ONLY when no HTTP request reached the provider — a missing API
   * key, a refusal before the fetch. Absent or false settles at cost. An
   * ambiguous outcome (timeout, network error, non-2xx) is NOT this: the
   * request may well have been served and billed.
   */
  neverCalled?: boolean;
  /** Provider-reported usage. Present ⇒ settlement charges the measured cost. */
  usage?: ProviderUsage | null;
  /** Anthropic `stop_reason`, used to classify how the call ended. */
  stopReason?: string | null;
  /** Overrides the derived reason (e.g. "PROVIDER_ERROR"). */
  terminationReason?: TerminationReason;
};

export type GuardSpec = {
  requestId: string;
  provider: string;
  model: string;
  searchType: string;
  userId?: string;
  budget: SearchBudget;
  /** Tokens the system prompt writes into the cache on a miss (cacheSystem). */
  cacheWriteTokens?: number;
};

/** Derive how the call ended, from what the provider reported. */
export function classifyTermination(
  searches: number,
  budget: SearchBudget,
  stopReason?: string | null,
): TerminationReason {
  if (searches >= budget.maxSearches) return "BUDGET_SEARCHES";
  if (stopReason === "max_tokens") return "BUDGET_TOKENS";
  return "COMPLETED";
}

/** Operator-facing refusal → the one line a user should see. */
export function refusalMessage(reason: RefusalReason): string {
  switch (reason) {
    case "daily-cap-reached":
      return "today's search budget is used up — back tomorrow 🌙";
    case "over-request-cap":
      return "that search is too big to run — try a narrower query";
    case "duplicate-request":
      return "that search is already running — hang tight";
    case "no-budget-configured":
    case "capability-disabled":
    case "guard-unavailable":
    case "unpriced-model":
    case "zero-estimate":
    case "no-model":
      return "search isn't configured yet — try again later";
    default:
      return ledgerRefusalMessage(reason).replace(/that's|that isn't/, "search is");
  }
}

/**
 * Reserve, call, settle — the SEARCH capability's entry point.
 *
 * Refusal reasons come from the ledger and are meant for operators, not users:
 * "no-budget-configured", "capability-disabled", "daily-cap-reached",
 * "over-request-cap", "duplicate-request", "admission-unavailable", plus
 * "unpriced-model" raised here when no published rate exists for the model.
 */
export async function withSearchSpendGuard<T>(
  rpc: ServiceRpc | null,
  spec: GuardSpec,
  run: () => Promise<ProviderRun<T>>,
): Promise<GuardedResult<T>> {
  if (!rpc) return { admitted: false, reason: "guard-unavailable" };

  let reservedUsd: number;
  try {
    reservedUsd = worstCaseUsd(spec.model, spec.budget, 0, spec.cacheWriteTokens ?? 0);
  } catch {
    // No published rate for this model. Refusing is the whole point.
    return { admitted: false, reason: "unpriced-model" };
  }
  if (!(reservedUsd > 0)) {
    // A zero reservation would let an unbounded call through on a technicality.
    return { admitted: false, reason: "zero-estimate" };
  }

  return withProviderSpendGuard(
    rpc,
    {
      requestId: spec.requestId,
      capability: "SEARCH",
      provider: spec.provider,
      model: spec.model,
      unit: "search+tokens",
      units: spec.budget.maxSearches,
      estimatedUsd: reservedUsd,
      userId: spec.userId,
      detail: { searchType: spec.searchType },
    },
    async () => {
      const outcome = await run();
      if (outcome.neverCalled === true) {
        return { value: outcome.value, neverCalled: true, outcome: "NOT_CALLED" as const };
      }
      const m = readUsage(outcome.usage);
      const actualUsd = outcome.usage ? actualUsdFromUsage(spec.model, m) : null;
      const termination =
        outcome.terminationReason ??
        classifyTermination(m.searches, spec.budget, outcome.stopReason);
      return {
        value: outcome.value,
        // undefined ⇒ the ledger charges the estimate. Never 0.
        actualUsd: actualUsd ?? undefined,
        unitsActual: m.searches,
        outcome: termination === "PROVIDER_ERROR" ? ("FAILED" as const) : ("ACCEPTED" as const),
        detail: {
          searchType: spec.searchType,
          searchCount: m.searches,
          llmCalls: 1,
          inputTokens: m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens,
          outputTokens: m.outputTokens,
          cacheHits: m.cacheReadTokens > 0 ? 1 : 0,
          terminationReason: termination,
        },
      };
    },
  );
}
