// searchGuard — the seam every billable search/AI call goes through.
//
// WHY A WRAPPER AND NOT THREE CALLS AT EACH SITE. The invariant is "no provider
// call without a valid spend reservation". Three separate calls at each site
// (admit, then fetch, then settle) can be got wrong four different ways —
// forget the admit, ignore its verdict, forget the settle, release after a call
// actually happened. Here the provider call is a CALLBACK: it cannot run before
// admission because admission gates the callback, and it cannot skip settlement
// because settlement is on the way out.
//
// The default direction on every ambiguity is to CHARGE. A reservation only
// comes back when the callback says, explicitly, that nothing left the box.

import {
  type SearchBudget,
  type TerminationReason,
  actualUsdFromUsage,
  admitSearchSpend,
  type ProviderUsage,
  readUsage,
  releaseSearchSpend,
  settleSearchSpend,
  worstCaseUsd,
} from "./searchBudget.ts";

/** How long admission may take before the request is refused. */
const RPC_TIMEOUT_MS = 5000;

// This module is imported by vitest (which runs on Node) as well as by the edge
// functions (which run on Deno), because the coverage tests read and exercise
// it. `| undefined` is load-bearing: it forces the typeof guard in
// serviceRoleRpc, so "no Deno runtime" resolves to null — no ledger, no
// admission — rather than throwing.
declare const Deno: { env: { get(key: string): string | undefined } } | undefined;

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
 * `search_budget_config.request_usd_cap`. Making this tighter needs a real page
 * count, which means parsing the PDF, which is not free either.
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

export type ServiceRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

/**
 * Service-role PostgREST adapter for the guard's three functions.
 *
 * Returns null when the service role is not configured. A null is NOT a licence
 * to proceed unguarded — every caller must refuse the request, because
 * "configuration missing" resolving to "spend freely" is precisely the bug the
 * ledger exists to make impossible.
 *
 * Never logs, echoes, or returns the key. Errors carry an HTTP status and the
 * function name and nothing else.
 */
export function serviceRoleRpc(): ServiceRpc | null {
  if (typeof Deno === "undefined") return null;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return async (fn, args) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(args),
        signal: ac.signal,
      });
      const text = await res.text().catch(() => "");
      if (!res.ok) return { data: null, error: { message: `${fn} http ${res.status}` } };
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        return { data: null, error: { message: `${fn} unparseable response` } };
      }
      return { data, error: null };
    } catch (e) {
      const why = (e as Error)?.name === "AbortError" ? "timeout" : "network";
      return { data: null, error: { message: `${fn} ${why}` } };
    } finally {
      clearTimeout(t);
    }
  };
}

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

export type GuardedResult<T> =
  | { admitted: true; value: T; reservedUsd: number; actualUsd: number | null }
  | { admitted: false; reason: string; remainingUsd?: number };

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

/**
 * Reserve, call, settle. The only path to a billable provider call.
 *
 * Refusal reasons come straight from the ledger and are meant to be shown to
 * operators, not users: "no-budget-configured", "disabled", "daily-cap-reached",
 * "over-request-cap", "duplicate-request", "admission-unavailable", plus
 * "unpriced-model" and "guard-unavailable" raised here.
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
    return { admitted: false, reason: "zero-reservation" };
  }

  const admission = await admitSearchSpend(rpc, {
    requestId: spec.requestId,
    estimatedUsd: reservedUsd,
    provider: spec.provider,
    model: spec.model,
    searchType: spec.searchType,
    userId: spec.userId,
  });
  if (!admission.ok) {
    return { admitted: false, reason: admission.reason, remainingUsd: admission.remainingUsd };
  }

  let outcome: ProviderRun<T>;
  try {
    outcome = await run();
  } catch (e) {
    // The callback threw AFTER a reservation existed. We do not know whether
    // the provider was reached, so the reservation is charged, not returned.
    await settleSearchSpend(rpc, spec.requestId, {
      searchCount: 0,
      llmCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      cacheHits: 0,
      terminationReason: "PROVIDER_ERROR",
    });
    throw e;
  }

  if (outcome.neverCalled === true) {
    await releaseSearchSpend(rpc, spec.requestId);
    return { admitted: true, value: outcome.value, reservedUsd, actualUsd: 0 };
  }

  const m = readUsage(outcome.usage);
  const actualUsd = outcome.usage ? actualUsdFromUsage(spec.model, m) : null;
  await settleSearchSpend(rpc, spec.requestId, {
    searchCount: m.searches,
    llmCalls: 1,
    inputTokens: m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens,
    outputTokens: m.outputTokens,
    cacheHits: m.cacheReadTokens > 0 ? 1 : 0,
    terminationReason:
      outcome.terminationReason ?? classifyTermination(m.searches, spec.budget, outcome.stopReason),
    // undefined ⇒ the ledger charges the estimate. Never 0.
    actualUsd: actualUsd ?? undefined,
  });
  return { admitted: true, value: outcome.value, reservedUsd, actualUsd };
}

/**
 * A stable id for one guarded request.
 *
 * A client-supplied id is honoured because reusing one is REFUSED
 * ("duplicate-request"), which fails in the safe direction — a retry with the
 * same id cannot double-reserve. A fresh uuid is the fallback.
 */
export function requestIdFrom(raw: unknown): string {
  if (typeof raw === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw)) return raw;
  return crypto.randomUUID();
}

/** Operator-facing refusal → the one line a user should see. */
export function refusalMessage(reason: string): string {
  switch (reason) {
    case "daily-cap-reached":
      return "today's search budget is used up — back tomorrow 🌙";
    case "over-request-cap":
      return "that search is too big to run — try a narrower query";
    case "duplicate-request":
      return "that search is already running — hang tight";
    case "no-budget-configured":
    case "disabled":
    case "guard-unavailable":
    case "unpriced-model":
    case "zero-reservation":
      return "search isn't configured yet — try again later";
    default:
      // "admission-unavailable" and anything new. Fail closed, say so plainly.
      return "search is unavailable right now — try again in a moment";
  }
}
