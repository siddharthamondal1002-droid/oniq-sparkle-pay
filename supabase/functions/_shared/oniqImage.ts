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

/**
 * THE PROMPT CEILING, and it belongs to the worker, not to us.
 *
 * MEASURED 2026-08-29, and this is the 27%. The GPU worker's contract.py
 * refuses `params.prompt` over 1000 characters; story-still was accepting
 * 2000 and the story worker was slicing every ask to 1900. So any richly
 * described shot — the rungs carrying character locks are the long ones —
 * was accepted here and refused there, EVERY time, while a plain shot went
 * through. Prompt length varies per shot, so a deterministic contract
 * mismatch looked exactly like a flaky endpoint: 20 failed against 53
 * completed, with no unhealthy worker anywhere.
 *
 * It stayed invisible because the throw discarded the provider's error
 * text. The first failure after that was captured read
 * `engine job FAILED: params.prompt exceeds 1000 characters`, which is the
 * whole diagnosis in one line.
 *
 * ONE NUMBER, imported by both ends. story-still refuses past it and the
 * worker slices to it, so the two cannot drift apart again — that drift is
 * the bug, not the value.
 */
export const ENGINE_MAX_PROMPT_CHARS = 1000;

/**
 * THE ASPECT IS THE CANVAS, NOT A SENTENCE. Removed 2026-08-31.
 *
 * This module used to append
 *
 *     "\n\nVertical 9:16 portrait composition, full-bleed."
 *
 * to every ask. For as long as it existed it was FALSE: the worker's contract
 * sampled 704x480 — landscape, 1.47:1 — so the model was told to compose
 * vertically onto a horizontal canvas, and the assembler then took a
 * 1080x1920 crop out of the middle of the result. The audit measured what
 * that cost: 61.6% of every frame's width discarded and 16 output pixels
 * invented per real one.
 *
 * The canvas is now genuinely portrait (contract.py: 704x1248, both axes
 * 32-divisible, 0.28% crop against the 1080x1920 film), so the sentence is no
 * longer a lie — and that is exactly why it goes. An aspect ratio is a
 * property of the tensor, decided in ONE place; a prompt asking for it is a
 * second, weaker, unverifiable copy that can silently disagree with the first.
 * Deleting it also returns 46 characters of an already-tight budget to the
 * words that describe the shot.
 *
 * If a future canvas changes shape, contract.py changes and nothing here has
 * to be remembered.
 */

/** What a caller may send. The worker's whole ceiling, now nothing is skimmed. */
export const MAX_ASK_CHARS = ENGINE_MAX_PROMPT_CHARS;

/**
 * The worker's negative-prompt ceiling, mirrored (contract.py:
 * MAX_NEGATIVE_PROMPT_CHARS). One number on both sides, for the same reason
 * ENGINE_MAX_PROMPT_CHARS is: a ceiling known to only one end of a contract
 * is a deterministic failure waiting for a long enough input.
 */
export const MAX_NEGATIVE_PROMPT_CHARS = 400;

/** The worker's seed bound: params.seed is a uint64. */
export const MAX_SEED = 2 ** 53 - 1;

export type StillVerdict =
  { ok: true; bytes: number } | { ok: false; reason: string; retryable?: boolean };

/**
 * Engine refusal codes that are infrastructure, not a verdict on the ask.
 *
 * The worker catches every Python exception and returns {ok:false, code}
 * as a COMPLETED job, so these arrive looking exactly like "your prompt
 * was refused" — and two of them are nothing of the sort. A container
 * that came up without a GPU says cuda-unavailable, and the next
 * container may well have one; a bucket that throttled or 500'd says so
 * in R2's own vocabulary. Both are worth one more ask.
 *
 * An ALLOWLIST, deliberately. An unrecognised code stays non-retryable,
 * so a refusal added to the worker later cannot start costing GPU
 * seconds here without somebody deciding that it should.
 */
export const TRANSIENT_ENGINE_CODES = new Set([
  "cuda-unavailable",
  "InternalError",
  "ServiceUnavailable",
  "SlowDown",
  "RequestTimeout",
  "RequestTimeTooSkewed",
  "ThrottlingException",
]);

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
    const code = String(o.code ?? "unknown");
    return {
      ok: false,
      reason: `engine refused: ${code}`,
      retryable: TRANSIENT_ENGINE_CODES.has(code),
    };
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
/**
 * Failure texts that will say the same thing every time.
 *
 * RunPod reports a job FAILED when the handler's result carries an `error`
 * key, and handler._error() sets one for every ContractError — so a
 * validation refusal and a dead container arrive under the identical
 * status. Only the reason separates them, which is why capturing it
 * mattered: `params.prompt exceeds 1000 characters` is not a hiccup, and
 * asking again spends three GPU jobs to be refused three times.
 */
const DETERMINISTIC_FAILURE = [
  /exceeds \d+ characters/i,
  /may not exceed/i,
  /must be a non-empty string/i,
  /invalid-input/i,
  /unsupported op/i,
  /unknown op/i,
  /missing required/i,
];

/** Would this failure reason plausibly change on another attempt? */
export function failureIsTransient(reason: string): boolean {
  if (!reason) return true; // no reason given — the old, blind behaviour
  return !DETERMINISTIC_FAILURE.some((re) => re.test(reason));
}

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
  opts: {
    deadlineMs?: number;
    pollMs?: number;
    id?: string;
    /**
     * The sampler seed for THIS draw. Derived by the caller from the shot's
     * identity plus its attempt number (storySeed.ts) — never rolled here,
     * because a still that cannot be redrawn is a still nobody can diagnose.
     * Absent, the worker falls back to its own constant, which is the old
     * behaviour and is why ten retries used to be one image ten times.
     */
    seed?: number;
    /**
     * What this shot must NOT contain. Per shot, because the terms that ruin
     * a face are not the terms that ruin a landscape (faceQuality.ts).
     */
    negativePrompt?: string;
  } = {},
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
      input: {
        op: "image_generate",
        output_key: key,
        // Only fields the worker's contract names, and only when the caller
        // actually supplied one: sending `seed: undefined` would serialise
        // away, but sending `seed: null` would be refused by the contract, and
        // an absent field is the documented way to ask for the default.
        params: {
          prompt,
          ...(typeof opts.seed === "number" ? { seed: opts.seed } : {}),
          ...(typeof opts.negativePrompt === "string"
            ? { negative_prompt: opts.negativePrompt }
            : {}),
        },
      },
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
        status !== "CANCELLED" && failureIsTransient(why),
      );
    }
  }

  const verdict = verifyStillOutput(output);
  if (verdict.ok !== true) throw new EngineError(verdict.reason, verdict.retryable === true);

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
