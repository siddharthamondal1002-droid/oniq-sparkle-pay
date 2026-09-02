/**
 * MOTION RUNTIME CONTRACT — the worker's per-shot motion decision, pinned.
 *
 * Three properties carry the whole design:
 *   1. INERT BY DEFAULT — with the clip stage off (every production dispatch)
 *      no shot ever attempts a clip; the contract only writes evidence down.
 *   2. SPEND-GUARDED — 'select' mode buys a clip only for shots whose own
 *      grammar calls for character motion and which no free tier (a measured
 *      rig) already animates; 'on' keeps the original every-shot experiment
 *      byte-for-byte.
 *   3. FAIL-CLOSED — a clip that cannot be proven to move (frozen frames,
 *      unmeasurable decode) is discarded and the still path carries the
 *      shot; no status ever reads as an ambiguous "success".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLIP_ALIVENESS_MIN,
  clipTemporallyAlive,
  frameLuminanceDiff,
  planShotMotion,
  resolveShotMotion,
  summarizeShotMotion,
  temporalAliveness,
} from "@/lib/motionRuntime";
import type { RawImage } from "@/lib/sheetPanel";

const WALK_SHOT = {
  still: "Aarav walks down the flickering corridor toward the old elevator",
  narration: "He walked, step by step, toward the door.",
};
const TALK_SHOT = {
  still: "The mother in the doorway",
  narration: "Open the door, Baba.",
  dialogue: { speaker: "Mother", line: "Open the door, Baba." },
};
const SCENERY_SHOT = {
  still: "An empty apartment corridor at 2:13 AM, one light flickering",
  narration: "Silence.",
};
const CAMERA_SHOT = {
  motion: "slow push in",
  still: "The closed bedroom door",
  narration: "The bedroom door.",
};

describe("planShotMotion — inert by default, spend-guarded when armed", () => {
  it("with the clip stage off, NOTHING is ever attempted", () => {
    for (const shot of [WALK_SHOT, TALK_SHOT, SCENERY_SHOT, CAMERA_SHOT]) {
      const p = planShotMotion(shot, { hasMeasuredRig: false, clipStage: "off" });
      expect(p.attemptClip).toBe(false);
    }
  });

  it("classifies motion need from the shot's own grammar", () => {
    const walk = planShotMotion(WALK_SHOT, { hasMeasuredRig: false, clipStage: "off" });
    expect(walk.motionClass).toBe("WALKING");
    expect(walk.driverClass).toBe("WALK");
    expect(walk.needsCharacterMotion).toBe(true);
    const scenery = planShotMotion(SCENERY_SHOT, { hasMeasuredRig: false, clipStage: "off" });
    expect(scenery.needsCharacterMotion).toBe(false);
    const camera = planShotMotion(CAMERA_SHOT, { hasMeasuredRig: false, clipStage: "off" });
    expect(camera.motionClass).toBe("CAMERA_ONLY");
    expect(camera.needsCharacterMotion).toBe(false);
  });

  it("'on' preserves the original experiment: every shot attempts a clip", () => {
    for (const shot of [WALK_SHOT, TALK_SHOT, SCENERY_SHOT, CAMERA_SHOT]) {
      const p = planShotMotion(shot, { hasMeasuredRig: false, clipStage: "on" });
      expect(p.attemptClip).toBe(true);
    }
  });

  it("'select' buys a clip only where motion is needed and no rig serves it", () => {
    expect(
      planShotMotion(WALK_SHOT, { hasMeasuredRig: false, clipStage: "select" }).attemptClip,
    ).toBe(true);
    expect(
      planShotMotion(TALK_SHOT, { hasMeasuredRig: false, clipStage: "select" }).attemptClip,
    ).toBe(true);
    // Scenery and camera-only shots: a clip cannot buy character motion here.
    expect(
      planShotMotion(SCENERY_SHOT, { hasMeasuredRig: false, clipStage: "select" }).attemptClip,
    ).toBe(false);
    expect(
      planShotMotion(CAMERA_SHOT, { hasMeasuredRig: false, clipStage: "select" }).attemptClip,
    ).toBe(false);
    // A measured rig is the free tier that beats a paid clip.
    const rigged = planShotMotion(WALK_SHOT, { hasMeasuredRig: true, clipStage: "select" });
    expect(rigged.level).toBe(2);
    expect(rigged.attemptClip).toBe(false);
  });

  it("on the 49da5c31-shaped film, 'select' spends on strictly fewer shots than 'on'", () => {
    const film = [WALK_SHOT, TALK_SHOT, SCENERY_SHOT, CAMERA_SHOT, SCENERY_SHOT];
    const on = film.filter(
      (s) => planShotMotion(s, { hasMeasuredRig: false, clipStage: "on" }).attemptClip,
    ).length;
    const select = film.filter(
      (s) => planShotMotion(s, { hasMeasuredRig: false, clipStage: "select" }).attemptClip,
    ).length;
    expect(on).toBe(5);
    expect(select).toBe(2);
  });
});

describe("resolveShotMotion — explicit outcomes, no ambiguous success", () => {
  const plan = (shot: object, clipStage: "off" | "on" | "select", hasMeasuredRig = false) =>
    planShotMotion(shot, { hasMeasuredRig, clipStage });

  it("a surviving clip is VALIDATED and names its provider", () => {
    const o = resolveShotMotion(plan(WALK_SHOT, "select"), {
      clipAttached: true,
      clipError: null,
      hasRig: false,
    });
    expect(o).toEqual({
      status: "VALIDATED",
      source: "clip",
      provider: "veo-3.1-fast",
      fallbackReason: null,
    });
  });

  it("an attempted clip that lost is FAILED with the reason", () => {
    const o = resolveShotMotion(plan(WALK_SHOT, "select"), {
      clipAttached: false,
      clipError: "clip frozen (aliveness 0.10 < 0.75) — discarded",
      hasRig: false,
    });
    expect(o.status).toBe("FAILED");
    expect(o.fallbackReason).toMatch(/frozen/);
  });

  it("a measured rig is GENERATED — a source, never pixel-proven here", () => {
    const o = resolveShotMotion(plan(WALK_SHOT, "off", true), {
      clipAttached: false,
      clipError: null,
      hasRig: true,
    });
    expect(o.status).toBe("GENERATED");
    expect(o.source).toBe("rig");
    expect(o.provider).toBe("measured-rig");
  });

  it("motion called for with no provider enabled is FALLBACK, owner-gate named", () => {
    const o = resolveShotMotion(plan(WALK_SHOT, "off"), {
      clipAttached: false,
      clipError: null,
      hasRig: false,
    });
    expect(o.status).toBe("FALLBACK");
    expect(o.fallbackReason).toMatch(/owner-gated/);
  });

  it("scenery is NOT_REQUESTED", () => {
    const o = resolveShotMotion(plan(SCENERY_SHOT, "off"), {
      clipAttached: false,
      clipError: null,
      hasRig: false,
    });
    expect(o.status).toBe("NOT_REQUESTED");
  });

  it("summarize counts every status once", () => {
    const outcomes = [
      resolveShotMotion(plan(WALK_SHOT, "select"), { clipAttached: true, clipError: null, hasRig: false }),
      resolveShotMotion(plan(WALK_SHOT, "off", true), { clipAttached: false, clipError: null, hasRig: true }),
      resolveShotMotion(plan(WALK_SHOT, "select"), { clipAttached: false, clipError: "x", hasRig: false }),
      resolveShotMotion(plan(WALK_SHOT, "off"), { clipAttached: false, clipError: null, hasRig: false }),
      resolveShotMotion(plan(SCENERY_SHOT, "off"), { clipAttached: false, clipError: null, hasRig: false }),
    ];
    expect(summarizeShotMotion(outcomes)).toEqual({
      total: 5,
      validatedClips: 1,
      rigSourced: 1,
      // The CPU generalist, counted apart from the measured specialists so a
      // film can say WHICH free tier carried a shot. Zero here and in
      // production until a CPU runner is provisioned.
      poseWarpSourced: 0,
      failed: 1,
      fallback: 1,
      notRequested: 1,
    });
  });
});

describe("temporal aliveness — a frozen clip can never pass as motion", () => {
  function frame(fill: (x: number, y: number) => number, w = 32, h = 32): RawImage {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = fill(x, y);
        const i = (y * w + x) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { width: w, height: h, data };
  }

  it("identical frames score exactly 0 — not alive", () => {
    const a = frame(() => 128);
    const b = frame(() => 128);
    expect(frameLuminanceDiff(a, b)).toBe(0);
    const score = temporalAliveness([a, b, frame(() => 128)]);
    expect(score).toBe(0);
    expect(clipTemporallyAlive(score)).toBe(false);
  });

  it("a moving bright region scores far above the threshold — alive", () => {
    const frames = [0, 8, 16].map((off) =>
      frame((x, y) => (x >= off && x < off + 8 && y >= 8 && y < 24 ? 240 : 20)),
    );
    const score = temporalAliveness(frames);
    expect(score).toBeGreaterThan(CLIP_ALIVENESS_MIN * 4);
    expect(clipTemporallyAlive(score)).toBe(true);
  });

  it("fewer than two frames, or unmeasurable pairs, collapse to 0 (fail closed)", () => {
    expect(temporalAliveness([])).toBe(0);
    expect(temporalAliveness([frame(() => 10)])).toBe(0);
    const mismatched = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4) };
    expect(Number.isNaN(frameLuminanceDiff(frame(() => 10), mismatched))).toBe(true);
    expect(temporalAliveness([frame(() => 10), mismatched])).toBe(0);
    expect(clipTemporallyAlive(Number.NaN)).toBe(false);
  });
});

describe("the story worker carries the contract, fail-closed", () => {
  const src = readFileSync(
    join(process.cwd(), "remotion/scripts/story-worker.mjs"),
    "utf8",
  );

  it("plans per shot from the shot's grammar and the rig answer", () => {
    expect(src).toMatch(/planShotMotion\(/);
    expect(src).toMatch(/hasMeasuredRig: Boolean\(shotRigs\[i\]\), clipStage/);
  });

  it("the clip attempt is gated by the plan, not a blanket flag", () => {
    expect(src).toMatch(/if \(motionPlan\?\.attemptClip\)/);
  });

  it("'on' keeps its original meaning and 'select' exists beside it", () => {
    expect(src).toMatch(/job\.grade === 'movie' && process\.env\.STORY_MOVIE === 'on'/);
    expect(src).toMatch(/process\.env\.STORY_MOVIE === 'select'/);
  });

  it("a generated clip must prove it moves, or the still carries the shot", () => {
    expect(src).toMatch(/clipAlivenessScore\(clipFile, clipSeconds\)/);
    expect(src).toMatch(/clipTemporallyAlive\(alive\)/);
    // Fixture clips loop one PNG by construction; a dry run skips the gate.
    expect(src).toMatch(/fixtureEdge \? null : clipAlivenessScore/);
    // The step-down message survives for every losing path.
    expect(src).toMatch(/still carries the shot/);
  });

  it("prints the film-level contract beside MOTION_VALIDATE", () => {
    expect(src).toMatch(/MOTION_CONTRACT: \$\{sum\.validatedClips\} clip-validated/);
    expect(src).toMatch(/resolveShotMotion\(motionMeta\[i\]\.plan/);
  });
});
