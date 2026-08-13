// story-clip — one moving shot of a movie-grade Story, generated in-house.
//
// The Veo half of the episode-3 architecture: the image model has already
// drawn what the frame IS (story-still); this hands that frame to Veo as the
// starting image with a prompt describing only what MOVES. Text-to-video
// ignores the style prompt entirely (measured 2026-08-08); image-to-video
// holds it for the whole clip (verified on episode 3). Same GOOGLE_AI_API_KEY
// as the stills and the voices — no new provider, no new secret.
//
// TWO ACTIONS, BECAUSE VEO IS A LONG-RUNNING OPERATION. A generation takes
// one to several minutes, which no single edge invocation can sit through:
//   start  submit prompt + starting frame, get back an operation name.
//   poll   ask after that operation; when done, download the clip and return
//          it base64, exactly the shape story-still returns an image.
//
// JOB TOKEN ONLY — deliberately stricter than story-still. A clip is the most
// expensive single call in the product (~$0.15 a second, list), and the only
// legitimate caller is the worker holding a job-scoped capability token. A
// user JWT gets 401: there is no in-app surface that generates loose clips,
// and accepting one would be a spend path outside the claim's cost guard.
//
// NO RETRY HERE, one level down from the house rule: the WORKER retries a
// filter refusal exactly once, because episode 3 measured Veo's third-party
// content filter as sampling-flaky (same image, same prompt, refused then
// passed). This function reports; the caller decides.

import { verifyJobToken } from "../_shared/jobToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Veo 3.1 Fast — the $0.15/s list price the movie-grade chart was derived
 * from (storyCostModel.UNIT.usdPerVideoSecond). Separate constant from the
 * image model for the same reason story-still keeps its own: they move on
 * different schedules.
 */
const CLIP_MODEL = "veo-3.1-fast-generate-preview";
/** If the preview id has moved on, one retry on the GA fast model. */
const CLIP_MODEL_FALLBACK = "veo-3.0-fast-generate-001";

const API = "https://generativelanguage.googleapis.com/v1beta";

/** Portrait, matching the stills and the whole downstream pipeline. */
const ASPECT = "9:16";

/** Veo accepts 4, 6 or 8 — there is no 10 on this API and no extend. */
const DURATIONS = new Set([4, 6, 8]);

const MAX_PROMPT = 2000;
/** ~12 MB of PNG once decoded — a 2K story-still runs 3-6 MB. */
const MAX_IMAGE_B64 = 16_000_000;

/** Operation names we will poll — anything else could aim our key elsewhere. */
const OPERATION_SHAPE = /^models\/[a-zA-Z0-9.-]+\/operations\/[a-zA-Z0-9_-]+$/;

const rlBuckets = new Map<string, number[]>();
function rateLimit(id: string, limit: number, windowMs = 60000): boolean {
  const now = Date.now();
  const arr = (rlBuckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    rlBuckets.set(id, arr);
    return false;
  }
  arr.push(now);
  rlBuckets.set(id, arr);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const jobToken = req.headers.get("x-story-job-token");
    if (!jobToken) return json({ error: "Unauthorized" }, 401);
    const secret = Deno.env.get("STORY_JOB_SECRET");
    if (!secret) return json({ error: "Auth unavailable" }, 500);
    const verified = await verifyJobToken(jobToken, secret);
    if (!verified.ok) return json({ error: `token ${verified.reason}` }, 401);

    const key = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!key) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "start") {
      // A film is ~8.5 clips a minute generated sequentially over minutes
      // each; four starts a minute is generous headroom, not a throttle.
      if (!rateLimit(`start:${verified.jobId}`, 4)) return json({ error: "slow down" }, 429);
      return await start(key, body);
    }
    if (action === "poll") {
      if (!rateLimit(`poll:${verified.jobId}`, 30)) return json({ error: "slow down" }, 429);
      return await poll(key, body);
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("story-clip fn error", e);
    return json({ error: "Something went sideways — try again" }, 500);
  }
});

async function start(key: string, body: Record<string, unknown>): Promise<Response> {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return json({ error: "No prompt." }, 400);
  if (prompt.length > MAX_PROMPT) return json({ error: "That prompt is too long." }, 400);

  const image = typeof body?.imageBase64 === "string" ? body.imageBase64 : "";
  if (!image) return json({ error: "No starting frame." }, 400);
  if (image.length > MAX_IMAGE_B64) return json({ error: "Starting frame too large." }, 400);
  const mime = typeof body?.imageMime === "string" ? body.imageMime : "image/png";

  const seconds = Number(body?.seconds);
  const durationSeconds = DURATIONS.has(seconds) ? seconds : 8;

  // Parameters are stripped one at a time on a 400 that names them, the same
  // shape as story-still's IMAGE_SIZE fallback: a model version that rejects
  // `resolution` (or the whole durations field) must not take the movie grade
  // down with it — Veo's own default is the acceptable degradation.
  const submit = (model: string, params: Record<string, unknown>) =>
    fetch(`${API}/models/${model}:predictLongRunning?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt, image: { bytesBase64Encoded: image, mimeType: mime } }],
        parameters: params,
      }),
    });

  let model = CLIP_MODEL;
  let params: Record<string, unknown> = {
    aspectRatio: ASPECT,
    durationSeconds,
    resolution: "720p",
  };
  let res = await submit(model, params);
  if (res.status === 404) {
    model = CLIP_MODEL_FALLBACK;
    res = await submit(model, params);
  }
  if (res.status === 400) {
    const reason = await res.clone().text().catch(() => "");
    for (const field of ["resolution", "durationSeconds"]) {
      if (new RegExp(field, "i").test(reason) && field in params) {
        const { [field]: _dropped, ...rest } = params;
        params = rest;
        res = await submit(model, params);
        break;
      }
    }
  }

  if (res.status === 401 || res.status === 403) return json({ configured: false }, 200);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("story-clip start upstream", res.status, detail.slice(0, 300));
    // The filter can refuse at SUBMIT time too. Surface it as the same 422
    // the worker's refusal ladder listens for.
    if (/third.party|prohibited|safety|filtered/i.test(detail)) {
      return json({ error: `That shot was refused (${detail.slice(0, 160)}).` }, 422);
    }
    return json({ error: "Could not start that clip." }, 502);
  }

  const data = await res.json().catch(() => ({}));
  const operation = typeof data?.name === "string" ? data.name : "";
  if (!OPERATION_SHAPE.test(operation)) {
    console.error("story-clip start: no operation name", JSON.stringify(data).slice(0, 300));
    return json({ error: "Could not start that clip." }, 502);
  }
  return json({ configured: true, operation });
}

async function poll(key: string, body: Record<string, unknown>): Promise<Response> {
  const operation = typeof body?.operation === "string" ? body.operation : "";
  // The shape check is a guard, not pedantry: this string becomes a URL path
  // under our API key, and a caller who could name an arbitrary path could
  // aim the key at any endpoint on the host.
  if (!OPERATION_SHAPE.test(operation)) return json({ error: "No such operation." }, 400);

  const res = await fetch(`${API}/${operation}?key=${encodeURIComponent(key)}`);
  if (res.status === 401 || res.status === 403) return json({ configured: false }, 200);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("story-clip poll upstream", res.status, detail.slice(0, 300));
    return json({ error: "Could not check on that clip." }, 502);
  }

  const op = (await res.json().catch(() => ({}))) as {
    done?: boolean;
    error?: { code?: number; message?: string };
    response?: Record<string, unknown>;
  };
  if (!op.done) return json({ configured: true, done: false });

  if (op.error) {
    const msg = op.error.message ?? "generation failed";
    console.error("story-clip operation error", msg.slice(0, 300));
    // A refusal is a 422 the worker may retry ONCE (sampling-flaky, measured);
    // anything else is a real failure.
    if (/third.party|prohibited|safety|filtered|violat/i.test(msg)) {
      return json({ error: `That shot was refused (${msg.slice(0, 160)}).` }, 422);
    }
    return json({ error: "That clip failed to generate." }, 502);
  }

  const video = firstVideo(op.response);
  if (!video) {
    // Generated-then-filtered comes back done, no error, no video, with a
    // count of what the responsible-AI pass removed. Refusal, not failure.
    const filtered = JSON.stringify(op.response ?? {}).slice(0, 300);
    console.error("story-clip: done with no video", filtered);
    return json({ error: `That shot was refused (no video in reply).` }, 422);
  }

  if (video.data) {
    return json({ configured: true, done: true, mime: video.mime, data: video.data });
  }

  // The URI form: a files/...:download link on the same host, fetched with
  // the key in a HEADER so it never lands in a log line as a query string.
  const uri = new URL(video.uri!);
  if (uri.hostname !== "generativelanguage.googleapis.com") {
    console.error("story-clip: video uri on unexpected host", uri.hostname);
    return json({ error: "That clip came back somewhere unexpected." }, 502);
  }
  const dl = await fetch(uri, { headers: { "x-goog-api-key": key } });
  if (!dl.ok) {
    console.error("story-clip download", dl.status);
    return json({ error: "Could not fetch the finished clip." }, 502);
  }
  const bytes = new Uint8Array(await dl.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return json({ configured: true, done: true, mime: "video/mp4", data: btoa(bin) });
}

/** The first generated video in a Veo operation response, whatever its shape. */
function firstVideo(
  response: Record<string, unknown> | undefined,
): { mime: string; uri?: string; data?: string } | null {
  if (!response) return null;
  const r = response as {
    generateVideoResponse?: { generatedSamples?: { video?: Record<string, unknown> }[] };
    generatedVideos?: { video?: Record<string, unknown> }[];
  };
  const video =
    r.generateVideoResponse?.generatedSamples?.[0]?.video ?? r.generatedVideos?.[0]?.video;
  if (!video) return null;
  const uri = typeof video.uri === "string" ? video.uri : undefined;
  const data =
    typeof video.bytesBase64Encoded === "string" ? video.bytesBase64Encoded : undefined;
  if (!uri && !data) return null;
  const mime = typeof video.mimeType === "string" ? video.mimeType : "video/mp4";
  return { mime, uri, data };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
