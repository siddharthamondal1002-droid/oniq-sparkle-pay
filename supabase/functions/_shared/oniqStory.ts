/**
 * ONIQ's own story model, from the application's side.
 *
 * Owner directive 2026-08-27 (Qwen3-8B approved): a story is written by
 * ONIQ's GPU worker — the `story_generate` op over the baked checkpoint —
 * and by nothing else. As in oniqImage, there is deliberately NO cloud
 * fallback in this module: a failure here fails clearly, because quietly
 * outsourcing the request is the exact behaviour the directive ends.
 *
 * This is the TRANSPORT and only the transport. It produces tokens; it
 * does not parse, repair or validate a story. Those live in
 * localStoryModel and storyIr, which already own them — the same split
 * the worker keeps on its own side, where the op deliberately contains no
 * JSON handling at all.
 *
 * Everything that decides anything is pure and injectable, so the whole
 * path is exercised offline the way oniqImage's is; the edge function is
 * the transport of the transport, not the logic.
 */

import type { LocalInvoke } from "./localStoryModel.ts";

const RUNPOD_SERVERLESS = "https://api.runpod.ai/v2";

/** Terminal provider states. UNKNOWN is never one of them. */
export const TERMINAL_OK = "COMPLETED";
export const TERMINAL_BAD = ["FAILED", "CANCELLED", "TIMED_OUT"];

/**
 * The worker contract's own bounds, mirrored.
 *
 * Mirrored rather than guessed, and checked HERE, because the worker
 * validates a job after the job has started: a prompt the worker will
 * refuse still costs GPU seconds to be refused. Refusing it locally costs
 * nothing. If these ever drift from contract.py the worker still wins —
 * it revalidates everything — so the cost of drift is a wasted refusal,
 * never an accepted bad job.
 */
export const MAX_STORY_PROMPT_CHARS = 20000;
export const MIN_STORY_TOKENS = 256;
export const MAX_STORY_TOKENS = 8192;

export type StoryVerdict =
  { ok: true; text: string; chars: number } | { ok: false; reason: string };

/**
 * The worker's success evidence, checked before the text is trusted.
 * A COMPLETED status proves the job ENDED, not that a story exists — the
 * same rule the video and image paths learned the expensive way.
 */
export function verifyStoryOutput(output: unknown): StoryVerdict {
  if (!output || typeof output !== "object") {
    return { ok: false, reason: "engine returned no output" };
  }
  const o = output as Record<string, unknown>;
  if (o.ok !== true) {
    return { ok: false, reason: `engine refused: ${String(o.code ?? "unknown")}` };
  }
  if (o.op !== "story_generate") {
    return { ok: false, reason: `wrong op: ${String(o.op)}` };
  }
  const text = typeof o.story_text === "string" ? o.story_text : "";
  if (!text.trim()) return { ok: false, reason: "engine wrote no story" };
  if (!o.model || o.model === "missing") {
    return { ok: false, reason: "engine did not report the loaded model" };
  }
  if (!o.inference_ms) {
    return { ok: false, reason: "engine did not measure inference" };
  }
  const chars = typeof o.story_chars === "number" ? o.story_chars : 0;
  if (chars !== text.length) {
    // The worker measures what it sent. A mismatch means the text was
    // truncated or altered in transit, and a half-story parses into a
    // plausible-looking short film rather than failing.
    return { ok: false, reason: `engine measured ${chars} chars, received ${text.length}` };
  }
  return { ok: true, text, chars };
}

export type StoryEngineEnv = {
  apiKey: string;
  endpointId: string;
};

export type StoryEngineDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export class StoryEngineError extends Error {}

/**
 * Write one story. Submits, polls to a bounded deadline, and proves the
 * response before returning the text.
 *
 * There is no artifact to fetch: `story_generate` is text-only and the
 * worker returns the story IN the response, so nothing here touches a
 * bucket. That is also why the request carries no output_key — the worker
 * contract refuses one on a text op.
 */
export async function generateStoryText(
  prompt: string,
  maxTokens: number,
  env: StoryEngineEnv,
  deps: StoryEngineDeps,
  opts: { deadlineMs?: number; pollMs?: number } = {},
): Promise<{ text: string; chars: number }> {
  if (!prompt.trim()) throw new StoryEngineError("empty prompt");
  if (prompt.length > MAX_STORY_PROMPT_CHARS) {
    throw new StoryEngineError(
      `prompt is ${prompt.length} chars, the engine accepts ${MAX_STORY_PROMPT_CHARS}`,
    );
  }
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < MIN_STORY_TOKENS ||
    maxTokens > MAX_STORY_TOKENS
  ) {
    throw new StoryEngineError(
      `max_tokens ${maxTokens} is outside ${MIN_STORY_TOKENS}-${MAX_STORY_TOKENS}`,
    );
  }

  // Generous against the image path's 120s: an 8k-token generation is a
  // long job, and the worker's own executionTimeout is the real ceiling.
  const deadlineMs = opts.deadlineMs ?? 300_000;
  const pollMs = opts.pollMs ?? 3_000;
  const started = deps.now();
  const headers = {
    Authorization: `Bearer ${env.apiKey}`,
    "content-type": "application/json",
  };

  const submitted = await deps.fetchImpl(`${RUNPOD_SERVERLESS}/${env.endpointId}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { op: "story_generate", params: { prompt, max_tokens: maxTokens } },
    }),
  });
  if (!submitted.ok) {
    throw new StoryEngineError(`engine rejected the request (${submitted.status})`);
  }
  const { id } = (await submitted.json()) as { id?: string };
  if (!id) throw new StoryEngineError("engine returned no job id");

  let output: unknown = null;
  for (;;) {
    if (deps.now() - started > deadlineMs) {
      throw new StoryEngineError("story took too long");
    }
    await deps.sleep(pollMs);
    const res = await deps.fetchImpl(
      `${RUNPOD_SERVERLESS}/${env.endpointId}/status/${encodeURIComponent(id)}`,
      { headers },
    );
    if (!res.ok) throw new StoryEngineError(`engine status ${res.status}`);
    const state = (await res.json()) as { status?: string; output?: unknown };
    if (state.status === TERMINAL_OK) {
      output = state.output;
      break;
    }
    if (TERMINAL_BAD.includes(String(state.status))) {
      throw new StoryEngineError(`engine job ${String(state.status)}`);
    }
  }

  const verdict = verifyStoryOutput(output);
  if (verdict.ok !== true) throw new StoryEngineError(verdict.reason);
  return { text: verdict.text, chars: verdict.chars };
}

/**
 * The transport in the shape localStoryModel asks for.
 *
 * `generateStoryIr` takes a LocalInvoke or throws LocalModelUnavailable;
 * this is the only implementation of it that exists, and it reaches
 * ONIQ's own worker. Building it here rather than inside generateStoryIr
 * is what keeps that module provider-neutral by construction — it still
 * has no idea a RunPod endpoint exists.
 */
export function storyInvoke(env: StoryEngineEnv, deps: StoryEngineDeps): LocalInvoke {
  return async (prompt: string, opts: { maxTokens: number }) => {
    const { text } = await generateStoryText(prompt, opts.maxTokens, env, deps);
    return text;
  };
}
