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
// expensive single call in the product, and the only legitimate caller is the
// worker holding a job-scoped capability token. A user JWT gets 401: there is
// no in-app surface that generates loose clips, and accepting one would be a
// spend path outside the ledger.
//
// (The old note here said "~$0.15 a second, list". That was the price of a tier
// ONIQ had stopped calling, and the whole movie-grade chart was built on it.
// Rates now live in _shared/videoRouting.ts, each with its provenance and its
// SURFACE attached, and this function reads them rather than restating one.)
//
// NO RETRY HERE, one level down from the house rule: the WORKER retries a
// filter refusal exactly once, because episode 3 measured Veo's third-party
// content filter as sampling-flaky (same image, same prompt, refused then
// passed). This function reports; the caller decides.

import { verifyJobToken } from "../_shared/jobToken.ts";
import { classifyProviderError, recordFailure } from "../_shared/providerError.ts";
import {
  admitProviderSpend,
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  settleProviderSpend,
  type ServiceRpc,
} from "../_shared/financialLedger.ts";
import { type AudioMode, resolveAudioMode } from "../_shared/videoAudio.ts";
import {
  ACTIVE_VIDEO_SURFACE,
  classifyVideoFailure,
  escalationFor,
  videoUsd,
} from "../_shared/videoRouting.ts";

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
/*
 * THE FALLBACK IS GONE, and its absence is the honest state.
 *
 * It was `veo-3.0-fast-generate-001`, retried whenever the primary answered
 * 404 — "if the preview id has moved on, one retry on the GA fast model".
 * Google deprecated that id on 2026-06-15 and switched it off on 2026-06-30,
 * so from July onward the ladder could only ever spend a second round-trip
 * and arrive at the same 502 it would have returned without one. A fallback
 * that cannot succeed is worse than none: it reads like resilience.
 *
 * Removing it changes no price and no provider — a branch that always fails
 * costs nothing to delete. CHOOSING A LIVE REPLACEMENT is a different matter:
 * the surviving alternatives sit at a different $/second, and
 * storyCostModel.UNIT.usdPerVideoSecond is derived from this tier, so a new
 * fallback moves the price chart. That is an owner decision and it is written
 * up in ENGINE_AUDIT.md rather than guessed at here.
 *
 * The dead id stays in _shared/modelRegistry.ts as a tombstone so the next
 * reader learns what happened, and src/lib/__tests__/modelRegistry.test.ts
 * fails the build if any model is still wired past its shutdown date.
 */

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

    // IN-HOUSE JOBS MAY NOT REACH VEO. Owner directive for the bounded
    // internal motion test, 2026-09-12: "never silently substitute Veo".
    //
    // WHY HERE AND NOT IN THE WORKER. Which engine animates is decided by
    // three environment gates the workflow fills from GitHub repository
    // variables, and a workflow file only takes effect once it is on the
    // default branch. If the film is dispatched before that sync lands, the
    // OLD workflow runs, routeMotion reads IN_HOUSE_MOTION=off and every shot
    // goes to Veo on the metered Google key — the exact substitution the
    // directive forbids, discovered from a bill rather than a log.
    //
    // An edge function deploys immediately and is therefore the one layer that
    // cannot be out of sync with this decision. A refusal costs the film its
    // clips (each shot carries as a still, which is what it would have been
    // anyway) and costs no money; the alternative costs money and proves
    // nothing about ONIQ's own GPU.
    //
    // The job id comes from the TOKEN, never the body, so a job cannot opt
    // itself out of its own refusal.
    if (await isInHouseOnly(verified.jobId)) {
      return json(
        {
          error:
            "this job is in-house-motion only; Veo is refused (owner directive 2026-09-12)",
        },
        403,
      );
    }

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

const AUDIO_MODES: ReadonlySet<string> = new Set(["VIDEO_ONLY", "ONIQ_SOUND", "VEO_NATIVE_AUDIO"]);

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

  // ---- AUDIO MODE -------------------------------------------------------
  //
  // NOTE WHAT IS *NOT* HERE: a `generateAudio` parameter. On this surface the
  // Gemini Developer API rejects it outright (verified against Google's own
  // SDK — see videoAudio.ts), so audio mode changes what ONIQ DOES WITH the
  // result, never what it asks for. Recording the decision is the point: a
  // discarded native track must arrive with a reason attached.
  const requestedAudio: AudioMode = AUDIO_MODES.has(String(body?.audioMode))
    ? (body.audioMode as AudioMode)
    : "ONIQ_SOUND";
  const audio = resolveAudioMode(requestedAudio, ACTIVE_VIDEO_SURFACE);

  // ---- FINANCIAL ADMISSION ----------------------------------------------
  //
  // Nothing below reaches Veo without a reservation. `rpc` null means the
  // service role is not configured, and an unreachable ledger is not
  // permission to spend — it is a refusal.
  const rpc = serviceRoleRpc();
  if (!rpc) {
    console.error("story-clip: no service role — cannot reserve, refusing");
    return json({ error: refusalMessage("guard-unavailable"), blocked: "guard-unavailable" }, 503);
  }

  let reservedUsd: number;
  try {
    // The BILLED shape, not the requested one: on a surface that cannot
    // decline audio, every clip is a with-audio clip whatever the mode says.
    reservedUsd = videoUsd(CLIP_MODEL, durationSeconds, audio.effective, ACTIVE_VIDEO_SURFACE);
  } catch (e) {
    // No verified rate. An unpriced model does not get to generate.
    console.error("story-clip: unpriced model", String(e).slice(0, 160));
    return json({ error: refusalMessage("unpriced-model"), blocked: "unpriced-model" }, 503);
  }

  const requestId = requestIdFrom(body?.requestId);
  // The shot, not the film: the retry ladder and the per-shot ceiling are
  // scoped to one shot, so one bad shot cannot eat the film's budget.
  const jobId = typeof body?.shotId === "string" ? body.shotId.slice(0, 120) : undefined;

  const admission = await admitProviderSpend(rpc, {
    requestId,
    capability: "VIDEO",
    provider: "google",
    model: CLIP_MODEL,
    unit: audio.providerAudioBilled ? "video_seconds_with_audio" : "video_seconds",
    units: durationSeconds,
    estimatedUsd: reservedUsd,
    jobId,
    detail: {
      audioRequested: audio.requested,
      audioEffective: audio.effective,
      audioAchievable: audio.achievable,
      providerAudioBilled: audio.providerAudioBilled,
      discardReason: audio.discardReason ?? null,
      surface: ACTIVE_VIDEO_SURFACE,
      seconds: durationSeconds,
    },
  });
  if (!admission.ok) {
    console.warn(`story-clip: spend guard refused (${admission.reason})`);
    return json(
      {
        error: refusalMessage(admission.reason),
        blocked: admission.reason,
        // The worker's ladder needs to tell "out of attempts" from "out of
        // money" — one means move on to the still, the other means stop.
        retryable: admission.reason === "admission-unavailable",
      },
      503,
    );
  }

  // Const since the fallback went: nothing reassigns this now.
  const model = CLIP_MODEL;
  let params: Record<string, unknown> = {
    aspectRatio: ASPECT,
    durationSeconds,
    resolution: "720p",
  };
  let res = await submit(model, params);

  // A request LEFT THE BOX. From here every exit settles — never releases —
  // because a submitted generation may have been served and billed even when
  // the answer that came back is a failure. Releasing here would be inventing
  // a refund.
  const settleFailed = (cls: string, detail: string) =>
    settleProviderSpend(rpc, requestId, {
      outcome: cls === "CONTENT_FILTERED" ? "FILTERED" : "FAILED",
      detail: { failureClass: cls, detail: detail.slice(0, 300) },
    });

  if (res.status === 404) {
    // The id itself is gone or renamed. There is no live fallback to try (see
    // the note beside CLIP_MODEL), and retrying the same id is pointless, so
    // say so plainly instead of burning the clock.
    console.error("story-clip start: model id 404", model);
    await settleFailed("PROVIDER_OUTAGE", "model id 404");
    return json({ error: "The video model is unavailable." }, 502);
  }
  if (res.status === 400) {
    const reason = await res
      .clone()
      .text()
      .catch(() => "");
    for (const field of ["resolution", "durationSeconds"]) {
      if (new RegExp(field, "i").test(reason) && field in params) {
        const { [field]: _dropped, ...rest } = params;
        params = rest;
        res = await submit(model, params);
        break;
      }
    }
  }

  if (res.status === 401 || res.status === 403) {
    await settleFailed("PROVIDER_OUTAGE", `auth ${res.status}`);
    return json({ configured: false }, 200);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("story-clip start upstream", res.status, detail.slice(0, 300));
    const cls = classifyProviderError(res.status, detail, res.headers);
    recordFailure(CLIP_MODEL, cls);

    // WHY THE FAILURE HAPPENED DECIDES WHAT HAPPENS NEXT, and "try the more
    // expensive tier" is the answer to exactly one failure class. A
    // responsible-AI refusal is about the request, not the model: the
    // 2026-08-24 run had the same two prompts return empty on BOTH Lite and
    // Fast, so escalating would have paid twice for the same refusal.
    const videoClass = classifyVideoFailure({ httpStatus: res.status, detail });
    const next = escalationFor(videoClass, { failedOnOtherTier: body?.failedOnOtherTier === true });
    await settleFailed(videoClass, detail);

    // Quota exhaustion used to arrive here as a bare 502 — indistinguishable
    // from a real fault, so the worker's ladder would retry against a daily
    // wall. Measured 2026-08-24: 18 consecutive 429 RESOURCE_EXHAUSTED in
    // 0.1–0.4s. 503 + retryable:false tells the worker to stop, not back off.
    if (cls.kind === "PROVIDER_QUOTA_EXHAUSTED" || cls.kind === "PROVIDER_RATE_LIMITED") {
      return json(
        {
          error: cls.userMessage,
          kind: cls.kind,
          retryable: cls.retryable,
          retryAfterSeconds: cls.retryAfterSeconds,
          failureClass: videoClass,
          next,
        },
        503,
      );
    }
    // The filter can refuse at SUBMIT time too. Surface it as the same 422
    // the worker's refusal ladder listens for.
    if (/third.party|prohibited|safety|filtered/i.test(detail)) {
      return json(
        {
          error: `That shot was refused (${detail.slice(0, 160)}).`,
          failureClass: videoClass,
          next,
        },
        422,
      );
    }
    return json({ error: "Could not start that clip.", failureClass: videoClass, next }, 502);
  }

  const data = await res.json().catch(() => ({}));
  const operation = typeof data?.name === "string" ? data.name : "";
  if (!OPERATION_SHAPE.test(operation)) {
    console.error("story-clip start: no operation name", JSON.stringify(data).slice(0, 300));
    await settleFailed("UNKNOWN", "no operation name in reply");
    return json({ error: "Could not start that clip." }, 502);
  }
  // The reservation stays RESERVED until poll settles it — the cost is not
  // known until the generation finishes. A worker that dies mid-generation
  // leaves it standing, which OVER-counts spend: the safe direction.
  return json({
    configured: true,
    operation,
    requestId,
    seconds: durationSeconds,
    audio: {
      requested: audio.requested,
      effective: audio.effective,
      achievable: audio.achievable,
      providerAudioBilled: audio.providerAudioBilled,
      preserveProviderAudio: audio.preserveProviderAudio,
      discardReason: audio.discardReason ?? null,
      note: audio.note,
    },
  });
}

async function poll(key: string, body: Record<string, unknown>): Promise<Response> {
  const operation = typeof body?.operation === "string" ? body.operation : "";
  // The reservation start() took. Without it a finished generation would be
  // billed by Google and recorded nowhere.
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const rpc: ServiceRpc | null = serviceRoleRpc();
  const settle = async (
    outcome: "ACCEPTED" | "FAILED" | "FILTERED",
    detail: Record<string, unknown>,
    actualUsd?: number,
    seconds?: number,
  ) => {
    if (!rpc || !requestId) return;
    await settleProviderSpend(rpc, requestId, { outcome, detail, actualUsd, unitsActual: seconds });
  };
  // The shape check is a guard, not pedantry: this string becomes a URL path
  // under our API key, and a caller who could name an arbitrary path could
  // aim the key at any endpoint on the host.
  if (!OPERATION_SHAPE.test(operation)) return json({ error: "No such operation." }, 400);

  // What start() reserved for. Passed back by the worker so settlement can
  // price the clip at the rate that was actually billed.
  const seconds = DURATIONS.has(Number(body?.seconds)) ? Number(body.seconds) : 8;
  const audioMode: AudioMode = AUDIO_MODES.has(String(body?.audioMode))
    ? (body.audioMode as AudioMode)
    : "ONIQ_SOUND";
  const billedAudio = resolveAudioMode(audioMode, ACTIVE_VIDEO_SURFACE);

  const res = await fetch(`${API}/${operation}?key=${encodeURIComponent(key)}`);
  if (res.status === 401 || res.status === 403) {
    await settle("FAILED", { failureClass: "PROVIDER_OUTAGE", detail: `auth ${res.status}` });
    return json({ configured: false }, 200);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("story-clip poll upstream", res.status, detail.slice(0, 300));
    // The GENERATION may still have happened and still have been billed —
    // only the status check failed. Charging the estimate is the safe reading.
    await settle("FAILED", {
      failureClass: classifyVideoFailure({ httpStatus: res.status, detail }),
      detail: detail.slice(0, 300),
    });
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
    const cls = classifyVideoFailure({ detail: msg });
    const next = escalationFor(cls, { failedOnOtherTier: body?.failedOnOtherTier === true });
    await settle(cls === "CONTENT_FILTERED" ? "FILTERED" : "FAILED", {
      failureClass: cls,
      detail: msg.slice(0, 300),
    });
    // A refusal is a 422 the worker may retry ONCE (sampling-flaky, measured);
    // anything else is a real failure.
    if (/third.party|prohibited|safety|filtered|violat/i.test(msg)) {
      return json(
        { error: `That shot was refused (${msg.slice(0, 160)}).`, failureClass: cls, next },
        422,
      );
    }
    return json({ error: "That clip failed to generate.", failureClass: cls, next }, 502);
  }

  const video = firstVideo(op.response);
  if (!video) {
    // Generated-then-filtered comes back done, no error, no video, with a
    // count of what the responsible-AI pass removed. Refusal, not failure.
    const filtered = JSON.stringify(op.response ?? {}).slice(0, 300);
    console.error("story-clip: done with no video", filtered);
    // WHETHER GOOGLE BILLS THIS IS UNKNOWN (see FILTERED_OUTPUT_BILLING). The
    // generation ran; the responsible-AI pass removed the sample. Settling at
    // the estimate is the conservative reading and the only one that cannot
    // silently understate a filter-heavy prompt set.
    await settle("FILTERED", {
      failureClass: "CONTENT_FILTERED",
      billingKnown: false,
      detail: filtered,
    });
    return json(
      {
        error: `That shot was refused (no video in reply).`,
        failureClass: "CONTENT_FILTERED",
        next: escalationFor("CONTENT_FILTERED"),
      },
      422,
    );
  }

  const measuredUsd = (() => {
    try {
      return videoUsd(CLIP_MODEL, seconds, billedAudio.effective, ACTIVE_VIDEO_SURFACE);
    } catch {
      // Unpriced ⇒ undefined ⇒ the ledger charges the estimate. Never 0.
      return undefined;
    }
  })();
  const acceptedDetail = {
    audioRequested: billedAudio.requested,
    audioEffective: billedAudio.effective,
    providerAudioBilled: billedAudio.providerAudioBilled,
    preserveProviderAudio: billedAudio.preserveProviderAudio,
    discardReason: billedAudio.discardReason ?? null,
    mime: video.mime,
  };

  if (video.data) {
    // PROVIDER outcome, not product acceptance. Technical/motion/audio QA runs
    // in the worker minutes later and records its verdict through
    // record_provider_outcome — which is what makes cost-per-ACCEPTED-second a
    // measured number rather than a hopeful one.
    await settle("ACCEPTED", acceptedDetail, measuredUsd, seconds);
    return json({
      configured: true,
      done: true,
      mime: video.mime,
      data: video.data,
      audio: acceptedDetail,
    });
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
    // The clip was GENERATED and billed; only the download failed.
    await settle(
      "FAILED",
      { failureClass: "PROVIDER_OUTAGE", detail: `download ${dl.status}` },
      measuredUsd,
      seconds,
    );
    return json({ error: "Could not fetch the finished clip." }, 502);
  }
  const bytes = new Uint8Array(await dl.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  await settle("ACCEPTED", acceptedDetail, measuredUsd, seconds);
  return json({
    configured: true,
    done: true,
    mime: "video/mp4",
    data: btoa(bin),
    audio: acceptedDetail,
  });
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
  const data = typeof video.bytesBase64Encoded === "string" ? video.bytesBase64Encoded : undefined;
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
