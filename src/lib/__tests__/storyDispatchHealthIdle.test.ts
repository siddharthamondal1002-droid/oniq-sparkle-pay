/**
 * story_dispatch_tick: an idle tick must not report health.
 *
 * WHY THIS TEST EXISTS. GITHUB_DISPATCH_TOKEN died on 2026-09-05 and nothing
 * noticed until 2026-09-11, because story_dispatch_health — the table
 * story-dispatch's own header tells you to read FIRST when the queue stops —
 * showed consecutive_failures 0 and a fresh last_ok_at throughout. The
 * dispatcher backs off 10 minutes per job, so nine of every eleven ticks
 * dispatched nothing, returned 200 {"dispatched":false,...}, and the old `ok`
 * test ("2xx and no \"error\" in the body") counted each one as a success that
 * wiped the failure record.
 *
 * COMMENTS ARE STRIPPED FIRST. The migration's own header quotes
 * consecutive_failures, last_ok_at and "dispatched":false while explaining
 * what must NOT happen, so every assertion below would match the explanation
 * rather than the code. That is the same prose-match this repo has now hit a
 * dozen times; see CLAUDE.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Drop whole-line `--` comments. The file has no inline ones, and its only
 *  em-dashes live inside string literals, so nothing executable is removed. */
const stripSqlComments = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");

const SQL = stripSqlComments(
  read("supabase/migrations/20260911100000_story_dispatch_health_idle_is_not_ok.sql"),
);

/** The body of the `if coalesce(idle, false) then` branch, up to its `elsif`. */
const idleBranch = (() => {
  const start = SQL.indexOf("if coalesce(idle, false) then");
  expect(start).toBeGreaterThan(-1);
  const end = SQL.indexOf("elsif ok is not null then", start);
  expect(end).toBeGreaterThan(start);
  return SQL.slice(start, end);
})();

describe("an idle dispatch tick is neither healthy nor failing", () => {
  it("declares the idle flag and derives it from a body that dispatched nothing", () => {
    expect(SQL).toMatch(/idle\s+boolean/);
    expect(SQL).toMatch(
      /idle\s*:=\s*ok and coalesce\(resp\.content, ''\) like '%"dispatched":false%'/,
    );
  });

  it("clears the in-flight request so the next tick may send", () => {
    expect(idleBranch).toMatch(/request_id\s*=\s*null/);
    expect(idleBranch).toMatch(/sent_at\s*=\s*null/);
  });

  it("touches NO health field — this is the whole fix", () => {
    // If any of these reappear in the idle branch the outage becomes invisible
    // again, which is exactly what happened for six days.
    expect(idleBranch).not.toMatch(/last_ok_at/);
    expect(idleBranch).not.toMatch(/last_fail_at/);
    expect(idleBranch).not.toMatch(/consecutive_failures/);
    expect(idleBranch).not.toMatch(/last_status/);
    expect(idleBranch).not.toMatch(/last_detail/);
  });

  it("is checked BEFORE the ok branch, or ok would claim the tick first", () => {
    expect(SQL.indexOf("if coalesce(idle, false) then")).toBeLessThan(
      SQL.indexOf("elsif ok is not null then"),
    );
  });

  it("still records a real failure and still counts it", () => {
    const failBranch = SQL.slice(SQL.indexOf("last_fail_at = now()"));
    expect(failBranch).toMatch(/consecutive_failures\s*=\s*h\.consecutive_failures \+ 1/);
    expect(SQL).toMatch(/last_ok_at = now\(\)[\s\S]{0,200}consecutive_failures = 0/);
  });

  it("leaves the dispatch decision, the reaper and the vault lookup alone", () => {
    expect(SQL).toMatch(/where status = 'queued'/);
    expect(SQL).toMatch(/reaped_count \+ 1/);
    expect(SQL).toMatch(/story_dispatch_service_role_key/);
    expect(SQL).toMatch(/functions\/v1\/story-dispatch/);
  });
});
