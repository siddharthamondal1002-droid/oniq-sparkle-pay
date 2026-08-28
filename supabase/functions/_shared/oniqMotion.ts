// oniqMotion — one in-house motion clip, drawn by ONIQ's own GPU worker.
//
// The exact sibling of oniqImage.generateStill: same worker, same endpoint,
// same submit → poll → fetch → prove shape, same "credentials stay in the
// endpoint's environment, never here" rule. The difference is the op
// (video_generate, not image_generate) and that the input is a still THE
// WORKER ALREADY WROTE — so there is no upload, no presign, and no bucket
// path travelling anywhere. The film's motion stage names a key it derives.
//
// WHY THIS IS NOT AN ACTION ON gpu-video. That function authenticates a USER
// JWT — it is the signed-in clip tool's surface, and its whole admission model
// is "the caller's own identity, the screen is not the gate". The film renderer
// holds a job token instead: one job, one hour, no user. Teaching one function
// two trust models is how a user JWT eventually reaches a film path or a job
// token reaches the operator view. story-still already solved this by being a
// job-token sibling rather than an action, and this follows it.
//
// NO FALLBACK LIVES HERE. There is no provider argument, no model argument and
// no second base URL. A failure is an EngineError and the caller's ladder
// steps the shot down to its still, exactly as a refused clip already does.

import { verifyStoredArtifact, verifyWorkerOutput } from "./gpuVideoCore.ts";

const RUNPOD_SERVERLESS = "https://api.runpod.ai/v2";

export const TERMINAL_OK = "COMPLETED";
export const TERMINAL_BAD = ["FAILED", "CANCELLED", "TIMED_OUT"];
export const CLIP_MIME = "video/mp4";

export class MotionEngineError extends Error {}

export type MotionEnv = {
  apiKey: string;
  endpointId: string;
  publicBase: string;
};

export type MotionDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

/**
 * Animate ONE still that the worker already holds. Returns the clip's bytes
 * base64'd — the same shape story-clip returns, so the renderer's existing
 * handling needs no new branch downstream of the call.
 */
export async function generateMotionClip(
  args: { prompt: string; inputKey: string; outputKey: string; watermark: boolean },
  env: MotionEnv,
  deps: MotionDeps,
  opts: { deadlineMs?: number; pollMs?: number } = {},
): Promise<{
  mime: string;
  data: string;
  bytes: number;
  gpuJobId: string;
  key: string;
  output: unknown;
}> {
  const deadlineMs = opts.deadlineMs ?? 600_000;
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
      input: {
        op: "video_generate",
        input_key: args.inputKey,
        output_key: args.outputKey,
        params: { prompt: args.prompt, watermark: args.watermark },
      },
    }),
  });
  if (!submitted.ok) {
    throw new MotionEngineError(`engine rejected the request (${submitted.status})`);
  }
  const { id } = (await submitted.json()) as { id?: string };
  if (!id) throw new MotionEngineError("engine returned no job id");

  let output: unknown = null;
  for (;;) {
    if (deps.now() - started > deadlineMs) {
      // The job may still be running on the endpoint. Saying "took too long"
      // and nothing else is what left job eb1b3f45 orphaned; the id goes back
      // with the error so the caller can reconcile it rather than lose it.
      throw new MotionEngineError(`clip took too long (gpu job ${id})`);
    }
    await deps.sleep(pollMs);
    const res = await deps.fetchImpl(
      `${RUNPOD_SERVERLESS}/${env.endpointId}/status/${encodeURIComponent(id)}`,
      { headers },
    );
    if (!res.ok) throw new MotionEngineError(`engine status ${res.status} (gpu job ${id})`);
    const state = (await res.json()) as { status?: string; output?: unknown };
    if (state.status === TERMINAL_OK) {
      output = state.output;
      break;
    }
    if (TERMINAL_BAD.includes(String(state.status))) {
      throw new MotionEngineError(`engine job ${String(state.status)} (gpu job ${id})`);
    }
  }

  // The worker's own report, checked by the shared verifier — the same one the
  // clip tool uses, so a film and a clip cannot disagree about what a good
  // output looks like.
  const verdict = verifyWorkerOutput(output);
  if (verdict.ok !== true) throw new MotionEngineError(`${verdict.reason} (gpu job ${id})`);

  const artifact = await deps.fetchImpl(`${env.publicBase.replace(/\/$/, "")}/${args.outputKey}`);
  if (!artifact.ok) {
    throw new MotionEngineError(`artifact fetch ${artifact.status} (gpu job ${id})`);
  }
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  // The bytes that ARRIVED must be the bytes the worker says it wrote. A 200
  // carrying a truncated object, or somebody else's file at that key, is
  // exactly what a status field cannot tell you — the same cross-check
  // generateStill makes for a still.
  const stored = verifyStoredArtifact(
    bytes,
    Number((output as Record<string, unknown>)?.output_bytes ?? -1),
  );
  if (stored.ok !== true) throw new MotionEngineError(`${stored.reason} (gpu job ${id})`);

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return {
    mime: CLIP_MIME,
    data: btoa(binary),
    bytes: bytes.byteLength,
    gpuJobId: id,
    key: args.outputKey,
    // The worker's own report travels back so the caller can settle the
    // ledger on MEASURED time rather than the estimate.
    output,
  };
}
