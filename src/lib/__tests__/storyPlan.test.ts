/**
 * Two things matter here and they are both about money.
 *
 * The plan must never ask the generator for a clip it cannot make, because a
 * shot over the ceiling fails AFTER the stills for the whole Story have been
 * paid for. And the quota must refuse before anything billable happens, in the
 * right order, because a kill switch that is checked second is not a kill
 * switch.
 */
import { describe, expect, it } from "vitest";
import { MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "@/lib/shotAllocation";
import {
  DEFAULT_STORY_SECONDS,
  MAX_STORY_SECONDS,
  MIN_STORY_SECONDS,
  checkStoryQuota,
  planStory,
  remainingSeconds,
} from "@/lib/storyPlan";

describe("planStory splits a duration into generatable shots", () => {
  it("sums to the requested seconds exactly, across the whole range", () => {
    // A sweep rather than examples: the remainder is where an off-by-one hides,
    // and a Story that is one second short of what the user asked for is a bug
    // they can see.
    for (let s = MIN_STORY_SECONDS; s <= MAX_STORY_SECONDS; s += 7) {
      const plan = planStory(s);
      expect(plan.shots.reduce((a, x) => a + x.seconds, 0), `${s}s`).toBe(plan.seconds);
      expect(plan.seconds).toBe(s);
    }
  });

  it("never asks for a clip longer than the generator can make", () => {
    for (let s = MIN_STORY_SECONDS; s <= MAX_STORY_SECONDS; s += 3) {
      for (const shot of planStory(s).shots) {
        expect(shot.seconds, `${s}s shot ${shot.index}`).toBeLessThanOrEqual(MAX_SHOT_SECONDS);
      }
    }
  });

  it("never produces a shot too short to read as a shot", () => {
    for (let s = MIN_STORY_SECONDS; s <= MAX_STORY_SECONDS; s += 3) {
      for (const shot of planStory(s).shots) {
        expect(shot.seconds, `${s}s shot ${shot.index}`).toBeGreaterThanOrEqual(MIN_SHOT_SECONDS);
      }
    }
  });

  it("plans the default minute at roughly the measured shot rate", () => {
    // Episode 3 measured 8.7 shots per minute. A minute should land near that,
    // not at the naive six that ten-second clips would suggest.
    const plan = planStory(DEFAULT_STORY_SECONDS);
    expect(plan.shots.length).toBeGreaterThanOrEqual(7);
    expect(plan.shots.length).toBeLessThanOrEqual(10);
    expect(plan.generations).toBe(plan.shots.length * 2);
  });

  it("adds shots when the clip ceiling demands more than pacing does", () => {
    // Unreachable with the shipped constants — pacing always wins — so it is
    // driven through the limits. A 3s ceiling over 60s needs 20 shots where
    // pacing would ask for 8.
    const plan = planStory(60, { maxShotSeconds: 3, shotsPerMinute: 8.5 });
    expect(plan.shots.length).toBeGreaterThanOrEqual(20);
    for (const shot of plan.shots) expect(shot.seconds).toBeLessThanOrEqual(3);
  });

  it("removes shots when pacing would push them under the floor", () => {
    // 60 shots per minute over 20s is 20 shots of 1s, under a 5s floor. The cap
    // must pull it back to 4.
    const plan = planStory(20, { shotsPerMinute: 60, minShotSeconds: 5 });
    expect(plan.shots.length).toBeLessThanOrEqual(4);
    for (const shot of plan.shots) expect(shot.seconds).toBeGreaterThanOrEqual(5);
    expect(plan.shots.reduce((a, x) => a + x.seconds, 0)).toBe(20);
  });

  it("clamps rather than throwing on a silly length", () => {
    expect(planStory(1).seconds).toBe(MIN_STORY_SECONDS);
    expect(planStory(99999).seconds).toBe(MAX_STORY_SECONDS);
  });

  it("rejects a length that is not one", () => {
    expect(() => planStory(NaN)).toThrow(/not a duration/);
    expect(() => planStory(Infinity)).toThrow(/not a duration/);
  });

  it("reports one still and one clip per shot, which is what gets billed", () => {
    const plan = planStory(120);
    expect(plan.generations).toBe(plan.shots.length * 2);
  });
});

describe("checkStoryQuota refuses before anything is spent", () => {
  const ok = { enabled: true, freeSeconds: 3000, usedSeconds: 0 };

  it("allows a request inside the allowance", () => {
    expect(checkStoryQuota(ok, 60)).toBeNull();
  });

  it("checks the kill switch FIRST, even when the allowance is ALSO exhausted", () => {
    // Order is the point, and the case has to make both branches true or it
    // proves nothing — an earlier version of this test left remaining > 0, so
    // the exhausted branch never competed and swapping the two still passed.
    const off = { enabled: false, freeSeconds: 10, usedSeconds: 10 };
    expect(checkStoryQuota(off, 5)?.reason).toBe("disabled");
  });

  it("refuses when the allowance is spent", () => {
    const spent = { enabled: true, freeSeconds: 3000, usedSeconds: 3000 };
    const r = checkStoryQuota(spent, 10);
    expect(r?.reason).toBe("exhausted");
    expect(r?.remaining).toBe(0);
  });

  it("refuses a request larger than what is left, and says how much is left", () => {
    const nearly = { enabled: true, freeSeconds: 3000, usedSeconds: 2970 };
    const r = checkStoryQuota(nearly, 60);
    expect(r?.reason).toBe("too-long");
    expect(r?.remaining).toBe(30);
    expect(r?.message).toContain("30s");
  });

  it("allows a request that exactly exhausts the allowance", () => {
    const nearly = { enabled: true, freeSeconds: 3000, usedSeconds: 2940 };
    expect(checkStoryQuota(nearly, 60)).toBeNull();
  });

  it("checks the product-wide ceiling before anything about this user", () => {
    // When the day's budget is gone it is gone for everyone. Telling one user
    // about their personal allowance answers a question they did not ask.
    // BOTH conditions must hold or the test proves nothing. An earlier version
    // left the personal allowance untouched, so the exhausted branch never
    // competed and reordering the two still passed — the same vacuous-ordering
    // mistake made on the kill switch earlier in this file's history.
    const busy = {
      enabled: true,
      freeSeconds: 300,
      usedSeconds: 300, // personally exhausted TOO
      globalDailyUsedSeconds: 3600,
      globalDailySeconds: 3600,
    };
    expect(checkStoryQuota(busy, 60)?.reason).toBe("capacity");
  });

  it("caps a single user's day even when their lifetime allowance is untouched", () => {
    // The lifetime allowance alone does not stop one account spending it all in
    // an hour, which is exactly what a compromised account does.
    const heavy = { enabled: true, freeSeconds: 3000, usedSeconds: 0, dailyUsedSeconds: 120 };
    const r = checkStoryQuota(heavy, 60);
    expect(r?.reason).toBe("daily");
    expect(r?.message).toMatch(/tomorrow/);
  });

  it("tells a user how much of today is left when some remains", () => {
    const partial = { enabled: true, freeSeconds: 3000, usedSeconds: 0, dailyUsedSeconds: 90 };
    expect(checkStoryQuota(partial, 60)?.message).toContain("30s");
  });

  it("allows a request that exactly fills the daily cap", () => {
    const edge = { enabled: true, freeSeconds: 3000, usedSeconds: 0, dailyUsedSeconds: 60 };
    expect(checkStoryQuota(edge, 60)).toBeNull();
  });

  it("never reports negative remaining, even if usage overshot", () => {
    // Overshoot is possible if a generation is counted twice under a race. The
    // number shown to a user must still make sense.
    const over = { enabled: true, freeSeconds: 100, usedSeconds: 140 };
    expect(remainingSeconds(over)).toBe(0);
    expect(checkStoryQuota(over, 5)?.remaining).toBe(0);
  });
});
