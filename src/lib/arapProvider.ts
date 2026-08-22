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
  // Unspecified character motion gets IDLE — the safe subtle in-place life,
  // never a guessed walk. The driver is derived at run time by
  // remotion/scripts/bvh_idle_reference.py (rotations scaled 0.25 toward
  // frame 0, root pinned) — s=0.10 failed the aliveness gate (0.43,
  // recorded falsification); s=0.25 passed real pixels (0.94, grounded
  // feet, stable identity, no artifacts).
  CHARACTER_MOTION: "derived://bvh_idle_reference.py?src=examples/bvh/fair1/zombie.bvh&scale=0.25",
};

/**
 * PRE-RENDER CHARACTER ELIGIBILITY — the measured envelope, revised by the
 * 24-character generalization-v2 corpus (2026-08-22, real renders).
 *
 * THE v2 ROOT-CAUSE RESULT. v1's headline rule — "bbox fill > 65% is a
 * merged-blob collapse class" — was FALSIFIED as a mechanism: mother
 * (74.8%) and princess (77.6%) render intact walks once the crop carries a
 * margin. The real cause of the v1 collapses AND every solver hang
 * (5 characters, 300-900 s with zero output) was the mask being CUT AT THE
 * CROP BORDER: all pathological rigs touched >=3 crop edges, all clean
 * ones <=2, AD's own bundled rigs 0 — and re-rendering the SAME rigs with
 * a 24 px margin fixed 8 of 10 (adchar2 was proven twice: my border-cut
 * rig hung, AD's padded rig of the same drawing rendered in 41 s).
 * autorig_reference.py now pads every crop; this gate ENFORCES that
 * contract rather than proxying it with fill.
 *
 * What remains, measured:
 *   - CORE JOINT OFF-SILHOUETTE (under the better of the classical/rembg
 *     masks) still marks degenerate rigs. An elbow/hand grazing outside is
 *     fine — both clean aladdin rigs have one.
 *   - RIG CONFIDENCE separates the residual bad renders: every clean walk
 *     has kpt_conf_mean >= 0.77; the crushed jarJinni sits at 0.61,
 *     adchar6 0.59, the failed side-views ~0.60. Floor: 0.70 (admits the
 *     marginal-but-intact lampJinni at 0.74; rejects marginal ringJinni at
 *     0.66 — a safe-direction false reject).
 *   - A NEAR-TOTAL fill (>90%) still means broken segmentation (the
 *     classical mask returns 100% on painterly art) — kept as a
 *     degenerate-mask ceiling, not a silhouette-shape rule.
 *
 * KNOWN RESIDUAL FALSE ACCEPT (1 of 11 admitted in the corpus): adchar4 —
 * a bent stick figure whose limbs are far thinner than the ~24 px ARAP
 * mesh grid — passes every metric (conf 0.82, joints inside) and renders
 * badly. No reliable cheap metric separates it yet (its mean stroke width
 * ~25 px vs clean adchar2's ~28 px); it is documented, and the canary's
 * human pixel review is the backstop. Post-render, l3RenderQc plus
 * temporalAliveness stay mandatory: aliveness alone scored every collapse
 * "alive" — a changing-pixel metric is necessary, never sufficient.
 */
export const ARAP_ELIGIBILITY = {
  /** Above this the mask is degenerate segmentation, not a silhouette. */
  maxBboxFillPct: 90,
  /** Joints that must sit ON the silhouette for the solve to stay sane. */
  coreJoints: ["shoulder", "hip", "knee", "foot"],
  /** Minimum pose-model mean keypoint confidence (measured separator). */
  minKptConfMean: 0.7,
} as const;

export function arapCharacterEligible(m: {
  /** Foreground fraction of the character's padded crop mask, percent. */
  bboxFillPct: number;
  /** Names of skeleton joints whose location falls outside the mask. */
  jointsOutsideMask: string[];
  /** Pose-model mean keypoint confidence for the rig (0..1). */
  kptConfMean: number;
  /** True when the mask touches any crop border — the padding contract
   *  autorig_reference.py guarantees was violated upstream. */
  maskTouchesBorder: boolean;
}): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (m.maskTouchesBorder) {
    reasons.push(
      "mask touches the crop border (padding contract violated — the measured solver-hang/collapse class)",
    );
  }
  if (m.bboxFillPct > ARAP_ELIGIBILITY.maxBboxFillPct) {
    reasons.push(
      `mask fills ${m.bboxFillPct.toFixed(1)}% of the crop (> ${ARAP_ELIGIBILITY.maxBboxFillPct}% — degenerate segmentation, not a silhouette)`,
    );
  }
  const core = m.jointsOutsideMask.filter((j) =>
    ARAP_ELIGIBILITY.coreJoints.some((c) => j.includes(c)),
  );
  if (core.length > 0) {
    reasons.push(`core joints off the silhouette: ${core.join(", ")} (degenerate solve class)`);
  }
  if (m.kptConfMean < ARAP_ELIGIBILITY.minKptConfMean) {
    reasons.push(
      `rig confidence ${m.kptConfMean.toFixed(2)} < ${ARAP_ELIGIBILITY.minKptConfMean} (hallucinated-joint class — jarJinni/side-view band)`,
    );
  }
  return { eligible: reasons.length === 0, reasons };
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
          reason: `no pixel-proven ARAP driver for ${req.motionClass} (grammar is evidence-gated; WALKING and derived IDLE today)`,
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
