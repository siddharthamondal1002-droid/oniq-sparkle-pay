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

export class EngineError extends Error {}

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
  opts: { deadlineMs?: number; pollMs?: number } = {},
): Promise<{ mime: string; data: string; bytes: number }> {
  const deadlineMs = opts.deadlineMs ?? 120_000;
  const pollMs = opts.pollMs ?? 2_000;
  const started = deps.now();
  const key = stillKeyFor(deps.newId());
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
    throw new EngineError(`engine rejected the request (${submitted.status})`);
  }
  const { id } = (await submitted.json()) as { id?: string };
  if (!id) throw new EngineError("engine returned no job id");

  let output: unknown = null;
  for (;;) {
    if (deps.now() - started > deadlineMs) {
      throw new EngineError("still took too long");
    }
    await deps.sleep(pollMs);
    const res = await deps.fetchImpl(
      `${RUNPOD_SERVERLESS}/${env.endpointId}/status/${encodeURIComponent(id)}`,
      { headers },
    );
    if (!res.ok) throw new EngineError(`engine status ${res.status}`);
    const state = (await res.json()) as { status?: string; output?: unknown };
    if (state.status === TERMINAL_OK) {
      output = state.output;
      break;
    }
    if (TERMINAL_BAD.includes(String(state.status))) {
      throw new EngineError(`engine job ${String(state.status)}`);
    }
  }

  const verdict = verifyStillOutput(output);
  if (verdict.ok !== true) throw new EngineError(verdict.reason);

  const artifact = await deps.fetchImpl(`${env.publicBase.replace(/\/$/, "")}/${key}`);
  if (!artifact.ok) throw new EngineError(`artifact fetch ${artifact.status}`);
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  if (bytes.byteLength !== verdict.bytes) {
    throw new EngineError(
      `artifact is ${bytes.byteLength} bytes, engine measured ${verdict.bytes}`,
    );
  }
  if (!looksLikePng(bytes)) throw new EngineError("artifact is not a png");

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return { mime: STILL_MIME, data: btoa(binary), bytes: bytes.byteLength };
}
