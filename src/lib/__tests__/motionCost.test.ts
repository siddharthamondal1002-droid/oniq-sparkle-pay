/**
 * The cost tiers: pick the cheapest level that animates the shot, and extract a
 * driver's pose ONCE for every character. No GPU, no spend, no model.
 */
import { describe, expect, it } from "vitest";
import {
  LEVELS,
  makePoseCache,
  mockPoseExtractor,
  poseCachePath,
  selectMotionLevel,
  type LevelPolicy,
  type ShotCapabilities,
} from "@/lib/motionCost";
import type { MotionDriver } from "@/lib/motionProvider";

const NO_CAPS: ShotCapabilities = { hasMeasuredRig: false, poseWarpEligible: false };
const WARP_OK: ShotCapabilities = { hasMeasuredRig: false, poseWarpEligible: true };
const FULL: LevelPolicy = { allowPoseWarp: true, allowDiffusion: true, allowPremium: true };
const CPU_ONLY: LevelPolicy = { allowPoseWarp: true, allowDiffusion: false, allowPremium: false };
const NONE: LevelPolicy = { allowPoseWarp: false, allowDiffusion: false, allowPremium: false };

describe("selectMotionLevel — cheapest tier that satisfies the shot", () => {
  it("static → L0, camera-only → L1", () => {
    expect(selectMotionLevel({}, NO_CAPS, FULL).level).toBe(0);
    expect(selectMotionLevel({ motion: "slow push in across the market" }, NO_CAPS, FULL).level).toBe(1);
  });

  it("a demo character with a measured rig walks at L2 (no GPU)", () => {
    const d = selectMotionLevel({ motion: "she walks" }, { hasMeasuredRig: true, poseWarpEligible: true }, FULL);
    expect(d.level).toBe(2);
    expect(LEVELS[d.level].gpuRequired).toBe(false);
  });

  it("an arbitrary pose-warp-eligible character walks at L3 (CPU, no GPU), escalating to 4→5", () => {
    const d = selectMotionLevel({ motion: "she walks through the market" }, WARP_OK, FULL);
    expect(d.level).toBe(3);
    expect(LEVELS[3].gpuRequired).toBe(false);
    expect(d.escalation).toEqual([3, 4, 5]); // climb only if a QC gate rejects L3
  });

  it("a non-pose-warp still falls to diffusion (L4) when allowed", () => {
    const d = selectMotionLevel({ motion: "she walks" }, NO_CAPS, FULL);
    expect(d.level).toBe(4);
    expect(d.escalation).toEqual([4, 5]);
  });

  it("CPU-only policy keeps everything off the GPU: pose-warp shot stays L3", () => {
    const d = selectMotionLevel({ motion: "he waves" }, WARP_OK, CPU_ONLY);
    expect(d.level).toBe(3);
    expect(d.escalation).toEqual([3]); // no GPU/premium behind it
  });

  it("a premium/cinematic class leads with Veo (L5) but keeps cheaper backups", () => {
    const d = selectMotionLevel({ motion: "she walks" }, WARP_OK, {
      ...FULL,
      premiumClasses: ["WALKING"],
    });
    expect(d.level).toBe(5);
    expect(d.escalation[0]).toBe(5);
    expect(d.escalation).toContain(3); // the cheaper tiers stay as fallbacks
  });

  it("motion called for but nothing available → honest still+camera (L1), never a fake clip", () => {
    const d = selectMotionLevel({ motion: "she walks" }, NO_CAPS, NONE);
    expect(d.level).toBe(1);
    expect(d.reason).toMatch(/not a fake clip/);
  });
});

describe("pose cache — extract once per driver, reuse for every character", () => {
  const WALK: MotionDriver = {
    id: "walk_9x16",
    motionClass: "WALK",
    driverVideo: "remotion/fixtures/motion-drivers/walk_9x16.mp4",
    durationSeconds: 8,
    fps: 30,
    aspectRatio: "9:16",
    source: "x",
    license: "x",
  };

  it("driver.mp4 → driver.pose.json", () => {
    expect(poseCachePath(WALK)).toBe("remotion/fixtures/motion-drivers/walk_9x16.pose.json");
  });

  it("three characters on the same WALK driver trigger ONE extraction", async () => {
    const cache = makePoseCache(mockPoseExtractor());
    // character A, B, C all reuse WALK_01
    const a = await cache.get(WALK);
    const b = await cache.get(WALK);
    const c = await cache.get(WALK);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(cache.extractionsRun()).toBe(1); // paid per DRIVER, not per character
    expect(cache.has("walk_9x16")).toBe(true);
  });

  it("concurrent first-gets dedupe to a single extraction (no double work)", async () => {
    let calls = 0;
    const slow = {
      kind: "mock" as const,
      extract: (d: MotionDriver) => {
        calls += 1;
        return Promise.resolve({ driverId: d.id, fps: d.fps, frames: [[0]], keypointCount: 133, format: "mock" as const });
      },
    };
    const cache = makePoseCache(slow);
    const [x, y] = await Promise.all([cache.get(WALK), cache.get(WALK)]);
    expect(x).toBe(y);
    expect(calls).toBe(1);
  });
});
