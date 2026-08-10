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
  parseClaimResult,
  planStory,
  refusalMessage,
  remainingSeconds,
} from "@/lib/storyPlan";

describe("planStory splits a duration into generatable shots", () => {
  it("sums to the requested seconds exactly, across the whole range", () => {
    // A sweep rather than examples: the remainder is where an off-by-one hides,
    // and a Story that is one second short of what the user asked for is a bug
    // they can see.
    for (let s = MIN_STORY_SECONDS; s <= MAX_STORY_SECONDS; s += 7) {
      const plan = planStory(s);
      expect(
        plan.shots.reduce((a, x) => a + x.seconds, 0),
        `${s}s`,
      ).toBe(plan.seconds);
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

  it("says capacity when the day's budget is gone and the user still has balance", () => {
    // When the day's free budget is spent it is spent for everyone, and a user
    // who could otherwise have generated needs to hear that rather than
    // something about their own allowance.
    const busy = {
      enabled: true,
      freeSeconds: 300,
      usedSeconds: 0,
      globalDailyUsedSeconds: 3600,
      globalDailySeconds: 3600,
    };
    expect(checkStoryQuota(busy, 60)?.reason).toBe("capacity");
  });

  it("says exhausted, not capacity, when the user is out too — because tomorrow will not help", () => {
    // THIS ASSERTION IS THE REVERSE OF WHAT IT USED TO BE, and the old one was
    // wrong. It asserted "capacity" here on the reasoning that a spent day is
    // spent for everyone. But freeSeconds is a LIFETIME allowance, not a daily
    // one: a user who has used 300 of 300 will still have used 300 of 300
    // tomorrow. "Story generation is busy today, try again tomorrow" promised
    // this person something the next day does not deliver, and it hid the only
    // thing that would actually help them, which is that their free time is
    // finished and there is a way to buy more.
    const busyAndSpent = {
      enabled: true,
      freeSeconds: 300,
      usedSeconds: 300,
      paidSeconds: 0,
      globalDailyUsedSeconds: 3600,
      globalDailySeconds: 3600,
    };
    expect(checkStoryQuota(busyAndSpent, 60)?.reason).toBe("exhausted");
  });

  it("lets a paid Story through on a day the free budget is fully spent", () => {
    // The property the whole paid bucket exists for. Someone who bought five
    // minutes and is then told "try again tomorrow" because OTHER people used
    // the free budget has not hit a capacity limit, they have been sold
    // something and refused it. The ceiling bounds free spend; a purchase is
    // revenue-covered and passes.
    const paidOnBusyDay = {
      enabled: true,
      freeSeconds: 300,
      usedSeconds: 300,
      paidSeconds: 300,
      globalDailyUsedSeconds: 3600,
      globalDailySeconds: 3600,
    };
    expect(checkStoryQuota(paidOnBusyDay, 300)).toBeNull();
  });

  it("spends free seconds before paid ones", () => {
    // Burning what somebody bought while they still have free time is a way to
    // lose a customer quietly. 60s wanted, 120s free available, so nothing paid
    // should be needed — proven by the fact that a user with the same free
    // balance and NO paid seconds is equally allowed.
    const both = { enabled: true, freeSeconds: 300, usedSeconds: 0, paidSeconds: 300 };
    const freeOnly = { enabled: true, freeSeconds: 300, usedSeconds: 0, paidSeconds: 0 };
    expect(checkStoryQuota(both, 60)).toBeNull();
    expect(checkStoryQuota(freeOnly, 60)).toBeNull();
  });

  it("does not apply the per-user daily cap to purchased seconds", () => {
    // The daily cap bounds what one FREE user can cost in a day. Applying it to
    // bought time would sell somebody five minutes and then ration it to two.
    const boughtOut = {
      enabled: true,
      freeSeconds: 300,
      usedSeconds: 300, // no free left, so the whole request is paid
      dailyUsedSeconds: 120, // and the daily cap is already spent
      dailySeconds: 120,
      paidSeconds: 300,
    };
    expect(checkStoryQuota(boughtOut, 300)).toBeNull();
  });

  it("still refuses when the paid balance is too small, and says so as too-long", () => {
    const notEnough = {
      enabled: true,
      freeSeconds: 300,
      usedSeconds: 300,
      paidSeconds: 60,
    };
    const r = checkStoryQuota(notEnough, 300);
    expect(r?.reason).toBe("too-long");
    // The sentence quotes the COMBINED balance. Telling someone who owns 60
    // purchased seconds that they have "0s of free time left" is true and
    // useless.
    expect(r?.message).toMatch(/60s left/);
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

  it("says the same sentence the RPC path will say, for every reason", () => {
    // The pure check and the parsed RPC result both go through
    // refusalMessage(). If one of them ever formatted its own string, this is
    // where the two would stop matching.
    const cases = [
      { state: { enabled: false, freeSeconds: 300, usedSeconds: 0 }, wanted: 60 },
      { state: { enabled: true, freeSeconds: 300, usedSeconds: 300 }, wanted: 60 },
      {
        state: { enabled: true, freeSeconds: 300, usedSeconds: 0, dailyUsedSeconds: 120 },
        wanted: 60,
      },
      { state: { enabled: true, freeSeconds: 40, usedSeconds: 0 }, wanted: 60 },
    ];
    for (const { state, wanted } of cases) {
      const r = checkStoryQuota(state, wanted)!;
      expect(r.message).toBe(
        refusalMessage(r.reason, {
          remaining: r.remaining,
          dailyLeft: Math.max(0, 120 - (state.dailyUsedSeconds ?? 0)),
          wanted,
        }),
      );
    }
  });
});

describe("parseClaimResult trusts the RPC and distrusts the payload", () => {
  it("reads a successful claim", () => {
    const r = parseClaimResult({
      ok: true,
      jobId: "abc",
      seconds: 60,
      remaining: 240,
      dailyLeft: 60,
    });
    expect(r).toEqual({ ok: true, jobId: "abc", seconds: 60, remaining: 240, dailyLeft: 60 });
  });

  it("turns a refusal into the same shape the pure check produces", () => {
    const r = parseClaimResult({
      ok: false,
      reason: "daily",
      remaining: 240,
      dailyLeft: 30,
      wanted: 60,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.refusal.reason).toBe("daily");
    expect(r.refusal.message).toContain("30s");
    expect(r.refusal.remaining).toBe(240);
  });

  it("formats every reason the RPC can return", () => {
    for (const reason of ["disabled", "capacity", "daily", "exhausted", "too-long"]) {
      const r = parseClaimResult({ ok: false, reason, remaining: 10, dailyLeft: 0, wanted: 60 });
      if (r.ok) throw new Error("unreachable");
      expect(r.refusal.message.length, reason).toBeGreaterThan(0);
    }
  });

  it("refuses to read success out of a claim with no job id", () => {
    // The dangerous failure is the quiet one: a malformed success would leave
    // the UI waiting on a job that does not exist while the seconds are spent.
    expect(() => parseClaimResult({ ok: true, seconds: 60 })).toThrow(/job id/);
  });

  it("throws on a reason this build does not know", () => {
    // A migration ahead of the bundle. Inventing a sentence for an unknown
    // refusal tells the user something that may be untrue.
    expect(() => parseClaimResult({ ok: false, reason: "vibes" })).toThrow(/unknown refusal/);
  });

  it("throws rather than guessing at a shapeless payload", () => {
    expect(() => parseClaimResult(null)).toThrow(/expected an object/);
    expect(() => parseClaimResult("ok")).toThrow(/expected an object/);
    expect(() => parseClaimResult({})).toThrow(/no ok flag/);
    expect(() => parseClaimResult({ ok: "yes" })).toThrow(/no ok flag/);
  });

  it("defaults missing numbers to zero rather than NaN", () => {
    // A NaN reaches the screen as "NaNs left", which is worse than a wrong
    // zero and much harder to read as a bug in the payload.
    const r = parseClaimResult({ ok: false, reason: "too-long" });
    if (r.ok) throw new Error("unreachable");
    expect(r.refusal.message).toBe("That is 0s and you have 0s of free time left.");
  });
});
