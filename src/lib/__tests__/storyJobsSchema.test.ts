/**
 * The migration and the pure modules describe the same rules twice.
 *
 * That duplication is not an accident and it is not removable: the quota
 * decision has to happen under a row lock, which means SQL, and the sentence a
 * user reads has to be one string in one place, which means TypeScript. What
 * IS removable is the drift, and that is what this file is — it parses
 * `20260809000000_story_jobs.sql` and asserts the two agree.
 *
 * It is a text test, not a database test. There is no Postgres in CI, so this
 * cannot prove the SQL runs; it can only prove the two descriptions match. The
 * migration still has to be applied and exercised against a real project, and
 * a green run here is not that.
 */
import { readFileSync } from "node:fs";
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
const SQL = readFileSync(join(ROOT, "supabase/migrations/20260809000000_story_jobs.sql"), "utf8");

/** The body of one `create or replace function` block, up to its `$$;` close. */
function functionBody(name: string): string {
  const start = SQL.indexOf(`create or replace function public.${name}`);
  expect(start, `${name} is not in the migration`).toBeGreaterThan(-1);
  const end = SQL.indexOf("$$;", start);
  expect(end, `${name} has no terminator`).toBeGreaterThan(start);
  return SQL.slice(start, end);
}

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
   * The TS order is DERIVED here rather than written down, by making every
   * condition true at once and then relaxing them one at a time. Writing the
   * expected order as a literal would just be a second copy of the thing under
   * test, and it would keep passing if both copies were reordered together.
   */
  const tsOrder: string[] = [];
  {
    const everythingFails = {
      enabled: false,
      freeSeconds: 10,
      usedSeconds: 10, // exhausted
      dailyUsedSeconds: 120,
      dailySeconds: 120, // no day left
      globalDailyUsedSeconds: 3600,
      globalDailySeconds: 3600, // no capacity
    };
    tsOrder.push(checkStoryQuota(everythingFails, 60)!.reason);
    const on = { ...everythingFails, enabled: true };
    tsOrder.push(checkStoryQuota(on, 60)!.reason);
    const roomy = { ...on, globalDailySeconds: 100000 };
    tsOrder.push(checkStoryQuota(roomy, 60)!.reason);
    const funded = { ...roomy, freeSeconds: 3000, usedSeconds: 10 };
    tsOrder.push(checkStoryQuota(funded, 60)!.reason);
    const daily = { ...funded, dailySeconds: 100000, freeSeconds: 40, usedSeconds: 0 };
    tsOrder.push(checkStoryQuota(daily, 60)!.reason);
  }

  it("derives the pure order as disabled, capacity, exhausted, daily, too-long", () => {
    // Sanity on the derivation itself: if the peel above stops exercising a
    // branch, the comparison below would compare SQL against a shorter list
    // and pass for the wrong reason.
    expect(tsOrder).toEqual(["disabled", "capacity", "exhausted", "daily", "too-long"]);
  });

  it("returns the reasons in that order in SQL", () => {
    // A kill switch checked second is not a kill switch, and the product-wide
    // ceiling has to beat a personal-allowance message — when the day's budget
    // is gone it is gone for everyone.
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
    const fns = [...SQL.matchAll(/create or replace function public\.(\w+)/g)].map(([, n]) => n);
    expect(fns.sort()).toEqual([
      "claim_story_seconds",
      "refund_story_seconds",
      "story_jobs_guard_transition",
      "story_quota_status",
    ]);
    for (const fn of fns) {
      expect(functionBody(fn), fn).toMatch(/set search_path = public/);
    }
    for (const fn of ["claim_story_seconds", "refund_story_seconds", "story_quota_status"]) {
      expect(functionBody(fn), fn).toMatch(/security definer/);
    }
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
    // And bills the clamped value, not the requested one.
    expect(body).toMatch(/values \(me, prompt_clean, wanted, wanted\)/);
  });

  it("does not move a job's status from inside the refund", () => {
    // The legal move depends on where the job is, and the trigger owns that.
    // A refund that also set 'failed' would throw on an already-purged job and
    // the seconds would stay spent.
    const body = functionBody("refund_story_seconds");
    expect(body).not.toMatch(/set status/);
  });
});
