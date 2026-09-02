/**
 * Character motion as a routed capability — and the Arthur case that forced it.
 *
 * THE REGRESSION THIS FILE EXISTS FOR (spec §14). Job 64874747, "The Last
 * Gaslamp", character Arthur, a Victorian lamplighter. rigFor() matches a
 * shot's text against ELEVEN measured characters — ONIQ's Arabian Nights season
 * cast — so Arthur matched nothing, and the film reported `0 rig-sourced`: nine
 * shots of camera and parallax with no character motion anywhere.
 *
 * The old behaviour, pinned so it cannot come back:
 *
 *     no rig -> camera/2.5D -> 0 rig-sourced
 *
 * The required behaviour:
 *
 *     no measured rig -> UCMA -> CPU character motion -> motionSource = "ucma"
 */
import { describe, expect, it } from "vitest";

import {
  MIN_CHARACTER_MOTION_PX,
  MIN_FRAMES_WITH_MOTION,
  MOTION_TIERS,
  type CharacterMotionAdapter,
  type CharacterMotionInput,
  type CharacterMotionPlan,
  type PoseFrame,
  characterMotionTelemetry,
  gateMotion,
  metricsOfPoses,
  resolveCharacterMotion,
} from "../characterMotion";

const ARTHUR: CharacterMotionInput = {
  characterId: "Arthur",
  characterReference: { imagePath: "/tmp/shot-01.png", characterRefId: null },
  shot: {
    still: "A lamplighter reaches up to the gaslamp with his taper.",
    narration: "Arthur climbed the little ladder as he had every night for thirty years.",
    dialogue: { speaker: "Arthur", line: "One more, then home." },
  },
  durationFrames: 180,
  fps: 30,
};

/** A pose track that genuinely moves: a slow drift plus a lean. */
function movingPoses(n = 120): PoseFrame[] {
  return Array.from({ length: n }, (_, frame) => ({
    frame,
    dx: 0.12 * Math.sin((frame / n) * Math.PI),
    dy: 0.01 * Math.sin((frame / n) * Math.PI * 2),
    rotDeg: 1.4 * Math.sin((frame / n) * Math.PI),
  }));
}

/** A pose track that does not move — a cut-out standing perfectly still. */
const frozenPoses = (n = 120): PoseFrame[] =>
  Array.from({ length: n }, (_, frame) => ({ frame, dx: 0, dy: 0, rotDeg: 0 }));

function planOf(poses: PoseFrame[], source: "measured_rig" | "ucma"): CharacterMotionPlan {
  return {
    source,
    confidence: 0.8,
    poseTimeline: poses,
    transformTimeline: [],
    motionMetrics: metricsOfPoses(poses, 900),
  };
}

function adapter(
  source: "measured_rig" | "ucma",
  behaviour: { can: boolean; reason?: string; plan?: CharacterMotionPlan },
): CharacterMotionAdapter {
  return {
    source,
    canHandle: () =>
      behaviour.can
        ? { supported: true, confidence: 0.8 }
        : { supported: false, reason: behaviour.reason ?? "NO" },
    buildMotion: async () =>
      behaviour.plan ?? { source: "failed" as const, reason: behaviour.reason ?? "BUILD_FAILED" },
  };
}

const RIG_DECLINES = adapter("measured_rig", { can: false, reason: "NOT_IN_REPERTORY" });
const UCMA_WORKS = adapter("ucma", { can: true, plan: planOf(movingPoses(), "ucma") });

describe("Arthur — no measured rig must no longer mean no character motion", () => {
  it("routes to UCMA and reports motionSource ucma", async () => {
    const got = await resolveCharacterMotion(ARTHUR, [RIG_DECLINES, UCMA_WORKS], {
      ucmaEnabled: true,
    });
    expect(got.source).toBe("ucma");
    expect(got.plan).not.toBeNull();
  });

  it("produces character motion that is actually non-zero", async () => {
    const got = await resolveCharacterMotion(ARTHUR, [RIG_DECLINES, UCMA_WORKS], {
      ucmaEnabled: true,
    });
    const m = got.plan!.motionMetrics;
    expect(m.bodyMotionPx + m.headMotionPx).toBeGreaterThan(MIN_CHARACTER_MOTION_PX);
    expect(m.framesWithMotion).toBeGreaterThan(MIN_FRAMES_WITH_MOTION);
  });

  it("records WHY the measured rig declined, rather than silently skipping it", async () => {
    const got = await resolveCharacterMotion(ARTHUR, [RIG_DECLINES, UCMA_WORKS], {
      ucmaEnabled: true,
    });
    expect(got.downgrades).toEqual([{ from: "measured_rig", reason: "NOT_IN_REPERTORY" }]);
  });
});

describe("the eleven measured rigs stay the optimised path", () => {
  it("a known character never reaches UCMA", async () => {
    const rigWorks = adapter("measured_rig", { can: true, plan: planOf(movingPoses(), "measured_rig") });
    let ucmaAsked = false;
    const ucmaSpy: CharacterMotionAdapter = {
      source: "ucma",
      canHandle: () => {
        ucmaAsked = true;
        return { supported: true, confidence: 1 };
      },
      buildMotion: async () => ({ source: "failed" as const, reason: "should not run" }),
    };
    const got = await resolveCharacterMotion(ARTHUR, [rigWorks, ucmaSpy], { ucmaEnabled: true });
    expect(got.source).toBe("measured_rig");
    // Never routed through UCMA "for architectural purity" — the specialist is
    // both higher confidence and cheaper, and it wins outright.
    expect(ucmaAsked).toBe(false);
  });

  it("the tier order puts specialists first and honesty last", () => {
    expect([...MOTION_TIERS]).toEqual(["measured_rig", "ucma", "camera_only", "static"]);
  });
});

describe("camera motion is never counted as character motion", () => {
  it("a frozen figure fails the gate however long the shot is", () => {
    // The whole point. Ken Burns moves every pixel in the frame; a cut-out that
    // does nothing must still report nothing, or the metric is worthless.
    const verdict = gateMotion(planOf(frozenPoses(300), "ucma"));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("NO_MOVING_FRAMES");
  });

  it("a tier that runs but produces nothing usable falls through, not forward", async () => {
    const ucmaFrozen = adapter("ucma", { can: true, plan: planOf(frozenPoses(), "ucma") });
    const got = await resolveCharacterMotion(ARTHUR, [RIG_DECLINES, ucmaFrozen], {
      ucmaEnabled: true,
    });
    expect(got.source).toBe("camera_only");
    expect(got.plan).toBeNull();
    expect(got.downgrades.map((d) => d.from)).toEqual(["measured_rig", "ucma"]);
  });

  it("camera_only carries no motion metrics at all", async () => {
    const got = await resolveCharacterMotion(ARTHUR, [RIG_DECLINES], { ucmaEnabled: true });
    const line = characterMotionTelemetry(got);
    expect(line.source).toBe("camera_only");
    // Absent, not zeroed: zeros read as "we measured nothing move", absence
    // reads as "there was nothing to measure". Only one of those is true here.
    expect(line).not.toHaveProperty("bodyMotionPx");
    expect(line).not.toHaveProperty("framesWithMotion");
  });
});

describe("the flag genuinely disables UCMA", () => {
  it("with UCMA off, an unknown character behaves exactly as before", async () => {
    const got = await resolveCharacterMotion(ARTHUR, [RIG_DECLINES, UCMA_WORKS], {
      ucmaEnabled: false,
    });
    expect(got.source).toBe("camera_only");
    expect(got.downgrades).toContainEqual({ from: "ucma", reason: "UCMA_DISABLED" });
  });

  it("does not even ask UCMA whether it could have helped", async () => {
    let asked = false;
    const spy: CharacterMotionAdapter = {
      source: "ucma",
      canHandle: () => {
        asked = true;
        return { supported: true, confidence: 1 };
      },
      buildMotion: async () => ({ source: "failed" as const, reason: "x" }),
    };
    await resolveCharacterMotion(ARTHUR, [RIG_DECLINES, spy], { ucmaEnabled: false });
    expect(asked).toBe(false);
  });
});

describe("the gate is a floor, not a boolean", () => {
  it("refuses motion too small for a viewer to see", () => {
    // Sized to land BETWEEN the two thresholds on purpose: ~0.06px per frame
    // is above the per-frame noise floor, so the frames count as moving, but
    // 60 of them total ~3.6px — under MIN_CHARACTER_MOTION_PX. A drift a
    // viewer would never notice must not pass as a performance.
    const perFrame = 0.06 / 900;
    const tiny = Array.from({ length: 60 }, (_, frame) => ({
      frame,
      dx: perFrame * frame,
      dy: 0,
      rotDeg: 0,
    }));
    const verdict = gateMotion(planOf(tiny, "ucma"));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("BELOW_MOTION_FLOOR");
  });

  it("refuses a glitch — motion in only a handful of frames", () => {
    const blip = frozenPoses(120);
    blip[60] = { frame: 60, dx: 0.3, dy: 0, rotDeg: 0 };
    const verdict = gateMotion(planOf(blip, "ucma"));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("TOO_FEW_MOVING_FRAMES");
  });

  it("counts a rotation as head travel, not body travel", () => {
    // A nodding figure must not be reported as a walking one.
    const nodding = Array.from({ length: 60 }, (_, frame) => ({
      frame,
      dx: 0,
      dy: 0,
      rotDeg: 2 * Math.sin(frame / 5),
    }));
    const m = metricsOfPoses(nodding, 900);
    expect(m.bodyMotionPx).toBe(0);
    expect(m.headMotionPx).toBeGreaterThan(0);
  });

  it("reports limb motion as an explicit zero, because v1 has no limbs", () => {
    // Parity with the measured rigs, which are rigid cut-outs. The field is
    // where articulation will land; a reader must see it is genuinely absent.
    expect(metricsOfPoses(movingPoses(), 900).limbMotionPx).toBe(0);
  });
});

describe("no identity is encoded anywhere in the router", () => {
  it("the module names no character, ethnicity, gender or occupation", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const SRC = readFileSync(join(process.cwd(), "src/lib/characterMotion.ts"), "utf8");
    // The eleven rig KEYS are data in characterRig.ts and stay there. UCMA
    // must never grow a list of who it can animate.
    for (const key of ["aladdin", "aliBaba", "morgiana", "lampJinni", "fisherman"]) {
      expect(SRC.toLowerCase(), key).not.toContain(key.toLowerCase());
    }
  });
});
