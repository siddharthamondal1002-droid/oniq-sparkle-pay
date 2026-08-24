/**
 * Search spend guard — depth bounds, cost estimation, and admission.
 *
 * The invariant these defend: NO SEARCH REQUEST CAN BYPASS THE GLOBAL SPEND
 * GUARD. The old control was a module-scope Map (10/min per isolate, reset on
 * cold start), which bounded one isolate and left fleet spend unbounded at a
 * measured ₹15.76–₹38.24 per query.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CACHE_READ_MULTIPLIER,
  DEFAULT_SEARCH_BUDGET,
  MODEL_RATES,
  USD_PER_WEB_SEARCH,
  admitSearchSpend,
  estimateSearchUsd,
  newCounters,
  releaseSearchSpend,
  settleSearchSpend,
  shouldStop,
  worstCaseUsd,
} from "../../../supabase/functions/_shared/searchBudget.ts";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260824050000_search_spend_guard.sql"),
  "utf8",
);

describe("published rates", () => {
  it("pins the web-search fee actually charged", () => {
    expect(USD_PER_WEB_SEARCH).toBeCloseTo(0.01, 6); // $10 per 1,000
  });

  it("pins Opus 5 and Haiku 4.5 at their published rates", () => {
    expect(MODEL_RATES["claude-opus-5"]).toEqual({ inUsd: 5 / 1e6, outUsd: 25 / 1e6 });
    expect(MODEL_RATES["claude-haiku-4-5"]).toEqual({ inUsd: 1 / 1e6, outUsd: 5 / 1e6 });
  });

  it("keeps cache reads at a tenth of input", () => {
    expect(CACHE_READ_MULTIPLIER).toBe(0.1);
  });
});

describe("estimateSearchUsd", () => {
  it("reproduces the measured current-path cost at the 11-search cap", () => {
    const usd = estimateSearchUsd({
      model: "claude-opus-5",
      searches: 11,
      inputTokens: 40_000 + 286,
      outputTokens: 3_500,
      cachedInputTokens: 1_286,
    });
    // ₹38.24 at FX 95.68 — the figure the whole cost case rests on.
    expect(usd).toBeGreaterThan(0.39);
    expect(usd).toBeLessThan(0.41);
  });

  it("throws rather than guessing for an unpriced model", () => {
    expect(() =>
      estimateSearchUsd({ model: "mystery", searches: 1, inputTokens: 1, outputTokens: 1 }),
    ).toThrow(/no published rate/);
  });

  it("makes Haiku materially cheaper than Opus for identical work", () => {
    const shape = { searches: 6, inputTokens: 20_000, outputTokens: 1_600 };
    const opus = estimateSearchUsd({ model: "claude-opus-5", ...shape });
    const haiku = estimateSearchUsd({ model: "claude-haiku-4-5", ...shape });
    expect(haiku).toBeLessThan(opus * 0.45);
  });

  it("counts the search fee even when no tokens are spent", () => {
    const usd = estimateSearchUsd({
      model: "claude-haiku-4-5",
      searches: 3,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(usd).toBeCloseTo(0.03, 6);
  });
});

describe("bounded depth", () => {
  it("defaults well below the old 11-search cap", () => {
    expect(DEFAULT_SEARCH_BUDGET.maxSearches).toBeLessThanOrEqual(4);
  });

  it("bounds every runaway dimension, not just searches", () => {
    for (const k of [
      "maxSearches",
      "maxProviderCalls",
      "maxLlmCalls",
      "maxInputTokens",
      "maxOutputTokens",
      "maxWallClockMs",
      "maxEstimatedUsd",
    ] as const) {
      expect(DEFAULT_SEARCH_BUDGET[k]).toBeGreaterThan(0);
    }
  });

  it("worst case under the default budget stays under the per-request cap", () => {
    // 0.50 is search_budget_config.request_usd_cap's default in the migration.
    expect(worstCaseUsd("claude-opus-5", DEFAULT_SEARCH_BUDGET)).toBeLessThan(0.5);
  });
});

describe("shouldStop", () => {
  const M = "claude-haiku-4-5";

  it("continues when nothing is exhausted", () => {
    expect(shouldStop(newCounters(), DEFAULT_SEARCH_BUDGET, M)).toBeNull();
  });

  it("stops early on sufficient evidence, before any budget is hit", () => {
    expect(shouldStop(newCounters(), DEFAULT_SEARCH_BUDGET, M, true)).toBe("SUFFICIENT_EVIDENCE");
  });

  it("stops at the search ceiling", () => {
    const c = { ...newCounters(), searches: DEFAULT_SEARCH_BUDGET.maxSearches };
    expect(shouldStop(c, DEFAULT_SEARCH_BUDGET, M)).toBe("BUDGET_SEARCHES");
  });

  it("stops on tokens", () => {
    const c = { ...newCounters(), inputTokens: DEFAULT_SEARCH_BUDGET.maxInputTokens };
    expect(shouldStop(c, DEFAULT_SEARCH_BUDGET, M)).toBe("BUDGET_TOKENS");
  });

  it("stops on wall clock", () => {
    const start = Date.now();
    const c = { ...newCounters(start), searches: 1 };
    const later = start + DEFAULT_SEARCH_BUDGET.maxWallClockMs + 1;
    expect(shouldStop(c, DEFAULT_SEARCH_BUDGET, M, false, later)).toBe("BUDGET_WALLCLOCK");
  });

  it("stops on estimated spend even when hop and token counts allow more", () => {
    const budget = { ...DEFAULT_SEARCH_BUDGET, maxEstimatedUsd: 0.005 };
    const c = { ...newCounters(), searches: 1 };
    expect(shouldStop(c, budget, M)).toBe("BUDGET_USD");
  });
});

describe("admission — the guard itself", () => {
  const okRpc = async () => ({
    data: { ok: true, reason: "admitted", remainingUsd: 4.9 },
    error: null,
  });

  it("admits when the ledger says yes", async () => {
    const a = await admitSearchSpend(okRpc, {
      requestId: "r1",
      estimatedUsd: 0.08,
      provider: "anthropic",
    });
    expect(a.ok).toBe(true);
    expect(a.remainingUsd).toBe(4.9);
  });

  it("REFUSES when the database errors — a guard that opens on failure is not a guard", async () => {
    const a = await admitSearchSpend(
      async () => ({ data: null, error: { message: "connection lost" } }),
      { requestId: "r2", estimatedUsd: 0.08, provider: "anthropic" },
    );
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("admission-unavailable");
  });

  it("REFUSES when the RPC throws", async () => {
    const a = await admitSearchSpend(
      async () => {
        throw new Error("boom");
      },
      { requestId: "r3", estimatedUsd: 0.08, provider: "anthropic" },
    );
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("admission-unavailable");
  });

  it("propagates a refusal reason unchanged", async () => {
    const a = await admitSearchSpend(
      async () => ({
        data: { ok: false, reason: "daily-cap-reached", remainingUsd: 0 },
        error: null,
      }),
      { requestId: "r4", estimatedUsd: 0.08, provider: "anthropic" },
    );
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("daily-cap-reached");
  });

  it("passes every telemetry field through on settle, and never a secret", async () => {
    let sent: Record<string, unknown> = {};
    await settleSearchSpend(
      async (_fn, args) => {
        sent = args;
        return { data: {}, error: null };
      },
      "r5",
      {
        searchCount: 3,
        llmCalls: 1,
        inputTokens: 900,
        outputTokens: 400,
        cacheHits: 1,
        terminationReason: "SUFFICIENT_EVIDENCE",
      },
    );
    expect(sent._search_count).toBe(3);
    expect(sent._termination_reason).toBe("SUFFICIENT_EVIDENCE");
    // Unknown actual cost is recorded as unknown, not back-filled.
    expect(sent._actual_usd).toBeNull();
    expect(JSON.stringify(sent)).not.toMatch(/sk-|api[_-]?key|authorization/i);
  });

  it("swallows settle/release failures rather than throwing into the request path", async () => {
    const bad = async () => {
      throw new Error("down");
    };
    await expect(
      settleSearchSpend(bad, "r6", {
        searchCount: 0,
        llmCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheHits: 0,
        terminationReason: "COMPLETED",
      }),
    ).resolves.toBeUndefined();
    await expect(releaseSearchSpend(bad, "r6")).resolves.toBeUndefined();
  });
});

describe("the migration enforces what the module assumes", () => {
  it("fails closed when no budget row is configured", () => {
    expect(MIGRATION).toMatch(/no-budget-configured/);
    expect(MIGRATION).toMatch(/FAIL CLOSED/i);
  });

  it("takes a row lock so concurrent workers cannot both spend the same budget", () => {
    expect(MIGRATION).toMatch(/from public\.search_spend_day where day = today for update/);
  });

  it("counts reservations against the cap, not just settled spend", () => {
    expect(MIGRATION).toMatch(/committed\s*:=\s*day_row\.reserved_usd \+ day_row\.settled_usd/);
  });

  it("is idempotent per request id", () => {
    expect(MIGRATION).toMatch(/duplicate-request/);
    expect(MIGRATION).toMatch(/search_spend_ledger_request_uk/);
  });

  it("does not invent a business budget — the cap has no default", () => {
    expect(MIGRATION).toMatch(/daily_usd_cap\s+numeric\(10, 4\) not null\b(?!\s+default)/);
  });

  it("never exposes the ledger or the ceiling to a client", () => {
    expect(MIGRATION).toMatch(
      /revoke all on public\.search_budget_config from anon, authenticated/,
    );
    expect(MIGRATION).toMatch(
      /revoke all on public\.search_spend_ledger\s+from anon, authenticated/,
    );
    expect(MIGRATION).toMatch(/revoke all on function public\.admit_search_spend/);
  });

  it("keeps an unknown provider cost unknown instead of zeroing it", () => {
    expect(MIGRATION).toMatch(/charge\s*:=\s*coalesce\(_actual_usd, led\.estimated_usd\)/);
  });

  it("uses the house security-definer + fixed search_path shape", () => {
    const defs = MIGRATION.match(/security definer/g) ?? [];
    expect(defs.length).toBe(3);
    const paths = MIGRATION.match(/set search_path = public/g) ?? [];
    expect(paths.length).toBe(3);
  });
});
