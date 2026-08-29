// Video provider selection — server-only half. Never imported by the client.
//
// Owner directive 2026-08-26 (production launch): ONIQ's IN-HOUSE video
// generation — LTX-Video 2B on a RunPod-serverless RTX A5000, I/O through
// the oniq-gpu R2 bucket — is the PRIMARY video path. (Launched on a 3090;
// the owner retargeted the endpoint to the A5000 the same day after the
// 3090's serverless availability flapped — see gpuVideoCore.TARGET_GPU_ID.)
// Google/Veo is OPTIONAL: available for fallback or a future premium tier,
// never required, and no video request may fail merely because Google video
// is unavailable.
//
// Owner directive 2026-08-29 (expanded open-source benchmark): Wan is no
// longer "disabled" — it is a CANDIDATE. The old flag encoded a stale fact,
// that an early experimental path had been switched off, and then read as a
// permanent verdict on the model family. Those are different claims, and the
// brief is explicit: Wan stays a candidate "until the benchmark determines
// its quality, license, runtime and cost", and if it does not beat LTX 2B it
// goes back to disabled.
//
// CANDIDATE IS NOT ENABLED. A candidate may be benchmarked; it may never
// serve a user. Generation flags below stay false and the selector still
// cannot reach anything but the production provider — the reclassification
// changes what ONIQ is allowed to LEARN, not what it is allowed to SPEND.
//
// Provider selection is SERVER-CONTROLLED: selectVideoProvider() takes no
// caller input, so a client cannot choose infrastructure — the same
// contract the GPU worker enforces (its job schema accepts a prompt and
// object references, never a GPU, model, image, or runtime). The measured
// production evidence behind this designation lives in
// docs/video/ONIQ_AI_FINANCIAL_CONTROL.md §16n–§16q.
//
// Consumers: the story movie pipeline (story-clip) reads this module's
// flags when it is wired onto the in-house path; until that wiring lands,
// this module is the single declared source of truth the wiring must use.

export type VideoProviderId = "in_house" | "google_veo";

export type VideoProviderDescriptor = {
  id: VideoProviderId;
  label: string;
  role: "primary" | "optional_fallback";
  /** What the provider runs — recorded, not client-selectable. */
  engine: string;
};

export const VIDEO_PROVIDERS: Record<VideoProviderId, VideoProviderDescriptor> = {
  in_house: {
    id: "in_house",
    label: "ONIQ in-house GPU inference",
    role: "primary",
    engine: "LTX-Video 2B on RunPod-serverless RTX A5000, R2 storage",
  },
  google_veo: {
    id: "google_veo",
    label: "Google Veo (optional)",
    role: "optional_fallback",
    engine: "Veo 3.1 Fast via GOOGLE_AI_API_KEY",
  },
};

// Phase 25 production flags — the launch configuration, verbatim.
export const MEDIA_VIDEO_GENERATION_ENABLED = true;
export const VIDEO_PROVIDER: VideoProviderId = "in_house";
export const VIDEO_MODEL = "LTX_VIDEO_2B";
export const VIDEO_GPU = "RTX_A5000";
export const WAN_GENERATION_ENABLED = false;
export const EXPERIMENTAL_MODELS_ENABLED = false;

/**
 * Where a model sits in ONIQ's evaluation, which is NOT the same question as
 * whether it may run.
 *
 *  production — serves users today.
 *  candidate  — may be measured and benchmarked; may not serve anyone. Every
 *               candidate needs an explicit owner authorisation before a
 *               single GPU-second is spent on it.
 *  disabled   — not under consideration.
 *
 * Splitting this out of the old boolean is the whole point of the 2026-08-29
 * directive: "WAN = disabled" conflated "we turned an experiment off" with
 * "this family is not worth measuring", and one of those was a decision while
 * the other was an accident of history.
 */
export type VideoModelStatus = "production" | "candidate" | "disabled";

export type ModelEvaluation = {
  readonly status: VideoModelStatus;
  /** Publisher licence as MEASURED from the registry, never as remembered. */
  readonly licence: string;
  /** What still has to be true before this could serve a user. */
  readonly blocking: string;
};

/**
 * The owner's expanded benchmark set. Licences are the ones the registry
 * actually reported on 2026-08-29 (oniq-gpu-worker `model-bench`), not values
 * typed from memory — "other" means the publisher's own terms and has to be
 * read before any production use, which is why it is recorded rather than
 * flattened to a yes/no.
 */
export const MODEL_EVALUATION: Record<string, ModelEvaluation> = {
  LTX_VIDEO_2B: {
    status: "production",
    licence: "other (Lightricks terms)",
    blocking: "none — this is what ships today",
  },
  LTX_VIDEO_13B: {
    status: "candidate",
    licence: "other (Lightricks terms)",
    blocking: "no real generation yet; runtime and quality unmeasured",
  },
  WAN_2_1_I2V_14B: {
    status: "candidate",
    licence: "apache-2.0",
    blocking: "no real generation yet; runtime and quality unmeasured",
  },
  WAN_2_2_I2V_A14B: {
    status: "candidate",
    licence: "apache-2.0",
    blocking: "no real generation yet; runtime and quality unmeasured",
  },
  HUNYUAN_VIDEO_1_5_I2V: {
    status: "candidate",
    licence: "other (tencent-hunyuan-community)",
    blocking:
      "architecture not readable from the published config, so not even a " +
      "VRAM projection exists yet",
  },
  COGVIDEOX_5B_I2V: {
    status: "candidate",
    licence: "other (publisher terms)",
    blocking: "no real generation yet; runtime and quality unmeasured",
  },
};

/**
 * Candidacy is permission to MEASURE, never permission to serve. Kept as a
 * function rather than a flag so the distinction has one enforcement point
 * that a test can pin.
 */
export function mayServeUsers(model: string): boolean {
  return MODEL_EVALUATION[model]?.status === "production";
}
export const GOOGLE_VIDEO_REQUIRED = false;
export const VIDEO_MAX_WORKERS = 1;
export const VIDEO_MIN_WORKERS = 0;

// Phase 8 initial production limits — expand only after real production
// measurements justify it, never on request.
export const VIDEO_LIMITS = {
  width: 704,
  height: 480,
  fps: 24,
  minSeconds: 3,
  maxSeconds: 5,
  concurrency: 1,
  maxRuntimeSeconds: 900,
  jobCeilingUsd: 0.5,
} as const;

/**
 * The production provider. Takes NO arguments by design: infrastructure
 * choice never comes from a caller, a request body, or a query string.
 */
export function selectVideoProvider(): VideoProviderDescriptor {
  return VIDEO_PROVIDERS[VIDEO_PROVIDER];
}
