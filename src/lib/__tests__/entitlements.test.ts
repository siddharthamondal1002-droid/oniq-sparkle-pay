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
import { callParticipantCap, forgetEntitlements, hasEntitlement } from "@/lib/entitlements";
import {
  FREE_CALL_PARTICIPANTS,
  MAX_CALL_PARTICIPANTS,
  PLUS_CALL_PARTICIPANTS,
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
 * THE ROOM SIZE — free 4, Plus 8 (owner directive, 2026-08-16).
 *
 * Every one of these is about the DIRECTION of the failure. The cap is not a
 * permission, it is a load limit on a mesh: guessing high means a phone opens
 * peer connections it cannot carry and ONIQ pays to relay them.
 */
describe("callParticipantCap", () => {
  it("reads the plan's room", async () => {
    getSession.mockImplementation(sessionFor("subscriber"));
    rpc.mockResolvedValue({ data: 8, error: null });
    await expect(callParticipantCap()).resolves.toBe(PLUS_CALL_PARTICIPANTS);
  });

  it("falls back to the FREE room, never the Plus one", async () => {
    getSession.mockImplementation(sessionFor("unlucky"));
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    await expect(callParticipantCap()).resolves.toBe(FREE_CALL_PARTICIPANTS);
  });

  it("treats a nonsense cap as unconfirmed rather than obeying it", async () => {
    // A plan row edited to 400 must not become a phone's problem. Anything
    // outside the sane band reads as "could not determine" and gets free.
    getSession.mockImplementation(sessionFor("someone"));
    for (const bad of [400, 0, -3, Number.NaN, "lots"]) {
      forgetEntitlements();
      rpc.mockResolvedValue({ data: bad, error: null });
      await expect(callParticipantCap(), `cap ${String(bad)} was obeyed`).resolves.toBe(
        FREE_CALL_PARTICIPANTS,
      );
    }
  });

  it("resolves — not never — when the read hangs", async () => {
    vi.useFakeTimers();
    getSession.mockImplementation(sessionFor("stuck"));
    rpc.mockImplementation(() => new Promise(() => {}));
    let settled: number | "pending" = "pending";
    const p = callParticipantCap().then((v) => (settled = v));
    await vi.advanceTimersByTimeAsync(6000);
    await p;
    expect(settled).toBe(FREE_CALL_PARTICIPANTS);
  });

  it("does not let one account inherit another's room", async () => {
    getSession.mockImplementation(sessionFor("the-admin"));
    rpc.mockResolvedValue({ data: 8, error: null });
    await expect(callParticipantCap()).resolves.toBe(8);
    getSession.mockImplementation(sessionFor("a-free-user"));
    rpc.mockResolvedValue({ data: 4, error: null });
    await expect(callParticipantCap()).resolves.toBe(4);
  });

  it("keeps the sane band tied to what the plans may actually sell", () => {
    // MAX is what the migration's check constraint allows, so the client's
    // rejection band and the database's cannot drift apart silently.
    expect(MAX_CALL_PARTICIPANTS).toBe(PLUS_CALL_PARTICIPANTS);
    expect(FREE_CALL_PARTICIPANTS).toBeLessThan(PLUS_CALL_PARTICIPANTS);
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260816100000_call_participant_cap.sql"),
      "utf8",
    );
    expect(sql).toContain(`between 2 and ${MAX_CALL_PARTICIPANTS}`);
    expect(sql).toContain(`max_call_participants = ${FREE_CALL_PARTICIPANTS} where key in ('free'`);
  });
});
