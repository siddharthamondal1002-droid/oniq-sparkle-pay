/**
 * The migration and the pure modules describe the same rules twice.
 *
 * That duplication is not an accident and it is not removable: the quota
 * decision has to happen under a row lock, which means SQL, and the sentence a
 * user reads has to be one string in one place, which means TypeScript. What
 * IS removable is the drift, and that is what this file is — it parses every
 * migration that touches the Story schema and asserts the two agree.
 *
 * It is a text test, not a database test. There is no Postgres in CI, so this
 * cannot prove the SQL runs; it can only prove the two descriptions match. The
 * migration still has to be applied and exercised against a real project, and
 * a green run here is not that.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STORY_TRANSITIONS, type StoryStatus } from "@/lib/storyLifecycle";
import {
  DEFAULT_DAILY_SECONDS,
  DEFAULT_FREE_SECONDS,
  DEFAULT_GLOBAL_DAILY_SECONDS,
  MAX_STORY_SECONDS,
  MIN_STORY_SECONDS,
  checkStoryQuota,
} from "@/lib/storyPlan";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");

/**
 * Every migration, oldest first.
 *
 * READING ONE FILE WAS A BUG, and it was found the hard way. This used to open
 * `20260809000000_story_jobs.sql` by name. When a later migration replaced
 * `claim_story_seconds` to spend purchased seconds, this file went on checking
 * the ORIGINAL definition — one the database no longer runs. It still passed,
 * which is the bad part: a guard pinned to a superseded definition does not
 * fail, it just stops being about anything.
 *
 * `create or replace` means the LAST definition in migration order is the live
 * one, so that is the one to parse.
 */
const SQL_FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
  // Only migrations that touch the Story schema. Widening the corpus to every
  // migration in the project would turn assertions like "authenticated gets
  // select and nothing more" into a claim about tables this file knows nothing
  // about — it would fail, or pass, for reasons unrelated to Stories.
  .filter((sql) => sql.includes("public.story_"));

/** The body of the LAST `create or replace function` block for a name. */
function functionBody(name: string): string {
  const needle = `create or replace function public.${name}`;
  for (const sql of [...SQL_FILES].reverse()) {
    const start = sql.lastIndexOf(needle);
    if (start === -1) continue;
    const end = sql.indexOf("$$;", start);
    expect(end, `${name} has no terminator`).toBeGreaterThan(start);
    return sql.slice(start, end);
  }
  throw new Error(`${name} is not defined in any migration`);
}

/** The whole corpus, for checks that are about presence rather than one body. */
const SQL = SQL_FILES.join("\n");

describe("the lifecycle table is the same in SQL as in TypeScript", () => {
  it("lists exactly the transitions storyLifecycle allows", () => {
    // The guard trigger is the floor under the product promise that every
    // Story's bytes eventually go. If SQL permits a move TypeScript forbids,
    // the floor has a hole in it that no unit test of the pure module sees.
    const body = functionBody("story_jobs_guard_transition");
    const pairs = [...body.matchAll(/\('([a-z]+)','([a-z]+)'\)/g)].map(
      ([, from, to]) => `${from}->${to}`,
    );
    expect(pairs.length, "no pairs parsed — the format changed").toBeGreaterThan(0);

    const expected: string[] = [];
    for (const [from, tos] of Object.entries(STORY_TRANSITIONS)) {
      for (const to of tos) expected.push(`${from}->${to}`);
    }
    expect([...pairs].sort()).toEqual([...expected].sort());
  });

  it("has no duplicate pairs, which would hide a missing one", () => {
    const body = functionBody("story_jobs_guard_transition");
    const pairs = [...body.matchAll(/\('([a-z]+)','([a-z]+)'\)/g)].map(
      ([, from, to]) => `${from}->${to}`,
    );
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("constrains story_jobs.status to exactly the known statuses", () => {
    const check = SQL.match(/status in \(([^)]+)\)/);
    expect(check, "no status check constraint").not.toBeNull();
    const inSql = (check?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .sort();
    const known = (Object.keys(STORY_TRANSITIONS) as StoryStatus[]).slice().sort();
    expect(inSql).toEqual(known);
  });

  it("keeps purged terminal in both, so nothing can leave it", () => {
    expect(STORY_TRANSITIONS.purged).toEqual([]);
    const body = functionBody("story_jobs_guard_transition");
    expect(body).not.toMatch(/\('purged','/);
  });
});

describe("the configured defaults are the numbers the arithmetic produced", () => {
  const defaultOf = (column: string): number => {
    const m = SQL.match(new RegExp(`${column} int not null default (\\d+)`));
    expect(m, `${column} has no default`).not.toBeNull();
    return Number(m?.[1]);
  };

  it("seeds free, daily and global ceilings from storyPlan", () => {
    // A migration that seeds a rounder number than the one derived in
    // storyPlan is a silent tier change — the constants would say 300 and the
    // bill would say something else.
    expect(defaultOf("free_seconds")).toBe(DEFAULT_FREE_SECONDS);
    expect(defaultOf("daily_seconds")).toBe(DEFAULT_DAILY_SECONDS);
    expect(defaultOf("global_daily_seconds")).toBe(DEFAULT_GLOBAL_DAILY_SECONDS);
  });

  it("seeds the length bounds from storyPlan", () => {
    expect(defaultOf("min_story_seconds")).toBe(MIN_STORY_SECONDS);
    expect(defaultOf("max_story_seconds")).toBe(MAX_STORY_SECONDS);
  });
});

describe("the claim refuses in the same order the pure check does", () => {
  /**
   * The TS order is DERIVED here rather than written down. Writing the expected
   * order as a literal would just be a second copy of the thing under test, and
   * it would keep passing if both copies were reordered together.
   *
   * ONE STATE PER LAYER, no longer a single state relaxed step by step. The
   * relaxing version worked while the checks were strictly nested; it stopped
   * working when the product-wide ceiling moved BELOW the per-user buckets, at
   * which point the "capacity" state was also personally exhausted and answered
   * "exhausted" twice instead. Each entry below now sets up exactly the one
   * condition it is there to trigger, and the sanity check underneath proves
   * all five were actually reached.
   */
  const tsOrder: string[] = [];
  {
    const base = {
      enabled: true,
      freeSeconds: 3000,
      usedSeconds: 0,
      paidSeconds: 0,
      dailyUsedSeconds: 0,
      dailySeconds: 100000,
      globalDailyUsedSeconds: 0,
      globalDailySeconds: 100000,
    };
    // Kill switch. Checked second, it is not a kill switch.
    tsOrder.push(checkStoryQuota({ ...base, enabled: false }, 60)!.reason);
    // Nothing free and nothing bought.
    tsOrder.push(checkStoryQuota({ ...base, freeSeconds: 10, usedSeconds: 10 }, 60)!.reason);
    // Lifetime balance intact, but today is spent.
    tsOrder.push(
      checkStoryQuota({ ...base, dailySeconds: 120, dailyUsedSeconds: 120 }, 60)!.reason,
    );
    // Some balance, less than asked for.
    tsOrder.push(checkStoryQuota({ ...base, freeSeconds: 40 }, 60)!.reason);
    // Fully funded; the product-wide free budget is what is gone.
    tsOrder.push(
      checkStoryQuota({ ...base, globalDailySeconds: 3600, globalDailyUsedSeconds: 3600 }, 60)!
        .reason,
    );
  }

  it("derives the pure order as disabled, exhausted, daily, too-long, capacity", () => {
    // Sanity on the derivation itself: if the setup above stops exercising a
    // branch, the comparison below would compare SQL against a shorter list
    // and pass for the wrong reason.
    expect(tsOrder).toEqual(["disabled", "exhausted", "daily", "too-long", "capacity"]);
  });

  it("returns the reasons in that order in SQL", () => {
    // A kill switch checked second is not a kill switch. The ceiling now comes
    // LAST rather than second, because it applies to the free portion of a
    // request and how much of a request is free is not known until the buckets
    // have been split — a purchase must not be refused because free users had a
    // busy day.
    const body = functionBody("claim_story_seconds");
    const sqlOrder = [...body.matchAll(/'reason',\s*'([a-z-]+)'/g)].map(([, r]) => r);
    expect(sqlOrder).toEqual(tsOrder);
  });

  it("carries no user-facing sentences — copy lives in storyPlan only", () => {
    // The RPC returns a reason and three numbers. If a sentence ever appears
    // here, there are two places to change the wording and one of them will be
    // missed.
    for (const fn of ["claim_story_seconds", "story_quota_status"]) {
      expect(functionBody(fn)).not.toMatch(/'message'/);
    }
    expect(SQL).not.toMatch(/Try again tomorrow|free Story time/);
  });
});

describe("the guards that make this safe to expose", () => {
  it("enables row level security on every table it creates", () => {
    const created = [...SQL.matchAll(/create table if not exists public\.(\w+)/g)].map(
      ([, t]) => t,
    );
    expect(created.length).toBeGreaterThan(0);
    for (const table of created) {
      expect(SQL, table).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("gives authenticated users read access and nothing more", () => {
    // Every write goes through an RPC or the service role. A direct grant
    // would let a client set its own used_seconds.
    const grants = [...SQL.matchAll(/grant ([\w ,]+) on public\.(\w+) to (\w+);/g)];
    for (const [, privileges, table, role] of grants) {
      if (role === "authenticated") {
        expect(privileges.trim(), `${table} grant to authenticated`).toBe("select");
      }
    }
  });

  it("pins search_path on every function, and marks the money ones definer", () => {
    // A SECURITY DEFINER function without a pinned search_path is the classic
    // privilege-escalation shape: the caller chooses which schema's `story_jobs`
    // the definer's rights get applied to.
    //
    // Story functions only. Some of the migrations that touch story_* also
    // define unrelated things (chat, profile QR, the food-order payment RPCs),
    // and those are somebody else's guard — pulling them in here would make
    // this list churn on every unrelated migration until nobody trusted it.
    const fns = [
      ...new Set(
        [...SQL.matchAll(/create or replace function public\.(\w+)/g)]
          .map(([, n]) => n)
          .filter((n) => n.includes("story")),
      ),
    ];
    expect(fns.sort()).toEqual([
      "attach_story_purchase_order",
      "claim_story_seconds",
      "create_story_purchase",
      "credit_story_purchase",
      "fail_story_purchase",
      "refund_story_seconds",
      "story_dispatch_tick",
      "story_jobs_guard_transition",
      "story_quota_status",
      "story_sweep_tick",
    ]);
    for (const fn of fns) {
      expect(functionBody(fn), fn).toMatch(/set search_path = public/);
    }
    // Everything that moves a balance or spends money. credit_story_purchase is
    // the one that turns a signature into seconds, so it belongs here even
    // though it never touches story_jobs.
    for (const fn of [
      "claim_story_seconds",
      "refund_story_seconds",
      "story_quota_status",
      "create_story_purchase",
      "attach_story_purchase_order",
      "credit_story_purchase",
      "fail_story_purchase",
    ]) {
      expect(functionBody(fn), fn).toMatch(/security definer/);
    }
  });

  it("lets no client path credit a Story balance", () => {
    // paid_seconds is the balance a purchase creates. If `authenticated` could
    // reach the function that increments it, the price chart would be
    // decorative — anyone could call it and mint themselves seconds.
    expect(SQL).toMatch(
      /revoke all on function public\.credit_story_purchase\(text, text, text\)\s*\n?\s*from public, anon, authenticated;/,
    );
    expect(SQL).not.toMatch(/grant execute on function public\.credit_story_purchase/);
    expect(SQL).not.toMatch(/grant execute on function public\.attach_story_purchase_order/);
    expect(SQL).not.toMatch(/grant execute on function public\.fail_story_purchase/);
  });

  it("makes crediting a purchase idempotent, so verify and webhook cannot both pay", () => {
    // Both razorpay-verify and razorpay-webhook call this for the same payment,
    // deliberately, because either one alone can be lost. The second must be a
    // no-op rather than a second credit.
    const body = functionBody("credit_story_purchase");
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/if p\.status = 'paid' then/);
  });

  it("never lets a user credit their own account", () => {
    // A refund adds seconds back. Exposing it to authenticated would make the
    // whole quota advisory: fail a job, get the time back, repeat.
    expect(SQL).toMatch(
      /revoke all on function public\.refund_story_seconds\(uuid\) from public, anon, authenticated;/,
    );
    expect(SQL).not.toMatch(/grant execute on function public\.refund_story_seconds/);
  });

  it("makes the refund idempotent, so a retried sweeper cannot pay twice", () => {
    const body = functionBody("refund_story_seconds");
    expect(body).toMatch(/refunded_at is not null/);
    expect(body).toMatch(/for update/);
  });

  it("locks global usage before user allowance in both writers", () => {
    // One lock order or two functions deadlock under exactly the concurrency
    // that made them necessary.
    for (const fn of ["claim_story_seconds", "refund_story_seconds"]) {
      const body = functionBody(fn);
      const globalAt = body.indexOf("story_global_usage");
      const userAt = body.indexOf("story_allowance");
      expect(globalAt, `${fn} touches story_global_usage`).toBeGreaterThan(-1);
      expect(userAt, `${fn} touches story_allowance`).toBeGreaterThan(-1);
      expect(globalAt, `${fn} lock order`).toBeLessThan(userAt);
    }
  });

  it("takes the row locks it claims to take", () => {
    const body = functionBody("claim_story_seconds");
    expect(body).toMatch(/from story_global_usage where day = today for update/);
    expect(body).toMatch(/from story_allowance where user_id = me for update/);
  });

  it("clamps the requested length server-side rather than trusting the client", () => {
    const body = functionBody("claim_story_seconds");
    expect(body).toMatch(/greatest\(cfg\.min_story_seconds/);
    expect(body).toMatch(/least\(cfg\.max_story_seconds/);
    // And bills the clamped value, not the requested one. Both requested_
    // seconds and seconds_charged take `wanted`; the trailing column is the
    // paid split, which does not affect what is billed.
    expect(body).toMatch(/values \(me, prompt_clean, wanted, wanted[,)]/);
  });

  it("does not move a job's status from inside the refund", () => {
    // The legal move depends on where the job is, and the trigger owns that.
    // A refund that also set 'failed' would throw on an already-purged job and
    // the seconds would stay spent.
    const body = functionBody("refund_story_seconds");
    expect(body).not.toMatch(/set status/);
  });
});
