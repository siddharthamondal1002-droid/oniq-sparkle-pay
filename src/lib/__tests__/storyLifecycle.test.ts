/**
 * One property matters here: nothing is left behind.
 *
 * The product promise is that a user's Story lives on our servers only while it
 * is being made and is deleted once it reaches their device. If a state exists
 * from which bytes are never swept, we are quietly hosting user video — and
 * that is not a bug anyone notices until it is a disclosure.
 *
 * So the central test is exhaustive over the status set rather than
 * example-based: every state either purges, ages into a purge, or is provably
 * in-flight.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  READY_TTL_MS,
  STALE_TTL_MS,
  type StoryJob,
  type StoryStatus,
  assertTransition,
  canTransition,
  jobsToPurge,
  owesPurge,
  purgeReason,
} from "@/lib/storyLifecycle";

const ALL: StoryStatus[] = [
  "queued",
  "generating",
  "assembling",
  "ready",
  "delivering",
  "delivered",
  "failed",
  "purged",
];

const NOW = 1_700_000_000_000;
const job = (status: StoryStatus, ageMs = 0, hasBytes = true): StoryJob => ({
  id: `s_${status}`,
  status,
  updatedAt: NOW - ageMs,
  hasBytes,
});

describe("every Story eventually leaves our servers", () => {
  it("purges or ages into a purge from EVERY state that holds bytes", () => {
    // Exhaustive over the status set. A new status added without a sweep rule
    // fails here rather than silently becoming a place video accumulates.
    const forever = 10 * 365 * 24 * 60 * 60 * 1000;
    for (const status of ALL) {
      if (status === "delivering") continue; // in flight — asserted separately below
      expect(owesPurge(job(status, forever), NOW), `${status} after ten years`).toBe(true);
    }
  });

  it("never purges a job that has no bytes", () => {
    for (const status of ALL) {
      expect(owesPurge(job(status, 0, false), NOW), status).toBe(false);
    }
  });

  it("purges delivered and failed immediately, without waiting", () => {
    expect(owesPurge(job("delivered", 0), NOW)).toBe(true);
    expect(owesPurge(job("failed", 0), NOW)).toBe(true);
  });

  it("catches an orphan: marked purged but the bytes are still there", () => {
    // A delete that failed after the row was updated. Status-only sweeping
    // would skip this forever, which is the worst case — it looks clean.
    const orphan = job("purged", 0, true);
    expect(owesPurge(orphan, NOW)).toBe(true);
    expect(purgeReason(orphan, NOW)).toBe("orphaned");
  });

  it("does not delete out from under a transfer in flight", () => {
    // `delivering` means bytes are being read right now. Purging here loses the
    // video for a user who is mid-download.
    expect(owesPurge(job("delivering", READY_TTL_MS * 5), NOW)).toBe(false);
  });

  it("holds a ready Story for the TTL, then expires it", () => {
    expect(owesPurge(job("ready", READY_TTL_MS - 1000), NOW)).toBe(false);
    expect(owesPurge(job("ready", READY_TTL_MS + 1000), NOW)).toBe(true);
    expect(purgeReason(job("ready", READY_TTL_MS + 1000), NOW)).toBe("expired");
  });

  it("sweeps a job that died mid-generation", () => {
    for (const status of ["queued", "generating", "assembling"] as const) {
      expect(owesPurge(job(status, STALE_TTL_MS - 1000), NOW), `${status} fresh`).toBe(false);
      expect(owesPurge(job(status, STALE_TTL_MS + 1000), NOW), `${status} stale`).toBe(true);
      expect(purgeReason(job(status, STALE_TTL_MS + 1000), NOW)).toBe("stale");
    }
  });

  it("returns exactly the jobs a sweeper should act on", () => {
    const jobs = [
      job("ready", 1000), // fresh, keep
      job("ready", READY_TTL_MS + 1), // expired
      job("delivered", 0), // done
      job("generating", 1000), // working, keep
      job("failed", 0), // failed
      job("delivering", READY_TTL_MS * 3), // in flight, keep
      job("purged", 0, false), // already clean, keep out
    ];
    const ids = jobsToPurge(jobs, NOW).map((j) => j.status);
    expect(ids.sort()).toEqual(["delivered", "failed", "ready"]);
  });
});

describe("transitions", () => {
  it("makes purged terminal", () => {
    for (const to of ALL) expect(canTransition("purged", to), `purged -> ${to}`).toBe(false);
  });

  it("lets every state reach purged", () => {
    for (const from of ALL) {
      if (from === "purged") continue;
      expect(canTransition(from, "purged"), `${from} -> purged`).toBe(true);
    }
  });

  it("requires the device to confirm before we delete", () => {
    // ready -> delivering -> delivered, not ready -> delivered. Deleting on
    // "download started" loses the file for anyone whose connection drops.
    expect(canTransition("ready", "delivered")).toBe(false);
    expect(canTransition("ready", "delivering")).toBe(true);
    expect(canTransition("delivering", "delivered")).toBe(true);
  });

  it("lets a dropped transfer fall back to ready so it can be retried", () => {
    expect(canTransition("delivering", "ready")).toBe(true);
  });

  it("refuses to skip generation", () => {
    expect(canTransition("queued", "ready")).toBe(false);
    expect(canTransition("queued", "delivered")).toBe(false);
    expect(canTransition("generating", "ready")).toBe(false);
  });

  it("throws with both states named", () => {
    expect(() => assertTransition("delivered", "ready")).toThrow(/delivered -> ready/);
  });
});

/**
 * The sweeper's copy of these rules must not drift from this one.
 *
 * `supabase/functions/story-sweep` cannot import this module — edge functions
 * bundle from `supabase/functions`, and reaching into `src/` makes the deploy
 * fragile — so it restates READY_TTL_MS, STALE_TTL_MS and owesPurge's branch
 * order. Two copies of a rule is a defect waiting for someone to change one of
 * them, and the only thing that makes it acceptable is a test that reads both.
 *
 * These assertions are deliberately about the SOURCE TEXT. A behavioural test
 * would need a Deno runtime and a storage client; reading the constants catches
 * the failure that actually happens, which is somebody editing a TTL here and
 * not there.
 */
describe("story-sweep mirrors the lifecycle rules", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sweeper = readFileSync(
    resolve(here, "../../../supabase/functions/story-sweep/index.ts"),
    "utf8",
  );

  const constantIn = (source: string, name: string): string | null => {
    const m = new RegExp(`const ${name}\\s*=\\s*([^;]+);`).exec(source);
    return m ? m[1].replace(/\s+/g, " ").trim() : null;
  };

  it("uses the same TTLs, written the same way", () => {
    const lifecycle = readFileSync(resolve(here, "../storyLifecycle.ts"), "utf8");
    for (const name of ["READY_TTL_MS", "STALE_TTL_MS"]) {
      const here = constantIn(lifecycle, name);
      const there = constantIn(sweeper, name);
      expect(here, `${name} missing from storyLifecycle.ts`).toBeTruthy();
      expect(there, `${name} missing from story-sweep`).toBeTruthy();
      expect(there, `${name} drifted between the two copies`).toBe(here);
    }
  });

  it("still excludes an in-flight transfer from deletion", () => {
    // The one branch whose absence would delete a file out from under somebody
    // mid-download. owesPurge() here returns false for `delivering`; the
    // sweeper must not have grown a case for it.
    expect(owesPurge(job("delivering", 10 * READY_TTL_MS), NOW)).toBe(false);
    expect(sweeper).not.toMatch(/status === "delivering"\s*\)\s*return true/);
  });

  it("asks about bytes rather than status", () => {
    // The whole point of owesPurge. A sweeper that filtered on status would
    // never see the row whose delete failed after it was marked purged.
    expect(sweeper).toMatch(/has_bytes=is\.true/);
    expect(sweeper).toMatch(/status === "purged"\) return true/);
  });
});
