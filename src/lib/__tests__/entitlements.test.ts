/**
 * THE PAYWALL'S CLIENT HALF, AND THE TWO WAYS IT USED TO HAND OUT THE PAID
 * RACK FOR FREE. Reported by the owner, 2026-08-16: "free tier fix for
 * lenses is not working for users."
 *
 * The server was never wrong — `has_entitlement` returns false for every free
 * account, checked against the live rows. Both faults were in this file, and
 * both failed OPEN, which is why an admin testing on their own account could
 * never have seen either: an admin has every entitlement and never renders a
 * lock at all.
 *
 * These are behavioural, not text pins. The supabase client is mocked so the
 * two failure shapes — an account switch, and a read that never comes back —
 * can actually be executed rather than described.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above every top-level statement, so the doubles it
// closes over have to be created in a hoisted block too.
const { getSession, rpc, onAuthStateChange } = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession, onAuthStateChange }, rpc },
}));
vi.mock("@/lib/errorReport", () => ({ reportClientError: vi.fn() }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forgetEntitlements, hasEntitlement } from "@/lib/entitlements";
import {
  AUDIO_BPS,
  MAX_VIDEO_BPS,
  MIN_VIDEO_BPS,
  VIDEO_UPLOAD_BUDGET_BPS,
  videoBitrateFor,
} from "@/lib/callCapacity";
import { reportClientError } from "@/lib/errorReport";

const sessionFor = (id: string | null) => async () => ({
  data: { session: id ? { user: { id } } : null },
  error: null,
});

beforeEach(() => {
  forgetEntitlements();
  vi.mocked(reportClientError).mockClear();
  rpc.mockReset();
  getSession.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hasEntitlement", () => {
  it("answers what the server says", async () => {
    getSession.mockImplementation(sessionFor("plus-user"));
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(hasEntitlement("all_lenses")).resolves.toBe(true);

    forgetEntitlements();
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(hasEntitlement("all_lenses")).resolves.toBe(false);
  });

  it("asks once per account, not once per mount", async () => {
    getSession.mockImplementation(sessionFor("someone"));
    rpc.mockResolvedValue({ data: true, error: null });
    await Promise.all([hasEntitlement("all_lenses"), hasEntitlement("all_lenses")]);
    await hasEntitlement("all_lenses");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  /**
   * DEFECT 1 — the cache was keyed by entitlement, not by account.
   *
   * Sign out and sign in as somebody else in a webview that never reloads —
   * which is exactly what the native shell does, and what happens when a
   * phone is handed over — and the previous account's answer was still there.
   * One admin sign-in unlocked every lens for whoever used the phone next.
   */
  it("does not let one account inherit another's answer", async () => {
    getSession.mockImplementation(sessionFor("the-admin"));
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(hasEntitlement("all_lenses")).resolves.toBe(true);

    // Same tab, same module, different person. No forgetEntitlements() call
    // here on purpose: the fix must hold even when nobody clears the cache.
    getSession.mockImplementation(sessionFor("a-free-user"));
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(
      hasEntitlement("all_lenses"),
      "the free account inherited the admin's unlocked rack",
    ).resolves.toBe(false);
  });

  /**
   * DEFECT 2 — a read that never returned left everything unlocked, forever.
   *
   * The old code awaited two un-timed network calls and cached the PENDING
   * promise. A stalled request left the hook at `null`, every caller renders
   * `null` as unlocked, and the cached promise meant it never retried. This
   * is the one that would hit a real phone mid-call, when WebRTC has the
   * radio.
   */
  it("resolves false — not never — when the read hangs", async () => {
    vi.useFakeTimers();
    getSession.mockImplementation(sessionFor("stuck-user"));
    rpc.mockImplementation(() => new Promise(() => {})); // never settles

    let settled: boolean | "pending" = "pending";
    const p = hasEntitlement("all_lenses").then((v) => (settled = v));
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(settled, "a hung read left the paid rack unlocked").toBe(false);
  });

  it("retries after a read it could not confirm, rather than pinning false", async () => {
    // The mirror of the fault above: caching an unconfirmed read would lock a
    // paying subscriber out of what they bought for the whole session.
    getSession.mockImplementation(sessionFor("subscriber"));
    rpc.mockResolvedValueOnce({ data: null, error: { message: "network" } });
    await expect(hasEntitlement("all_lenses")).resolves.toBe(false);

    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(hasEntitlement("all_lenses")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("files a report when it cannot confirm, so this is never invisible again", async () => {
    getSession.mockImplementation(sessionFor("subscriber"));
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    await hasEntitlement("all_lenses");
    expect(reportClientError).toHaveBeenCalledWith(
      "entitlement-unconfirmed",
      expect.stringContaining("all_lenses"),
      expect.objectContaining({ key: "all_lenses" }),
    );
  });

  it("is not an entitlement when nobody is signed in", async () => {
    getSession.mockImplementation(sessionFor(null));
    await expect(hasEntitlement("all_lenses")).resolves.toBe(false);
    expect(rpc, "asked the server about nobody").not.toHaveBeenCalled();
  });
});

/**
 * NO ROOM SIZE AT ALL — owner directive, 2026-08-16: group calls are free
 * with no participant cap, replacing the "free 4, Plus 8" directive of
 * earlier the same day.
 *
 * These tests changed direction rather than being deleted, and the direction
 * is the point. The old ones existed to prove the cap was never guessed HIGH,
 * because guessing high opened peer connections a phone could not carry. The
 * cap is gone, so what has to be proved now is the opposite pair: that no gate
 * survives anywhere, and that the thing which replaced it — a per-stream
 * bitrate that shrinks as the room grows — actually bounds the load the cap
 * used to bound.
 */
describe("group calls are uncapped", () => {
  it("exposes no way to read a per-account room size", async () => {
    // The entitlement module must not have grown a cap read back. This is the
    // file where one would naturally reappear.
    const mod = (await import("@/lib/entitlements")) as Record<string, unknown>;
    expect(Object.keys(mod)).not.toContain("callParticipantCap");
    expect(Object.keys(mod)).not.toContain("useCallCap");
  });

  it("asks the database for no such thing", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/entitlements.ts"), "utf8");
    expect(src.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "")).not.toContain("my_call_cap");
  });

  it("drops the cap from the schema rather than raising it", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260816200000_group_calls_uncapped.sql"),
      "utf8",
    );
    // All three, and in a single migration: a column without its check, or a
    // function reading a column that is gone, is a broken half-state.
    expect(sql).toContain("drop constraint if exists subscription_plans_call_cap_sane");
    expect(sql).toContain("drop function if exists public.my_call_cap(uuid)");
    expect(sql).toContain("drop column if exists max_call_participants");
  });

  it("leaves no client code reading the dropped column or function", () => {
    for (const f of [
      "src/components/stories/PlanSheet.tsx",
      "src/components/chat/CallOverlay.tsx",
      "src/integrations/supabase/types.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, `${f} still names the dropped column`).not.toContain("max_call_participants");
      expect(src, `${f} still names the dropped function`).not.toContain("my_call_cap");
    }
  });
});

/**
 * WHAT REPLACED THE CAP.
 *
 * A mesh costs every phone one upload per other participant, so the load the
 * cap used to bound is still real. The answer is to spend less per stream as
 * the room grows. These pin that the arithmetic actually bounds anything —
 * a "budget" that is never enforced would be a comment, not a guard.
 */
describe("videoBitrateFor", () => {
  it("gives small rooms exactly what shipped before the cap was lifted", () => {
    // 1:1 through 4-person calls are bit-for-bit unchanged. Lifting a cap
    // must not quietly downgrade the calls people already make.
    for (const peers of [1, 2, 3]) expect(videoBitrateFor(peers)).toBe(MAX_VIDEO_BPS);
  });

  it("shrinks as the room grows", () => {
    const rates = [4, 8, 12, 20].map(videoBitrateFor);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i], `rate did not fall from ${rates[i - 1]}`).toBeLessThan(rates[i - 1]);
    }
  });

  it("keeps total video upload inside the budget until the floor bites", () => {
    // THE ACTUAL GUARANTEE. Without this the function could return anything
    // decreasing and still let a twenty-person room melt a phone.
    for (let peers = 1; peers <= 40; peers++) {
      const total = peers * videoBitrateFor(peers);
      const flooredAt = VIDEO_UPLOAD_BUDGET_BPS / MIN_VIDEO_BPS;
      if (peers <= flooredAt) {
        expect(total, `${peers} peers exceeded the budget`).toBeLessThanOrEqual(
          VIDEO_UPLOAD_BUDGET_BPS + peers, // rounding slack, 1 bps per stream
        );
      }
    }
  });

  it("never sends worse than the floor, however large the room", () => {
    for (const peers of [50, 500, 5000]) {
      expect(videoBitrateFor(peers)).toBe(MIN_VIDEO_BPS);
    }
  });

  it("survives nonsense rather than returning NaN into setParameters", () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const n = videoBitrateFor(bad);
      expect(Number.isFinite(n), `videoBitrateFor(${String(bad)}) was not finite`).toBe(true);
      expect(n).toBeGreaterThanOrEqual(MIN_VIDEO_BPS);
      expect(n).toBeLessThanOrEqual(MAX_VIDEO_BPS);
    }
  });

  it("never scales audio down — voice is what a call is for", () => {
    expect(AUDIO_BPS).toBe(64_000);
    const src = readFileSync(join(process.cwd(), "src/lib/callCapacity.ts"), "utf8");
    expect(src, "AUDIO_BPS became a function of room size").not.toMatch(
      /audioBitrateFor|AUDIO_BPS\s*\/|AUDIO_BPS\s*\*/,
    );
  });
});
