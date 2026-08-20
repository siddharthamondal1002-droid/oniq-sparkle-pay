/**
 * PREFLIGHT — the cheap production-readiness gate, proven against every failure
 * class it exists to catch before Chromium ever starts.
 *
 * The module is pure (src/lib/storyPreflight.ts): the worker does the fs/ffprobe
 * IO and hands descriptors here. So these tests build a KNOWN-GOOD manifest and
 * mutate exactly one thing per case — a missing still, a zero-byte voice, a
 * truncated clip, a duplicated shot index, a 300-that-became-60 timeline — and
 * assert both that it is caught and that it is caught with the RIGHT structured
 * code and the offending shot/asset named. The worker's use of it (order, stage
 * markers) is pinned separately by storyStageRecovery.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  AUDIO_MIN_BYTES,
  DURATION_MAX_RATIO,
  IMAGE_MIN_BYTES,
  STORY_FPS,
  STORY_HEIGHT,
  STORY_WIDTH,
  preflight,
  validateTimeline,
  type AssetProbe,
  type JobManifest,
  type ShotManifest,
} from "@/lib/storyPreflight";

function still(i: number): AssetProbe {
  return {
    role: "still",
    path: `.story-x/shot${i}.png`,
    kind: "image",
    present: true,
    bytes: 80_000,
  };
}
function audio(i: number, seconds = 10): AssetProbe {
  return {
    role: "audio",
    path: `.story-x/shot${i}.wav`,
    kind: "audio",
    present: true,
    bytes: 200_000,
    seconds,
  };
}
function clip(i: number, seconds = 8): AssetProbe {
  return {
    role: "clip",
    path: `.story-x/shot${i}.clip.mp4`,
    kind: "video",
    present: true,
    bytes: 500_000,
    seconds,
    minSeconds: seconds,
  };
}

/** A known-good five-shot, 50s film — a valid job before we break one thing. */
function goodManifest(): JobManifest {
  const shots: ShotManifest[] = [];
  for (let i = 0; i < 6; i++) {
    shots.push({ index: i, seconds: 10, assets: [still(i), audio(i, 10)] });
  }
  return {
    id: "job-abc",
    requestedSeconds: 60,
    verbatim: false,
    fps: STORY_FPS,
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
    shots,
  };
}

describe("preflight passes a whole, well-formed job", () => {
  it("returns ok with the real timeline exposed", () => {
    const r = preflight(goodManifest());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.timeline.timelineSeconds).toBe(60);
      expect(r.timeline.expectedSeconds).toBe(60);
      expect(r.timeline.ratio).toBeCloseTo(1);
    }
  });

  it("accepts a shot that also carries an optional clip", () => {
    const m = goodManifest();
    m.shots[0].assets.push(clip(0, 8));
    expect(preflight(m).ok).toBe(true);
  });
});

describe("missing / corrupt visual assets", () => {
  it("catches a MISSING still, naming the shot and file", () => {
    const m = goodManifest();
    m.shots[2].assets[0] = { ...still(2), present: false, bytes: 0 };
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_ASSET_MISSING");
      expect(r.failure.shot).toBe(2);
      expect(r.failure.asset).toContain("shot2.png");
    }
  });

  it("catches a ZERO-BYTE still as corrupt", () => {
    const m = goodManifest();
    m.shots[1].assets[0] = { ...still(1), bytes: 0 };
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_ASSET_CORRUPT");
      expect(r.failure.detail).toMatch(/zero-byte/);
    }
  });

  it("catches a TRUNCATED still — present and non-empty but under the byte floor", () => {
    const m = goodManifest();
    m.shots[0].assets[0] = { ...still(0), bytes: IMAGE_MIN_BYTES - 1 };
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_ASSET_CORRUPT");
      expect(r.failure.detail).toMatch(/truncated/);
    }
  });
});

describe("missing / corrupt audio assets", () => {
  it("catches a MISSING voice", () => {
    const m = goodManifest();
    m.shots[3].assets[1] = { ...audio(3), present: false, bytes: 0, seconds: undefined };
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_ASSET_MISSING");
      expect(r.failure.shot).toBe(3);
    }
  });

  it("catches a ZERO-BYTE voice", () => {
    const m = goodManifest();
    m.shots[0].assets[1] = { ...audio(0), bytes: 0, seconds: undefined };
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("PREFLIGHT_ASSET_CORRUPT");
  });

  it("catches a header-only voice with no samples (under the audio floor)", () => {
    const m = goodManifest();
    m.shots[0].assets[1] = { ...audio(0), bytes: AUDIO_MIN_BYTES - 1 };
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("PREFLIGHT_ASSET_CORRUPT");
  });

  it("catches a voice with no readable duration", () => {
    const m = goodManifest();
    m.shots[0].assets[1] = { ...audio(0), seconds: undefined };
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).toMatch(/no readable duration/);
  });
});

describe("optional clip validation", () => {
  it("catches a MISSING clip that the shot claimed", () => {
    const m = goodManifest();
    m.shots[0].assets.push({ ...clip(0), present: false, bytes: 0, seconds: undefined });
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("PREFLIGHT_ASSET_MISSING");
  });

  it("catches a clip truncated below its own floor", () => {
    const m = goodManifest();
    m.shots[0].assets.push({ ...clip(0, 8), seconds: 2, minSeconds: 8 });
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_ASSET_CORRUPT");
      expect(r.failure.detail).toMatch(/under its/);
    }
  });
});

describe("shot-index integrity", () => {
  it("rejects a DUPLICATE shot index", () => {
    const m = goodManifest();
    m.shots[2].index = 1;
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_SHOT_INVALID");
      expect(r.failure.detail).toMatch(/duplicate/);
    }
  });

  it("rejects a MISSING shot index (a gap in the sequence)", () => {
    const m = goodManifest();
    m.shots[5].index = 9; // leaves index 5 missing
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_SHOT_INVALID");
      expect(r.failure.detail).toMatch(/missing shot index/);
    }
  });

  it("rejects a shot with an invalid duration", () => {
    const m = goodManifest();
    m.shots[0].seconds = 0;
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_SHOT_INVALID");
      expect(r.failure.detail).toMatch(/no valid duration/);
    }
  });

  it("rejects a shot missing its required audio role", () => {
    const m = goodManifest();
    m.shots[0].assets = [still(0)]; // no audio
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_MANIFEST_INVALID");
      expect(r.failure.detail).toMatch(/required audio/);
    }
  });
});

describe("job-level validation", () => {
  it("rejects a job with no id", () => {
    const m = goodManifest();
    m.id = "";
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("PREFLIGHT_JOB_INVALID");
  });

  it("rejects a wrong fps or resolution", () => {
    const bad1 = { ...goodManifest(), fps: 24 };
    const bad2 = { ...goodManifest(), width: 720 };
    expect(preflight(bad1).ok).toBe(false);
    expect(preflight(bad2).ok).toBe(false);
  });

  it("rejects an empty shot list", () => {
    const m = goodManifest();
    m.shots = [];
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.code).toBe("PREFLIGHT_MANIFEST_INVALID");
  });
});

describe("timeline / duration-mismatch — the 300-became-60 guard", () => {
  it("rejects a 300s request whose timeline came out at 60s", () => {
    // Six 10s shots = 60s, but the job says 300s was requested. Ratio 0.2 is
    // the silent truncation the whole gate exists to refuse to render.
    const m = goodManifest();
    m.requestedSeconds = 300;
    const r = preflight(m);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.code).toBe("PREFLIGHT_DURATION_MISMATCH");
      expect(r.failure.detail).toMatch(/300s/);
    }
  });

  it("accepts a real 300s film — thirty 10s shots summing to 300s", () => {
    const shots: ShotManifest[] = [];
    for (let i = 0; i < 30; i++) {
      shots.push({ index: i, seconds: 10, assets: [still(i), audio(i, 10)] });
    }
    const m: JobManifest = { ...goodManifest(), requestedSeconds: 300, shots };
    const r = preflight(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.timeline.timelineSeconds).toBe(300);
  });

  it("accepts honest TTS drift and the verbatim fill band, but not a gross miss", () => {
    // A verbatim film may run to half its purchased seconds (fill floor 0.5) —
    // that must pass. A quarter must not.
    const half = validateTimeline({ ...goodManifest(), requestedSeconds: 120, shots: sumTo(60) });
    expect("code" in half).toBe(false); // 60/120 = 0.5, exactly the floor
    const quarter = validateTimeline({
      ...goodManifest(),
      requestedSeconds: 240,
      shots: sumTo(60),
    });
    expect("code" in quarter).toBe(true); // 60/240 = 0.25
  });

  it("never rejects a film for being long within the ceiling band", () => {
    const long = validateTimeline({ ...goodManifest(), requestedSeconds: 60, shots: sumTo(90) });
    expect("code" in long).toBe(false); // 90/60 = 1.5, under the 1.6 ceiling
    expect(DURATION_MAX_RATIO).toBeGreaterThan(1.25); // above the verbatim fill ceiling
  });
});

/** Shots whose seconds add up to `total`, for timeline-only cases. */
function sumTo(total: number): ShotManifest[] {
  const n = 6;
  const each = total / n;
  const shots: ShotManifest[] = [];
  for (let i = 0; i < n; i++)
    shots.push({ index: i, seconds: each, assets: [still(i), audio(i, each)] });
  return shots;
}
