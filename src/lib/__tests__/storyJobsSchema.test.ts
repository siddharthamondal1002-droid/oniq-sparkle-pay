/**
 * The migrations and the pure modules describe the same rules twice.
 *
 * That duplication is not an accident and it is not removable: the quota
 * decision has to happen under a row lock, which means SQL, and the sentence a
 * user reads has to be one string in one place, which means TypeScript. What
 * IS removable is the drift, and that is what this file is — it parses the
 * migrations and asserts the two descriptions agree.
 *
 * TWO FILES, BECAUSE FUNCTIONS GET REPLACED. `20260809000000_story_jobs.sql`
 * created the quota machinery; `20260810115624_*.sql` (Story purchases)
 * REPLACED claim_story_seconds, refund_story_seconds and story_quota_status to
 * spend the paid bucket. A test that kept parsing the first file would be
 * pinning a definition the database no longer runs — the guard would go quiet,
 * not fail, which is worse than no guard. So `functionBody` always returns the
 * LATEST definition across both files, and anything the second file did not
 * touch still resolves to the first.
 *
 * It is a text test, not a database test. There is no Postgres in CI, so this
 * cannot prove the SQL runs; it can only prove the two descriptions match. The
 * migrations still have to be applied and exercised against a real project,
 * and a green run here is not that. (Both were applied on 2026-08-10 and the
 * dumped definitions diffed clean against these files.)
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
const JOBS_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260809000000_story_jobs.sql"),
  "utf8",
);
const PURCHASE_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260810115624_9ba7e01b-3f20-4d70-974a-029d5f5f1db8.sql"),
  "utf8",
);
const OWNER_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260812010000_owner_rides_free.sql"),
  "utf8",
);
const CLIP_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260813060000_movie_clip_stage.sql"),
  "utf8",
);
const LAUNCH_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260813200000_movie_on_classic_off.sql"),
  "utf8",
);
/** Migration order. Later files replace earlier definitions, same as Postgres. */
const MIGRATIONS = [JOBS_SQL, PURCHASE_SQL, OWNER_SQL, CLIP_SQL, LAUNCH_SQL];

/**
 * The body of one `create or replace function` block, up to its `$$;` close —
 * from the LAST migration that defines it, because that is the definition the
 * database is actually running.
 */
function functionBody(name: string): string {
  for (const sql of [...MIGRATIONS].reverse()) {
    const start = sql.indexOf(`create or replace function public.${name}`);
    if (start === -1) continue;
    const end = sql.indexOf("$$;", start);
    expect(end, `${name} has no terminator`).toBeGreaterThan(start);
    return sql.slice(start, end);
  }
  expect.fail(`${name} is not in any migration`);
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
    const check = JOBS_SQL.match(/status in \(([^)]+)\)/);
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
    const m = JOBS_SQL.match(new RegExp(`${column} int not null default (\\d+)`));
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
    expect(defaultOf("max_story_seconds")).toBe(MAX_STORY_SECONDS);
    // The FLOOR moved 10 -> 60 on 2026-08-15 when the sub-minute film was
    // withdrawn, so the seed migration is no longer the authority on it: a
    // later migration alters both the live row and the column default. Assert
    // the mover, not the seed — checking the seed would pin a number the
    // database has deliberately stopped using.
    const drop = readFileSync(
      join(process.cwd(), "supabase/migrations/20260815060000_drop_thirty_seconds.sql"),
      "utf8",
    );
    expect(MIN_STORY_SECONDS).toBe(60);
    expect(drop).toContain("min_story_seconds = 60");
    expect(drop, "a fresh project would still seed the withdrawn floor").toContain(
      "alter column min_story_seconds set default 60",
    );
  });
});

describe("the claim refuses in the same order the pure check does", () => {
  /**
   * The TS order is DERIVED here rather than written down, by making every
   * condition true at once and then relaxing them one at a time. Writing the
   * expected order as a literal would just be a second copy of the thing under
   * test, and it would keep passing if both copies were reordered together.
   *
   * CAPACITY IS LAST NOW, and that is the purchase migration's change, not an
   * accident: the product-wide ceiling applies to the FREE portion of a
   * request only, so it cannot be evaluated until the free/paid split has
   * happened — which is after every personal check.
   */
  const tsOrder: string[] = [];
  {
    const everythingFails = {
      enabled: false,
      freeSeconds: 10,
      usedSeconds: 10, // exhausted
      paidSeconds: 0, // nothing purchased either
      dailyUsedSeconds: 120,
      dailySeconds: 120, // no day left
      globalDailyUsedSeconds: 3600,
      globalDailySeconds: 3600, // no capacity
    };
    tsOrder.push(checkStoryQuota(everythingFails, 60)!.reason);
    const on = { ...everythingFails, enabled: true };
    tsOrder.push(checkStoryQuota(on, 60)!.reason);
    // Free time exists but today is spent, and no paid time covers the rest.
    const funded = { ...on, freeSeconds: 3000, usedSeconds: 10 };
    tsOrder.push(checkStoryQuota(funded, 60)!.reason);
    // The day is open but the lifetime balance cannot cover the length.
    const daily = { ...funded, dailySeconds: 100000, freeSeconds: 40, usedSeconds: 0 };
    tsOrder.push(checkStoryQuota(daily, 60)!.reason);
    // Fully funded personally; the product-wide ceiling is what refuses.
    const roomy = { ...daily, freeSeconds: 3000, usedSeconds: 10 };
    tsOrder.push(checkStoryQuota(roomy, 60)!.reason);
  }

  it("derives the pure order as disabled, exhausted, daily, too-long, capacity", () => {
    // Sanity on the derivation itself: if the peel above stops exercising a
    // branch, the comparison below would compare SQL against a shorter list
    // and pass for the wrong reason.
    expect(tsOrder).toEqual(["disabled", "exhausted", "daily", "too-long", "capacity"]);
  });

  it("returns the reasons in that order in SQL", () => {
    // A kill switch checked second is not a kill switch. And capacity moving
    // below the personal checks is load-bearing: the ceiling is charged
    // against spend_free, which does not exist until the split has run.
    const body = functionBody("claim_story_seconds");
    const sqlOrder = [...body.matchAll(/'reason',\s*'([a-z-]+)'/g)].map(([, r]) => r);
    expect(sqlOrder).toEqual(tsOrder);
  });

  it("lets purchased seconds ignore the daily cap and the global ceiling", () => {
    // The two exemptions the purchase migration promises. If either regresses
    // in the pure check, a paying user gets told to come back tomorrow.
    const daySpent = {
      enabled: true,
      freeSeconds: 300,
      usedSeconds: 300, // no free time at all
      paidSeconds: 300,
      dailyUsedSeconds: 120,
      dailySeconds: 120, // day fully spent
      globalDailyUsedSeconds: 3600,
      globalDailySeconds: 3600, // product ceiling fully spent
    };
    expect(checkStoryQuota(daySpent, 60)).toBeNull();
    // And the SQL charges only the free portion against the ceiling.
    const body = functionBody("claim_story_seconds");
    expect(body).toMatch(/global_used \+ spend_free > cfg\.global_daily_seconds/);
  });

  it("carries no user-facing sentences — copy lives in storyPlan only", () => {
    // The RPC returns a reason and numbers. If a sentence ever appears here,
    // there are two places to change the wording and one of them will be
    // missed.
    for (const fn of ["claim_story_seconds", "story_quota_status"]) {
      expect(functionBody(fn)).not.toMatch(/'message'/);
    }
    for (const sql of MIGRATIONS) {
      expect(sql).not.toMatch(/Try again tomorrow|free Story time/);
    }
  });
});

describe("the guards that make this safe to expose", () => {
  it("enables row level security on every table any migration creates", () => {
    // The owner-rides-free migration replaces functions and creates no
    // tables, so the ≥1-table demand is on the SET, not on each file — the
    // real invariant is that no created table ships without RLS.
    let totalCreated = 0;
    for (const sql of MIGRATIONS) {
      const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map(
        ([, t]) => t,
      );
      totalCreated += created.length;
      for (const table of created) {
        expect(sql, table).toContain(`alter table public.${table} enable row level security`);
      }
    }
    expect(totalCreated).toBeGreaterThan(0);
  });

  it("gives authenticated users read access and nothing more", () => {
    // Every write goes through an RPC or the service role. A direct grant
    // would let a client set its own used_seconds — or its own paid_seconds,
    // which is the same mistake with a price on it.
    for (const sql of MIGRATIONS) {
      const grants = [...sql.matchAll(/grant ([\w ,]+) on public\.(\w+) to (\w+);/g)];
      for (const [, privileges, table, role] of grants) {
        if (role === "authenticated") {
          expect(privileges.trim(), `${table} grant to authenticated`).toBe("select");
        }
      }
    }
  });

  it("pins search_path on every function, and marks the money ones definer", () => {
    // A SECURITY DEFINER function without a pinned search_path is the classic
    // privilege-escalation shape: the caller chooses which schema's tables the
    // definer's rights get applied to.
    const fns = [
      ...new Set(
        MIGRATIONS.flatMap((sql) =>
          [...sql.matchAll(/create or replace function public\.(\w+)/g)].map(([, n]) => n),
        ),
      ),
    ];
    expect(fns.sort()).toEqual([
      "attach_story_purchase_order",
      "claim_story_seconds",
      "create_story_purchase",
      "credit_story_purchase",
      "fail_story_purchase",
      "refund_story_seconds",
      "story_jobs_guard_transition",
      "story_quota_status",
    ]);
    for (const fn of fns) {
      expect(functionBody(fn), fn).toMatch(/set search_path = public/);
      if (fn !== "story_jobs_guard_transition") {
        expect(functionBody(fn), fn).toMatch(/security definer/);
      }
    }
  });

  it("never lets a user credit their own account", () => {
    // A refund adds seconds back; a credit mints them. Exposing either to
    // authenticated would make the whole quota advisory.
    expect(PURCHASE_SQL).toMatch(
      /revoke all on function public\.refund_story_seconds\(uuid\) from public, anon, authenticated;/,
    );
    expect(PURCHASE_SQL).toMatch(
      /revoke all on function public\.credit_story_purchase\(text, text, text\)\s*from public, anon, authenticated;/,
    );
    for (const sql of MIGRATIONS) {
      expect(sql).not.toMatch(/grant execute on function public\.refund_story_seconds/);
      expect(sql).not.toMatch(/grant execute on function public\.credit_story_purchase/);
    }
  });

  it("makes the refund idempotent, so a retried sweeper cannot pay twice", () => {
    const body = functionBody("refund_story_seconds");
    expect(body).toMatch(/refunded_at is not null/);
    expect(body).toMatch(/for update/);
  });

  it("makes the credit idempotent, because verify and webhook both call it", () => {
    // The guard is `status = 'paid'` under the row lock — by design NOT a
    // check on seconds_credited, which would double-credit the moment a
    // 0-second tier ever existed.
    const body = functionBody("credit_story_purchase");
    expect(body).toMatch(/for update/);
    expect(body).toMatch(/p\.status = 'paid'/);
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
    // And bills the clamped value, not the requested one — with the paid part
    // of it recorded on the job so a refund can put each second back in the
    // bucket it came from, and the validated grade recorded so the worker
    // builds the pipeline that was bought.
    expect(body).toMatch(/values \(me, prompt_clean, wanted, wanted, spend_paid, grade_clean\)/);
  });

  it("refunds each second to the bucket it came from", () => {
    // A job that spent 40 free and 80 paid must give back 40 free and 80 paid.
    // Refunding the whole 120 as free would quietly delete somebody's purchase
    // and hand them daily allowance they never had.
    const body = functionBody("refund_story_seconds");
    expect(body).toMatch(/paid_seconds_charged/);
    expect(body).toMatch(/paid_seconds = paid_seconds \+ paid_part/);
  });

  it("does not move a job's status from inside the refund", () => {
    // The legal move depends on where the job is, and the trigger owns that.
    // A refund that also set 'failed' would throw on an already-purged job and
    // the seconds would stay spent.
    const body = functionBody("refund_story_seconds");
    expect(body).not.toMatch(/set status/);
  });

  it("never reads a price from the request", () => {
    // The whole pricing model in one assertion: create_story_purchase takes a
    // LENGTH and an origin label, and nothing else. An amount parameter here
    // would be the one request away from paying a rupee for five minutes.
    expect(PURCHASE_SQL).toMatch(
      /create or replace function public\.create_story_purchase\(_seconds int, _origin text default 'web'\)/,
    );
    const body = functionBody("create_story_purchase");
    expect(body).toMatch(/from story_price_tiers where seconds = _seconds and active/);
  });

  it("keeps the paid bucket writable only through the definer functions", () => {
    // paid_seconds is credited by credit_story_purchase and spent by
    // claim_story_seconds; story_purchases rows are written only by the
    // purchase functions. A client-writable row in either place is a balance a
    // client can mint.
    expect(PURCHASE_SQL).toMatch(
      /revoke insert, update, delete on public\.story_purchases from anon, authenticated;/,
    );
    expect(PURCHASE_SQL).toMatch(
      /revoke insert, update, delete on public\.story_price_tiers from anon, authenticated;/,
    );
    expect(PURCHASE_SQL).toMatch(
      /revoke insert, update, delete on public\.story_purchase_config from anon, authenticated;/,
    );
  });
});
