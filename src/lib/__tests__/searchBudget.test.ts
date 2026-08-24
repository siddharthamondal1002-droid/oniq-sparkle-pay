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
  estimateSearchUsd,
  newCounters,
  shouldStop,
  worstCaseUsd,
} from "../../../supabase/functions/_shared/searchBudget.ts";

// The CENTRAL ledger. 20260824050000 built a search-only one; this supersedes
// it, and asserting against the superseded file would be checking a migration
// that no longer governs anything.
const LEDGER = readFileSync(
  join(process.cwd(), "supabase/migrations/20260824120000_provider_spend_ledger.sql"),
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

describe("the central ledger enforces what the module assumes", () => {
  it("fails closed when no budget row is configured", () => {
    expect(LEDGER).toMatch(/no-budget-configured/);
    expect(LEDGER).toMatch(/FAIL CLOSED/i);
  });

  it("ships with generation OFF — enabled defaults to false", () => {
    expect(LEDGER).toMatch(/enabled\s+boolean\s+not null default false/);
    expect(LEDGER).toMatch(/capability-disabled/);
  });

  it("takes a row lock so concurrent workers cannot both spend the same budget", () => {
    expect(LEDGER).toMatch(/where day = today and capability = _capability for update/);
    // The job row is locked too, or two retries of the same shot could both
    // pass an attempt check that neither had yet incremented.
    expect(LEDGER).toMatch(/from public\.provider_spend_job where job_id = _job_id for update/);
  });

  it("counts reservations against the cap, not just settled spend", () => {
    expect(LEDGER).toMatch(/committed\s*:=\s*day_row\.reserved_usd \+ day_row\.settled_usd/);
    expect(LEDGER).toMatch(/job_committed\s*:=\s*job_row\.reserved_usd \+ job_row\.settled_usd/);
  });

  it("bounds retries in the database, not in a caller's loop", () => {
    expect(LEDGER).toMatch(/job-attempts-exhausted/);
    expect(LEDGER).toMatch(/max_attempts_per_job\s+integer\s+not null default 3/);
  });

  it("has three ceilings — request, job and day", () => {
    for (const reason of ["over-request-cap", "job-cap-reached", "daily-cap-reached"]) {
      expect(LEDGER, reason).toMatch(new RegExp(reason));
    }
  });

  it("refuses a zero reservation — an unpriced call is not a free call", () => {
    expect(LEDGER).toMatch(/zero-estimate/);
  });

  it("is idempotent per request id", () => {
    expect(LEDGER).toMatch(/duplicate-request/);
    expect(LEDGER).toMatch(/provider_spend_ledger_request_uk/);
  });

  it("does not invent a business budget — no money column has a default", () => {
    expect(LEDGER).toMatch(/daily_usd_cap\s+numeric\(10, 4\) not null\b(?!\s+default)/);
    expect(LEDGER).toMatch(/request_usd_cap numeric\(10, 4\) not null\b(?!\s+default)/);
    expect(LEDGER).toMatch(/job_usd_cap\s+numeric\(10, 4\) not null\b(?!\s+default)/);
  });

  it("never exposes the ledger or the ceiling to a client", () => {
    expect(LEDGER).toMatch(/revoke all on public\.provider_budget_config from anon, authenticated/);
    expect(LEDGER).toMatch(
      /revoke all on public\.provider_spend_ledger\s+from anon, authenticated/,
    );
    expect(LEDGER).toMatch(/revoke all on function public\.admit_provider_spend/);
  });

  it("keeps an unknown provider cost unknown instead of zeroing it", () => {
    expect(LEDGER).toMatch(/charge\s*:=\s*coalesce\(_actual_usd, led\.estimated_usd\)/);
  });

  it("uses the house security-definer + fixed search_path shape", () => {
    // admit, settle, release, record_outcome.
    const defs = LEDGER.match(/security definer/g) ?? [];
    expect(defs.length).toBe(4);
    const paths = LEDGER.match(/set search_path = public/g) ?? [];
    expect(paths.length).toBe(4);
  });

  it("supersedes the search-only ledger rather than running two of them", () => {
    // Two accounting systems is two places for the check to drift from the
    // spend. The old tables are carried over and dropped, in that order.
    expect(LEDGER).toMatch(
      /insert into public\.provider_spend_ledger[\s\S]*from public\.search_spend_ledger/,
    );
    expect(LEDGER).toMatch(/drop table if exists public\.search_spend_ledger/);
    expect(LEDGER).toMatch(/drop function if exists public\.admit_search_spend/);
  });
});
