// Video provider selection — server-only half. Never imported by the client.
//
// Owner directive 2026-08-26 (production launch): ONIQ's IN-HOUSE video
// generation — LTX-Video 2B on a RunPod-serverless RTX A5000, I/O through
// the oniq-gpu R2 bucket — is the PRIMARY video path. (Launched on a 3090;
// the owner retargeted the endpoint to the A5000 the same day after the
// 3090's serverless availability flapped — see gpuVideoCore.TARGET_GPU_ID.)
// Google/Veo is OPTIONAL: available for fallback or a future premium tier,
// never required, and no video request may fail merely because Google video
// is unavailable. Wan 2.1 14B is FUTURE/EXPERIMENTAL and disabled.
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
