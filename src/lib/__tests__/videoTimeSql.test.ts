// The finished-video-time migration, pinned (owner directive 2026-08-27).
// The schema IS the monetization contract: integer-only accounting, a
// fail-closed sale switch, debit-at-reserve/refund-at-settle, idempotent
// credits, service-role-only money movement — and total isolation from the
// proven story-film billing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/test/sourceText";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260827200000_video_time_monetization.sql"),
  "utf8",
);
// The comments EXPLAIN the isolation and name what must be absent, so the
// absence pins scan executable text only — the same rule every SQL pin in
// this repo follows.
const EXECUTABLE = stripSqlComments(SQL);

describe("integer accounting only", () => {
  it("time is bigint milliseconds and money is integer paise — no floats", () => {
    expect(EXECUTABLE).not.toMatch(/\b(real|float4|float8|double precision|money)\b/);
    expect(SQL).toContain("trial_ms_granted bigint not null default 60000");
    expect(SQL).toContain("paid_ms bigint not null default 0");
    expect(SQL).toContain("payg_paise_per_minute int not null default 2900");
    expect(SQL).toContain("clean_addon_paise_per_minute int not null default 2000");
  });
});

describe("the catalogue", () => {
  it("carries the owner's prices, inactive on arrival", () => {
    expect(SQL).toContain(
      "('creator_monthly', 'Creator', 'auto_renew', 'P1M', 19900, 0, 1800, '{}', false, 13)",
    );
    expect(SQL).toContain(
      "('pro_monthly', 'Pro', 'auto_renew', 'P1M', 34900, 0, 3600, '{no_watermark}', false, 14)",
    );
  });

  it("a re-run can never turn an owner-activated plan back off", () => {
    const conflictClause = SQL.slice(
      SQL.indexOf("('pro_monthly'"),
      SQL.indexOf("-- --------------------------------------------------------- the time accounts"),
    );
    expect(conflictClause).not.toMatch(/^\s*active = excluded\.active/m);
  });

  it("video plans grant ZERO story seconds — the products stay separate", () => {
    // included_seconds (story) is 0 on both video plans; the video allowance
    // lives in its own column the story claim never reads.
    expect(SQL).toContain("add column if not exists video_included_seconds");
    // And the migration touches the story billing NOWHERE.
    for (const storyTerm of ["claim_story_seconds", "story_allowance", "story_price_tiers"]) {
      expect(EXECUTABLE, storyTerm).not.toContain(storyTerm);
    }
  });
});

describe("fail-closed sale switch", () => {
  it("nothing is on sale until the owner flips it", () => {
    expect(SQL).toContain("sales_enabled boolean not null default false");
    expect(SQL).toMatch(/create_video_purchase[\s\S]{0,600}sales_enabled is not true/);
    expect(SQL).toMatch(/start_free_video_month[\s\S]{0,600}sales_enabled is not true/);
  });

  it("the trial bound itself defaults ON — a spend reduction from day one", () => {
    expect(SQL).toContain("trial_enabled boolean not null default true");
  });
});

describe("reserve → settle → release", () => {
  it("debits trial first, then the plan window, then paid", () => {
    const reserve = SQL.slice(
      SQL.indexOf("create or replace function public.reserve_video_time"),
      SQL.indexOf("create or replace function public.settle_video_time"),
    );
    const t = reserve.indexOf("t_ms := least(_ms, trial_avail)");
    const pl = reserve.indexOf("pl_ms := least(_ms - t_ms, plan_avail)");
    const pd = reserve.indexOf("pd_ms := _ms - t_ms - pl_ms");
    expect(t).toBeGreaterThan(-1);
    expect(pl).toBeGreaterThan(t);
    expect(pd).toBeGreaterThan(pl);
  });

  it("refunds the paid pool first at settlement", () => {
    const settle = SQL.slice(
      SQL.indexOf("create or replace function public.settle_video_time"),
      SQL.indexOf("create or replace function public.release_video_time"),
    );
    const paid = settle.indexOf("back_paid := least(refund, r.reserved_paid_ms)");
    const plan = settle.indexOf("back_plan := least(refund - back_paid, r.reserved_plan_ms)");
    expect(paid).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(paid);
    // The actual charge can never exceed the reservation.
    expect(settle).toContain("least(greatest(coalesce(_actual_ms, 0), 0), reserved_total)");
  });

  it("every step is idempotent", () => {
    // A duplicate reserve for the same job debits nothing twice.
    expect(SQL).toMatch(
      /insert into video_time_reservations[\s\S]{0,300}on conflict \(job_id\) do nothing/,
    );
    // A settled or released reservation never settles again.
    expect(SQL).toMatch(/if r\.status <> 'reserved' then[\s\S]{0,120}'already'/);
    // A paid purchase never credits twice.
    expect(SQL).toMatch(/if p\.status = 'paid' then[\s\S]{0,120}'alreadyPaid'/);
  });

  it("a release is a settle at zero — one code path, one truth", () => {
    expect(SQL).toContain("select public.settle_video_time(_job_id, 0);");
  });
});

describe("who may move money and time", () => {
  it("ledger movement is service-role only", () => {
    for (const fn of [
      "reserve_video_time(uuid, uuid, bigint)",
      "settle_video_time(uuid, bigint)",
      "release_video_time(uuid)",
      "attach_video_purchase_order(uuid, text)",
      "credit_video_purchase(text, text, text)",
      "fail_video_purchase(text, text)",
    ]) {
      expect(SQL, fn).toContain(
        `revoke all on function public.${fn}\n  from public, anon, authenticated;`,
      );
    }
  });

  it("clients get exactly status, purchase intent, and the free month", () => {
    for (const fn of [
      "video_time_status()",
      "create_video_purchase(int, text)",
      "start_free_video_month(text)",
    ]) {
      expect(SQL, fn).toContain(`grant execute on function public.${fn} to authenticated;`);
    }
  });

  it("every new table is RLS-locked to its owner", () => {
    for (const table of [
      "video_time_accounts",
      "video_time_reservations",
      "video_purchases",
      "free_month_grants",
    ]) {
      expect(SQL, table).toContain(`alter table public.${table} enable row level security`);
      expect(SQL, table).toMatch(
        new RegExp(`create policy ${table}_read_own[\\s\\S]{0,120}auth\\.uid\\(\\) = user_id`),
      );
    }
    // The sale config has RLS on and NO client policy at all.
    expect(SQL).toContain("alter table public.video_sale_config enable row level security");
    expect(SQL).not.toMatch(/create policy[^;]*video_sale_config/);
  });
});

describe("first month free", () => {
  it("is once per account by primary key, for new subscribers only", () => {
    expect(SQL).toMatch(/free_month_grants \(\s*user_id uuid primary key/);
    expect(SQL).toMatch(/start_free_video_month[\s\S]{0,1600}'already-subscribed'/);
    expect(SQL).toMatch(/start_free_video_month[\s\S]{0,2200}'already-used'/);
  });

  it("grants through the same grant_subscription every paid month uses", () => {
    expect(SQL).toContain("grant_subscription(me, _plan_key, 1, 'oniq', 'first-month-free')");
  });
});

describe("PAYG purchases", () => {
  it("minutes come from a fixed tier list and the server's rate", () => {
    expect(SQL).toContain("_minutes not in (1, 2, 5, 10)");
    expect(SQL).toContain("price := cfg.payg_paise_per_minute * _minutes;");
  });

  it("a paid row is never walked back by a late failure event", () => {
    expect(SQL).toMatch(/fail_video_purchase[\s\S]{0,600}status = 'created'/);
  });
});

describe("the video entitlement authority (owner directive 2026-08-27)", () => {
  const AUTHORITY = readFileSync(
    join(process.cwd(), "supabase/migrations/20260827210000_video_entitlement_authority.sql"),
    "utf8",
  );
  const AUTH_EXEC = stripSqlComments(AUTHORITY);

  it("video asks its own function — admin rides free, then VIDEO plans only", () => {
    expect(AUTHORITY).toContain("create or replace function public.has_video_entitlement");
    expect(AUTH_EXEC).toContain("select is_admin(_user) or exists");
    // The load-bearing predicate: the legacy story Plus plans carry
    // no_watermark for the STORY product and hold video_included_seconds = 0,
    // so without this line their subscribers would get clean video priced
    // far under Pro.
    expect(AUTH_EXEC).toContain("p.video_included_seconds > 0");
  });

  it("the story free-for-all is not touched, and the panel reads the same authority", () => {
    expect(AUTH_EXEC).not.toMatch(/function public\.has_entitlement\s*\(/);
    expect(AUTH_EXEC).toContain(
      "'watermarkFree', has_video_entitlement(me, 'no_watermark')",
    );
  });

  it("locked down like every money function", () => {
    expect(AUTHORITY).toContain(
      "revoke all on function public.has_video_entitlement(uuid, text) from public, anon",
    );
  });
});

describe("operator cost view", () => {
  it("exists for COGS-per-finished-minute and is not client-readable", () => {
    expect(SQL).toContain("cogs_usd_per_finished_minute");
    expect(SQL).toContain("revoke all on public.gpu_video_cogs from public, anon, authenticated;");
  });
});
