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
import { stripComments } from "../../test/sourceText.ts";
import {
  READY_TTL_MS,
  RENDER_ACTIVE_TTL_MS,
  STALE_TTL_MS,
  type StoryJob,
  type StoryStatus,
  assertTransition,
  canTransition,
  jobsToPurge,
  owesPurge,
  purgeReason,
  staleTtlForActive,
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

  it("sweeps an UNCLAIMED queued job at the 30-minute TTL", () => {
    expect(owesPurge(job("queued", STALE_TTL_MS - 1000), NOW), "queued fresh").toBe(false);
    expect(owesPurge(job("queued", STALE_TTL_MS + 1000), NOW), "queued stale").toBe(true);
    expect(purgeReason(job("queued", STALE_TTL_MS + 1000), NOW)).toBe("stale");
  });

  it("does NOT sweep an actively-rendering job at 30 minutes — a 300s film takes ~40", () => {
    // The bug that killed every 300s film: generating/assembling was reaped at
    // the queued TTL while the runner was still rendering. Now it survives until
    // its workflow could not still be alive.
    for (const status of ["generating", "assembling"] as const) {
      expect(owesPurge(job(status, STALE_TTL_MS + 1000), NOW), `${status} @31min`).toBe(false);
      expect(owesPurge(job(status, RENDER_ACTIVE_TTL_MS - 1000), NOW), `${status} @149min`).toBe(
        false,
      );
      expect(owesPurge(job(status, RENDER_ACTIVE_TTL_MS + 1000), NOW), `${status} @151min`).toBe(
        true,
      );
      expect(purgeReason(job(status, RENDER_ACTIVE_TTL_MS + 1000), NOW)).toBe("stale");
    }
  });

  it("staleTtlForActive gives render states the long window and queued the short one", () => {
    expect(staleTtlForActive("queued")).toBe(STALE_TTL_MS);
    expect(staleTtlForActive("generating")).toBe(RENDER_ACTIVE_TTL_MS);
    expect(staleTtlForActive("assembling")).toBe(RENDER_ACTIVE_TTL_MS);
    expect(RENDER_ACTIVE_TTL_MS).toBeGreaterThan(STALE_TTL_MS);
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
    for (const name of ["READY_TTL_MS", "STALE_TTL_MS", "RENDER_ACTIVE_TTL_MS"]) {
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

/**
 * A FILM THAT CANNOT BE EXPIRED IS A FILM NOBODY IS EVER TOLD ABOUT.
 *
 * Measured 2026-09-11. `story-dispatch` stamps `dispatched_at` BEFORE its GitHub
 * call — deliberately, so an isolate that dies mid-flight does not re-dispatch a
 * minute later — and `story_jobs_guard_transition` opens with
 * `new.updated_at := now()` on EVERY update, read from `pg_proc` rather than
 * assumed. So during a dispatch outage the retry loop refreshes `updated_at`
 * about every ten minutes, `STALE_TTL_MS` never elapses, and the film is never
 * failed and never refunded. Two films sat `queued` for two days that way.
 *
 * These assertions read the SOURCE TEXT for the same reason the block above
 * does — the sweep needs a Deno runtime and a storage client to execute — and
 * they strip comments first, because every comment in that region quotes
 * `updated_at`, `created_at`, `dispatched_at` and `dispatcherDown` in order to
 * explain them.
 */
describe("story-sweep can expire a film the dispatcher keeps touching", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const code = stripComments(
    readFileSync(resolve(here, "../../../supabase/functions/story-sweep/index.ts"), "utf8"),
  );

  /** The worst queue wait ever observed over 117 films that reached `ready`. */
  const WORST_OBSERVED_QUEUE_WAIT_MS = 66 * 60 * 1000;

  it("carries a second queued clock, longer than the worst real wait", () => {
    const m = /const QUEUED_ABANDONED_TTL_MS\s*=\s*([^;]+);/.exec(code);
    expect(m, "QUEUED_ABANDONED_TTL_MS missing from story-sweep").toBeTruthy();
    const value = Number(eval(m![1]));
    expect(value).toBeGreaterThan(STALE_TTL_MS);
    expect(value).toBeGreaterThan(WORST_OBSERVED_QUEUE_WAIT_MS);
  });

  it("keys that clock on created_at, which nothing writes after the insert", () => {
    // updated_at would be refreshed by the very retry loop this exists to
    // survive; created_at cannot be moved by any later write.
    expect(code).toMatch(/abandonedBefore\s*=\s*new Date\(now - QUEUED_ABANDONED_TTL_MS\)/);
    expect(code).toContain("and(status.eq.queued,created_at.lt.${abandonedBefore})");
  });

  it("keeps BOTH queued clauses — the new one adds a route, it does not replace one", () => {
    const queuedClauses = [...code.matchAll(/and\(status\.eq\.queued,/g)];
    expect(queuedClauses).toHaveLength(2);
    expect(code).toContain("and(status.eq.queued,updated_at.lt.${deadBefore})");
  });

  it("words the failure from the dispatcher's health BEFORE the dispatch stamp", () => {
    // `dispatched_at` is stamped before the call, so a stamp means ATTEMPTED and
    // never "a runner took it". Reading it first told every person in an outage
    // that a renderer had taken their film and abandoned it.
    const why = code.slice(code.indexOf("const why ="), code.indexOf("const marked ="));
    expect(why).toBeTruthy();
    expect(why.indexOf("dispatcherDown")).toBeGreaterThan(-1);
    expect(why.indexOf("dispatcherDown")).toBeLessThan(why.indexOf("row.dispatched_at"));
  });
});
