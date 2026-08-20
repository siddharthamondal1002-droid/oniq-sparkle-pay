import { describe, expect, it } from "vitest";
import { classifyShotObservation, colorDistance, safePathHash } from "@/lib/storyCvEvidence";

describe("storyCvEvidence helpers", () => {
  it("classifies strong single-shot alignment as MATCH", () => {
    const out = classifyShotObservation({
      expectedShotId: 1,
      expectedDurationMs: 4000,
      observedDurationMs: 4050,
      observedCutCount: 0,
      evidenceConfidence: 0.9,
    });
    expect(out.classification).toBe("MATCH");
  });

  it("classifies multi-cut high-confidence signal as MISMATCH", () => {
    const out = classifyShotObservation({
      expectedShotId: 2,
      expectedDurationMs: 5000,
      observedDurationMs: 5400,
      observedCutCount: 3,
      evidenceConfidence: 0.88,
    });
    expect(out.classification).toBe("MISMATCH");
  });

  it("downgrades low-confidence evidence to UNKNOWN", () => {
    const out = classifyShotObservation({
      expectedShotId: 3,
      expectedDurationMs: 3000,
      observedDurationMs: 3400,
      observedCutCount: 2,
      evidenceConfidence: 0.2,
    });
    expect(out.classification).toBe("UNKNOWN");
  });

  it("compares dominant color overlap", () => {
    expect(colorDistance(["#ff0000", "#00ff00"], ["#00ff00", "#0000ff"])).toBeGreaterThan(0);
    expect(colorDistance(["#ff0000"], ["#ff0000"])).toBe(0);
  });

  it("hashes media path deterministically", () => {
    const a = safePathHash("/tmp/clip.mp4");
    const b = safePathHash("/tmp/clip.mp4");
    expect(a).toBe(b);
  });
});
