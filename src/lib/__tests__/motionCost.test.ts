/**
 * The cost tiers: pick the cheapest level that animates the shot, and extract a
 * driver's pose ONCE for every character. No GPU, no spend, no model.
 */
import { describe, expect, it } from "vitest";
import {
  LEVELS,
  l3RenderQc,
  makePoseCache,
  mockPoseExtractor,
  poseCachePath,
  poseWarpEligible,
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

  it("Phase 8: an arms-against-torso shot is NOT L3-eligible → routes to L4 diffusion", () => {
    // Phase 8 proved a part-aware mask does NOT fix the arm ARAP tear (an
    // ARAP_LIMIT, not an occlusion/mask limit), so the arms-flush restriction
    // stays: such a shot is caps.poseWarpEligible=false and must land at L4.
    const elig = poseWarpEligible({ framing: "full", characterCount: 1, stylized: true, armsAgainstTorso: true });
    expect(elig.eligible).toBe(false);
    const caps: ShotCapabilities = { hasMeasuredRig: false, poseWarpEligible: elig.eligible };
    const d = selectMotionLevel({ motion: "he walks through the market" }, caps, FULL);
    expect(d.level).toBe(4); // diffusion, NOT the tearing L3 pose-warp
    expect(d.escalation).toEqual([4, 5]);
  });

  it("Phase 8: arms-against-torso with NO L4 → honest still+camera (L1), never a torn L3 clip", () => {
    const elig = poseWarpEligible({ framing: "full", characterCount: 1, stylized: true, armsAgainstTorso: true });
    const caps: ShotCapabilities = { hasMeasuredRig: false, poseWarpEligible: elig.eligible };
    const d = selectMotionLevel({ motion: "he walks" }, caps, CPU_ONLY); // pose-warp allowed but shot ineligible; no diffusion
    expect(d.level).toBe(1); // fall back to the honest still, not a claw-armed L3
    expect(d.reason).toMatch(/not a fake clip/);
  });
});

describe("poseWarpEligible — L3 serves only the shots it can, fails closed", () => {
  it("a stylised, frontal, full-body, single, unoccluded shot is eligible", () => {
    const r = poseWarpEligible({ framing: "wide", characterCount: 1, stylized: true });
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("escalates (not eligible) on any adverse signal, naming the reason", () => {
    expect(poseWarpEligible({ framing: "close-up", stylized: true }).eligible).toBe(false);
    expect(poseWarpEligible({ framing: "wide", occluded: true }).eligible).toBe(false);
    expect(poseWarpEligible({ framing: "wide", nonFrontal: true }).eligible).toBe(false);
    expect(poseWarpEligible({ framing: "wide", characterCount: 2 }).eligible).toBe(false);
    expect(poseWarpEligible({ framing: "wide", stylized: false }).reasons).toContain(
      "photoreal (L3 is for illustrated art)",
    );
  });

  it("fails CLOSED on unknown framing (never forces a doubtful shot into L3)", () => {
    expect(poseWarpEligible({}).eligible).toBe(false);
    expect(poseWarpEligible({ framing: "unknown", stylized: true }).eligible).toBe(false);
  });

  it("Phase 7: a real full-body ONIQ still at 1244px is eligible; a tiny one is not", () => {
    const ok = poseWarpEligible({ framing: "full", characterCount: 1, stylized: true, longSidePx: 1244 });
    expect(ok.eligible).toBe(true);
    const tiny = poseWarpEligible({ framing: "full", characterCount: 1, stylized: true, longSidePx: 200 });
    expect(tiny.eligible).toBe(false);
    expect(tiny.reasons.join(" ")).toMatch(/resolution/);
  });

  it("Phase 7: arms-flush-against-torso escalates (the measured arm-tear failure mode)", () => {
    const r = poseWarpEligible({ framing: "full", characterCount: 1, stylized: true, armsAgainstTorso: true });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/arms flush against torso/);
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

  it("post-render QC (Phase 6): clean walks pass, a collapsed auto-rig escalates to L4", () => {
    // Real Phase-6 measurements: char2 ≈8.2% fill / in-frame, char3 ≈11.1% / in-frame
    // rendered clean walks from ONE shared driver; char1 ≈2.3% / off-frame collapsed.
    expect(l3RenderQc({ meanFillPct: 8.2, inFrameAllFrames: true }).pass).toBe(true);
    expect(l3RenderQc({ meanFillPct: 11.1, inFrameAllFrames: true }).pass).toBe(true);
    const collapsed = l3RenderQc({ meanFillPct: 2.3, inFrameAllFrames: false });
    expect(collapsed.pass).toBe(false);
    expect(collapsed.escalateTo).toBe(4); // diffusion, not a shipped mangled puppet
    expect(collapsed.reasons.join(" ")).toMatch(/collapsed|left the frame/);
  });

  it("post-render QC fails closed on an unstable (roaming) foot line", () => {
    const r = l3RenderQc(
      { meanFillPct: 9, inFrameAllFrames: true, footLineRangePx: 123, frameSizePx: 500 },
    );
    expect(r.pass).toBe(false); // 123/500 = 25% > 15%
    expect(r.escalateTo).toBe(4);
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
