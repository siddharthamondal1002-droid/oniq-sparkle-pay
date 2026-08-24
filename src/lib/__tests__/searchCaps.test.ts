/**
 * THE THREE SEARCH CAPS — owner directive of 2026-08-24.
 *
 *   request_usd_cap = 0.50   the most one search request may spend
 *   job_usd_cap     = 2.00   the most one job's search ladder may spend
 *   daily_usd_cap   = 20.00  the most all SEARCH may spend in a day
 *
 * WHY THIS FILE IS NOT videoCaps.test.ts WITH DIFFERENT NUMBERS. SEARCH has a
 * hazard VIDEO never had: the capability it replaced, `search_budget_config`,
 * shipped a request_usd_cap DEFAULT of 0.50 — the same figure the owner later
 * chose. Two numbers that agree by coincidence are the easiest place in a
 * codebase for an authority to be quietly swapped, because nothing looks
 * different afterwards. The owner's directive is the authority; the superseded
 * default is not, and the tests below are written so that a future edit which
 * re-derived these ceilings from the dropped table would still have to change
 * an assertion to do it.
 *
 * The second thing this file pins is the ORDER of deployment. SEARCH is
 * configured and DISABLED, four live edge functions fail closed on it, and
 * those two facts have to stay true together.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  effectiveJobSpendCap,
  providerBudgetStatus,
  roundUsd,
  validateBudgetCaps,
} from "../../../supabase/functions/_shared/financialLedger.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SEARCH_CEILINGS_SQL = read("supabase/migrations/20260824190000_search_spend_ceilings.sql");
const VIDEO_CEILINGS_SQL = read("supabase/migrations/20260824170000_video_spend_ceilings.sql");
const LEDGER_SQL = read("supabase/migrations/20260824120000_provider_spend_ledger.sql");
const INVARIANTS_SQL = read("supabase/migrations/20260824150000_provider_budget_invariants.sql");

/**
 * THE OWNER'S THREE NUMBERS — directive of 2026-08-24.
 *
 * Mirrored here so drift in either direction fails the build: a migration
 * edited away from what the owner authorised, or a test quietly re-pointed at
 * whatever the migration happens to say.
 */
const OWNER_SEARCH_CAPS = { request: "0.50", job: "2.00", daily: "20.00" } as const;

/** The owner set no attempt count for SEARCH, so the column default stands. */
const SCHEMA_DEFAULT_ATTEMPTS = 3;

// ==================================================== the owner's ceilings
describe("the owner's configured SEARCH ceilings", () => {
  it("stores exactly 0.50 / 2.00 / 20.00 for SEARCH, in USD", () => {
    const values = SEARCH_CEILINGS_SQL.match(
      /values\s*\n?\s*\(\s*'SEARCH'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*(true|false)\s*\)/i,
    );
    expect(values, "the SEARCH ceilings insert must be present and parseable").toBeTruthy();
    const [, request, job, daily, enabled] = values!;
    expect(request).toBe(OWNER_SEARCH_CAPS.request);
    expect(job).toBe(OWNER_SEARCH_CAPS.job);
    expect(daily).toBe(OWNER_SEARCH_CAPS.daily);
    // The whole point: caps configured, SEARCH still off.
    expect(enabled.toLowerCase()).toBe("false");
  });

  it("is a well-ordered, spendable triple by the same rules the database applies", () => {
    const caps = {
      requestUsdCap: Number(OWNER_SEARCH_CAPS.request),
      jobUsdCap: Number(OWNER_SEARCH_CAPS.job),
      dailyUsdCap: Number(OWNER_SEARCH_CAPS.daily),
      maxAttemptsPerJob: SCHEMA_DEFAULT_ATTEMPTS,
    };
    expect(validateBudgetCaps(caps).valid).toBe(true);
    // 0 < 0.50 <= 2.00 <= 20.00, asserted as the owner stated it.
    expect(caps.requestUsdCap).toBeGreaterThan(0);
    expect(caps.requestUsdCap).toBeLessThanOrEqual(caps.jobUsdCap);
    expect(caps.jobUsdCap).toBeLessThanOrEqual(caps.dailyUsdCap);
    for (const v of Object.values(caps)) expect(Number.isFinite(v)).toBe(true);
  });

  it("configures the ceilings WITHOUT enabling SEARCH, even on re-run", () => {
    const conflict = SEARCH_CEILINGS_SQL.slice(SEARCH_CEILINGS_SQL.search(/on conflict/i));
    const setClause = conflict.slice(0, conflict.indexOf(";"));
    expect(setClause).toMatch(/request_usd_cap\s*=\s*excluded\.request_usd_cap/);
    expect(setClause).toMatch(/job_usd_cap\s*=\s*excluded\.job_usd_cap/);
    expect(setClause).toMatch(/daily_usd_cap\s*=\s*excluded\.daily_usd_cap/);
    expect(setClause, "ON CONFLICT must never touch `enabled`").not.toMatch(/\benabled\s*=/);
  });

  it("takes the schema default for attempts rather than inventing a fourth number", () => {
    // The owner supplied three ceilings and no attempt count. Writing one here
    // would be an agent choosing how many times ONIQ retries a paid call.
    const insertColumns = SEARCH_CEILINGS_SQL.slice(
      SEARCH_CEILINGS_SQL.search(/insert into public\.provider_budget_config/i),
      SEARCH_CEILINGS_SQL.search(/values/i),
    );
    expect(insertColumns).not.toMatch(/max_attempts_per_job/);
    // ...and the default it therefore inherits is the one asserted below.
    expect(LEDGER_SQL).toMatch(
      new RegExp(`max_attempts_per_job\\s+integer\\s+not null default ${SCHEMA_DEFAULT_ATTEMPTS}`),
    );
  });

  it("carries no FX, no INR, and no second currency", () => {
    expect(SEARCH_CEILINGS_SQL).not.toMatch(/usdInr|inrPerUsd|fxRate|exchangeRate|_inr\b|₹/i);
    expect(SEARCH_CEILINGS_SQL).toMatch(/USD/);
  });

  it("verifies its own write rather than trusting the insert to have landed", () => {
    expect(SEARCH_CEILINGS_SQL).toMatch(/raise exception/i);
    expect(SEARCH_CEILINGS_SQL).toMatch(/is_spendable_usd/);
  });
});

// ======================================= the superseded table is not authority
describe("these numbers come from the owner, not from the table they replaced", () => {
  it("cannot be read from search_budget_config at runtime — it no longer exists", () => {
    // The strongest available guarantee that the dropped default is not the
    // authority: there is nothing left to read it from.
    expect(LEDGER_SQL).toMatch(/drop table if exists public\.search_budget_config/);
    expect(LEDGER_SQL).toMatch(/drop function if exists public\.admit_search_spend/);
  });

  it("writes the ceilings as literals, never selected from the old table", () => {
    // The INSERT statement alone — not the verification block after it, which
    // legitimately SELECTs the row back to check what landed.
    const from = SEARCH_CEILINGS_SQL.search(/insert into public\.provider_budget_config/i);
    const insert = SEARCH_CEILINGS_SQL.slice(from, SEARCH_CEILINGS_SQL.indexOf(";", from) + 1);
    expect(insert).toMatch(/values/i);
    expect(insert).not.toMatch(/search_budget_config/i);
    // A ceiling read out of another table is a ceiling nobody authorised.
    expect(insert).not.toMatch(/\bselect\b/i);
  });

  it("does not touch any capability but SEARCH", () => {
    // VIDEO is READ in this migration — the guard block asserts it was left
    // alone — so "mentions VIDEO" is legitimate and "writes VIDEO" is not.
    const writes = SEARCH_CEILINGS_SQL.slice(
      SEARCH_CEILINGS_SQL.search(/insert into public\.provider_budget_config/i),
      SEARCH_CEILINGS_SQL.search(/do \$\$/i),
    );
    const capabilities = [...writes.matchAll(/'(SEARCH|TEXT|IMAGE|VIDEO|VIDEO_AUDIO|TTS|OTHER)'/g)]
      .map((m) => m[1])
      .filter((c, i, a) => a.indexOf(c) === i);
    expect(capabilities).toEqual(["SEARCH"]);
  });

  it("asserts VIDEO's ceilings survived it, and they are still the owner's", () => {
    expect(SEARCH_CEILINGS_SQL).toMatch(/VIDEO ceilings changed/);
    // The figures this migration guards must be the ones VIDEO's own migration
    // writes, or the guard is checking a number nobody set.
    expect(VIDEO_CEILINGS_SQL).toMatch(/'VIDEO'\s*,\s*1\.00\s*,\s*5\.00\s*,\s*50\.00\s*,\s*3/);
  });
});

// ====================================================== reachable exposure
describe("SEARCH exposure: the ceiling and what the ladder can reach", () => {
  const request = Number(OWNER_SEARCH_CAPS.request);
  const job = Number(OWNER_SEARCH_CAPS.job);
  const daily = Number(OWNER_SEARCH_CAPS.daily);

  it("distinguishes the CONFIGURED ceiling from what the retry ladder can reach", () => {
    // min(2.00, 0.50 * 3) = 1.50. The $2.00 ceiling is a backstop above the
    // ladder, the same shape as VIDEO's $5.00 over $3.00.
    expect(effectiveJobSpendCap(request, job, SCHEMA_DEFAULT_ATTEMPTS)).toBe(1.5);
    expect(job).toBe(2.0); // the configured ceiling is unchanged, and stays
    expect(effectiveJobSpendCap(request, job, SCHEMA_DEFAULT_ATTEMPTS)).toBeLessThan(job);
  });

  it("proves a future retry increase can never bypass the job ceiling", () => {
    expect(effectiveJobSpendCap(request, job, 3)).toBe(1.5);
    expect(effectiveJobSpendCap(request, job, 4)).toBe(2.0); // ladder meets ceiling
    expect(effectiveJobSpendCap(request, job, 5)).toBe(2.0); // ceiling binds
    // The database refuses attempts above 10 outright, so bound the whole
    // legal range rather than a sample of it.
    for (let a = 1; a <= 10; a++) {
      expect(effectiveJobSpendCap(request, job, a)).toBeLessThanOrEqual(job);
    }
    expect(INVARIANTS_SQL).toMatch(/max_attempts_per_job between 1 and 10/);
  });

  it("and the daily ceiling still bounds the whole fleet above that", () => {
    expect(job).toBeLessThanOrEqual(daily);
    expect(effectiveJobSpendCap(request, job, SCHEMA_DEFAULT_ATTEMPTS)).toBeLessThanOrEqual(daily);
    // 40 requests of $0.50 is exactly the day; the 41st cannot be admitted.
    expect(roundUsd(request * 40)).toBe(daily);
  });

  it("computes exposure at the ledger's own precision, with no float dust", () => {
    // 0.5 * 3 is exact in IEEE-754, so pick inputs that are not.
    expect(effectiveJobSpendCap(0.1, 99, 3)).toBe(0.3);
    expect(roundUsd(effectiveJobSpendCap(request, job, 3))).toBe(1.5);
    expect(Number.isNaN(effectiveJobSpendCap(NaN, job, 3))).toBe(true);
    expect(Number.isNaN(effectiveJobSpendCap(request, Infinity, 3))).toBe(true);
  });

  it("does NOT require the job ceiling to be reachable", () => {
    expect(
      validateBudgetCaps({
        requestUsdCap: request,
        jobUsdCap: job,
        dailyUsdCap: daily,
        maxAttemptsPerJob: SCHEMA_DEFAULT_ATTEMPTS,
      }).valid,
    ).toBe(true);
  });
});

// ============================================ configured is not enabled
describe("CONFIGURED IS NOT ENABLED", () => {
  /**
   * The verdicts below are the ones real PostgreSQL 16.13 returned from
   * `provider_budget_status` after the migrations were applied, replayed
   * through an rpc double. They are transcribed, not invented — a fabricated
   * shape would let the mirror drift from the database it mirrors.
   */
  const CONFIGURED_BUT_OFF = {
    capability: "SEARCH",
    capsConfigured: true,
    generationAllowed: false,
    reason: "CAPABILITY_DISABLED",
    requestUsdCap: 0.5,
    jobUsdCap: 2.0,
    dailyUsdCap: 20.0,
    maxAttemptsPerJob: 3,
  };
  const NO_ROW = {
    capability: "SEARCH",
    capsConfigured: false,
    generationAllowed: false,
    reason: "SPEND_CAP_UNSET",
  };
  const rpcReturning = (verdict: Record<string, unknown>) => async () => ({
    data: verdict,
    error: null,
  });

  it("reports CAPABILITY_DISABLED, not SPEND_CAP_UNSET, once the row exists", async () => {
    // The distinction the owner has to be able to see: the ceilings landed AND
    // spending is still refused. One reason string covering both would make
    // "configured" and "off" indistinguishable from outside.
    const s = await providerBudgetStatus(rpcReturning(CONFIGURED_BUT_OFF), "SEARCH");
    expect(s.capsConfigured).toBe(true);
    expect(s.generationAllowed).toBe(false);
    expect(s.reason).toBe("CAPABILITY_DISABLED");
    expect(s.requestUsdCap).toBe(0.5);
    expect(s.jobUsdCap).toBe(2.0);
    expect(s.dailyUsdCap).toBe(20.0);
  });

  it("still refuses — valid ceilings are not permission to spend", async () => {
    const s = await providerBudgetStatus(rpcReturning(CONFIGURED_BUT_OFF), "SEARCH");
    expect(s.generationAllowed).toBe(false);
    // ...and the database agrees, on the same row shape.
    expect(INVARIANTS_SQL).toMatch(/CAPABILITY_DISABLED/);
    expect(LEDGER_SQL).toMatch(/capability-disabled/);
  });

  it("an absent row is refused too, and for a DIFFERENT stated reason", async () => {
    const unset = await providerBudgetStatus(rpcReturning(NO_ROW), "SEARCH");
    expect(unset.generationAllowed).toBe(false);
    expect(unset.reason).toBe("SPEND_CAP_UNSET");
    expect(unset.capsConfigured).toBe(false);
    const configured = await providerBudgetStatus(rpcReturning(CONFIGURED_BUT_OFF), "SEARCH");
    expect(unset.reason).not.toBe(configured.reason);
  });

  it("never re-derives 'allowed' from the numbers it was handed", async () => {
    // A verdict claiming allowed=false while carrying a perfectly valid triple
    // must stay false. A caller that recomputed permission from the ceilings
    // would be a second policy, and the looser of the two always wins.
    const s = await providerBudgetStatus(rpcReturning(CONFIGURED_BUT_OFF), "SEARCH");
    expect(
      validateBudgetCaps({
        requestUsdCap: s.requestUsdCap!,
        jobUsdCap: s.jobUsdCap!,
        dailyUsdCap: s.dailyUsdCap!,
        maxAttemptsPerJob: SCHEMA_DEFAULT_ATTEMPTS,
      }).valid,
    ).toBe(true);
    expect(s.generationAllowed).toBe(false);
  });

  it("an unreachable ledger is refused, not assumed open", async () => {
    const s = await providerBudgetStatus(null, "SEARCH");
    expect(s.generationAllowed).toBe(false);
    expect(s.reason).toBe("STATUS_UNAVAILABLE");
  });
});

// ======================================= the four edge functions stay closed
describe("the four searching edge functions remain fail-closed", () => {
  const SEARCH_FNS = [
    "supabase/functions/smart-scout/index.ts",
    "supabase/functions/hotel-scout/index.ts",
    "supabase/functions/ting/index.ts",
    "supabase/functions/health-scan/index.ts",
  ];

  it("every one of them routes its provider call through the guard", () => {
    for (const p of SEARCH_FNS) {
      const src = read(p);
      expect(src, p).toMatch(/withSearchSpendGuard/);
    }
  });

  it("none of them proceeds when admission is refused", () => {
    for (const p of SEARCH_FNS) {
      const src = read(p);
      // The refusal has to be READ. A guard whose result is discarded is a
      // guard that admits everything.
      expect(src, p).toMatch(/\.admitted/);
    }
  });

  it("the guard refuses before it can reach a provider when there is no rpc", async () => {
    const { withSearchSpendGuard } =
      await import("../../../supabase/functions/_shared/searchGuard.ts");
    let called = false;
    const r = await withSearchSpendGuard(
      null,
      {
        requestId: "search-caps-test",
        provider: "anthropic",
        model: "claude-opus-5",
        searchType: "test",
        budget: {
          maxSearches: 1,
          maxProviderCalls: 1,
          maxLlmCalls: 1,
          maxInputTokens: 1_000,
          maxOutputTokens: 1_000,
          maxWallClockMs: 60_000,
          // The owner's request ceiling, so the reservation this would have
          // made is the one production would make.
          maxEstimatedUsd: 0.5,
        },
      },
      async () => {
        called = true;
        return { value: null };
      },
    );
    expect(r.admitted).toBe(false);
    expect(called, "no provider call may happen without a reservation").toBe(false);
  });
});
