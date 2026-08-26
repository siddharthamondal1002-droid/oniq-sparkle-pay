// gpuVideoFlow — every DECISION in the UI→GPU generation path, pure.
//
// The server functions in gpuVideo.server.ts are transports around this
// module: they read secrets and move bytes, this file decides. That split is
// what lets the whole flow — payload shape, infrastructure lockdown, status
// transitions, artifact verification, idempotency, the watchdog — be proved
// by vitest without a credential or a cent.
//
// Owner directive 2026-08-26 (production launch): the in-house path is
// PRIMARY — LTX-Video 2B on a RunPod-serverless RTX 3090, R2 in/out, custody
// copy in Supabase storage. The client's only degrees of freedom are the
// motion prompt, a reference chosen from the server-side registry, and an
// idempotency key. Everything else is decided here or refused here.

import {
  GPU_JOB_CAP_USD,
  MAX_GPU_RUNTIME_SECONDS,
  admitGpuJob,
  type GpuAdmission,
} from "../../supabase/functions/_shared/gpuJob.ts";
import { VIDEO_GPU, VIDEO_LIMITS, VIDEO_MODEL, VIDEO_PROVIDER } from "@/lib/videoProvider.server";

// ------------------------------------------------------------ the request
/** What a client may say. Anything beyond these fields is refused, not ignored. */
export type GenerationRequest = {
  prompt: string;
  /** An id into STAGED_REFERENCES — never a bucket path. */
  referenceId: string;
  /** One per user gesture. Repeats return the existing job. */
  idempotencyKey: string;
};

const REQUEST_FIELDS = new Set(["prompt", "referenceId", "idempotencyKey"]);

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
  | "infrastructure-not-selectable";

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
  return { ok: true, request: { prompt, referenceId, idempotencyKey } };
}

// ------------------------------------------------------------- the payload
/**
 * The worker-contract payload, byte for byte what the proven pipeline runs:
 * op + object references + a prompt-only params object. Assembled ONLY from
 * validated parts; there is no spread of client input anywhere near it.
 */
export function buildWorkerPayload(request: GenerationRequest, jobId: string) {
  return {
    input: {
      op: "video_generate",
      input_key: STAGED_REFERENCES[request.referenceId].key,
      output_key: outputRefFor(jobId),
      params: { prompt: request.prompt },
    },
  };
}

/** Server-generated output reference — media/video/<job_id>/, per §16q. */
export function outputRefFor(jobId: string): string {
  return `media/video/${jobId}/ltx-001.mp4`;
}

// ------------------------------------------------------------ the admission
/**
 * Financial admission for one generation: the SAME admitGpuJob gate the GPU
 * contract module defines, fed a LIVE price. LTX 2B measured 15.9GB peak on
 * the card, so 16GB is the honest VRAM floor.
 */
export function admitGeneration(livePricePerHourUsd: number | null): GpuAdmission {
  return admitGpuJob({
    gpuType: "NVIDIA GeForce RTX 3090",
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
  if (!/3090/.test(String(o.gpu_name ?? ""))) return { ok: false, reason: "wrong-gpu" };
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

// ------------------------------------------------------------ launch facts
/** Single-source launch facts, re-exported for the tool's UI copy. */
export const LAUNCH = {
  provider: VIDEO_PROVIDER,
  model: VIDEO_MODEL,
  gpu: VIDEO_GPU,
  limits: VIDEO_LIMITS,
} as const;
