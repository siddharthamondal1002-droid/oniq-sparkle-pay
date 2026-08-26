// gpuVideoFlow — the UI→GPU decision core, re-exported for the web app.
//
// The decisions themselves moved to supabase/functions/_shared/gpuVideoCore.ts
// (2026-08-26) so the gpu-video EDGE FUNCTION — the transport that actually
// works on the owner's device, same as every story function — runs the SAME
// code the app and the vitest suite see. One source of truth, two runtimes.
export {
  AUDIO_MODES,
  MAX_PROMPT_CHARS,
  TARGET_GPU_ID,
  NARRATION_FASTEST_WPS,
  NARRATION_MAX_CHARS,
  NARRATION_MAX_WORDS,
  STAGED_REFERENCES,
  TERMINAL_STATUSES,
  UI_LABELS,
  VIDEO_CLOCK_SECONDS,
  WATCHDOG_SECONDS,
  admitGeneration,
  buildAudioMuxPayload,
  buildWorkerPayload,
  finalRefFor,
  idempotentReuse,
  narrationWordCount,
  outputRefFor,
  statusFromPoll,
  validateRequest,
  verifyAudioMuxOutput,
  verifyStoredArtifact,
  verifyWorkerOutput,
  watchdogExpired,
  type AudioMode,
  type GenerationRequest,
  type JobStatus,
  type OutputVerdict,
  type RequestRefusal,
} from "../../supabase/functions/_shared/gpuVideoCore.ts";

import { VIDEO_GPU, VIDEO_LIMITS, VIDEO_MODEL, VIDEO_PROVIDER } from "@/lib/videoProvider.server";

// ------------------------------------------------------------ launch facts
/** Single-source launch facts, re-exported for the tool's UI copy. */
export const LAUNCH = {
  provider: VIDEO_PROVIDER,
  model: VIDEO_MODEL,
  gpu: VIDEO_GPU,
  limits: VIDEO_LIMITS,
} as const;
