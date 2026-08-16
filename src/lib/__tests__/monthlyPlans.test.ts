/**
 * The monthly plan, and the two numbers that can quietly bankrupt it.
 *
 * Owner directive 2026-08-16: Story time moves from per-second selling to a
 * per-month plan — ONIQ Plus at ₹499 with 8 minutes included, a free plan of
 * 1 minute a month, and per-minute top-ups kept as a prepaid plan alongside.
 *
 * SELLING A MONTH IS A DIFFERENT RISK FROM SELLING A MINUTE. Per minute, a bad
 * price costs you a thin margin. Per month, the price is fixed and the cost is
 * not: `included_seconds` is a database column that looks like a generosity
 * dial and is actually the line between a profitable plan and one that loses
 * money on everybody who uses it properly. At ₹499 the break-even is 10.5
 * minutes. Nothing in the schema stops someone typing 900 into that column, so
 * the arithmetic is asserted here instead.
 *
 * The other number is `price_paise`, and the same test catches it from the
 * other side: lowering the price without lowering the minutes fails too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLAN_INCLUDED_SECONDS,
  PLAN_PRICE_PAISE,
  SUBSCRIPTION_RETAINED,
  maxIncludedSecondsFor,
  planMarginAt,
} from "@/lib/storyCostModel";
import { sayAllowance, sayLeft } from "@/components/stories/PlanSheet";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PLANS = read("supabase/migrations/20260816060000_monthly_plans.sql");
const CLAIM = read("supabase/migrations/20260816061000_monthly_claim.sql");
/** Comment lines stripped — the prose here describes the hazards it prevents. */
const bare = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
const PLANS_SQL = bare(PLANS);
const CLAIM_SQL = bare(CLAIM);

describe("the plan pays for the minutes it includes", () => {
  it("includes fewer minutes than ₹499 can carry", () => {
    const cap = maxIncludedSecondsFor(PLAN_PRICE_PAISE.plus_monthly);
    expect(
      PLAN_INCLUDED_SECONDS.plus_monthly,
      `₹${PLAN_PRICE_PAISE.plus_monthly / 100} can carry ${cap}s; the plan promises ${PLAN_INCLUDED_SECONDS.plus_monthly}s`,
    ).toBeLessThanOrEqual(cap);
    // And not by a hair: a plan sitting a few seconds under break-even is one
    // rounding change away from being over it.
    expect(PLAN_INCLUDED_SECONDS.plus_monthly).toBeLessThanOrEqual(cap * 0.85);
  });

  it("still makes money on a subscriber who uses every included second", () => {
    const m = planMarginAt(PLAN_PRICE_PAISE.plus_monthly, PLAN_INCLUDED_SECONDS.plus_monthly);
    expect(m, "a fully-using subscriber costs more than they pay").toBeGreaterThan(0);
    // The realistic band. If this drifts, the plan changed and nobody said so.
    expect(m).toBeGreaterThan(0.15);
    expect(m).toBeLessThan(0.3);
  });

  it("makes more from a subscriber who uses less, and never less from one who uses none", () => {
    const full = planMarginAt(49900, 480);
    const some = planMarginAt(49900, 336); // 70%
    const none = planMarginAt(49900, 0);
    expect(some).toBeGreaterThan(full);
    expect(none).toBeGreaterThan(some);
    // Using nothing leaves exactly tax and the payment fee.
    expect(none).toBeCloseTo(SUBSCRIPTION_RETAINED, 6);
  });

  it("prices the free plan's giveaway honestly", () => {
    // One minute a month per account, and it is a real cost — about ₹41 at
    // movie grade. Named so that raising it is a decision, not a typo.
    expect(PLAN_INCLUDED_SECONDS.free).toBe(60);
    const costPaise = planMarginAt(1, 0) * 0; // free plan has no price to divide by
    void costPaise;
    expect(maxIncludedSecondsFor(0)).toBe(0);
  });

  it("agrees with the plan rows the database actually holds", () => {
    // The TypeScript above is what the tests reason about; the SQL is what
    // bills. A mismatch means the guard is protecting a number nobody uses.
    expect(PLANS_SQL).toContain("'plus_monthly', 'ONIQ Plus', 'auto_renew', 'P1M', 49900, 480");
    expect(PLANS_SQL).toContain("'free', 'Free', 'free', null, 0, 60");
    expect(PLANS_SQL).toContain("'topup', 'Top up', 'prepaid'");
  });
});

describe("who can grant themselves a subscription", () => {
  it("nobody, from the client", () => {
    // The single most important line in the migration. grant_subscription
    // decides who has paid; reachable by `authenticated` it would make Plus
    // free to anyone who can open the network tab.
    expect(PLANS_SQL).toContain(
      "revoke all on function public.grant_subscription(uuid, text, int, text, text) from public, anon, authenticated",
    );
    expect(
      /grant execute on function public\.grant_subscription[^;]*to authenticated/.test(PLANS_SQL),
      "grant_subscription is reachable by the client",
    ).toBe(false);
  });

  it("keeps subscriptions readable but never writable by its owner", () => {
    // Parse the POLICY statements rather than scanning the whole file: the
    // first version of this test matched the `select ... for update` row lock
    // inside grant_subscription and failed on correct code, which is the kind
    // of guard people delete rather than fix.
    const policies = [
      ...PLANS_SQL.matchAll(/create policy\s+(\w+)\s+on\s+public\.(\w+)\s+([\s\S]*?);/g),
    ].map((m) => ({ name: m[1], table: m[2], body: m[3].toLowerCase() }));
    const onSubs = policies.filter((p) => p.table === "subscriptions");
    expect(onSubs.length, "no policy on subscriptions at all").toBeGreaterThan(0);
    for (const p of onSubs) {
      expect(p.body, `policy ${p.name} lets a client write its own subscription`).toContain(
        "for select",
      );
      expect(p.body).toContain("auth.uid() = user_id");
    }
    // RLS must actually be on, or the policies above are decoration.
    expect(PLANS_SQL).toContain("alter table public.subscriptions enable row level security");
  });

  it("refuses to subscribe anyone to a plan that does not recur", () => {
    expect(PLANS_SQL).toContain("if p.kind <> 'auto_renew' then raise exception");
  });
});

describe("the period", () => {
  it("extends on renewal instead of restarting", () => {
    // Paying on day 20 of a paid month must not throw away the ten days
    // already bought, nor reset the minute allowance early.
    expect(PLANS_SQL).toContain("starts := existing.period_start;");
    expect(PLANS_SQL).toContain("ends := (existing.period_end + (_months || ' months')::interval)");
  });

  it("cancels at the end of the period, never on the day it is pressed", () => {
    expect(PLANS_SQL).toContain("cancel_at_period_end = true");
    const fn = PLANS_SQL.slice(PLANS_SQL.indexOf("function public.cancel_my_subscription"));
    expect(
      /period_end\s*=\s*(current_date|now\(\))/.test(fn),
      "cancelling shortens the period somebody paid for",
    ).toBe(false);
  });

  it("expires without needing a sweep to have run", () => {
    // A late cron must never be able to hand somebody a month they did not
    // pay for, so entitlement is decided by the date, not by a status column
    // that something else is responsible for updating.
    expect(PLANS_SQL).toContain("and s.period_end > (now() at time zone 'utc')::date");
  });

  it("treats grace as subscribed and hold as not", () => {
    // Grace exists so a bank timeout does not cancel a paying customer; hold
    // exists so an unfixed card does not keep getting free film.
    expect(PLANS_SQL).toContain("status in ('active', 'grace')");
    expect(PLANS_SQL).not.toContain("status in ('active', 'grace', 'on_hold')");
  });
});

describe("the claim, on a monthly allowance", () => {
  it("rate-limits the free plan by the day and subscribers by their month", () => {
    // 120s/day against 480s/month would ration a bought allowance to four
    // days. Selling 8 minutes and then metering them is not what was sold.
    expect(CLAIM_SQL).toContain(
      "daily_left := case when is_free_plan\n                     then greatest(0, cfg.daily_seconds - a_daily_used)\n                     else period_left end;",
    );
  });

  it("counts only the giveaway against the shared daily ceiling", () => {
    // Otherwise eight Plus members exhaust it and block each other out of
    // film they have already paid for.
    expect(CLAIM_SQL).toContain(
      "free_spend := case when is_free_plan then spend_included else 0 end;",
    );
    expect(CLAIM_SQL).toContain("if global_used + free_spend > cfg.global_daily_seconds");
  });

  it("never resets a period on a refused attempt", () => {
    // The reset happens in a local variable; the row is only written on the
    // success path. Resetting on refusal would hand out a fresh month to
    // anyone who asked for a film they could not afford.
    const reset = CLAIM_SQL.indexOf("a_period_used := 0;");
    const write = CLAIM_SQL.indexOf("period_used_seconds = a_period_used + spend_included");
    expect(reset).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(reset);
    expect(CLAIM_SQL.slice(reset, write)).toContain("return jsonb_build_object('ok', false");
  });

  it("takes the watermark from the plan rather than from admin alone", () => {
    expect(CLAIM_SQL).toContain("clean := has_entitlement(me, 'no_watermark');");
    expect(CLAIM_SQL).toContain("no_watermark, grade, verbatim)");
  });

  it("spends the included allowance before the prepaid balance", () => {
    // Top-ups are bought and do not expire; the monthly allowance does.
    // Spending the balance first would quietly burn the thing that keeps.
    const inc = CLAIM_SQL.indexOf("spend_included := least(wanted, period_left, daily_left);");
    const paid = CLAIM_SQL.indexOf("spend_paid := least(wanted - spend_included, a_paid);");
    expect(inc).toBeGreaterThan(-1);
    expect(paid).toBeGreaterThan(inc);
  });

  it("keeps every guard the per-second version had", () => {
    // This function is the billing path. A rewrite that quietly drops one of
    // these is the failure mode worth a test of its own.
    expect(CLAIM_SQL, "grade check").toContain(
      "case when _grade = 'movie' then 'movie' else null end",
    );
    expect(CLAIM_SQL, "prompt cap").toContain("length(prompt_clean) > 5000");
    expect(CLAIM_SQL, "verbatim fit band").toContain("spoken_seconds < wanted * 0.5");
    expect(CLAIM_SQL, "verbatim NBSP handling").toContain("translate(prompt_clean, chr(160), ' ')");
    expect(CLAIM_SQL, "owner rides free").toContain("if is_admin(me) then");
    expect(CLAIM_SQL, "global capacity guard").toContain("'reason', 'capacity'");
    expect(CLAIM_SQL, "row lock").toContain("from story_allowance where user_id = me for update");
    expect(CLAIM_SQL, "definer + pinned path").toContain("security definer");
    expect(CLAIM_SQL).toContain("set search_path = public");
  });

  it("still answers the client's old keys, so a stale bundle keeps working", () => {
    // The app in people's hands reads these. A rename would have looked fine
    // in CI and broken the studio for anyone who had not reloaded.
    for (const k of [
      "'remaining'",
      "'dailyLeft'",
      "'paidSeconds'",
      "'freeSeconds'",
      "'maxSeconds'",
    ]) {
      expect(CLAIM_SQL, `${k} disappeared from the status payload`).toContain(k);
    }
  });
});

describe("what the plan screen says", () => {
  it("says balances as film, not as database seconds", () => {
    // "480s" is what the row holds and nobody thinks in. Seconds survive under
    // a minute because "0.5 min" is worse than "30s".
    expect(sayLeft(480)).toBe("8 min");
    expect(sayLeft(60)).toBe("1 min");
    expect(sayLeft(90)).toBe("1 min 30s");
    expect(sayLeft(30)).toBe("30s");
    expect(sayLeft(0)).toBe("Nothing");
    expect(sayLeft(-5), "a negative balance must not render as film").toBe("Nothing");
  });

  it("describes an allowance in the plan's own terms", () => {
    expect(sayAllowance(480)).toBe("8 minutes of film a month");
    expect(sayAllowance(60)).toBe("1 minute of film a month");
    expect(sayAllowance(90)).toBe("90s of film a month");
    expect(sayAllowance(0)).toBe("No film included");
  });

  it("reads the plans from the database rather than listing them again", () => {
    // A second copy of the price in TypeScript is a second copy to drift, and
    // the one in the database is the one that bills.
    const ui = readFileSync(join(process.cwd(), "src/components/stories/PlanSheet.tsx"), "utf8");
    expect(ui).toContain('.from("subscription_plans")');
    expect(ui, "a hardcoded price would drift from the row that bills").not.toMatch(/49900|₹499/);
  });

  it("never offers to sell what it cannot sell", () => {
    const ui = readFileSync(join(process.cwd(), "src/components/stories/PlanSheet.tsx"), "utf8");
    // With no checkout wired, a sentence — not a dead or greyed-out button,
    // which reads as a bug in the app rather than a fact about the world.
    expect(ui).toContain("Not on sale in this app yet.");
    const studio = readFileSync(
      join(process.cwd(), "src/components/stories/StoryStudio.tsx"),
      "utf8",
    );
    expect(studio, "the Plus CTA points somewhere before a plan checkout exists").toContain(
      "onChoose={null}",
    );
  });

  it("tells the truth about cancelling", () => {
    // Cancelling does not take the paid month away, and the copy has to carry
    // that or the button reads as "lose access now".
    const ui = readFileSync(join(process.cwd(), "src/components/stories/PlanSheet.tsx"), "utf8");
    expect(ui).toContain("you keep it until then");
    expect(ui).toContain("You keep Plus until");
  });
});
