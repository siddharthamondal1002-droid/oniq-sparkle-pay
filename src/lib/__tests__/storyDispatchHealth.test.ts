/**
 * THE DISPATCHER READS ITS OWN REPLY NOW.
 *
 * Diagnosed 2026-08-16 from a Story that died without ever being rendered:
 * job eb0d052f, queued 03:06 UTC on 08-15, `dispatched_at` still null when
 * story-sweep failed and refunded it 39 minutes later. No story-worker run of
 * ANY kind existed between 08-14 16:00 and 08-15 10:33, and the cron fired all
 * 90 times in the hour around it, every one reporting success.
 *
 * Both were true because `story_dispatch_tick` ended with a bare
 * `perform net.http_post(...)`. pg_net is fire-and-forget — the call returns a
 * request id the moment the row is queued — so the cron recorded success
 * whether the edge function answered 200, answered "configured: false", or was
 * never reached. A broken dispatcher was indistinguishable from an empty
 * queue, and by the time anyone asked, pg_net had pruned the response.
 *
 * A TEXT TEST, like the other SQL mirrors here. It proves the migration says
 * what it must; APPLICATION is verified against the live project per deploy.
 * Last verified 2026-08-16 by exercising all four branches against the live
 * function: a real 200 reconciled to ok (consecutive_failures 3 -> 0); a
 * fabricated `{"configured":false}` 200 recorded as a FAILURE with the body as
 * detail; a request id with no response row after 20 minutes recorded as a
 * lost reply; and a real `{"dispatched":true}` body confirmed NOT to raise a
 * false alarm. Both failure branches filed the expected client_error_reports
 * row; the fabricated rows and reports were deleted afterwards.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260816110000_dispatch_reads_its_own_reply.sql"),
  "utf8",
);

describe("story_dispatch_tick", () => {
  it("keeps the request id and reconciles it on the NEXT tick", () => {
    // pg_net writes the response asynchronously, so there is nothing to read
    // in the tick that sent it. Carrying the id across ticks is the whole
    // mechanism — a version that tried to read it inline would always find
    // nothing and would be exactly as blind as the original.
    expect(SQL).toContain("request_id           bigint");
    expect(SQL).toMatch(/from net\._http_response r where r\.id = h\.request_id/);
    expect(SQL).toMatch(/set request_id = req, sent_at = now\(\)/);
  });

  it("does not call a 200 success on its own", () => {
    // story-dispatch answers 200 with `{"configured": false}` when it has no
    // GitHub token, and 200 with `{"error": ...}` when the queue read fails.
    // Both are the dispatcher NOT dispatching. Checking status alone would
    // have called the outage that started this healthy.
    expect(SQL).toContain(`not like '%"error"%'`);
    expect(SQL).toContain(`not like '%"configured":false%'`);
    expect(SQL).toContain(`not like '%"configured": false%'`);
    // Transport failures carry no status at all.
    expect(SQL).toContain("resp.error_msg is null");
  });

  it("treats a reply it never saw as a failure, not as still-in-flight", () => {
    // pg_net prunes its response table. Without this the request id would sit
    // there forever and the in-flight guard below would wedge dispatch shut.
    expect(SQL).toMatch(/h\.sent_at < now\(\) - interval '10 minutes'/);
    expect(SQL).toContain("no response row within 10 minutes");
  });

  it("files failures where the owner already looks", () => {
    // client_error_reports is the admin dashboard's errors panel. A new table
    // nobody opens would be the same blind spot with extra steps.
    expect(SQL).toContain("insert into public.client_error_reports");
    expect(SQL).toContain("'story-dispatch'");
    // Throttled, or a day-long outage files 1,440 identical rows.
    expect(SQL).toMatch(/last_reported_at < now\(\) - interval '1 hour'/);
  });

  it("records the failure that never reaches pg_net at all", () => {
    // A missing vault key means no request is ever made, so there is no reply
    // to reconcile. It has to be recorded at the point of giving up or it
    // stays as invisible as everything else was.
    expect(SQL).toContain("no service-role key in vault");
    // lastIndexOf: the FIRST `if service_key is null then` is the fallback
    // vault lookup, the second is the give-up branch this is about.
    const branch = SQL.slice(SQL.lastIndexOf("if service_key is null then"));
    expect(branch).toContain("insert into public.client_error_reports");
  });

  it("sends one request at a time, so no outcome is overwritten unread", () => {
    expect(SQL).toMatch(/where id and request_id is not null\) then\s*\n\s*return;/);
  });

  it("does not name a variable `status` — it would break the reap", () => {
    // CAUGHT BY RUNNING IT, not by reading it. plpgsql resolves a bare
    // `status` in `where status in ('generating','assembling')` as the local
    // variable and raises "column reference is ambiguous", which would have
    // thrown on every tick that had anything to reap — taking the reaper down
    // along with the dispatcher this was meant to fix.
    expect(SQL).not.toMatch(/^\s*status\s+integer;/m);
    expect(SQL).toContain("resp_status integer;");
    // And the reap is still there, below the reconcile.
    expect(SQL.indexOf("reaped_count = reaped_count + 1")).toBeGreaterThan(
      SQL.indexOf("from net._http_response"),
    );
  });

  it("is reachable by nobody but the cron", () => {
    expect(SQL).toContain(
      "revoke all on function public.story_dispatch_tick() from public, anon, authenticated",
    );
    expect(SQL).toContain(
      "revoke all on table public.story_dispatch_health from public, anon, authenticated",
    );
    expect(SQL).toContain("alter table public.story_dispatch_health enable row level security");
  });
});
