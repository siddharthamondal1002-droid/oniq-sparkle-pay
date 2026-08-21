/**
 * MOTION COST TIERS — the cheapest level of animation that satisfies a shot.
 *
 * The cost breakthrough (owner directive, Phase 4): do NOT run a large diffusion
 * model for every shot. Classify each shot, then pick the CHEAPEST tier that
 * makes the character visibly perform its action, and escalate to diffusion or
 * the premium API only for the shots that actually need it. Most shots in a film
 * are static, camera-only, or simple body motion — none of those need a GPU.
 *
 * SIX LEVELS, cheapest first:
 *   0 STATIC       still only (no motion).                         CPU, ~free
 *   1 CAMERA       still + Ken Burns / parallax / VFX (in-house).  CPU, ~free
 *   2 RIG          measured 2D rig puppet — the 11 demo characters CPU, ~free
 *                  only (needs a hand-measured sheet, does not scale).
 *   3 POSE_WARP    segment + auto-rig + pose-retarget + 2D warp    CPU, ~free
 *                  render for an ARBITRARY still (Animated-Drawings
 *                  class). No diffusion. Serves stylised/frontal/
 *                  full-body shots; degrades on photoreal/occluded/
 *                  non-frontal (escalate to 4).
 *   4 DIFFUSION    Wan2.1-VACE 1.3B, pose-conditioned.             GPU
 *   5 PREMIUM      Veo 3.1 Fast (direct Google).                   paid API
 *
 * ONLY levels 4 and 5 cost real compute/money. 0–3 run on the CPU the render
 * already uses. This module is PURE — it decides levels and manages the pose
 * cache; it runs no model, spends nothing, and provisions no GPU. It does not
 * delete or replace any provider — it is the selector ABOVE them.
 */

import {
  classifyMotionDriver,
  classifyShotMotion,
  type MotionClass,
  type MotionDriver,
  type MotionDriverClass,
  type MotionShot,
} from "./motionProvider.ts";

export type MotionLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type LevelMeta = {
  level: MotionLevel;
  name: "STATIC" | "CAMERA" | "RIG" | "POSE_WARP" | "DIFFUSION" | "PREMIUM";
  /** Where the marginal cost lands. `none`/`cpu-runner` = no new spend beyond
   *  the render compute ONIQ already pays; the rupee figures live in
   *  MOTION_COST_ARCHITECTURE.md, not fabricated here. */
  billing: "none" | "cpu-runner" | "gpu-compute" | "google-metered";
  gpuRequired: boolean;
};

export const LEVELS: Record<MotionLevel, LevelMeta> = {
  0: { level: 0, name: "STATIC", billing: "none", gpuRequired: false },
  1: { level: 1, name: "CAMERA", billing: "cpu-runner", gpuRequired: false },
  2: { level: 2, name: "RIG", billing: "cpu-runner", gpuRequired: false },
  3: { level: 3, name: "POSE_WARP", billing: "cpu-runner", gpuRequired: false },
  4: { level: 4, name: "DIFFUSION", billing: "gpu-compute", gpuRequired: true },
  5: { level: 5, name: "PREMIUM", billing: "google-metered", gpuRequired: false },
};

/** What this shot's character can support, decided upstream from the still. */
export type ShotCapabilities = {
  /** One of the 11 measured demo rigs matches this shot's cast (enables L2). */
  hasMeasuredRig: boolean;
  /** The still is a good candidate for the L3 pose-warp path — stylised /
   *  roughly frontal / most of the body visible. A conservative upstream flag;
   *  when false the shot skips L3 and (if allowed) uses diffusion. */
  poseWarpEligible: boolean;
};

export type LevelPolicy = {
  /** L3 pose-warp animator is deployed. */
  allowPoseWarp: boolean;
  /** L4 diffusion (GPU host) is available. */
  allowDiffusion: boolean;
  /** L5 premium Veo is allowed (spends metered money — owner-gated). */
  allowPremium: boolean;
  /** Classes worth the premium tier directly (hero/cinematic shots). */
  premiumClasses?: MotionClass[];
};

export type LevelDecision = {
  level: MotionLevel;
  motionClass: MotionClass;
  driverClass: MotionDriverClass | null;
  reason: string;
  /** Cheapest→dearest levels to try; the runtime escalates on a QC miss. Empty
   *  means "no animation possible under this policy" (falls back to the still). */
  escalation: MotionLevel[];
};

/**
 * Pick the cheapest level that can satisfy the shot, plus the escalation path a
 * QC gate would climb if the cheap level looks wrong. Never invents a capability
 * the policy/caps do not grant: with no GPU and no premium, a motion shot lands
 * at L3 if eligible, else at L1 (an honest still + camera, NOT a fake clip).
 */
export function selectMotionLevel(
  shot: MotionShot,
  caps: ShotCapabilities,
  policy: LevelPolicy,
): LevelDecision {
  const motionClass = classifyShotMotion(shot);
  const driverClass = classifyMotionDriver(shot);

  if (motionClass === "STATIC") {
    return { level: 0, motionClass, driverClass, reason: "nothing moves", escalation: [0] };
  }
  if (motionClass === "CAMERA_ONLY") {
    return { level: 1, motionClass, driverClass, reason: "camera move only", escalation: [1] };
  }

  // A real character motion is called for. Build the cheapest→dearest ladder
  // from what is actually available, then pick its first rung.
  const ladder: MotionLevel[] = [];
  if (caps.hasMeasuredRig) ladder.push(2); // a demo character with a measured rig
  if (policy.allowPoseWarp && caps.poseWarpEligible) ladder.push(3);
  if (policy.allowDiffusion) ladder.push(4);
  if (policy.allowPremium) ladder.push(5);

  const premiumFirst =
    policy.allowPremium && (policy.premiumClasses ?? []).includes(motionClass);
  if (premiumFirst) {
    // Hero/cinematic shot: lead with premium, keep the rest as (cheaper) backups.
    const rest = ladder.filter((l) => l !== 5);
    const ordered = [5, ...rest];
    return {
      level: 5,
      motionClass,
      driverClass,
      reason: "premium/cinematic class — lead with Veo",
      escalation: ordered,
    };
  }

  if (ladder.length === 0) {
    // Motion was called for but nothing can render it — honest still + camera.
    return {
      level: 1,
      motionClass,
      driverClass,
      reason: "motion called for but no animator available — still + camera (not a fake clip)",
      escalation: [1],
    };
  }

  return {
    level: ladder[0],
    motionClass,
    driverClass,
    reason: `cheapest available tier for ${motionClass}`,
    escalation: ladder,
  };
}

// ── POSE CACHE — extract a driver's pose ONCE, reuse for every character ──────
//
// DWPose on a driver video is the same work no matter which character wears the
// motion, so it must run ONCE per driver and be cached (driver.mp4 →
// driver.pose.json). Character A + WALK_01, B + WALK_01, C + WALK_01 all reuse
// one PoseSequence. Extraction is CPU (onnxruntime/rtmlib) — a GPU is needed
// only for the diffusion at L4, never for pose extraction or the L3 warp.

/** A driver's extracted motion — the reusable, character-independent part. */
export type PoseSequence = {
  driverId: string;
  fps: number;
  /** Whole-body keypoints per frame (DWPose 133 = body+hands+face). Shape is
   *  the extractor's; kept opaque here so this module needs no CV dependency. */
  frames: number[][];
  keypointCount: number;
  format: "dwpose-133" | "openpose-18" | "mock";
};

/** The cache path a driver's poses live at: `foo.mp4` → `foo.pose.json`. */
export function poseCachePath(driver: MotionDriver): string {
  return driver.driverVideo.replace(/\.[^./]+$/, "") + ".pose.json";
}

/** Pulls poses from a driver video. `mock` needs no CV stack; `cpu-dwpose` is
 *  the real CPU extractor (onnxruntime + DWPose weights), run out of process. */
export type PoseExtractor = {
  kind: "mock" | "cpu-dwpose";
  extract: (driver: MotionDriver) => Promise<PoseSequence>;
};

/** A mock extractor — proves the cache without any CV dependency or GPU. */
export function mockPoseExtractor(): PoseExtractor {
  return {
    kind: "mock",
    extract: (driver) =>
      Promise.resolve({
        driverId: driver.id,
        fps: driver.fps,
        frames: [[0, 0]],
        keypointCount: 133,
        format: "mock",
      }),
  };
}

/**
 * A memoizing pose cache: the extractor runs at most ONCE per driver id, and
 * every later character reuses the cached PoseSequence. This is the cost saving
 * made concrete — pose extraction is paid per DRIVER, not per character.
 */
export function makePoseCache(extractor: PoseExtractor): {
  get: (driver: MotionDriver) => Promise<PoseSequence>;
  extractionsRun: () => number;
  has: (driverId: string) => boolean;
} {
  const cache = new Map<string, PoseSequence>();
  const inflight = new Map<string, Promise<PoseSequence>>();
  let runs = 0;
  return {
    get: async (driver) => {
      const hit = cache.get(driver.id);
      if (hit) return hit;
      const pending = inflight.get(driver.id);
      if (pending) return pending;
      runs += 1;
      const p = extractor.extract(driver).then((seq) => {
        cache.set(driver.id, seq);
        inflight.delete(driver.id);
        return seq;
      });
      inflight.set(driver.id, p);
      return p;
    },
    extractionsRun: () => runs,
    has: (driverId) => cache.has(driverId),
  };
}
