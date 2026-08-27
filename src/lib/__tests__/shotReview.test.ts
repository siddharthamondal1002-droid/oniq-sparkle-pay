// The automated film reviewer and its repairs.
//
// Owner directive 2026-08-27: "Do not simply accept HTTP 200." Each case
// here is a shot that a naive pipeline would have delivered.
import { describe, expect, it } from "vitest";
import { CLIP_ALIVENESS_MIN } from "../../../supabase/functions/_shared/motionGate.ts";
import {
  planRepair,
  repairTouchesPicture,
  reviewShot,
  type ShotEvidence,
} from "../../../supabase/functions/_shared/shotReview.ts";

const EXPECT = {
  durationSeconds: 4,
  width: 704,
  height: 480,
  requiresMotion: true,
  requiresAudio: false,
};

const good: ShotEvidence = {
  ok: true,
  outputRef: "out/shot.mp4",
  outputBytes: 240_000,
  videoSeconds: 4.04,
  frames: 97,
  width: 704,
  height: 480,
  format: "mp4",
  aliveness: 6.1,
  residualMotion: 4.8,
};

describe("a real shot passes", () => {
  it("accepts measured evidence of a real clip", () => {
    expect(reviewShot(good, EXPECT).verdict).toBe("PASS");
  });
});

describe("a shot is never accepted on a status alone", () => {
  const code = (over: Partial<ShotEvidence>) => {
    const v = reviewShot({ ...good, ...over }, EXPECT);
    return v.verdict === "REPAIR_REQUIRED" ? v.code : "PASS";
  };

  it("refuses a missing artifact even when the worker says ok", () => {
    expect(code({ outputRef: undefined })).toBe("MISSING_ARTIFACT");
    expect(code({ ok: false })).toBe("MISSING_ARTIFACT");
  });

  it("refuses an empty file", () => expect(code({ outputBytes: 0 })).toBe("ENCODE_FAILURE"));

  it("refuses a clip that reports no frames", () =>
    expect(code({ frames: 0 })).toBe("ENCODE_FAILURE"));

  it("refuses a clip that is not the length it was planned at", () =>
    expect(code({ videoSeconds: 9 })).toBe("DURATION_FAILURE"));

  it("refuses the wrong canvas", () => expect(code({ width: 512 })).toBe("WRONG_RESOLUTION"));

  it("refuses a frozen clip — the failure a 200 hides best", () => {
    expect(code({ aliveness: CLIP_ALIVENESS_MIN - 0.01 })).toBe("STATIC_MOTION");
    expect(code({ aliveness: 0 })).toBe("STATIC_MOTION");
  });

  it("does not demand motion of a classic shot", () => {
    const classic = { ...EXPECT, requiresMotion: false };
    expect(reviewShot({ ...good, aliveness: 0, frames: 0 }, classic).verdict).toBe("PASS");
  });
});

describe("camera-only movement is REPORTED, not gated", () => {
  it("notes the suspicion without spending a repair on it", () => {
    // The bands overlap on synthetic clips and no real clip has placed a
    // line between them yet; acting here would spend GPU money on an
    // uncalibrated threshold.
    const v = reviewShot({ ...good, aliveness: 6.1, residualMotion: 0.2 }, EXPECT);
    expect(v.verdict).toBe("PASS");
    expect(v.notes.join(" ")).toMatch(/camera-only suspected/);
    expect(v.notes.join(" ")).toMatch(/advisory, not gated/);
  });

  it("says nothing when the residual is healthy", () => {
    expect(reviewShot(good, EXPECT).notes).toEqual([]);
  });
});

describe("audio is reviewed only when the shot should speak", () => {
  const speaking = { ...EXPECT, requiresAudio: true };

  it("refuses a silent shot that was supposed to speak", () => {
    const v = reviewShot({ ...good, hasAudio: false }, speaking);
    expect(v.verdict === "REPAIR_REQUIRED" && v.code).toBe("AUDIO_FAILURE");
  });

  it("refuses a track that is silence with extra steps", () => {
    const v = reviewShot({ ...good, hasAudio: true, audioPeakDbfs: -91 }, speaking);
    expect(v.verdict === "REPAIR_REQUIRED" && v.code).toBe("AUDIO_FAILURE");
  });

  it("passes a real voice", () => {
    expect(reviewShot({ ...good, hasAudio: true, audioPeakDbfs: -12 }, speaking).verdict).toBe(
      "PASS",
    );
  });
});

describe("a repair changes something specific", () => {
  it("a static clip is told to make the action explicit, not asked again", () => {
    const r = planRepair("STATIC_MOTION", 1);
    expect(r.action).toBe("sharpen-motion");
    expect(r.promptSuffix).toMatch(/performs the action visibly/);
    expect(r.redrawReference).toBe(false); // the frame was fine
  });

  it("a corrupt frame is redrawn before it is animated again", () => {
    const r = planRepair("VISUAL_CORRUPTION", 1);
    expect(r.redrawReference).toBe(true);
  });

  it("an audio failure never regenerates the picture", () => {
    const r = planRepair("AUDIO_FAILURE", 1);
    expect(r.action).toBe("respeak");
    expect(repairTouchesPicture(r)).toBe(false);
  });

  it("out of attempts, the shot is abandoned rather than retried forever", () => {
    const r = planRepair("STATIC_MOTION", 0);
    expect(r.action).toBe("abandon");
    expect(repairTouchesPicture(r)).toBe(false);
    expect(r.detail).toMatch(/film stops safely/);
  });

  it("every failure code has a repair — no diagnosis is a dead end", () => {
    for (const code of [
      "ENCODE_FAILURE",
      "DURATION_FAILURE",
      "STATIC_MOTION",
      "VISUAL_CORRUPTION",
      "AUDIO_FAILURE",
      "WRONG_RESOLUTION",
      "MISSING_ARTIFACT",
    ] as const) {
      expect(planRepair(code, 1).detail.length).toBeGreaterThan(10);
    }
  });
});
