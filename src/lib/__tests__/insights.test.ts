/**
 * INSIGHTS — the arithmetic, and the refusals.
 *
 * Most of these test that the module declines to say something. That is the
 * point of the file it covers: a trend drawn from two readings, an average
 * taken over one gap, or a flat line pinned to the top of its box are all
 * ways of showing a person a confidence nobody measured.
 */
import { describe, expect, it } from "vitest";
import {
  cycleSummary,
  dayBefore,
  exerciseStreak,
  METRICS,
  MIN_PER_HALF,
  sparkPoints,
  summarise,
} from "@/lib/insights";

const day = (n: number) => `2026-08-${String(n).padStart(2, "0")}`;
const series = (values: number[]) => values.map((value, i) => ({ day: day(i + 1), value }));

describe("summarise", () => {
  it("says nothing at all about an empty series", () => {
    expect(summarise([], 0.3)).toEqual({
      count: 0,
      latest: null,
      average: null,
      trend: "unknown",
      change: null,
    });
  });

  it("reports the latest and the average from one reading, but no trend", () => {
    const got = summarise(series([4]), 0.3);
    expect(got.count).toBe(1);
    expect(got.latest).toEqual({ day: day(1), value: 4 });
    expect(got.average).toBe(4);
    // A single point has no direction, and `flat` would be a claim.
    expect(got.trend).toBe("unknown");
    expect(got.change).toBeNull();
  });

  it("refuses a direction until both halves reach the floor", () => {
    // Five readings gives halves of two — one short.
    expect(summarise(series([1, 1, 3, 5, 5]), 0.3).trend).toBe("unknown");
    expect(summarise(series([1, 1, 1, 5, 5, 5]), 0.3).trend).toBe("up");
    expect(MIN_PER_HALF).toBe(3);
  });

  it("a null change is not a zero change", () => {
    // Zero would render as "no movement"; null renders as "not enough yet".
    expect(summarise(series([1, 5]), 0.3).change).toBeNull();
  });

  it("reads a rise, a fall, and a wobble inside the band", () => {
    expect(summarise(series([2, 2, 2, 4, 4, 4]), 0.3).trend).toBe("up");
    expect(summarise(series([4, 4, 4, 2, 2, 2]), 0.3).trend).toBe("down");
    // 0.2 of movement on a band of 0.3 is how people answer the same question
    // twice, not a change of mood.
    expect(summarise(series([3, 3, 3, 3.2, 3.2, 3.2]), 0.3).trend).toBe("flat");
  });

  it("ignores the order it was handed", () => {
    const scrambled = [
      { day: day(6), value: 4 },
      { day: day(1), value: 2 },
      { day: day(4), value: 4 },
      { day: day(2), value: 2 },
      { day: day(5), value: 4 },
      { day: day(3), value: 2 },
    ];
    expect(summarise(scrambled, 0.3).trend).toBe("up");
  });

  it("drops readings that are not numbers rather than averaging a NaN", () => {
    const dirty = [...series([3, 3, 3, 5, 5, 5]), { day: day(9), value: Number.NaN }];
    const got = summarise(dirty, 0.3);
    expect(got.count).toBe(6);
    expect(Number.isFinite(got.average as number)).toBe(true);
  });

  it("gives each metric its own band, because the units are not comparable", () => {
    const bands = Object.fromEntries(METRICS.map((m) => [m.id, m.flatBand]));
    // Half an hour of sleep is a change; half a point of mood is noise.
    expect(bands.sleep_hrs).toBeLessThan(bands.water_glasses);
    expect(new Set(Object.values(bands)).size).toBeGreaterThan(1);
  });
});

describe("sparkPoints", () => {
  it("draws nothing from nothing", () => {
    expect(sparkPoints([], 100, 20)).toEqual([]);
  });

  it("puts one reading in the middle rather than at an edge", () => {
    expect(sparkPoints(series([3]), 100, 20)).toEqual([{ x: 50, y: 10 }]);
  });

  it("puts the highest reading at the top and the lowest at the bottom", () => {
    const pts = sparkPoints(series([1, 5]), 100, 20);
    expect(pts[0]).toEqual({ x: 0, y: 20 });
    expect(pts[1]).toEqual({ x: 100, y: 0 });
  });

  it("draws a flat series down the middle, not along the ceiling", () => {
    // Pinning it to the top would read as a maximum, which is a claim about
    // the values rather than a fact about them.
    for (const p of sparkPoints(series([3, 3, 3]), 100, 20)) expect(p.y).toBe(10);
  });

  it("spaces readings evenly across the width", () => {
    expect(sparkPoints(series([1, 2, 3]), 100, 20).map((p) => p.x)).toEqual([0, 50, 100]);
  });
});

describe("exerciseStreak", () => {
  const on = (d: string) => ({ day: d, exercised: true });

  it("is zero when nothing was logged", () => {
    expect(exerciseStreak([])).toBe(0);
  });

  it("counts back from the most recent log, not from today", () => {
    // Someone who logged yesterday and has not opened the app since has not
    // lost their streak — they have not answered yet.
    expect(exerciseStreak([on("2026-08-10"), on("2026-08-09"), on("2026-08-08")])).toBe(3);
  });

  it("stops at a gap in the days", () => {
    expect(exerciseStreak([on("2026-08-10"), on("2026-08-08")])).toBe(1);
  });

  it("stops at a day that was logged as no exercise", () => {
    expect(
      exerciseStreak([on("2026-08-10"), { day: "2026-08-09", exercised: false }, on("2026-08-08")]),
    ).toBe(1);
  });

  it("treats an unanswered day as the end, not as a no", () => {
    expect(exerciseStreak([{ day: "2026-08-10", exercised: null }, on("2026-08-09")])).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(exerciseStreak([on("2026-09-01"), on("2026-08-31"), on("2026-08-30")])).toBe(3);
  });
});

describe("dayBefore", () => {
  it("steps back one day, across months and years", () => {
    expect(dayBefore("2026-09-01")).toBe("2026-08-31");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  });

  it("returns empty for something that is not a day", () => {
    expect(dayBefore("not-a-day")).toBe("");
  });
});

describe("cycleSummary", () => {
  it("says nothing from an empty log", () => {
    expect(cycleSummary([])).toEqual({ lastStart: null, averageLength: null, measuredOver: 0 });
  });

  it("reports the last start from one entry, and no average", () => {
    expect(cycleSummary(["2026-08-01"])).toEqual({
      lastStart: "2026-08-01",
      averageLength: null,
      measuredOver: 0,
    });
  });

  it("refuses to call a single gap an average", () => {
    // One observation dressed as a pattern is the thing this guards against.
    const got = cycleSummary(["2026-07-01", "2026-07-29"]);
    expect(got.averageLength).toBeNull();
    expect(got.measuredOver).toBe(1);
  });

  it("averages once there are two gaps, and says how many", () => {
    const got = cycleSummary(["2026-06-01", "2026-06-29", "2026-07-27"]);
    expect(got.averageLength).toBe(28);
    expect(got.measuredOver).toBe(2);
    expect(got.lastStart).toBe("2026-07-27");
  });

  it("does not care what order the log arrives in", () => {
    const got = cycleSummary(["2026-07-27", "2026-06-01", "2026-06-29"]);
    expect(got.lastStart).toBe("2026-07-27");
    expect(got.averageLength).toBe(28);
  });
});
