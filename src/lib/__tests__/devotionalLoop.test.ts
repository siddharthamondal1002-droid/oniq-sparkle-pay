/**
 * The devotional loop, and the faith isolation it rides on.
 *
 * Two separate concerns, both worth pinning:
 *
 * THE LOOP is anchored to wall-clock timestamps rather than to a running
 * interval, because a phone suspends the tab. Every assertion below feeds
 * `now` in explicitly, which is why the module takes it as a parameter — a
 * Date.now() inside would make the behaviour untestable without fake timers
 * and would hide exactly the case that matters (a long gap while suspended).
 *
 * THE ISOLATION is the Jain bleed bug's fix. A faith with no channels shows
 * its own empty state and NEVER another faith's content. The mapping now
 * lives in one place because app.faith.tsx WRITES the key that Watch and Home
 * READ, and two copies of the rule is how a user ends up looking at somebody
 * else's tradition.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEVOTIONAL_DURATIONS,
  FAITH_LS_KEY,
  formatRemaining,
  loopPhase,
  loopRemainingSec,
  religionToFaithId,
  type Religion,
} from "@/lib/devotionalLoop";
import { FAITH_ENTRIES, faithChannelsFor } from "@/data/watchDirectory";
import type { FaithId } from "@/data/faithContent";

const ROOT = process.cwd();
const T0 = 1_700_000_000_000;

describe("the loop is anchored to the clock, not to an interval", () => {
  const loop = { startedAt: T0, durationSec: 3 * 60 * 60 };

  it("is active until the duration has really elapsed", () => {
    expect(loopPhase(loop, T0)).toBe("active");
    expect(loopPhase(loop, T0 + 60_000)).toBe("active");
    // One millisecond before the end.
    expect(loopPhase(loop, T0 + 3 * 60 * 60 * 1000 - 1)).toBe("active");
  });

  it("ends exactly on time, not a tick late", () => {
    expect(loopPhase(loop, T0 + 3 * 60 * 60 * 1000)).toBe("ended");
    expect(loopPhase(loop, T0 + 4 * 60 * 60 * 1000)).toBe("ended");
  });

  it("SURVIVES the app being suspended — the whole reason for timestamps", () => {
    // Background the app 20 minutes in, come back an hour later. An
    // interval-based timer would have been frozen and would report 20 minutes
    // elapsed; the clock knows it is 80.
    const backAt = T0 + 80 * 60 * 1000;
    expect(loopPhase(loop, backAt)).toBe("active");
    expect(loopRemainingSec(loop, backAt)).toBe(100 * 60);
  });

  it("reports no loop when there is none", () => {
    expect(loopPhase(null, T0)).toBe("none");
    expect(loopRemainingSec(null, T0)).toBe(0);
  });

  it("never reports negative time left", () => {
    expect(loopRemainingSec(loop, T0 + 99 * 60 * 60 * 1000)).toBe(0);
  });

  it("keeps the original durations", () => {
    expect(DEVOTIONAL_DURATIONS.map((d) => d.sec)).toEqual([
      600, 1800, 3600, 10800, 21600, 43200, 86400,
    ]);
  });

  it.each([
    [0, "0s"],
    [45, "45s"],
    [60, "1m"],
    [90, "1m"],
    [3600, "1h"],
    [3660, "1h 1m"],
    [9900, "2h 45m"],
  ])("formats %i seconds as %s", (sec, want) => {
    expect(formatRemaining(sec)).toBe(want);
  });
});

describe("faith isolation", () => {
  const FAITHS: FaithId[] = ["islamic", "sikh", "hindu", "christian", "buddhist", "jain", "jewish"];

  it("maps every religion the picker offers, and nothing else", () => {
    const picker: Religion[] = [
      "hindu",
      "islam",
      "christian",
      "sikh",
      "buddhist",
      "jain",
      "jewish",
    ];
    for (const r of picker) expect(religionToFaithId(r)).not.toBeNull();
    expect(religionToFaithId("islam")).toBe("islamic");
    expect(religionToFaithId("hindu")).toBe("hindu");
  });

  it("returns null for no choice and for junk — NEVER a default faith", () => {
    // A default here is the bleed bug: it would show one tradition's channels
    // to somebody who picked another, or to somebody who picked none.
    expect(religionToFaithId(null)).toBeNull();
    expect(religionToFaithId("pastafarian" as Religion)).toBeNull();
    expect(religionToFaithId("" as Religion)).toBeNull();
  });

  it("shows nothing at all when no faith is chosen", () => {
    expect(faithChannelsFor(null)).toEqual([]);
  });

  it("never leaks one faith's channels into another's list", () => {
    for (const a of FAITHS) {
      for (const e of faithChannelsFor(a)) {
        expect(e.faith, `${e.name} surfaced under ${a}`).toBe(a);
      }
    }
  });

  it("every faith in the roster is reachable from the picker", () => {
    // A faith with channels but no route to them is a silent outage.
    const reachable = new Set(
      (["hindu", "islam", "christian", "sikh", "buddhist", "jain", "jewish"] as Religion[])
        .map(religionToFaithId)
        .filter(Boolean),
    );
    for (const e of FAITH_ENTRIES) {
      expect(reachable.has(e.faith), `${e.faith} has entries but no picker route`).toBe(true);
    }
  });

  it("keeps ONE copy of the religion→faith mapping", () => {
    // app.faith.tsx WRITES the key the other two screens read. It used to
    // carry its own copy of this mapping; two copies is how the screens drift
    // apart and a user is shown someone else's tradition.
    const faithScreen = readFileSync(join(ROOT, "src/routes/_authenticated/app.faith.tsx"), "utf8");
    expect(faithScreen).toContain("sharedReligionToFaithId");
    expect(faithScreen, "app.faith.tsx redefined the mapping").not.toMatch(
      /function religionToFaithId/,
    );
    // And it must not hardcode the storage key next to the shared one.
    expect(faithScreen).toContain("FAITH_LS_KEY");
    expect(FAITH_LS_KEY).toBe("oniq.faith.religion.v1");
  });
});

describe("radio did not come back with the channels", () => {
  it("plays no stream URL of its own, anywhere", () => {
    // The removal commit's own reading, and it is right: devotional radio
    // piped Radio Browser's `url_resolved` straight into new Audio(), with no
    // rights-holder player in the path at all. Channels came back on
    // 2026-08-16 because YouTube's embed puts their player in the middle.
    // This one has no such middle, so it stays a directory.
    const faithScreen = readFileSync(join(ROOT, "src/routes/_authenticated/app.faith.tsx"), "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(faithScreen, "a raw audio player is back").not.toMatch(/new Audio\(/);
    expect(faithScreen, "a resolved stream URL is back").not.toMatch(/url_resolved/);

    const fn = readFileSync(join(ROOT, "supabase/functions/devotional-radio/index.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(fn, "the edge function serves a stream URL again").not.toMatch(/url_resolved/);
  });
});
