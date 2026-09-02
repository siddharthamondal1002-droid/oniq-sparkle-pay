/**
 * Arthur — the regression, retargeted at the CANONICAL selector.
 *
 * Job 64874747, "The Last Gaslamp", a Victorian lamplighter named Arthur.
 * rigFor() matches a shot's text against ELEVEN measured characters (ONIQ's
 * Arabian Nights season cast), so Arthur matched nothing and the film reported
 * `0 rig-sourced`: nine shots of camera and parallax, no character motion.
 *
 * An earlier pass at this built a second router (characterMotion.ts, 3ad43fab)
 * before the ARAP stack was found. That was a duplicate of a selector this
 * codebase already had, and it is deleted — these assertions moved onto
 * planShotMotion/selectMotionLevel, which is where the decision actually lives.
 *
 * WHAT THIS DOES NOT CLAIM. Arthur is not supported. The pose-warp tier is
 * still switched off at the planner by a literal, because no CPU runner is
 * provisioned. These tests pin the SHAPE — a known rig takes the measured
 * path, an unknown character is the one the generalist would serve — without
 * requiring the runner to exist.
 */
import { describe, expect, it } from "vitest";

import { LEVELS, selectMotionLevel } from "../motionCost";
import { planShotMotion, resolveShotMotion, summarizeShotMotion } from "../motionRuntime";

const REACHING = {
  still: "A lamplighter reaches up to the gaslamp with his taper.",
  narration: "Arthur climbed the little ladder as he had every night for thirty years.",
  motion: "He raises the taper to the mantle.",
};

describe("a known measured character still takes the specialist path", () => {
  it("the free rig tier beats a paid clip in select mode", () => {
    const plan = planShotMotion(REACHING, { hasMeasuredRig: true, clipStage: "select" });
    // The ladder treats a rig as the free tier, so `select` never buys a clip
    // for a shot the puppet already animates.
    expect(plan.attemptClip).toBe(false);
  });

  it("a rendered rig is reported as rig-sourced, not as a clip", () => {
    const plan = planShotMotion(REACHING, { hasMeasuredRig: true, clipStage: "select" });
    const out = resolveShotMotion(plan, { clipAttached: false, clipError: null, hasRig: true });
    expect(out.source).toBe("rig");
    expect(out.status).toBe("GENERATED");
  });
});

describe("Arthur — unknown character, and what actually happens today", () => {
  it("is honestly reported as carried by camera, not as character motion", () => {
    const plan = planShotMotion(REACHING, { hasMeasuredRig: false, clipStage: "off" });
    const out = resolveShotMotion(plan, { clipAttached: false, clipError: null, hasRig: false });
    expect(out.source).toBe("none");
    expect(out.fallbackReason).toContain("owner-gated");
  });

  it("the pose-warp tier is OFF at the planner — no runner is provisioned", () => {
    // The literal in planShotMotion, pinned. When a runner lands, this test is
    // the one that must change, and changing it is the visible moment the CPU
    // generalist goes live.
    const withPoseWarp = selectMotionLevel(
      REACHING,
      { hasMeasuredRig: false, poseWarpEligible: true },
      { allowPoseWarp: true, allowDiffusion: false, allowPremium: false },
    );
    expect(withPoseWarp.level).toBe(3);
    expect(LEVELS[3].name).toBe("POSE_WARP");
    expect(LEVELS[3].gpuRequired).toBe(false);

    // ...but the production planner never asks for it.
    const planned = planShotMotion(REACHING, { hasMeasuredRig: false, clipStage: "off" });
    expect(planned.level).not.toBe(3);
  });
});

describe("pose-warp is separately observable from the measured rigs", () => {
  it("a pose-warp shot is neither rig-sourced nor a clip", () => {
    const summary = summarizeShotMotion([
      { status: "GENERATED", source: "rig", provider: "measured-rig", fallbackReason: null },
      { status: "GENERATED", source: "pose-warp", provider: "arap-l3-armdamped", fallbackReason: null },
      { status: "FALLBACK", source: "none", provider: null, fallbackReason: "x" },
    ]);
    // Both are free character motion; a film that reported one number for both
    // could not tell you which tier carried a shot.
    expect(summary.rigSourced).toBe(1);
    expect(summary.poseWarpSourced).toBe(1);
    expect(summary.fallback).toBe(1);
  });

  it("reports zero pose-warp today, because no runner exists", () => {
    const plan = planShotMotion(REACHING, { hasMeasuredRig: false, clipStage: "off" });
    const out = resolveShotMotion(plan, { clipAttached: false, clipError: null, hasRig: false });
    expect(summarizeShotMotion([out]).poseWarpSourced).toBe(0);
  });
});

describe("there is exactly ONE canonical motion-provider path", () => {
  it("no parallel router or adapter framework survives", () => {
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    // 3ad43fab's duplicate. Its coverage moved here; the abstraction did not.
    expect(existsSync(join(process.cwd(), "src/lib/characterMotion.ts"))).toBe(false);
  });
});
