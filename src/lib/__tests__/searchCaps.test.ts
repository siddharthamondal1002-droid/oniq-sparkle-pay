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
const OWNER_MIGRATION = "supabase/migrations/20260824190000_search_spend_ceilings.sql";
/** Lovable's applied-ledger copy. Deployment evidence — never delete it. */
const APPLIED_MIGRATION =
  "supabase/migrations/20260824171654_ef84b816-c74c-4932-81ec-ecc11761d7da.sql";
const SEARCH_CEILINGS_SQL = read(OWNER_MIGRATION);
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
    // health-scan left the fleet 2026-09-09: a 410 stub, no provider call
    // (src/health/__tests__/anthropicRetired.test.ts).
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

// ================================================== migration lineage
/**
 * TWO FILES NOW WRITE THE SAME SEARCH ROW, AND BOTH MUST STAY.
 *
 *   20260824190000_search_spend_ceilings.sql        the owner's authority
 *   20260824171654_ef84b816-….sql                   Lovable's applied record
 *
 * The second is what Lovable wrote when it applied the first to production.
 * It is deployment evidence: it says what actually ran against the live
 * database, which is a different claim from what the repository intends. A
 * tidy-up that deleted it would destroy the only in-repo record of the apply
 * and leave the two claims indistinguishable again.
 *
 * The risk a duplicate creates is drift — someone edits one and not the other.
 * These tests make that a build failure instead of a silent divergence.
 */
describe("migration lineage: the owner's file and the applied record", () => {
  const ownerSql = read(OWNER_MIGRATION);
  const appliedSql = read(APPLIED_MIGRATION);
  /** Trailing-newline differences are not divergence; content differences are. */
  const norm = (s: string) => s.replace(/\n*$/, "\n");

  it("both files exist — neither may be deleted as a cosmetic tidy-up", () => {
    expect(ownerSql.length).toBeGreaterThan(0);
    expect(appliedSql.length).toBeGreaterThan(0);
  });

  it("are identical in content, modulo the trailing newline", () => {
    // Measured at audit time: 5052 vs 5051 bytes, `cmp` reporting EOF rather
    // than a mismatch — the applied copy is the owner's file without its final
    // newline. Anything else is real drift and must fail here.
    expect(norm(appliedSql)).toBe(norm(ownerSql));
  });

  it("write the same three ceilings and the same disabled flag", () => {
    const parse = (sql: string) =>
      sql.match(
        /values\s*\n?\s*\(\s*'SEARCH'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*(true|false)\s*\)/i,
      );
    for (const [label, sql] of [
      ["owner", ownerSql],
      ["applied", appliedSql],
    ] as const) {
      const m = parse(sql);
      expect(m, `${label} migration must carry a parseable SEARCH insert`).toBeTruthy();
      const [, request, job, daily, enabled] = m!;
      expect(request, label).toBe(OWNER_SEARCH_CAPS.request);
      expect(job, label).toBe(OWNER_SEARCH_CAPS.job);
      expect(daily, label).toBe(OWNER_SEARCH_CAPS.daily);
      expect(enabled.toLowerCase(), label).toBe("false");
    }
  });

  it("neither can enable SEARCH on a re-run", () => {
    for (const [label, sql] of [
      ["owner", ownerSql],
      ["applied", appliedSql],
    ] as const) {
      const conflict = sql.slice(sql.search(/on conflict/i));
      const setClause = conflict.slice(0, conflict.indexOf(";"));
      expect(setClause, `${label}: ON CONFLICT must not touch enabled`).not.toMatch(
        /\benabled\s*=/,
      );
    }
  });

  it("apply in a deterministic order, applied-record first", () => {
    // Supabase applies migrations in lexicographic filename order, so the
    // ordering is a property of the names and can be asserted without a
    // database. 171654 < 190000, so the applied record runs first and the
    // owner's file runs second as a no-op UPDATE to the same values.
    const stamp = (p: string) => p.replace(/^.*migrations\//, "").slice(0, 14);
    expect(stamp(APPLIED_MIGRATION) < stamp(OWNER_MIGRATION)).toBe(true);
    // Whichever runs last, the owner's file is the one that gets the final say
    // on a fresh database — which is the safe way round.
    expect(stamp(OWNER_MIGRATION)).toBe("20260824190000");
  });
});

// ============================================ one budget system, not two
describe("there is exactly one spend ledger", () => {
  const SHIPPED = [
    "supabase/functions/_shared/financialLedger.ts",
    "supabase/functions/_shared/searchGuard.ts",
    "supabase/functions/_shared/searchBudget.ts",
    "supabase/functions/smart-scout/index.ts",
    "supabase/functions/ting/index.ts",
    "supabase/functions/hotel-scout/index.ts",
  ];

  it("no shipped code calls the superseded search-only spend API", () => {
    const dead =
      /admit_search_spend|settle_search_spend|release_search_spend|search_spend_ledger|search_spend_day|search_budget_config/;
    for (const p of SHIPPED) {
      expect(read(p), `${p} must not use the dropped search-only API`).not.toMatch(dead);
    }
  });

  it("every spend RPC in shipped code is a provider_* one", () => {
    const calls = SHIPPED.flatMap((p) => [
      ...read(p).matchAll(/rpc\(\s*"([a-z_]*(?:spend|budget)[a-z_]*)"/g),
    ]).map((m) => m[1]);
    expect(calls.length, "the ledger RPCs must be reachable at all").toBeGreaterThan(0);
    expect([...new Set(calls)].sort()).toEqual([
      "admit_provider_spend",
      "provider_budget_status",
      "release_provider_spend",
      "settle_provider_spend",
    ]);
  });

  it("searchGuard reserves against the unified ledger under capability SEARCH", () => {
    const src = read("supabase/functions/_shared/searchGuard.ts");
    expect(src).toMatch(/withProviderSpendGuard/);
    expect(src).toMatch(/capability:\s*"SEARCH"/);
  });
});

// ==================================== deploying cannot bypass the guard
describe("deploying a searching edge function cannot reach a provider", () => {
  const SEARCH_FNS = [
    "supabase/functions/smart-scout/index.ts",
    "supabase/functions/hotel-scout/index.ts",
    "supabase/functions/ting/index.ts",
    // health-scan left the fleet 2026-09-09: a 410 stub, no provider call
    // (src/health/__tests__/anthropicRetired.test.ts).
  ];

  it("no searching function writes to the budget config — deploying cannot enable SEARCH", () => {
    // `enabled` lives in the database. Shipping code can never flip it, which
    // is why "deploy" and "enable" stay two separate acts.
    for (const p of SEARCH_FNS) {
      const src = read(p);
      expect(src, p).not.toMatch(/provider_budget_config/);
      expect(src, p).not.toMatch(/\benabled\s*[:=]\s*true/);
    }
  });

  it("every Anthropic call sits after the guard opens, never before it", () => {
    for (const p of SEARCH_FNS) {
      const src = read(p);
      const guardAt = src.indexOf("withSearchSpendGuard(");
      expect(guardAt, `${p} must open the guard`).toBeGreaterThan(-1);
      // The provider call belongs inside the guard's callback. If one ever
      // appears earlier in the file it is outside the reservation, and a
      // refused admission would not stop it.
      for (const m of src.matchAll(/api\.anthropic\.com/g)) {
        expect(m.index!, `${p}: Anthropic call at ${m.index} precedes the guard`).toBeGreaterThan(
          guardAt,
        );
      }
    }
  });

  it("each one reads the refusal before touching the guarded value", () => {
    for (const p of SEARCH_FNS) {
      const src = read(p);
      const checkedAt = src.indexOf(".admitted");
      const usedAt = src.indexOf("guarded.value");
      expect(checkedAt, `${p} must check .admitted`).toBeGreaterThan(-1);
      if (usedAt > -1) {
        expect(checkedAt, `${p} must check admission before using the value`).toBeLessThan(usedAt);
      }
    }
  });
});

// ================================================ the enablement flip
/**
 * SEARCH ON — owner directive of 2026-08-24, recorded in
 * `20260824193000_search_enabled.sql`.
 *
 * Two migrations, two decisions, and the split is the point. The ceilings
 * migration omits `enabled` so a re-run can never switch spending on behind
 * the owner; this one sets it, because flipping the capability on IS its whole
 * purpose — the same shape as the 2026-08-13 movie-on/classic-off flip.
 */
describe("the SEARCH enablement flip", () => {
  const ENABLE_SQL = read("supabase/migrations/20260824193000_search_enabled.sql");

  it("sets enabled on SEARCH, and touches no money", () => {
    expect(ENABLE_SQL).toMatch(/update public\.provider_budget_config/i);
    expect(ENABLE_SQL).toMatch(/set\s+enabled\s*=\s*true/i);
    expect(ENABLE_SQL).toMatch(/where capability = 'SEARCH'/i);
    // The enablement migration owns the flag, never the ceilings.
    const update = ENABLE_SQL.slice(
      ENABLE_SQL.search(/update public\.provider_budget_config/i),
      ENABLE_SQL.indexOf(";", ENABLE_SQL.search(/update public\.provider_budget_config/i)),
    );
    for (const cap of ["request_usd_cap", "job_usd_cap", "daily_usd_cap", "max_attempts_per_job"]) {
      expect(update, `the flip must not write ${cap}`).not.toMatch(new RegExp(`${cap}\\s*=`));
    }
  });

  it("refuses to enable over ceilings that are not the owner's", () => {
    // Turning spending on over a wrong, missing or unusable budget is the one
    // ordering mistake this flip could make, so it is checked BEFORE the
    // update rather than after it.
    const guardEnds = ENABLE_SQL.search(/update public\.provider_budget_config/i);
    const preflight = ENABLE_SQL.slice(0, guardEnds);
    expect(preflight).toMatch(/refusing to enable SEARCH: no budget row/);
    expect(preflight).toMatch(/refusing to enable SEARCH: ceilings are/);
    expect(preflight).toMatch(/is_spendable_usd/);
    expect(preflight).toMatch(/0\.50.*2\.00.*20\.00/s);
  });

  it("refuses to carry VIDEO along", () => {
    expect(ENABLE_SQL).toMatch(/VIDEO was enabled by the SEARCH flip/);
    expect(ENABLE_SQL).toMatch(/a capability other than SEARCH is enabled/);
  });

  it("sorts after the ceilings migration, so it can never run first", () => {
    const stamp = (p: string) => p.replace(/^.*migrations\//, "").slice(0, 14);
    expect(
      stamp("supabase/migrations/20260824193000_search_enabled.sql") > stamp(OWNER_MIGRATION),
    ).toBe(true);
  });

  it("leaves VIDEO's own enablement to VIDEO's own decision", () => {
    // Nothing anywhere in the migration set enables VIDEO.
    expect(VIDEO_CEILINGS_SQL).toMatch(
      /'VIDEO'\s*,\s*1\.00\s*,\s*5\.00\s*,\s*50\.00\s*,\s*3\s*,\s*false/,
    );
    expect(ENABLE_SQL).not.toMatch(/where capability = 'VIDEO'[\s\S]{0,80}enabled\s*=\s*true/i);
  });
});

// ============================================ OVER_CAP is recorded, not hidden
/**
 * On 2026-08-24 the first real SEARCH request settled at $0.530683 against a
 * $0.50 ceiling. The ledger recorded the true figure — settlement never clamps,
 * because a clamped invoice is a fabricated one — but the row was
 * indistinguishable from a compliant settlement. An overrun nobody can see is
 * an overrun nobody fixes.
 */
describe("an overrun is marked, and never disguised", () => {
  const OVER_CAP_SQL = read("supabase/migrations/20260824200000_ledger_over_cap.sql");

  it("adds the flag and the ceiling that was in force, not just the flag", () => {
    // Judging a historical settlement against a cap that has since moved is how
    // an audit reaches a confidently wrong answer.
    expect(OVER_CAP_SQL).toMatch(/add column if not exists over_cap boolean/i);
    expect(OVER_CAP_SQL).toMatch(/add column if not exists request_cap_usd_at_settle/i);
  });

  it("still records the true charge — the flag is a receipt, not a clamp", () => {
    const fn = OVER_CAP_SQL.slice(
      OVER_CAP_SQL.search(/create or replace function public\.settle_provider_spend/i),
    );
    // The charge is the actual, exactly as before.
    expect(fn).toMatch(/charge := coalesce\(_actual_usd, led\.estimated_usd\)/);
    // Nothing anywhere reduces it to the cap.
    expect(fn).not.toMatch(/least\s*\(\s*charge/i);
    expect(fn).not.toMatch(/charge\s*:=\s*.*cap/i);
  });

  it("guards the comparison against an unusable ceiling", () => {
    // `charge > 'NaN'` is FALSE in PostgreSQL, so an unusable cap would read as
    // "not over cap" — the friendliest possible lie.
    const fn = OVER_CAP_SQL.slice(
      OVER_CAP_SQL.search(/create or replace function public\.settle_provider_spend/i),
    );
    expect(fn).toMatch(/is_spendable_usd\(cap\)/);
    expect(fn).toMatch(/cap is not null/);
  });

  it("does not become an admission control", () => {
    // It must change no decision. Admission still lives in admit_provider_spend.
    const fn = OVER_CAP_SQL.slice(
      OVER_CAP_SQL.search(/create or replace function public\.settle_provider_spend/i),
    );
    expect(fn).not.toMatch(/return jsonb_build_object\('ok', false, 'reason', 'over-/);
    expect(OVER_CAP_SQL).toMatch(/never a control|not a control/i);
  });

  it("stays service-role only", () => {
    expect(OVER_CAP_SQL).toMatch(
      /revoke all on function public\.settle_provider_spend[\s\S]{0,120}from anon, authenticated/i,
    );
  });

  it("surfaces the overruns for reading", () => {
    expect(OVER_CAP_SQL).toMatch(/create or replace view public\.provider_spend_over_cap/i);
    expect(OVER_CAP_SQL).toMatch(/over_by_usd/);
  });
});
