// gpuVideoCore — every DECISION in the UI→GPU generation path, pure.
//
// Moved here from src/lib/gpuVideoFlow.ts (2026-08-26) so the gpu-video EDGE
// FUNCTION and the web app run the SAME decisions from one file: src/lib
// re-exports this module, the vitest suite proves it, and Deno imports it
// directly. Zero imports beyond the sibling GPU contract, like every module
// both runtimes load.
//
// Owner directive 2026-08-26 (production launch): the in-house path is
// PRIMARY — LTX-Video 2B on a RunPod-serverless card, R2 in/out, custody
// copy in Supabase storage. The client's only degrees of freedom are the
// motion prompt, a reference chosen from the server-side registry, and an
// idempotency key. Everything else is decided here or refused here.

import {
  GPU_JOB_CAP_USD,
  MAX_GPU_RUNTIME_SECONDS,
  admitGpuJob,
  type GpuAdmission,
} from "./gpuJob.ts";
import { verifyFinalMedia } from "./videoAudio.ts";

// ------------------------------------------------------------ the request
/** What a client may say. Anything beyond these fields is refused, not ignored. */
export type GenerationRequest = {
  prompt: string;
  /** An id into STAGED_REFERENCES — never a bucket path. */
  referenceId: string;
  /** One per user gesture. Repeats return the existing job. */
  idempotencyKey: string;
  /** Voice-over mode — "off" (the default) or "narration". Nothing else. */
  audio: AudioMode;
  /** The narration line, required when audio is "narration". */
  narrationText?: string;
};

const REQUEST_FIELDS = new Set([
  "prompt",
  "referenceId",
  "idempotencyKey",
  "audio",
  "narrationText",
]);

// ------------------------------------------------------------------ audio
/** The audio choices a client has. Voice, model, rate, format: server's. */
export const AUDIO_MODES = ["off", "narration"] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];

/**
 * The generated video's fixed length — the worker contract's 97 frames at
 * 24fps. For this tool the VIDEO is the clock (the inverse of Stories,
 * where narration is), so the narration must fit inside it.
 */
export const VIDEO_CLOCK_SECONDS = 97 / 24;

/** Mirrors the worker contract's MAX_NARRATION_CHARS — an input fence. */
export const NARRATION_MAX_CHARS = 300;

/**
 * The estimate pre-gate, from the Story pipeline's measured speech rates:
 * across four real films the FASTEST measured narration ran 2.672 words
 * per second. A line that would overflow the 4.04s video even at that
 * fastest rate is certainly doomed, so it is refused before any money
 * moves; anything shorter passes to the worker's MEASURED gate, which is
 * authoritative and refuses (never truncates) after the voice is spoken.
 */
export const NARRATION_FASTEST_WPS = 2.672;
export const NARRATION_MAX_WORDS = Math.floor(VIDEO_CLOCK_SECONDS * NARRATION_FASTEST_WPS);

/** Words as the estimator counts them — NBSP is a space, like the SQL gate. */
export function narrationWordCount(text: string): number {
  const words = text
    .replace(/\u00a0/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}

/**
 * Reference images the worker can reach, by id. The worker reads from the
 * oniq-gpu R2 bucket and nothing app-side holds R2 write credentials (they
 * live only in the RunPod endpoint environment, by design), so inputs are
 * staged keys, registered here after the owner uploads them. A client names
 * an id; the KEY never crosses the wire inbound.
 */
export const STAGED_REFERENCES: Record<string, { key: string; label: string }> = {
  "reference-001": {
    key: "IMG-20260825-WA0002.jpg",
    label: "Reference portrait (production canary image)",
  },
};

export const MAX_PROMPT_CHARS = 1000; // mirrors the worker contract's bound

export type RequestRefusal =
  | "unknown-field"
  | "prompt-missing"
  | "prompt-too-long"
  | "reference-unknown"
  | "idempotency-key-missing"
  | "infrastructure-not-selectable"
  | "audio-mode-unknown"
  | "narration-missing"
  | "narration-too-long"
  | "narration-estimate-too-long";

/**
 * Validate a client request. GPU/provider/model/budget/runtime/bucket words
 * arriving as EXTRA FIELDS are the classic way infrastructure control leaks
 * to a browser, so unknown fields are a refusal with their own reason —
 * loudly distinct from a typo'd prompt.
 */
export function validateRequest(
  raw: Record<string, unknown>,
): { ok: true; request: GenerationRequest } | { ok: false; reason: RequestRefusal } {
  const unknown = Object.keys(raw).filter((k) => !REQUEST_FIELDS.has(k));
  if (unknown.length) {
    const infra = /gpu|provider|model|endpoint|budget|runtime|cost|bucket|key|worker|image/i;
    return {
      ok: false,
      reason: unknown.some((k) => infra.test(k))
        ? "infrastructure-not-selectable"
        : "unknown-field",
    };
  }
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return { ok: false, reason: "prompt-missing" };
  if (prompt.length > MAX_PROMPT_CHARS) return { ok: false, reason: "prompt-too-long" };
  const referenceId = typeof raw.referenceId === "string" ? raw.referenceId : "";
  if (!STAGED_REFERENCES[referenceId]) return { ok: false, reason: "reference-unknown" };
  const idempotencyKey = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return { ok: false, reason: "idempotency-key-missing" };
  }

  // Audio: absent means off. Anything not on the list is a refusal, not a
  // coercion — an unknown mode silently becoming "off" would hide a bug.
  const audioRaw = raw.audio === undefined ? "off" : raw.audio;
  if (audioRaw !== "off" && audioRaw !== "narration") {
    return { ok: false, reason: "audio-mode-unknown" };
  }
  const audio: AudioMode = audioRaw;
  let narrationText: string | undefined;
  if (audio === "narration") {
    narrationText = typeof raw.narrationText === "string" ? raw.narrationText.trim() : "";
    if (!narrationText) return { ok: false, reason: "narration-missing" };
    if (narrationText.length > NARRATION_MAX_CHARS) {
      return { ok: false, reason: "narration-too-long" };
    }
    if (narrationWordCount(narrationText) > NARRATION_MAX_WORDS) {
      return { ok: false, reason: "narration-estimate-too-long" };
    }
  }

  return { ok: true, request: { prompt, referenceId, idempotencyKey, audio, narrationText } };
}

// ------------------------------------------------------------- the payload
/**
 * The worker-contract payload, byte for byte what the proven pipeline runs:
 * op + object references + a params object assembled ONLY from validated
 * parts — there is no spread of client input anywhere near it.
 *
 * `noWatermark` is the SERVER-derived entitlement (has_entitlement at
 * submit, recorded on the job row) — never a client flag. The worker's
 * contract defaults an absent watermark to TRUE, so the only way to a
 * clean export is this server passing false deliberately.
 */
export function buildWorkerPayload(
  request: GenerationRequest,
  jobId: string,
  noWatermark: boolean = false,
) {
  return {
    input: {
      op: "video_generate",
      input_key: STAGED_REFERENCES[request.referenceId].key,
      output_key: outputRefFor(jobId),
      params: { prompt: request.prompt, watermark: !noWatermark },
    },
  };
}

/**
 * The watermark proof (monetization resolution loop, 2026-08-27): when the
 * worker reports whether it burned the mark, that report must match the
 * entitlement of record — a Pro clip that came back marked, or a free clip
 * that came back clean, is the WRONG PRODUCT and fails closed (released,
 * never charged, never delivered). An output with no `watermarked` key is
 * the pre-watermark worker image still serving: accepted as the status quo
 * ante, and the canary reads it as "image not yet rebuilt", never as clean.
 */
export function watermarkVerdict(output: unknown, noWatermark: boolean): OutputVerdict {
  if (!output || typeof output !== "object") return { ok: false, reason: "no-output" };
  const o = output as Record<string, unknown>;
  if (!("watermarked" in o)) return { ok: true };
  if (typeof o.watermarked !== "boolean") {
    return { ok: false, reason: "watermark-evidence-invalid" };
  }
  if (o.watermarked !== !noWatermark) return { ok: false, reason: "wrong-watermark" };
  return { ok: true };
}

/** Server-generated output reference — media/video/<job_id>/, per §16q. */
export function outputRefFor(jobId: string): string {
  return `media/video/${jobId}/ltx-001.mp4`;
}

/** The voiced final's reference — same server-owned namespace as the source. */
export function finalRefFor(jobId: string): string {
  return `media/video/${jobId}/final-001.mp4`;
}

/**
 * The audio_mux payload: the SILENT video this same job already generated
 * (by its server-owned key) in, the voiced final out, and the narration as
 * the only parameter. Voice, rate and format are the worker's decisions.
 */
export function buildAudioMuxPayload(narration: string, jobId: string) {
  return {
    input: {
      op: "audio_mux",
      input_key: outputRefFor(jobId),
      output_key: finalRefFor(jobId),
      params: { narration },
    },
  };
}

// ------------------------------------------------------------ the admission
/**
 * The production card — owner-settled 2026-08-26 after the endpoint's GPU
 * swap (3090 pool flap → L4 → A5000): the RTX A5000, 24GB, secure cloud.
 * One canonical id, used by BOTH the admission below and the worker-output
 * proof, so the card the app authorizes and the card it accepts evidence
 * from can never drift apart. The endpoint (p3zmlv8ek10dzt) offers exactly
 * this card; a worker reporting anything else fails closed.
 */
export const TARGET_GPU_ID = "NVIDIA RTX A5000";

/**
 * Financial admission for one generation: the SAME admitGpuJob gate the GPU
 * contract module defines, fed a LIVE price. LTX 2B measured 15.9GB peak on
 * the card, so 16GB is the honest VRAM floor (the A5000 carries 24GB).
 */
export function admitGeneration(livePricePerHourUsd: number | null): GpuAdmission {
  return admitGpuJob({
    gpuType: TARGET_GPU_ID,
    pricePerHourUsd: livePricePerHourUsd,
    maxRuntimeSeconds: MAX_GPU_RUNTIME_SECONDS,
    requiredVramGb: 16,
    jobCapUsd: GPU_JOB_CAP_USD,
  });
}

// ---------------------------------------------------------------- statuses
export type JobStatus =
  | "queued"
  | "admitted"
  | "provisioning"
  | "running"
  | "uploading"
  | "audio_generating"
  | "completed"
  | "failed"
  | "timed-out"
  | "cancelled"
  | "terminating"
  | "orphaned";

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  "completed",
  "failed",
  "timed-out",
  "cancelled",
  "orphaned",
]);

/** What the user is told, per status. Provider internals stay out of copy. */
export const UI_LABELS: Record<JobStatus, string> = {
  queued: "Preparing…",
  admitted: "Queued",
  provisioning: "Starting GPU…",
  running: "Generating…",
  uploading: "Uploading…",
  audio_generating: "Adding voice…",
  completed: "Ready",
  failed: "Failed",
  "timed-out": "Failed (took too long)",
  cancelled: "Cancelled",
  terminating: "Finishing up…",
  orphaned: "Failed (needs operator attention)",
};

/**
 * Map a RunPod serverless poll onto the job state machine. IN_QUEUE before
 * a worker exists is the cold boot — "provisioning" — because that is what
 * the user is actually waiting on.
 */
export function statusFromPoll(runpodStatus: string): JobStatus | null {
  switch (runpodStatus) {
    case "IN_QUEUE":
      return "provisioning";
    case "IN_PROGRESS":
      return "running";
    case "COMPLETED":
      return "uploading"; // artifact custody + verification still ahead
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "TIMED_OUT":
      return "timed-out";
    default:
      return null; // unknown provider vocabulary changes nothing
  }
}

// ------------------------------------------------------------ verification
/**
 * The GPU success proof, mirrored from the validation driver: a COMPLETED
 * status proves nothing by itself. Every check the money depends on, again,
 * at the application boundary.
 */
export type OutputVerdict = { ok: true } | { ok: false; reason: string };

export function verifyWorkerOutput(output: unknown): OutputVerdict {
  if (!output || typeof output !== "object") return { ok: false, reason: "no-output" };
  const o = output as Record<string, unknown>;
  if (o.ok !== true) return { ok: false, reason: `worker-not-ok:${String(o.code ?? "unknown")}` };
  if (o.device !== "cuda") return { ok: false, reason: "not-cuda" };
  // Explicit canonical identity, not a substring: the worker's reported
  // card must BE the card the app authorized. Any other name — including
  // yesterday's card — fails closed.
  if (String(o.gpu_name ?? "") !== TARGET_GPU_ID) return { ok: false, reason: "wrong-gpu" };
  const model = String(o.model ?? "");
  if (!model || model === "missing") return { ok: false, reason: "model-unproven" };
  if (!o.model_load_ms) return { ok: false, reason: "model-unproven" };
  if (!o.inference_ms) return { ok: false, reason: "no-inference" };
  if (!(typeof o.frames === "number" && o.frames > 0)) return { ok: false, reason: "no-frames" };
  if (!(typeof o.video_seconds === "number" && o.video_seconds > 0)) {
    return { ok: false, reason: "no-frames" };
  }
  if (!(typeof o.output_bytes === "number" && o.output_bytes > 0)) {
    return { ok: false, reason: "no-artifact" };
  }
  return { ok: true };
}

/**
 * The audio_mux success proof. The worker measured the OUTPUT's streams
 * (it decodes them, header trust is banned there too); this re-judges
 * those measurements with the SAME shared verdict the rest of ONIQ media
 * uses — verifyFinalMedia from videoAudio.ts — so a track that is silence
 * with extra steps, or a drifted mux, is refused at the application
 * boundary even if a future worker regression let it through.
 */
export function verifyAudioMuxOutput(output: unknown): OutputVerdict {
  if (!output || typeof output !== "object") return { ok: false, reason: "no-output" };
  const o = output as Record<string, unknown>;
  if (o.ok !== true) return { ok: false, reason: `worker-not-ok:${String(o.code ?? "unknown")}` };
  if (o.has_audio !== true) return { ok: false, reason: "no-audio-stream" };
  if (!(typeof o.narration_seconds === "number" && o.narration_seconds > 0)) {
    return { ok: false, reason: "no-narration" };
  }
  if (!(typeof o.output_bytes === "number" && o.output_bytes > 0)) {
    return { ok: false, reason: "no-artifact" };
  }
  const videoSeconds = typeof o.video_seconds === "number" ? o.video_seconds : 0;
  const audioSeconds = typeof o.audio_seconds === "number" ? o.audio_seconds : 0;
  const verdict = verifyFinalMedia("ONIQ_SOUND", {
    hasVideoStream: videoSeconds > 0,
    hasAudioStream: true,
    videoSeconds,
    audioSeconds,
    audioPeakDb: typeof o.audio_peak_dbfs === "number" ? o.audio_peak_dbfs : undefined,
  });
  if (!verdict.ok) return { ok: false, reason: `media:${verdict.failures[0]}` };
  return { ok: true };
}

/**
 * The custody copy must BE the artifact the worker measured: same byte
 * count (the identity check this repo already trusts for published media),
 * and a real ISO-BMFF header — bytes 4..8 spell "ftyp".
 */
export function verifyStoredArtifact(bytes: Uint8Array, expectedByteCount: number): OutputVerdict {
  if (bytes.byteLength === 0) return { ok: false, reason: "artifact-empty" };
  if (bytes.byteLength !== expectedByteCount)
    return { ok: false, reason: "artifact-size-mismatch" };
  const ftyp = String.fromCharCode(...bytes.slice(4, 8));
  if (ftyp !== "ftyp") return { ok: false, reason: "artifact-not-mp4" };
  return { ok: true };
}

// -------------------------------------------------------------- idempotency
/**
 * Whether a submit with this key returns an existing job. Only a FAILED
 * family job frees the key for an explicit retry — an in-flight or
 * completed job is always returned rather than re-run.
 */
export function idempotentReuse(existing: { status: JobStatus } | null): boolean {
  if (!existing) return false;
  return !["failed", "timed-out", "cancelled"].includes(existing.status);
}

// ---------------------------------------------------------------- watchdog
/**
 * Wall-clock watchdog: the execution ceiling plus the same again for queue
 * and cold pull (the measured cold pull was 204–399s). Past this, a
 * non-terminal job is cancelled and marked timed-out — nothing waits
 * forever, and nothing re-submits by itself.
 */
export const WATCHDOG_SECONDS = MAX_GPU_RUNTIME_SECONDS + 900;

export function watchdogExpired(createdAtIso: string, nowMs: number): boolean {
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return true; // unparsable age is not a license to run forever
  return nowMs - created > WATCHDOG_SECONDS * 1000;
}
