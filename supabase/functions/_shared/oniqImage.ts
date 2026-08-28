/**
 * ONIQ's own image engine, from the application's side.
 *
 * Owner directive 2026-08-27 (fully in-house generation): a story still
 * is drawn by ONIQ's GPU worker — the `image_generate` op, LTX text-to-
 * video over the baked snapshot, frame 0 — and by nothing else. There is
 * deliberately NO cloud fallback in this module: a failure here fails
 * clearly, because silently outsourcing the request is the exact
 * behaviour the directive exists to end.
 *
 * Everything that decides anything is pure and injectable, so the whole
 * path is exercised offline by the vitest suite the same way
 * gpuVideoCore is — the edge function is the transport, not the logic.
 */

const RUNPOD_SERVERLESS = "https://api.runpod.ai/v2";

/** Terminal provider states. UNKNOWN is never one of them. */
export const TERMINAL_OK = "COMPLETED";
export const TERMINAL_BAD = ["FAILED", "CANCELLED", "TIMED_OUT"];

/** The engine's own contract, mirrored: png at the video canvas. */
export const STILL_MIME = "image/png";

export type StillVerdict = { ok: true; bytes: number } | { ok: false; reason: string };

/**
 * The worker's success evidence, checked before an artifact is trusted.
 * A COMPLETED status proves the job ended, not that a still exists — the
 * same rule the video path learned.
 */
export function verifyStillOutput(output: unknown): StillVerdict {
  if (!output || typeof output !== "object") {
    return { ok: false, reason: "engine returned no output" };
  }
  const o = output as Record<string, unknown>;
  if (o.ok !== true) {
    return { ok: false, reason: `engine refused: ${String(o.code ?? "unknown")}` };
  }
  if (o.op !== "image_generate") {
    return { ok: false, reason: `wrong op: ${String(o.op)}` };
  }
  if (o.format !== "png") {
    return { ok: false, reason: `wrong format: ${String(o.format)}` };
  }
  const bytes = typeof o.output_bytes === "number" ? o.output_bytes : 0;
  if (!bytes) return { ok: false, reason: "no still was written" };
  if (!o.model || o.model === "missing") {
    return { ok: false, reason: "engine did not report the loaded model" };
  }
  if (!o.inference_ms) {
    return { ok: false, reason: "engine did not measure inference" };
  }
  return { ok: true, bytes };
}

/** PNG magic, checked on the bytes that came back — a 200 is not a PNG. */
export function looksLikePng(bytes: Uint8Array): boolean {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length > magic.length && magic.every((b, i) => bytes[i] === b);
}

export function stillKeyFor(id: string): string {
  return `story/still/${id}.png`;
}

export type EngineEnv = {
  apiKey: string;
  endpointId: string;
  publicBase: string;
};

export type EngineDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  newId: () => string;
};

/**
 * A failure that names whether trying again could plausibly help.
 *
 * WHY THIS EXISTS. Story job 1481d262 (2026-08-28) died when this engine
 * returned FAILED twice on shot 1, and the endpoint's own health at the
 * time read 53 completed / 20 failed with ZERO unhealthy or throttled
 * workers — so a quarter of all jobs fail against a provably healthy
 * endpoint, and not one of those twenty recorded WHY, because the throw
 * below used to discard the provider's error text. `retryable` and
 * `reason` exist so a failure is diagnosable and so the caller can tell
 * a container hiccup from a verdict about the request itself. Retrying
 * the second sort only spends money to be told the same thing again.
 */
export class EngineError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

/**
 * The provider's own account of a failed job, flattened to one short
 * line. RunPod carries it as `error` (usually the handler's traceback)
 * and sometimes inside `output`; both are read because neither is
 * promised. Bounded hard — this ends up in a log and an error body, and
 * an unbounded traceback belongs in neither.
 */
export function failureReason(state: unknown): string {
  if (!state || typeof state !== "object") return "";
  const s = state as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof s.error === "string" && s.error.trim()) parts.push(s.error.trim());
  const out = s.output;
  if (typeof out === "string" && out.trim()) {
    parts.push(out.trim());
  } else if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    for (const k of ["error", "message", "detail", "traceback"]) {
      if (typeof o[k] === "string" && (o[k] as string).trim()) {
        parts.push((o[k] as string).trim());
        break;
      }
    }
  }
  return parts.join(" | ").replace(/\s+/g, " ").slice(0, 300);
}

/**
 * Draw one still. Submits, polls to a bounded deadline, fetches the
 * artifact from the bucket's PUBLIC read base (credentials stay in the
 * endpoint's environment, never here), and proves the bytes before
 * returning them.
 */
export async function generateStill(
  prompt: string,
  env: EngineEnv,
  deps: EngineDeps,
  opts: { deadlineMs?: number; pollMs?: number; id?: string } = {},
): Promise<{ mime: string; data: string; bytes: number; key: string }> {
  const deadlineMs = opts.deadlineMs ?? 120_000;
  const pollMs = opts.pollMs ?? 2_000;
  const started = deps.now();
  // A caller may supply a DERIVED id so the still's key can be recomputed
  // later without being carried around — the film's motion stage needs to
  // name this still as its source without anyone passing a bucket path.
  // Absent one, a random id as before. This engine's own request stays
  // text-only either way; the id names the DESTINATION, never an input.
  const key = stillKeyFor(opts.id ?? deps.newId());
  const headers = {
    Authorization: `Bearer ${env.apiKey}`,
    "content-type": "application/json",
  };

  const submitted = await deps.fetchImpl(`${RUNPOD_SERVERLESS}/${env.endpointId}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { op: "image_generate", output_key: key, params: { prompt } },
    }),
  });
  if (!submitted.ok) {
    // 5xx is the platform; 4xx is a verdict on this request.
    throw new EngineError(
      `engine rejected the request (${submitted.status})`,
      submitted.status >= 500,
    );
  }
  const { id } = (await submitted.json()) as { id?: string };
  if (!id) throw new EngineError("engine returned no job id");

  let output: unknown = null;
  for (;;) {
    if (deps.now() - started > deadlineMs) {
      // The deadline expired with the job still not terminal — a slow
      // cold start looks exactly like this, and it is worth one more ask.
      throw new EngineError("still took too long", true);
    }
    await deps.sleep(pollMs);
    const res = await deps.fetchImpl(
      `${RUNPOD_SERVERLESS}/${env.endpointId}/status/${encodeURIComponent(id)}`,
      { headers },
    );
    if (!res.ok) throw new EngineError(`engine status ${res.status}`, res.status >= 500);
    const state = (await res.json()) as { status?: string; output?: unknown };
    if (state.status === TERMINAL_OK) {
      output = state.output;
      break;
    }
    if (TERMINAL_BAD.includes(String(state.status))) {
      const status = String(state.status);
      const why = failureReason(state);
      // FAILED and TIMED_OUT are the container hiccuping — measured
      // retryable: run #132's shot 6 hit FAILED and drew fine on the
      // next attempt. CANCELLED is somebody's decision, and asking
      // again would be arguing with it.
      throw new EngineError(
        why ? `engine job ${status}: ${why}` : `engine job ${status}`,
        status !== "CANCELLED",
      );
    }
  }

  const verdict = verifyStillOutput(output);
  if (verdict.ok !== true) throw new EngineError(verdict.reason);

  const artifact = await deps.fetchImpl(`${env.publicBase.replace(/\/$/, "")}/${key}`);
  // A 404 moments after the engine reported the write is the bucket
  // catching up, not a missing still; 5xx is the bucket hiccuping.
  if (!artifact.ok) {
    throw new EngineError(
      `artifact fetch ${artifact.status}`,
      artifact.status === 404 || artifact.status >= 500,
    );
  }
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  if (bytes.byteLength !== verdict.bytes) {
    throw new EngineError(
      `artifact is ${bytes.byteLength} bytes, engine measured ${verdict.bytes}`,
    );
  }
  if (!looksLikePng(bytes)) throw new EngineError("artifact is not a png");

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return { mime: STILL_MIME, data: btoa(binary), bytes: bytes.byteLength, key };
}
