// searchBudget — bounded search depth + durable, fleet-wide spend admission.
//
// TWO SEPARATE PROBLEMS, both measured on 2026-08-24:
//
// 1. DEPTH. smart-scout allowed `max_uses: 11` Anthropic web searches per
//    query on claude-opus-5, measured at ₹15.76–₹38.24/query. `max_uses` alone
//    is not a budget: it bounds searches and nothing else, while the trace
//    found TOKENS are 72% of the cost at the cap, because results re-enter
//    context on every hop.
//
// 2. BREADTH. The only spend control was a module-scope `Map` — 10/min PER
//    ISOLATE, reset on cold start. Fleet-wide spend was unbounded. The fix has
//    to be durable and atomic, which means the database, not this file.
//
// This module owns the ESTIMATE and the SHAPE. The ceiling lives in Postgres
// (`admit_search_spend`) because only the database can make check-then-spend
// atomic across isolates.

/** Authoritative, verified 2026-08-24 from platform.claude.com pricing. */
export const USD_PER_WEB_SEARCH = 10 / 1000;

/** USD per input/output token, by model id. Cache reads are 0.1x input. */
export const MODEL_RATES: Record<string, { inUsd: number; outUsd: number }> = {
  "claude-opus-5": { inUsd: 5 / 1e6, outUsd: 25 / 1e6 },
  "claude-sonnet-5": { inUsd: 2 / 1e6, outUsd: 10 / 1e6 },
  "claude-haiku-4-5": { inUsd: 1 / 1e6, outUsd: 5 / 1e6 },
};

export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * A complete budget. `maxSearches` alone was the old control and it was not
 * enough — every dimension that can run away has a ceiling here.
 */
export type SearchBudget = {
  maxSearches: number;
  maxProviderCalls: number;
  maxLlmCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxWallClockMs: number;
  maxEstimatedUsd: number;
};

/**
 * Default depth. Deliberately 4, not 11.
 *
 * The trace showed cost is superlinear in hops because each hop's results are
 * re-sent as input on the next. 4 covers "per-store searches across the major
 * retailers plus one cross-check" — which is what the system prompt actually
 * asks for — at roughly half the cap-case cost. It is a starting ceiling to be
 * tuned against measured `searches_attempted`, NOT a claim that 4 is optimal.
 */
export const DEFAULT_SEARCH_BUDGET: SearchBudget = {
  maxSearches: 4,
  maxProviderCalls: 6,
  maxLlmCalls: 2,
  maxInputTokens: 24_000,
  maxOutputTokens: 3_500,
  maxWallClockMs: 120_000,
  maxEstimatedUsd: 0.08,
};

export type CostInputs = {
  model: string;
  searches: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

/**
 * Estimate USD for one search request. Unknown model = throw, never guess:
 * an unpriced model is one ONIQ cannot budget for, and returning 0 would
 * admit unlimited spend.
 */
export function estimateSearchUsd(c: CostInputs): number {
  const rate = MODEL_RATES[c.model];
  if (!rate) throw new Error(`no published rate for model ${c.model}`);
  const cached = c.cachedInputTokens ?? 0;
  return (
    c.searches * USD_PER_WEB_SEARCH +
    cached * rate.inUsd * CACHE_READ_MULTIPLIER +
    c.inputTokens * rate.inUsd +
    c.outputTokens * rate.outUsd
  );
}

/** Worst case for a budget — what admission must reserve. */
export function worstCaseUsd(model: string, b: SearchBudget, cachedInputTokens = 0): number {
  return estimateSearchUsd({
    model,
    searches: b.maxSearches,
    inputTokens: b.maxInputTokens,
    outputTokens: b.maxOutputTokens,
    cachedInputTokens,
  });
}

// ------------------------------------------------------------ termination
export type TerminationReason =
  | "SUFFICIENT_EVIDENCE"
  | "BUDGET_SEARCHES"
  | "BUDGET_TOKENS"
  | "BUDGET_USD"
  | "BUDGET_WALLCLOCK"
  | "PROVIDER_ERROR"
  | "COMPLETED";

export type SpendCounters = {
  searches: number;
  providerCalls: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
};

export function newCounters(now = Date.now()): SpendCounters {
  return {
    searches: 0,
    providerCalls: 0,
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    startedAt: now,
  };
}

/**
 * Should retrieval stop? Returns a reason, or null to continue.
 *
 * `sufficientEvidence` is passed in by the caller — early termination is a
 * domain judgement (enough merchants found, enough authoritative sources)
 * and does not belong in a budget module.
 */
export function shouldStop(
  c: SpendCounters,
  b: SearchBudget,
  model: string,
  sufficientEvidence = false,
  now = Date.now(),
): TerminationReason | null {
  if (sufficientEvidence) return "SUFFICIENT_EVIDENCE";
  if (c.searches >= b.maxSearches) return "BUDGET_SEARCHES";
  if (c.inputTokens >= b.maxInputTokens || c.outputTokens >= b.maxOutputTokens) {
    return "BUDGET_TOKENS";
  }
  if (now - c.startedAt >= b.maxWallClockMs) return "BUDGET_WALLCLOCK";
  const spent = estimateSearchUsd({
    model,
    searches: c.searches,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
  });
  if (spent >= b.maxEstimatedUsd) return "BUDGET_USD";
  return null;
}

// ------------------------------------------------------------ admission
export type Admission = {
  ok: boolean;
  reason: string;
  remainingUsd?: number;
  dailyCapUsd?: number;
};

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

/**
 * Reserve budget BEFORE the provider call. Any failure — including a database
 * error — refuses admission. A spend guard that opens when it cannot reach its
 * own ledger is not a guard.
 */
export async function admitSearchSpend(
  rpc: Rpc,
  args: {
    requestId: string;
    estimatedUsd: number;
    provider: string;
    model?: string;
    searchType?: string;
    userId?: string;
  },
): Promise<Admission> {
  try {
    const { data, error } = await rpc("admit_search_spend", {
      _request_id: args.requestId,
      _estimated_usd: args.estimatedUsd,
      _provider: args.provider,
      _model: args.model ?? null,
      _search_type: args.searchType ?? null,
      _user_id: args.userId ?? null,
    });
    if (error) return { ok: false, reason: "admission-unavailable" };
    const d = (data ?? {}) as Record<string, unknown>;
    return {
      ok: d.ok === true,
      reason: typeof d.reason === "string" ? d.reason : "unknown",
      remainingUsd: typeof d.remainingUsd === "number" ? d.remainingUsd : undefined,
      dailyCapUsd: typeof d.dailyCapUsd === "number" ? d.dailyCapUsd : undefined,
    };
  } catch {
    return { ok: false, reason: "admission-unavailable" };
  }
}

export type Telemetry = {
  searchCount: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheHits: number;
  terminationReason: TerminationReason;
  actualUsd?: number;
};

export async function settleSearchSpend(rpc: Rpc, requestId: string, t: Telemetry): Promise<void> {
  try {
    await rpc("settle_search_spend", {
      _request_id: requestId,
      _actual_usd: t.actualUsd ?? null,
      _search_count: t.searchCount,
      _llm_calls: t.llmCalls,
      _input_tokens: t.inputTokens,
      _output_tokens: t.outputTokens,
      _cache_hits: t.cacheHits,
      _termination_reason: t.terminationReason,
    });
  } catch {
    // Settlement is best-effort. A lost settle leaves the reservation standing,
    // which over-counts spend — the safe direction to fail.
  }
}

/** ONLY when the provider was never called. */
export async function releaseSearchSpend(rpc: Rpc, requestId: string): Promise<void> {
  try {
    await rpc("release_search_spend", { _request_id: requestId });
  } catch {
    // Same reasoning as settle: a lost release over-counts, never under-counts.
  }
}
