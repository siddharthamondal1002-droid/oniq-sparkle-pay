import { describe, expect, it } from "vitest";
import {
  compareExpectedSignal,
  matchTemporalEvents,
  summarizeBinaryMetrics,
} from "@/lib/storyCvCalibration";

describe("storyCvCalibration metrics", () => {
  it("matches temporal cuts within tolerance", () => {
    const matched = matchTemporalEvents({
      expectedTimestampsMs: [1000, 2200, 5000],
      observedTimestampsMs: [960, 2225, 8000],
      toleranceMs: 60,
    });

    expect(matched.tp).toBe(2);
    expect(matched.fp).toBe(1);
    expect(matched.fn).toBe(1);
    expect(matched.matches).toHaveLength(2);
  });

  it("computes precision/recall/fpr/fnr with opportunity count", () => {
    const out = summarizeBinaryMetrics({ tp: 4, fp: 1, fn: 2, opportunityCount: 20 });

    expect(out.tn).toBe(13);
    expect(out.precision).toBe(0.8);
    expect(out.recall).toBe(0.6667);
    expect(out.fpr).toBe(0.0714);
    expect(out.fnr).toBe(0.3333);
  });

  it("returns unknown for UNKNOWN expected labels", () => {
    expect(compareExpectedSignal({ expected: "UNKNOWN", observed: "static" })).toBe("unknown");
  });

  it("compares known labels directly", () => {
    expect(compareExpectedSignal({ expected: "static", observed: "static" })).toBe("match");
    expect(compareExpectedSignal({ expected: "static", observed: "mixed" })).toBe("mismatch");
  });
});
