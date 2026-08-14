import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const REAPER_SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260814090000_stale_generating_reaper.sql"),
  "utf8",
);
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/story-worker.yml"), "utf8");

/**
 * The stale-generating reaper's contracts, parsed from the SQL the same
 * way the pricing mirrors parse theirs. The row a dead runner abandons is
 * invisible in production until someone's film silently never arrives —
 * exactly the class of failure a source pin catches at commit time.
 */
describe("the stale-generating reaper", () => {
  it("revives through transitions the lifecycle guard actually allows", () => {
    // The recreated guard must whitelist both revival edges, or the reap
    // UPDATE raises and the tick dies before dispatching anything.
    expect(REAPER_SQL).toContain("('generating','queued')");
    expect(REAPER_SQL).toContain("('assembling','queued')");
    // And the reap itself must target exactly the two in-flight statuses.
    expect(REAPER_SQL).toMatch(/status in \('generating','assembling'\)/);
  });

  it("waits out the longest legitimate run before calling a row dead", () => {
    const interval = REAPER_SQL.match(/interval '(\d+) hours?'/);
    expect(interval, "the reap lost its staleness interval").not.toBeNull();
    const reapMinutes = Number(interval?.[1]) * 60;
    const timeout = WORKFLOW.match(/timeout-minutes:\s*(\d+)/);
    expect(timeout, "story-worker.yml lost its timeout").not.toBeNull();
    // The runner's own timeout is the definition of "wedged"; reaping
    // inside it could steal a job from a slow-but-alive runner.
    expect(reapMinutes).toBeGreaterThan(Number(timeout?.[1]));
  });

  it("gives a job two fresh runners, then tells the truth", () => {
    expect(REAPER_SQL).toContain("reaped_count < 2");
    expect(REAPER_SQL).toContain("reaped_count >= 2");
    expect(REAPER_SQL).toContain("reaped_count = reaped_count + 1");
    expect(REAPER_SQL).toMatch(/set status = 'failed',\s*\n?\s*error = 'reaped/);
    expect(REAPER_SQL).toMatch(
      /add column if not exists reaped_count integer not null default 0/,
    );
  });

  it("reaps BEFORE the nothing-queued early return, and re-offers immediately", () => {
    // The early return fires exactly when a stuck row is the only job in
    // the system — the reap placed after it would never run when needed.
    const reapAt = REAPER_SQL.indexOf("set status = 'queued'");
    const earlyReturnAt = REAPER_SQL.indexOf("Nothing queued, nothing to do");
    expect(reapAt).toBeGreaterThan(-1);
    expect(earlyReturnAt).toBeGreaterThan(-1);
    expect(reapAt).toBeLessThan(earlyReturnAt);
    // Clearing dispatched_at skips the ten-minute backoff the dead
    // dispatch already served.
    expect(REAPER_SQL).toContain("dispatched_at = null");
    // And the minute tick's reap predicate stays an index hit.
    expect(REAPER_SQL).toMatch(
      /create index if not exists story_jobs_inflight_idx/,
    );
  });
});
