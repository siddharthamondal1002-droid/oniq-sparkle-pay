/**
 * ARAP L3 CPU MOTION — the zero-GPU pose-warp provider, code-complete and
 * fail-closed (zero-GPU generalization loop, 2026-08-22).
 *
 * WHAT THIS IS. A MotionProvider for the measured CPU character-motion recipe:
 * Meta Animated Drawings (MIT code AND model weights) — auto-rig from the
 * drawn-humanoid detector + pose estimator, rembg u2netp silhouette mask,
 * BVH-driven retarget with the ARM-DAMPED mapping, ARAP 2D deform, headless
 * OSMesa render. It conforms to the SAME injected contract Veo and the GPU
 * providers use: this file commits to no Python runtime, no model files, no
 * subprocess and no worker wiring. A CPU host injects a runner that executes
 * the versioned argv OUT of process; with no runner (the default everywhere),
 * the provider is unavailable, selection drops it, and the caller keeps the
 * still/parallax path — never a fabricated clip.
 *
 * WHY A NEW FILE rather than motionProvider.ts: that module carries the L3R
 * rigid-puppet reserve, frozen against reference d7fcc681. This provider is
 * ADDITIVE — it imports the contract types and touches nothing.
 *
 * MEASURED FACTS (2026-08-22, 4-core CPU reference host, real decoded frames):
 *   - WALK, arm-damped retarget, hand-rigged fixture: 0/5 inspected frames
 *     with the claw/blade ARAP artifact (stock arms: 4/5). Gait preserved.
 *     Aliveness 7.52 vs stock 8.88 — ~10x the CLIP_ALIVENESS_MIN floor.
 *   - ~69-78 s and ~1.2 GB peak RSS per 200-frame 500x500 clip. GPU 0, API 0.
 *   - Auto-rig: 6/6 ONIQ cast sheet characters RIGGED (det 0.89-0.998).
 *     The classical AD threshold mask FAILED on all 6 painterly crops
 *     (100% fill); the rembg u2netp mask is the measured, mandatory fix.
 *   - Graded arm damping (BVH rotations scaled toward the clip's frame 0) is
 *     FALSIFIED for the zombie walk driver: its rest pose holds the arms
 *     across the torso, so every scale level reproduces the artifact. The
 *     shipped setting is the binary hang-down mapping — see
 *     remotion/scripts/retarget_armdamped_reference.yaml and
 *     MOTION_AMPLITUDE.md.
 *
 * GRAMMAR IS EVIDENCE-GATED. Only motions with a real-pixel PASS on record
 * may appear in ARAP_MOTION_GRAMMAR. Today that is WALKING alone. The other
 * FAIR MIT clips (wave_hello, jumping, dab) stay out until their renders
 * pass the same inspection — a grammar entry is a claim, and claims here
 * require frames.
 *
 * ACTOR ASSET ≠ PERMANENT BIOGRAPHY: identity comes ONLY from the source
 * still; the BVH drives movement, never appearance. There is deliberately no
 * character/appearance parameter in the arg builder.
 */

import type {
  MotionClip,
  MotionProvider,
  MotionRequest,
  ProviderMeta,
} from "./motionProvider.ts";

/** ARAP pose-warp, CPU-only OSS. Costed in CPU-runner seconds, not rupees:
 *  ~69-78 s of 4-core CPU per ~12.5 s clip was the measured reference figure;
 *  the ₹/s of the REAL runner is priced at deploy — never invented here. */
export const ARAP_L3_META: ProviderMeta = {
  name: "arap-l3-armdamped",
  kind: "oss",
  role: "pose-warp",
  requiresGpu: false,
  inrPerSecond: null, // CPU minutes are the cost; priced on the actual runner
  billing: "cpu-runner",
};

export type ArapL3RunSpec = {
  /** Official inference implementation (MIT — code and model weights). */
  officialRepo: "https://github.com/facebookresearch/AnimatedDrawings";
  /** License facts, pinned so a drift is a failing test, not a memory. */
  license: "MIT (Animated Drawings code and drawn-humanoid weights — official repo)";
  /** The in-repo reference runner the CPU host executes. */
  runner: "remotion/scripts/l3_animate_reference.py";
  /** The measured arm-damped retarget (the ONLY artifact-free setting). */
  retargetConfig: "remotion/scripts/retarget_armdamped_reference.yaml";
  /** Auto-rig halves: AD's MIT .mar models, loaded directly on CPU. */
  autorig: "remotion/scripts/autorig_reference.py";
  /** Silhouette mask: the classical AD mask fails on painterly art (measured
   *  100% fill on 6/6 ONIQ sheets); rembg u2netp is mandatory. */
  mask: "rembg-u2netp";
  /** Headless GL: OSMesa, forced GL 3.3 — no display, no GPU. */
  env: { PYOPENGL_PLATFORM: "osmesa"; MESA_GL_VERSION_OVERRIDE: "3.3" };
  /** AD's retarget stack needs the documented pin (np.bool8 removal in 2.x). */
  numpyPin: "1.26.4";
};

export const ARAP_L3_RUN: ArapL3RunSpec = {
  officialRepo: "https://github.com/facebookresearch/AnimatedDrawings",
  license: "MIT (Animated Drawings code and drawn-humanoid weights — official repo)",
  runner: "remotion/scripts/l3_animate_reference.py",
  retargetConfig: "remotion/scripts/retarget_armdamped_reference.yaml",
  autorig: "remotion/scripts/autorig_reference.py",
  mask: "rembg-u2netp",
  env: { PYOPENGL_PLATFORM: "osmesa", MESA_GL_VERSION_OVERRIDE: "3.3" },
  numpyPin: "1.26.4",
};

/**
 * The evidence-gated motion grammar: motion class → MIT FAIR driver clip.
 * ONLY classes with a real-pixel PASS are present; asking for anything else
 * is a structured permanent miss, and the still path carries the shot.
 */
export const ARAP_MOTION_GRAMMAR: Readonly<Partial<Record<MotionRequest["motionClass"], string>>> = {
  WALKING: "examples/bvh/fair1/zombie.bvh",
};

/**
 * PRE-RENDER CHARACTER ELIGIBILITY — the measured envelope (2026-08-22,
 * six-character ONIQ corpus, real renders). Two bounded failure classes
 * collapsed the ARAP mesh regardless of retarget config (proven: the same
 * characters collapse under stock AND arm-damped mappings):
 *
 *   1. MERGED SILHOUETTE — limbs not separated from the body in the mask
 *      (mother 74.8% bbox fill, lampJinni 67.3% → both collapsed; every
 *      clean walk sat at 51-57%). The armsAgainstTorso class motionCost.ts
 *      already names, now with a measurable proxy.
 *   2. CORE JOINT OFF-SILHOUETTE — a shoulder/hip/knee/foot localized
 *      outside the mask (fisherman: left_shoulder+left_foot → collapsed;
 *      magician: right_knee+right_foot → pathological render). An elbow or
 *      hand grazing outside is fine (both clean aladdin rigs have one).
 *
 * On the corpus these two gates admit every clean walk and reject every
 * collapse, so an ineligible character is a correct still-path fallback,
 * never a garbage clip. THRESHOLDS ARE PROVISIONAL — measured on n=6;
 * widening the corpus before trusting them harder is the recorded follow-up.
 * Post-render, l3RenderQc (fill ≥4%) plus temporalAliveness stay mandatory:
 * they caught 2 of 3 collapses blind, and the aliveness score alone waved
 * all 3 through — a changing-pixel metric is necessary, never sufficient.
 */
export const ARAP_ELIGIBILITY = {
  /** Above this the silhouette is a merged blob (limbs not separated). */
  maxBboxFillPct: 65,
  /** Joints that must sit ON the silhouette for the solve to stay sane. */
  coreJoints: ["shoulder", "hip", "knee", "foot"],
} as const;

export function arapCharacterEligible(m: {
  /** Foreground fraction of the character's tight bbox mask, percent. */
  bboxFillPct: number;
  /** Names of skeleton joints whose location falls outside the mask. */
  jointsOutsideMask: string[];
}): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (m.bboxFillPct > ARAP_ELIGIBILITY.maxBboxFillPct) {
    reasons.push(
      `silhouette is a merged blob (${m.bboxFillPct.toFixed(1)}% bbox fill > ${ARAP_ELIGIBILITY.maxBboxFillPct}% — limbs not separated, ARAP collapse class)`,
    );
  }
  const core = m.jointsOutsideMask.filter((j) =>
    ARAP_ELIGIBILITY.coreJoints.some((c) => j.includes(c)),
  );
  if (core.length > 0) {
    reasons.push(`core joints off the silhouette: ${core.join(", ")} (degenerate solve class)`);
  }
  return { eligible: reasons.length === 0, reasons };
}

// ── ARTIFACT-DERIVED ELIGIBILITY METRICS ─────────────────────────────────────
//
// MEASUREMENT IS NOT POLICY, and this is the seam between them.
//
// `arapCharacterEligible` above decides whether a character satisfies the
// measured envelope. Until now nothing PRODUCED the two numbers it decides on:
// `bboxFillPct` and `jointsOutsideMask` appeared only in that signature and in
// its tests, because during the six-character corpus run they were derived by
// hand. So the gate was real and unreachable at the same time.
//
// These functions close that, and deliberately compute nothing else. They read
// artifacts the auto-rig ALREADY writes (autorig_reference.py: the detector
// bbox, the bbox-local mask.png, the 15 joint positions) and report what is
// there. They hold no threshold, know nothing about 65%, and cannot make a
// character eligible or ineligible — that stays one function away, so a future
// runner can supply measurements without acquiring the power to set policy.
//
// The division shows in the return: `jointsOutsideMask` lists EVERY joint
// outside the silhouette, including elbows and hands. arapCharacterEligible
// then filters to ARAP_ELIGIBILITY.coreJoints, which is what preserves
// ENG-0088's actual meaning — a grazing elbow is fine (both clean aladdin rigs
// have one), a shoulder or foot off-mask is the degenerate-solve class.

/**
 * What the auto-rig writes, as data.
 *
 * COORDINATES ARE BBOX-LOCAL, matching the artifacts: autorig_reference.py
 * crops to the detector box and segments THAT (`mask = segment(cropped)`), so
 * the mask's origin is the bbox's top-left and the joints the pose estimator
 * returns are in the same crop's frame. Nothing here is in whole-scene
 * coordinates, which is exactly why the 65% envelope measured on tight sheet
 * crops transfers unchanged to a character detected inside a gateway still.
 */
export type AutorigArtifacts = {
  /** Tight character bbox in SOURCE-image pixels: [left, top, right, bottom]. */
  bbox: readonly [number, number, number, number];
  /** The bbox-local silhouette. Non-zero is foreground (rembg u2netp output). */
  mask: {
    width: number;
    height: number;
    /** Row-major, `width * height` entries. */
    data: ArrayLike<number>;
  };
  /** Joint name -> position in BBOX-LOCAL pixels. */
  joints: Readonly<Record<string, { x: number; y: number }>>;
};

export type EligibilityMetrics =
  | { ok: true; bboxFillPct: number; jointsOutsideMask: string[] }
  | { ok: false; reason: string };

/**
 * WHICH PIXEL A JOINT IS IN — fixed, not left to floating-point accident.
 *
 * A joint is a continuous coordinate; a mask is a grid. The convention is
 * `floor`: the pixel containing (x, y) is [floor(x), floor(y)], so a joint at
 * exactly 4.0 belongs to pixel 4 (the one to its right/below), and 3.999
 * belongs to pixel 3. Anything outside [0, width) x [0, height) is outside the
 * silhouette by definition — a joint off the crop cannot be on the mask.
 *
 * Stated and tested because "on the boundary" is the case that decides a
 * character's tier, and an unstated rounding rule would make that decision
 * differ between two implementations that both look correct.
 */
export function maskPixelAt(
  mask: AutorigArtifacts["mask"],
  x: number,
  y: number,
): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= mask.width || py >= mask.height) return null;
  return Number(mask.data[py * mask.width + px]);
}

/**
 * Measure a rigged character. Pure: no filesystem, no model, no policy.
 *
 * FAILS CLOSED, and the reason is worth stating because the failure mode is
 * silent. A malformed artifact that returned `{ bboxFillPct: 0,
 * jointsOutsideMask: [] }` would read as a PERFECT result — 0% fill is under
 * the 65% ceiling and no joints are off-mask — so a broken run would look
 * like the most eligible character in the corpus. Zero is a legitimate
 * measurement elsewhere, so it can never double as "unmeasurable". An invalid
 * input therefore returns `ok: false`, and the caller must treat that as
 * ineligible-with-reason rather than as a measurement.
 */
export function computeEligibilityMetrics(a: AutorigArtifacts): EligibilityMetrics {
  const [l, t, r, b] = a.bbox ?? [];
  if (![l, t, r, b].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return { ok: false, reason: "invalid bbox (non-finite bounds)" };
  }
  const bw = r - l;
  const bh = b - t;
  if (bw <= 0 || bh <= 0) return { ok: false, reason: `degenerate bbox (${bw}x${bh})` };

  const m = a.mask;
  if (!m || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width <= 0 || m.height <= 0) {
    return { ok: false, reason: "missing or malformed mask dimensions" };
  }
  if (m.data == null || m.data.length !== m.width * m.height) {
    return {
      ok: false,
      reason: `mask data length ${m.data?.length ?? 0} != ${m.width}x${m.height}`,
    };
  }

  // The mask must BE the bbox crop. If it is not, the fill fraction would be
  // taken over a different region than the one the envelope was measured on,
  // and the number would be quietly wrong rather than obviously absent.
  if (m.width !== Math.round(bw) || m.height !== Math.round(bh)) {
    return {
      ok: false,
      reason: `mask ${m.width}x${m.height} does not match bbox ${Math.round(bw)}x${Math.round(bh)}`,
    };
  }

  let foreground = 0;
  for (let i = 0; i < m.data.length; i += 1) if (Number(m.data[i]) !== 0) foreground += 1;
  const bboxFillPct = (foreground / (m.width * m.height)) * 100;

  const names = Object.keys(a.joints ?? {});
  if (names.length === 0) return { ok: false, reason: "no joints in the rig record" };
  // ENG-0088 is a statement about core joints, so a record with none of them
  // cannot be checked against it. Unverifiable is not the same as passing.
  const hasCore = names.some((n) => ARAP_ELIGIBILITY.coreJoints.some((c) => n.includes(c)));
  if (!hasCore) {
    return {
      ok: false,
      reason: `no core joints present (need one of: ${ARAP_ELIGIBILITY.coreJoints.join(", ")})`,
    };
  }

  const jointsOutsideMask: string[] = [];
  for (const name of names) {
    const j = a.joints[name];
    if (!j || !Number.isFinite(j.x) || !Number.isFinite(j.y)) {
      return { ok: false, reason: `joint ${name} has a non-finite position` };
    }
    const px = maskPixelAt(m, j.x, j.y);
    // null = off the crop entirely, 0 = on the crop but off the silhouette.
    if (px === null || px === 0) jointsOutsideMask.push(name);
  }
  return { ok: true, bboxFillPct, jointsOutsideMask };
}

/**
 * The EXACT reference-runner argv for ONE shot. The runner host resolves
 * `adDir`/`charDir` (the AD checkout and the auto-rigged character dir);
 * the motion and retarget configs and the output are explicit paths, so a
 * run's inputs are always in its record.
 */
export function buildArapRenderArgs(a: {
  spec: ArapL3RunSpec;
  /** The Animated Drawings checkout on the CPU host. */
  adDir: string;
  /** The auto-rigged character dir (char_cfg.yaml + texture.png + mask.png). */
  charDir: string;
  /** The motion config naming the grammar's BVH driver. */
  motionCfg: string;
  /** Where the host writes the clip (gif; the host muxes mp4 with ffmpeg). */
  outPath: string;
}): string[] {
  return [
    "python3",
    a.spec.runner,
    a.adDir,
    a.charDir,
    a.motionCfg,
    a.spec.retargetConfig,
    a.outPath,
  ];
}

/**
 * The out-of-process CPU runner a real host injects. `ready()` is true ONLY
 * when a host with the AD checkout, the .mar models and the pinned Python
 * stack is actually provisioned; `exec` runs the argv and returns the
 * produced clip's path and measured facts. No such runner exists in the
 * worker or this repository — unavailability means the provider MISSES and
 * the caller falls back, never a fabricated clip.
 */
export type ArapCpuRunner = {
  ready: () => boolean;
  exec: (
    args: string[],
    req: MotionRequest,
  ) => Promise<{ videoPath: string; seconds: number; fps: number }>;
};

/**
 * The ARAP provider. Fail-closed by construction: inject `null` (the default
 * everywhere today) and it is unavailable — selection drops it, nothing is
 * attempted, Veo and the still path behave exactly as before. A request for
 * a motion class outside the evidence-gated grammar is a permanent miss
 * WITHOUT touching the runner: unproven motion is not rendered, ever.
 */
export function makeArapL3Provider(runner: ArapCpuRunner | null): MotionProvider {
  return {
    meta: ARAP_L3_META,
    available: () => runner?.ready() === true,
    generate: async (req: MotionRequest): Promise<MotionClip> => {
      if (!runner || !runner.ready()) {
        return {
          ok: false,
          reason:
            "no CPU runner configured for ARAP pose-warp (needs the provisioned Animated Drawings stack)",
          provider: ARAP_L3_META.name,
          class: "permanent",
        };
      }
      const driver = ARAP_MOTION_GRAMMAR[req.motionClass];
      if (!driver) {
        return {
          ok: false,
          reason: `no pixel-proven ARAP driver for ${req.motionClass} (grammar is evidence-gated; WALKING only today)`,
          provider: ARAP_L3_META.name,
          class: "permanent",
        };
      }
      const args = buildArapRenderArgs({
        spec: ARAP_L3_RUN,
        adDir: "ad://checkout",
        charDir: "rig://character",
        motionCfg: `motion://${driver}`,
        outPath: "clip://arap-l3.gif",
      });
      try {
        const out = await runner.exec(args, req);
        return {
          ok: true,
          videoPath: out.videoPath,
          mime: "video/mp4",
          seconds: out.seconds,
          provider: ARAP_L3_META.name,
        };
      } catch (e) {
        return {
          ok: false,
          reason: String((e as { message?: string })?.message ?? e).slice(0, 200),
          provider: ARAP_L3_META.name,
          class: "transient",
        };
      }
    },
  };
}
