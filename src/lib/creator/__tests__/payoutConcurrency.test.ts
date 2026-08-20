/**
 * P1 — Creator Program (Track A / RazorpayX) payout concurrency safety.
 *
 * TWO KINDS OF PROOF, deliberately:
 *
 *   1. BEHAVIOURAL — classifyPayout is pure, so the decision that actually
 *      prevents a double-pay (a lost response becomes UNKNOWN and is left
 *      'processing', never 'failed') is executed and asserted here.
 *
 *   2. STRUCTURAL — the concurrency guarantee itself lives in SQL semantics
 *      (FOR UPDATE SKIP LOCKED, a guarded UPDATE) and in the edge dispatcher.
 *      A vitest process has no multi-connection Postgres, so — exactly as
 *      payoutGate.test.ts does for the money gate — the DEFENDING MECHANISM is
 *      pinned in source. That two live Postgres backends partition SKIP LOCKED
 *      rows is a property of Postgres, not of this repo; what this repo must
 *      not silently lose is the use of that primitive. A live multi-worker race
 *      on staging Postgres is listed as a pre-production step in the README.
 *
 * The 10 audit scenarios are each named below.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/test/sourceText";
import { classifyPayout } from "@/lib/creator/payoutClassify";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const PARK = "parked/payout-safety";
const migration = stripSqlComments(read(`${PARK}/20260820090000_payout_concurrency_safety.sql`));
const dispatch = read(`${PARK}/dispatch.prepared.ts`);
const payoutFn = read(`${PARK}/razorpay.payout.prepared.ts`);

// ---------------------------------------------------------------------------
// The production money-path migration must NOT be applied. It stays parked;
// Lovable auto-applies supabase/migrations/* on a main build, so its presence
// there would BE the execution the owner has to approve.
// ---------------------------------------------------------------------------
describe("the payout migration is prepared, not executed", () => {
  it("does not sit in the auto-applied migrations directory", () => {
    expect(
      existsSync(join(ROOT, "supabase/migrations/20260820090000_payout_concurrency_safety.sql")),
      "the P1 migration has been promoted into supabase/migrations — that is the owner-gated step",
    ).toBe(false);
  });
  it("exists as a prepared artifact", () => {
    expect(existsSync(join(ROOT, `${PARK}/20260820090000_payout_concurrency_safety.sql`))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// BEHAVIOURAL — the classifier is the safe-retry decision.
// ---------------------------------------------------------------------------
describe("classifyPayout — a lost response is never a failure", () => {
  it("a confirmed payout id is terminal success", () => {
    const d = classifyPayout({ kind: "ok", providerId: "pout_x" });
    expect(d.outcome).toBe("paid");
    expect(d.leaveProcessing).toBe(false);
  });

  it("TEST 4 — a transport timeout is UNKNOWN and stays processing", () => {
    const d = classifyPayout({ kind: "transport", message: "timed out" });
    expect(d.outcome).toBe("unknown");
    expect(d.leaveProcessing).toBe(true);
  });

  it("TEST 5 — a retriable status (429/5xx/409) is UNKNOWN, not failed", () => {
    for (const status of [408, 409, 425, 429, 500, 502, 503, 504]) {
      const d = classifyPayout({ kind: "http", status });
      expect(d.outcome, `status ${status}`).toBe("unknown");
      expect(d.leaveProcessing, `status ${status}`).toBe(true);
    }
  });

  it("a definitive 4xx (e.g. bad VPA) is FAILED and terminal", () => {
    const d = classifyPayout({ kind: "http", status: 400, providerError: "invalid vpa" });
    expect(d.outcome).toBe("failed");
    expect(d.leaveProcessing).toBe(false);
  });

  it("a 2xx that carried no payout id is UNKNOWN, never assumed paid", () => {
    const d = classifyPayout({ kind: "http", status: 200 });
    expect(d.outcome).toBe("unknown");
    expect(d.leaveProcessing).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// STRUCTURAL — the atomic claim (the ONE PAYOUT → ONE PROCESSOR invariant).
// ---------------------------------------------------------------------------
describe("atomic claim — one payout, one active processor", () => {
  it("TEST 1 & 2 & 10 — claim locks with SKIP LOCKED and transitions to processing", () => {
    // The claim is no longer a bare SELECT: it locks the picked rows with
    // FOR UPDATE SKIP LOCKED (so a concurrent claim skips them) and flips them
    // to 'processing' in the same statement.
    expect(migration).toMatch(/for update\s+skip locked/i);
    expect(migration).toMatch(/update payout_queue[\s\S]*set status\s*=\s*'processing'/i);
    expect(migration).toMatch(/returning q\.id/i);
    // And it is not callable by end users.
    expect(migration).toMatch(
      /revoke all on function public\.claim_payout_batch\(int\) from public, anon, authenticated/i,
    );
  });
});

// ---------------------------------------------------------------------------
// STRUCTURAL — guarded, idempotent mark.
// ---------------------------------------------------------------------------
describe("mark — terminal states only reachable from processing", () => {
  it("TEST 9 — mark only moves a row that is still 'processing'", () => {
    // An already-'paid' row is not 'processing', so a second mark is a no-op:
    // a duplicate can never overwrite or double-count a settled payout.
    expect(migration).toMatch(
      /update payout_queue[\s\S]*where id = _id\s*\n?\s*and status = 'processing'/i,
    );
  });
  it("mark reports whether it actually moved the row (no silent swallow)", () => {
    expect(migration).toMatch(/jsonb_build_object\('updated'/i);
  });
});

// ---------------------------------------------------------------------------
// STRUCTURAL — crash recovery via the reaper.
// ---------------------------------------------------------------------------
describe("reaper — a crashed worker cannot strand money forever", () => {
  it("TEST 3 — stuck 'processing' rows are requeued after a timeout", () => {
    expect(migration).toMatch(/reap_stuck_payouts/i);
    expect(migration).toMatch(/where q\.status = 'processing'/i);
    expect(migration).toMatch(/claimed_at < now\(\) - make_interval/i);
  });
  it("exhausted retries park as 'unknown' for reconciliation, never guessed 'failed'", () => {
    // A payout that may have silently succeeded must never be re-sent on a
    // guess; after the attempts cap it becomes 'unknown' (reconcile by hand),
    // not 'failed'.
    expect(migration).toMatch(/attempts >= greatest\(1, _max_attempts\)[\s\S]*then 'unknown'/i);
  });
  it("attempts is incremented on every claim so the cap can bite", () => {
    expect(migration).toMatch(/attempts\s*=\s*q\.attempts \+ 1/i);
  });
});

// ---------------------------------------------------------------------------
// STRUCTURAL — provider-side idempotency.
// ---------------------------------------------------------------------------
describe("idempotency — the same logical payout is at most one real payout", () => {
  it("TEST 6 & 7 — the payout POST carries X-Payout-Idempotency keyed on the row id", () => {
    expect(payoutFn).toMatch(/"X-Payout-Idempotency":\s*p\.referenceId/);
    // The dispatcher uses the queue row id as that key.
    expect(dispatch).toMatch(/referenceId:\s*item\.id/);
  });
  it("reference_id uniqueness is NOT relied on (it is not enforced by default)", () => {
    // reference_id still rides along for dashboard traceability, but the header
    // is the guarantee — a comment pins the reasoning so a later edit does not
    // "simplify" the header away believing reference_id covers it.
    expect(payoutFn).toMatch(/reference_id/);
    expect(payoutFn).toMatch(/X-Payout-Idempotency/);
  });
});

// ---------------------------------------------------------------------------
// STRUCTURAL — the dispatcher no longer swallows failures.
// ---------------------------------------------------------------------------
describe("dispatcher — every failure is observable and recoverable", () => {
  it("TEST 8 — outcomes are classified into paid / failed / unknown", () => {
    expect(dispatch).toMatch(/classifyPayout/);
    expect(dispatch).toMatch(/decision\.outcome === "paid"/);
    expect(dispatch).toMatch(/decision\.outcome === "failed"/);
  });
  it("an UNKNOWN outcome leaves the row processing — it is never marked failed", () => {
    // The unknown branch must not call mark(); it logs and lets the reaper act.
    expect(dispatch).toMatch(/left processing for reaper/);
  });
  it("the mark result is read, not swallowed with .catch(() => {})", () => {
    expect(dispatch).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\}\)/);
    expect(dispatch).toMatch(/markMisses/);
  });
  it("the reaper runs before the run claims anything (self-heal a prior crash)", () => {
    const reapAt = dispatch.indexOf("reap_stuck_payouts");
    const claimAt = dispatch.indexOf("claim_payout_batch");
    expect(reapAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(-1);
    expect(reapAt).toBeLessThan(claimAt);
  });
});

// ---------------------------------------------------------------------------
// The inlined edge classifier must agree with the shipped, tested one.
// ---------------------------------------------------------------------------
describe("the edge classifier mirrors the tested one", () => {
  it("shares the same retriable-status set", () => {
    const shipped = read("src/lib/creator/payoutClassify.ts");
    const set = /RETRIABLE_HTTP = new Set\(\[([0-9,\s]+)\]\)/;
    const a = shipped.match(set)?.[1]?.replace(/\s/g, "");
    const b = dispatch.match(set)?.[1]?.replace(/\s/g, "");
    expect(a, "shipped classifier retriable set").toBeTruthy();
    expect(b, "edge classifier retriable set").toBe(a);
  });
});

// ---------------------------------------------------------------------------
// MONEY-PATH REGRESSION — this change is concurrency only. run_creator_payouts'
// arithmetic (allocation, percentages, per-viewer split) is NOT in the parked
// migration, so it cannot have been altered by it.
// ---------------------------------------------------------------------------
describe("money-path regression — amounts and eligibility untouched", () => {
  it("the parked migration does not redefine run_creator_payouts", () => {
    expect(migration).not.toMatch(/function public\.run_creator_payouts/i);
  });
  it("the parked migration does not touch creator_payouts, percentages, or pools", () => {
    expect(migration).not.toMatch(/creator_pct|subscriber_pct|period_pool_paise/i);
    expect(migration).not.toMatch(/insert into creator_payouts/i);
  });
});
