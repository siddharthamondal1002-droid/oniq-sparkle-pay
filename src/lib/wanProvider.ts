/**
 * WAN 2.1 I2V-14B-480P — the second motion provider, code-complete and
 * fail-closed (open-weight character-motion loop, 2026-08-22).
 *
 * WHAT THIS IS. A MotionProvider for the official open-weight
 * Wan2.1-I2V-14B-480P image-to-video model, conforming to the SAME injected
 * contract the VACE motion-transfer provider uses: this file commits to no
 * GPU, no weights, no network and no spend. A GPU host injects a runner that
 * executes the versioned argv OUT of process and hands back the produced
 * mp4; with no runner (every environment ONIQ currently has), the provider
 * is unavailable, `runMotion` falls through, and the caller keeps the
 * still/parallax path — never a fabricated clip.
 *
 * WHY A NEW FILE rather than motionProvider.ts: that module carries the L3R
 * rigid-puppet reserve, which is frozen against reference d7fcc681 and
 * verified zero-diff after every merge. Wan is ADDITIVE — it imports the
 * contract types and touches nothing.
 *
 * MODEL FACTS (recorded 2026-08-22, from the OFFICIAL repository
 * github.com/Wan-Video/Wan2.1 — huggingface.co is egress-blocked from this
 * environment, so the GitHub README is the primary source fetched):
 *   - model id:   Wan-AI/Wan2.1-I2V-14B-480P (official Hugging Face repo)
 *   - code:       Apache-2.0 (repository license header)
 *   - weights:    "The models in this repository are licensed under the
 *                 Apache 2.0 License." (README, verbatim)
 *   - usage note: the README adds an accountability clause (no unlawful or
 *                 harmful content) — a use policy, not a commercial
 *                 restriction; commercial deployment is permitted by
 *                 Apache-2.0.
 *   - output:    81 frames at 16 fps ≈ 5.06 s per clip (official defaults).
 *   - VRAM:      NOT stated per-variant in the fetched README text. The
 *                14B family is documented for multi-GPU or single-GPU with
 *                `--offload_model True`; community measurements (flagged as
 *                secondary, unverified here) put comfortable 480P inference
 *                at a 40 GB-class card and consumer-24 GB as possible with
 *                offload. The REAL figure is measured on the GPU host in
 *                Phase 3 of the run procedure — never assumed from here.
 *
 * ACTOR ASSET ≠ PERMANENT BIOGRAPHY: identity comes ONLY from the source
 * still; the prompt describes movement, never the character's traits. There
 * is deliberately no character/appearance parameter in the arg builder.
 */

import {
  motionOnlyPrompt,
  type MotionClip,
  type MotionProvider,
  type MotionRequest,
  type ProviderMeta,
} from "./motionProvider.ts";

/** Wan2.1 I2V-14B-480P, self-hosted OSS. GPU-bound; ₹/s measured at deploy. */
export const WAN21_I2V_META: ProviderMeta = {
  name: "wan2.1-i2v-14b-480p",
  kind: "oss",
  role: "i2v",
  requiresGpu: true,
  inrPerSecond: null, // never invented — measured when a real host exists
  billing: "gpu-compute",
};

export type WanI2vRunSpec = {
  /** Official checkpoint id on Hugging Face. */
  modelId: "Wan-AI/Wan2.1-I2V-14B-480P";
  /** Official inference implementation. */
  officialRepo: "https://github.com/Wan-Video/Wan2.1";
  /** generate.py task name for the 14B image-to-video path. */
  task: "i2v-14B";
  /** The 480P generation size (the checkpoint's native tier), WxH. */
  size: "832*480";
  /** Official defaults: 81 frames at 16 fps ≈ 5.06 s. */
  frames: number;
  fps: number;
  /** Where the Apache-2.0 weights live on the GPU host (never in git). */
  ckptDir: string;
  /** License facts, pinned so a drift is a failing test, not a memory. */
  license: "apache-2.0 (code and weights — official README, 2026-08-22)";
};

export const WAN21_I2V_RUN: WanI2vRunSpec = {
  modelId: "Wan-AI/Wan2.1-I2V-14B-480P",
  officialRepo: "https://github.com/Wan-Video/Wan2.1",
  task: "i2v-14B",
  size: "832*480",
  frames: 81,
  fps: 16,
  ckptDir: "./models/Wan2.1-I2V-14B-480P",
  license: "apache-2.0 (code and weights — official README, 2026-08-22)",
};

/**
 * The EXACT official `generate.py` argv for ONE shot: source still in,
 * movement-only prompt, deterministic seed, mp4 out. `offload` adds the
 * official single-GPU switch — an explicit choice on the host, never a
 * silent default, so a run's memory strategy is always in its record.
 */
export function buildWanI2vArgs(a: {
  spec: WanI2vRunSpec;
  /** Path on the GPU host to the actor-conditioned still (identity). */
  imagePath: string;
  /** Movement description only (e.g. motionOnlyPrompt) — never biography. */
  motionPrompt: string;
  /** Deterministic seed — recorded with every experiment (rule 46). */
  seed: number;
  /** Where the host writes the mp4. */
  saveFile: string;
  /** Official single-GPU memory switch (--offload_model True). */
  offload?: boolean;
}): string[] {
  return [
    "generate.py",
    "--task", a.spec.task,
    "--size", a.spec.size,
    "--ckpt_dir", a.spec.ckptDir,
    "--image", a.imagePath,
    "--prompt", a.motionPrompt,
    "--frame_num", String(a.spec.frames),
    "--base_seed", String(a.seed),
    "--save_file", a.saveFile,
    ...(a.offload ? ["--offload_model", "True"] : []),
  ];
}

/**
 * The out-of-process GPU runner a real host injects. `ready()` is true ONLY
 * when a host with the weights and enough VRAM is actually reachable; `exec`
 * runs the argv and returns the produced mp4's path and measured facts. No
 * such runner exists in the CPU worker or this repository — and
 * unavailability means the provider MISSES and the caller falls back,
 * never a fabricated clip.
 */
export type WanGpuRunner = {
  ready: () => boolean;
  exec: (
    args: string[],
    req: MotionRequest,
  ) => Promise<{ videoPath: string; seconds: number; fps: number }>;
};

/**
 * The Wan provider. Fail-closed by construction: inject `null` (the default
 * everywhere today) and it is unavailable — `selectProviderOrder` drops it,
 * nothing is attempted, Veo and the still path behave exactly as before.
 * Wan is ADDITIVE; it can never be selected implicitly in production.
 */
export function makeWanI2vProvider(
  runner: WanGpuRunner | null,
  opts: { seed?: number } = {},
): MotionProvider {
  const seed = opts.seed ?? 42;
  return {
    meta: WAN21_I2V_META,
    available: () => runner?.ready() === true,
    generate: async (req: MotionRequest): Promise<MotionClip> => {
      if (!runner || !runner.ready()) {
        return {
          ok: false,
          reason:
            "no GPU host configured for Wan2.1-I2V-14B-480P (open-weight i2v needs a provisioned GPU)",
          provider: WAN21_I2V_META.name,
          class: "permanent",
        };
      }
      const args = buildWanI2vArgs({
        spec: WAN21_I2V_RUN,
        imagePath: "still://source",
        motionPrompt: motionOnlyPrompt(req.motionClass),
        seed,
        saveFile: "clip://wan-i2v.mp4",
        offload: true,
      });
      try {
        const out = await runner.exec(args, req);
        return {
          ok: true,
          videoPath: out.videoPath,
          mime: "video/mp4",
          seconds: out.seconds,
          provider: WAN21_I2V_META.name,
        };
      } catch (e) {
        return {
          ok: false,
          reason: String((e as { message?: string })?.message ?? e).slice(0, 200),
          provider: WAN21_I2V_META.name,
          class: "transient",
        };
      }
    },
  };
}
