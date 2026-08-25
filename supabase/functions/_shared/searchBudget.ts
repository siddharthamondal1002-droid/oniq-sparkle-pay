// searchBudget — bounded search depth + durable, fleet-wide spend admission.
//
// TWO SEPARATE PROBLEMS, both measured on 2026-08-24:
//
// 1. DEPTH. smart-scout allowed `max_uses: 11` Anthropic web searches per
//    query on claude-opus-5, measured at $0.165-$0.400 per query. `max_uses`
//    alone is not a budget: it bounds searches and nothing else, while the
//    trace found TOKENS are 72% of the cost at the cap, because results
//    re-enter context on every hop.
//
//    USD, deliberately. Anthropic publishes in USD, the ledger settles in USD,
//    and an FX rate is a second independently-moving number that has no place
//    in a budget decision. Any INR presentation is a reporting-time conversion
//    carrying its own source and timestamp.
//
// 2. BREADTH. The only spend control was a module-scope `Map` — 10/min PER
//    ISOLATE, reset on cold start. Fleet-wide spend was unbounded. The fix has
//    to be durable and atomic, which means the database, not this file.
//
// This module owns the ESTIMATE and the SHAPE for SEARCH. The ceiling lives in
// Postgres (`admit_provider_spend`) because only the database can make
// check-then-spend atomic across isolates — and it is shared with every other
// capability ONIQ pays for, so there is one ledger rather than one per feature.

/** Authoritative, verified 2026-08-24 from platform.claude.com pricing. */
export const USD_PER_WEB_SEARCH = 10 / 1000;

/**
 * USD per input/output token, by model id. Cache reads are 0.1x input.
 *
 * Every rate here is copied from platform.claude.com/docs/en/about-claude/pricing.
 * A model ONIQ calls but that is ABSENT from this table is not "free" and not
 * "probably about the same" — estimateSearchUsd throws, admission refuses, and
 * the owner has to add a verified rate. That is the point: an unpriced model is
 * one nobody can budget for.
 *
 * `claude-sonnet-4-6` verified 2026-08-24: $3/MTok in, $15/MTok out. It is the
 * model health-scan runs on, and it was the one model in the fleet this table
 * could not price.
 */
export const MODEL_RATES: Record<string, { inUsd: number; outUsd: number }> = {
  "claude-opus-5": { inUsd: 5 / 1e6, outUsd: 25 / 1e6 },
  "claude-sonnet-5": { inUsd: 2 / 1e6, outUsd: 10 / 1e6 },
  "claude-sonnet-4-6": { inUsd: 3 / 1e6, outUsd: 15 / 1e6 },
  "claude-haiku-4-5": { inUsd: 1 / 1e6, outUsd: 5 / 1e6 },
  // Google, added 2026-08-25 for the Anthropic-credit-exhaustion failover.
  // $0.10 / MTok in, $0.40 / MTok out. See GEMINI_PRICING_PROVENANCE below —
  // this rate is corroborated but was NOT read from a primary Google page,
  // because every Google documentation host is egress-blocked here.
  "gemini-2.5-flash-lite": { inUsd: 0.1 / 1e6, outUsd: 0.4 / 1e6 },
};

/** The stable id. NOT `-preview-09-2025`, which Google shut down 2026-03-31. */
export const GEMINI_FAILOVER_MODEL = "gemini-2.5-flash-lite";

/**
 * How the Gemini rate above was established, recorded because it is weaker
 * evidence than every Anthropic rate in this table and a future reader must
 * not mistake the two.
 *
 * `platform.claude.com` is reachable from the build container, so the Anthropic
 * rates were read off the published pricing page. `ai.google.dev`,
 * `cloud.google.com`, `docs.cloud.google.com` and `developers.googleblog.com`
 * are ALL blocked by the network egress proxy, so no primary Google page could
 * be opened. Two independently-worded web searches returned $0.10/$0.40 per
 * MTok, both attributing it to Google's own GA announcement, and the owner
 * stated the same two figures in the directive. That is three agreeing
 * secondary readings, not one primary one.
 */
export const GEMINI_PRICING_PROVENANCE = "corroborated-secondary" as const;

/**
 * USD per web search, BY MODEL. `null` means "ONIQ cannot price a search on
 * this model", which is not the same as free.
 *
 * Anthropic bills its server-side `web_search_20250305` tool at a flat
 * $10/1,000. Google bills Grounding with Google Search separately from tokens,
 * and the figure could not be established: the two searches that returned a
 * number disagreed ($14 per 1,000 vs $35 per 1,000), the free allowance and
 * the per-query-vs-per-prompt counting rule differ by model generation, and
 * no primary Google page was reachable to settle it.
 *
 * So a Gemini call that SEARCHES is refused rather than reserved against a
 * guessed rate. A Gemini call that does not search is priced exactly, because
 * tokens are the whole bill. This is the difference between "we have not
 * priced this model" and "this model cannot do this priced thing".
 */
export const SEARCH_UNIT_USD_BY_MODEL: Record<string, number | null> = {
  "claude-opus-5": USD_PER_WEB_SEARCH,
  "claude-sonnet-5": USD_PER_WEB_SEARCH,
  "claude-sonnet-4-6": USD_PER_WEB_SEARCH,
  "claude-haiku-4-5": USD_PER_WEB_SEARCH,
  "gemini-2.5-flash-lite": null,
};

/** Thrown when a model is priced for tokens but not for the searches asked of it. */
export const UNPRICED_SEARCH_UNIT = "unpriced-search-unit";

/**
 * Per-search rate for a model. `undefined` (model absent) falls back to the
 * Anthropic rate so pre-existing behaviour for unlisted Claude ids is
 * unchanged; an EXPLICIT `null` means unpriceable.
 */
export function searchUnitUsdFor(model: string): number | null {
  const v = SEARCH_UNIT_USD_BY_MODEL[model];
  return v === undefined ? USD_PER_WEB_SEARCH : v;
}

export const CACHE_READ_MULTIPLIER = 0.1;

/**
 * 5-minute cache WRITE is 1.25x base input — it is not free, and it is what
 * `cacheSystem: true` pays on the first call of every cache window. Leaving it
 * out understated settlement on exactly the calls that miss the cache.
 */
export const CACHE_WRITE_5M_MULTIPLIER = 1.25;

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
  cacheWriteInputTokens?: number;
};

/**
 * Estimate USD for one search request. Unknown model = throw, never guess:
 * an unpriced model is one ONIQ cannot budget for, and returning 0 would
 * admit unlimited spend.
 */
export function estimateSearchUsd(c: CostInputs): number {
  const rate = MODEL_RATES[c.model];
  if (!rate) throw new Error(`no published rate for model ${c.model}`);
  // A search this model has no published search rate for cannot be reserved.
  // Only raised when searches are actually requested: a zero-search call on
  // such a model is fully priced by its token rates.
  const perSearch = searchUnitUsdFor(c.model);
  if (c.searches > 0 && perSearch === null) {
    throw new Error(`${UNPRICED_SEARCH_UNIT}: no published per-search rate for ${c.model}`);
  }
  const cached = c.cachedInputTokens ?? 0;
  const written = c.cacheWriteInputTokens ?? 0;
  return (
    c.searches * (perSearch ?? 0) +
    cached * rate.inUsd * CACHE_READ_MULTIPLIER +
    written * rate.inUsd * CACHE_WRITE_5M_MULTIPLIER +
    c.inputTokens * rate.inUsd +
    c.outputTokens * rate.outUsd
  );
}

/** Worst case for a budget — what admission must reserve. */
export function worstCaseUsd(
  model: string,
  b: SearchBudget,
  cachedInputTokens = 0,
  cacheWriteInputTokens = 0,
): number {
  return estimateSearchUsd({
    model,
    searches: b.maxSearches,
    inputTokens: b.maxInputTokens,
    outputTokens: b.maxOutputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
  });
}

/**
 * Anthropic's `usage` block, as far as billing is concerned.
 *
 * `input_tokens` EXCLUDES both cache figures — Anthropic reports the three
 * separately and they are priced at three different rates, so adding them up
 * as one number would misprice every cached call.
 */
export type ProviderUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  server_tool_use?: { web_search_requests?: unknown } | null;
};

export type MeasuredUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  searches: number;
};

function nonNegInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Read a provider usage block. Missing fields are 0 COUNTS, never 0 COST. */
export function readUsage(u: ProviderUsage | null | undefined): MeasuredUsage {
  const uu = (u ?? {}) as ProviderUsage;
  return {
    inputTokens: nonNegInt(uu.input_tokens),
    outputTokens: nonNegInt(uu.output_tokens),
    cacheReadTokens: nonNegInt(uu.cache_read_input_tokens),
    cacheWriteTokens: nonNegInt(uu.cache_creation_input_tokens),
    searches: nonNegInt(uu.server_tool_use?.web_search_requests),
  };
}

/**
 * What the call ACTUALLY cost, from what the provider reported it used.
 *
 * This is a DERIVED actual, not a provider-quoted invoice line: Anthropic
 * reports token counts and search counts, not dollars, so the dollars come from
 * multiplying measured counts by published rates. It is exact given both, and
 * it is why settlement can pass a real `actualUsd` instead of leaving the
 * reservation to stand. Returns null when the model is unpriced — a null here
 * means "unknown", and the ledger then charges the ESTIMATE, never zero.
 */
export function actualUsdFromUsage(model: string, m: MeasuredUsage): number | null {
  if (!MODEL_RATES[model]) return null;
  return estimateSearchUsd({
    model,
    searches: m.searches,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cachedInputTokens: m.cacheReadTokens,
    cacheWriteInputTokens: m.cacheWriteTokens,
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
//
// GONE, DELIBERATELY. This module used to carry admitSearchSpend /
// settleSearchSpend / releaseSearchSpend, each calling a search-only SQL
// function. The accounting now lives in _shared/financialLedger.ts, which every
// capability shares, and searchGuard.ts is the SEARCH adapter over it.
//
// Leaving the old wrappers here would have left two sets of names for one
// ledger — which is how a check drifts away from the spend it is supposed to
// gate. What stays in this file is what is genuinely search-specific: the
// published rates, the depth budget, and turning provider-reported usage into
// dollars.
