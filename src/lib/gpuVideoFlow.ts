// gpuVideoFlow — the UI→GPU decision core, re-exported for the web app.
//
// The decisions themselves moved to supabase/functions/_shared/gpuVideoCore.ts
// (2026-08-26) so the gpu-video EDGE FUNCTION — the transport that actually
// works on the owner's device, same as every story function — runs the SAME
// code the app and the vitest suite see. One source of truth, two runtimes.
export {
  MAX_PROMPT_CHARS,
  STAGED_REFERENCES,
  TERMINAL_STATUSES,
  UI_LABELS,
  WATCHDOG_SECONDS,
  admitGeneration,
  buildWorkerPayload,
  idempotentReuse,
  outputRefFor,
  statusFromPoll,
  validateRequest,
  verifyStoredArtifact,
  verifyWorkerOutput,
  watchdogExpired,
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
