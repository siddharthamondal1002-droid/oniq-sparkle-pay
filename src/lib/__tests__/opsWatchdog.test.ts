import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../../test/sourceText.ts";

/**
 * THE WATCHDOG IS THE JOIN BETWEEN "SOMETHING IS WRONG" AND "SOMEONE KNOWS",
 * and every assertion here reads SOURCE WITH COMMENTS STRIPPED. That is not
 * decoration: the migration's header quotes every constant it explains — "3
 * hours", "QUEUED_ABANDONED_TTL_MS", "0.80", "story-dispatch" — so a raw grep
 * would pass on a file whose prose is right and whose code is wrong. This repo
 * has hit that exact shape thirteen times.
 */
const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const MIGRATION = "supabase/migrations/20260912060000_oniq_ops_watchdog.sql";
const ALERT_FN = "supabase/functions/ops-alert/index.ts";
const SWEEP = "supabase/functions/story-sweep/index.ts";

/** SQL comments are `--`, which the TS stripper does not know about. */
function stripSql(src: string): string {
  return src
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

describe("the watchdog detects from server-side facts, never from error volume", () => {
  /**
   * MEASURED 2026-09-12 over 30 days of client_error_reports: the worst single
   * hour belongs to `chat-viewport` at 19 reports and is not an outage, while
   * the total six-day video outage never exceeded ONE report per hour — because
   * story_dispatch_tick() throttles its own self-report hourly. A watchdog that
   * counts error reports sleeps through the only outage ONIQ has ever had.
   */
  it("counts no error reports in any signal", () => {
    const sql = stripSql(read(MIGRATION));
    const fn = sql.slice(sql.indexOf("create or replace function public.ops_watch_tick"));
    expect(fn).not.toMatch(/client_error_reports/);
  });

  it("reads the dispatcher's own consecutive-failure counter", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(/consecutive_failures/);
    expect(sql).toMatch(/story_dispatch_health/);
  });

  /** Three consecutive failures is three minutes, read off the every-minute dispatch cron rather than chosen. */
  it("keeps the dispatch threshold at three", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(/k_dispatch_fails\s+constant\s+integer\s*:=\s*3\s*;/);
  });

  /**
   * THE STALL WINDOW IS HALF story-sweep's ABANDONED TTL, so the owner hears
   * BEFORE ONIQ gives up on the film. That TTL was itself set at 5.5x the
   * measured worst real created_at -> dispatched_at wait of 65.1 minutes over
   * 117 films. Asserted as a RELATIONSHIP across the two files: raise the TTL
   * alone and this goes red rather than quietly alerting after the expiry.
   */
  it("alerts at half the abandoned-film TTL, computed from story-sweep", () => {
    const sweep = stripComments(read(SWEEP));
    const m = /const QUEUED_ABANDONED_TTL_MS\s*=\s*([^;]+);/.exec(sweep);
    expect(m).not.toBeNull();
    const ttlHours = Number(new Function(`return (${m![1]})`)()) / 3_600_000;
    const sql = stripSql(read(MIGRATION));
    const w = /k_stalled\s+constant\s+interval\s*:=\s*interval\s*'(\d+) hours'/.exec(sql);
    expect(w).not.toBeNull();
    expect(Number(w![1])).toBe(ttlHours / 2);
  });

  /** One open row per signal IS the dedup. Without it a fault writes 288 rows a day and nobody reads any of them. */
  it("dedups by a partial unique index rather than by convention", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(
      /create unique index[\s\S]*?on public\.ops_alerts \(signal\) where resolved_at is null/,
    );
  });

  /** Two ticks must not interleave: the partial index would raise on the busy minute an alert opens. */
  it("serialises concurrent ticks", () => {
    const sql = stripSql(read(MIGRATION));
    expect(sql).toMatch(/pg_advisory_xact_lock/);
  });

  /** A watchdog may observe and announce. It may never act. */
  it("writes nothing a person can see", () => {
    const sql = stripSql(read(MIGRATION));
    const fn = sql.slice(sql.indexOf("create or replace function public.ops_watch_tick"));
    for (const table of [
      "story_jobs",
      "wallets",
      "profiles",
      "health_",
      "provider_budget_config",
    ]) {
      expect(fn).not.toMatch(new RegExp(`(update|insert into|delete from)\\s+public\\.${table}`));
    }
  });
});

describe("the cron must hand ops-alert a key it can actually verify", () => {
  /**
   * THE DEFECT THE END-TO-END TEST CAUGHT, and reading could not have.
   * `story_dispatch_tick` prefers `story_dispatch_service_role_key`, which on
   * this project is NOT a JWT; `ops-alert` admits the cron by reading the role
   * claim, so that pairing answers 401. Copying the existing preference would
   * have produced a watchdog that detects for ever and announces never.
   * Measured: opaque -> 401, JWT -> 200 {"caller":"cron"}.
   */
  it("selects the key by shape, not by name", () => {
    const sql = stripSql(read(MIGRATION));
    const fn = sql.slice(sql.indexOf("create or replace function public.ops_watch_pick_key"));
    expect(fn).toMatch(/starts_with\(decrypted_secret, 'eyJ'\)/);
  });

  it("routes the tick's notification through that chooser", () => {
    const sql = stripSql(read(MIGRATION));
    const tick = sql.slice(sql.indexOf("create or replace function public.ops_watch_tick"));
    expect(tick).toMatch(/v_key\s*:=\s*public\.ops_watch_pick_key\(\)/);
    // and NOT by re-deriving a name preference beside the chooser
    expect(tick).not.toMatch(/story_dispatch_service_role_key/);
  });
});

describe("delivery may fail without losing the observation", () => {
  const src = stripComments(read(ALERT_FN));

  /**
   * MARK ONLY ON A REAL DELIVERY. A row marked notified after a failed send is
   * an outage nobody ever hears about twice — the next tick would see it as
   * already announced and stay silent for the rest of the outage.
   */
  it("marks notified_at only inside a successful-send branch", () => {
    const i = src.indexOf("if (sent > 0)");
    expect(i).toBeGreaterThan(0);
    // Scoped to the WRITE. `notified_at` legitimately appears earlier in the
    // select list and in the pending filter — a whole-file search for the name
    // would be asserting about a read, which is the "a count over a file is not
    // a guard" mistake this repo has already made four times.
    const writes = [...src.matchAll(/\.update\(\{[^}]*notified_at[^}]*\}\)/g)];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w.index!).toBeGreaterThan(i);
  });

  /** The token is the address a push is delivered to; the status is what a fix needs. */
  it("never puts a device token in a failure record", () => {
    const block = src.slice(src.indexOf("const failures"), src.indexOf("if (sent > 0)"));
    expect(block).toMatch(/failures\.push/);
    expect(block).not.toMatch(/failures\.push\([^)]*token/);
  });

  /** `platform = 'web'` rows are VAPID subscriptions; posting one to FCM fails the whole send. */
  it("excludes web subscriptions from the FCM send", () => {
    expect(src).toMatch(/\.neq\(\s*["']platform["']\s*,\s*["']web["']\s*\)/);
  });

  /** Two callers, one gate: the cron's service role, or an admin proving delivery. Nobody else. */
  it("admits only the service role or a verified admin", () => {
    expect(src).toMatch(/roleOf\(bearer\) === ["']service_role["']/);
    expect(src).toMatch(/rpc\(["']is_admin["']/);
    expect(src).toMatch(/status:\s*403|["']forbidden["']/);
  });

  /** One push per run, never one per alert — a burst of notifications is the spam failure. */
  it("sends one message covering every pending alert", () => {
    expect(src).toMatch(/MAX_LINES/);
    expect(src).toMatch(/lines\.slice\(0, MAX_LINES\)/);
  });
});
