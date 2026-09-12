// story-motion — the film's LEVEL 4 motion stage, on ONIQ's own GPU.
//
// The job-token sibling of story-still. story-still draws a frame with the
// worker's image_generate; this animates that same frame with video_generate.
// Same endpoint, same auth, same "credentials stay in the endpoint" rule.
//
// IT STAGES NOTHING. The still this animates was written to R2 BY THE WORKER
// when story-still drew it, at a key derived from the shot. So there is no
// upload here, no presign, and no bucket path arriving from anywhere: the key
// is RECOMPUTED from job/scene/shot identifiers, which is why the request
// carries identifiers and has no field for a path. A caller holding one has
// nowhere to put it.
//
// NO FALLBACK. There is no provider field, no model field, and no second base
// URL in this function or the engine under it. A failure returns 502 with the
// engine's own words; the renderer's ladder steps that shot down to its still,
// which is a shot, not a hole. Silently reaching Google here would spend the
// metered key on work the owner routed to hardware ONIQ already pays for.

import { verifyJobToken } from "../_shared/jobToken.ts";
import { generateMotionClip } from "../_shared/oniqMotion.ts";
import { assertSafeId, outputKeyFor, stillKeyFor, unitKey } from "../_shared/inHouseMotion.ts";
import { MAX_PROMPT_CHARS } from "../_shared/gpuVideoCore.ts";
import { MAX_NEGATIVE_PROMPT_CHARS, MAX_SEED } from "../_shared/oniqImage.ts";
import { runBilledUnit } from "../_shared/inHouseMotion.ts";
import {
  admitProviderSpend,
  refusalMessage,
  serviceRoleRpc,
  settleProviderSpend,
} from "../_shared/financialLedger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-story-job-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** One shot's clips arrive one at a time; workersMax is 1, so pacing beyond
 *  this buys nothing and a looser bound only lets a bug spend faster. */
const RATE_PER_MINUTE = 30;
const rlBuckets = new Map<string, number[]>();

function rateLimit(id: string, limit: number, windowMs = 60_000): boolean {
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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/**
 * THE ROLE CLAIM, NOT A BYTE EQUALITY — the shape `send-push`, `ops-alert` and
 * `frontier-probe` already use. frontier-probe compared the bearer to
 * SUPABASE_SERVICE_ROLE_KEY with `===` and no key this project holds equalled
 * it, so its service branch was unreachable from anywhere and every arm
 * answered 401 identically.
 */
function _roleOf(jwt: string): string {
  const parts = jwt.split(".");
  if (parts.length !== 3) return "";
  try {
    return String(JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))).role ?? "");
  } catch {
    return "";
  }
}

/**
 * READ-ONLY GPU HEALTH, service role only.
 *
 * WHY THIS EXISTS. `ONIQ_GPU_HEALTHY` and `ONIQ_WORKER_IMAGE` are OPERATOR
 * ASSERTIONS typed into GitHub repository variables — `routeMotion` trusts
 * them and cannot check them. Job eb1b3f45 (2026-08-28) is what that costs:
 * an endpoint whose template carried no model-bearing image accepted a job it
 * could never run and sat until the 1800s watchdog killed it. Asserting
 * healthy without measuring is the thing that produced that job.
 *
 * RunPod's `/health` is a GET. It submits nothing, claims no worker and bills
 * nothing, so this can be called before deciding whether a test film is worth
 * dispatching. It returns RunPod's own body verbatim — never the key, never
 * the endpoint id.
 *
 * IT IS NOT THE JOB-TOKEN PATH AND MUST NOT WEAKEN IT. This branch returns
 * before the token gate is reached, and the token gate below is untouched: a
 * caller without the service role still cannot reach one line of it.
 */
async function runpodHealth(): Promise<Response> {
  const apiKey = Deno.env.get("RUNPOD_API_KEY");
  const endpointId = Deno.env.get("RUNPOD_ENDPOINT_ID");
  const publicBase = Deno.env.get("R2_PUBLIC_BASE_URL");
  if (!apiKey || !endpointId || !publicBase) {
    return json({
      configured: false,
      missing: {
        RUNPOD_API_KEY: !apiKey,
        RUNPOD_ENDPOINT_ID: !endpointId,
        R2_PUBLIC_BASE_URL: !publicBase,
      },
    });
  }
  const res = await fetch(`https://api.runpod.ai/v2/${endpointId}/health`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const raw = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // A non-JSON body is the interesting case (a Cloudflare page, an HTML
    // 404), so it travels as text rather than becoming a null nobody can read.
    body = raw.slice(0, 500);
  }
  return json({ configured: true, status: res.status, health: body });
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // A RUNNER IS NOT A USER. Only the per-job capability token opens this:
    // no user-JWT branch exists, because a signed-in browser has no business
    // animating a film's shot — that surface is gpu-video's clip tool.
    const jobToken = req.headers.get("x-story-job-token");
    if (!jobToken) return json({ error: "Unauthorized" }, 401);
    const secret = Deno.env.get("STORY_JOB_SECRET");
    if (!secret) return json({ error: "Auth unavailable" }, 500);
    const verified = await verifyJobToken(jobToken, secret);
    if (!verified.ok) return json({ error: `token ${verified.reason}` }, 401);
    if (!rateLimit(verified.jobId, RATE_PER_MINUTE)) {
      return json({ error: "slow down" }, 429);
    }

    const apiKey = Deno.env.get("RUNPOD_API_KEY");
    const endpointId = Deno.env.get("RUNPOD_ENDPOINT_ID");
    const publicBase = Deno.env.get("R2_PUBLIC_BASE_URL");
    if (!apiKey || !endpointId || !publicBase) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ error: "No prompt." }, 400);
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: "That prompt is too long." }, 400);
    }

    // SEED AND NEGATIVE PROMPT — the same two fields story-still now takes,
    // validated here for the same reason: refused at the edge costs nothing,
    // refused on the GPU costs a paid job. Both are OPTIONAL, and an absent
    // one leaves the worker's own default in place rather than inventing a
    // value at this layer.
    //
    // The seed is the retry fix. `SEED = 42` in videogen.py meant a shot's
    // second attempt resampled its first attempt exactly; the caller derives
    // one from (job, scene, shot, attempt) so the ten attempts the owner paid
    // for are ten genuinely different draws — and still reproducible, because
    // the derivation is a pure function of the shot's identity.
    let seed: number | undefined;
    if (body?.seed !== undefined && body?.seed !== null) {
      const raw = body.seed;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > MAX_SEED) {
        return json({ error: "seed must be an integer in range" }, 400);
      }
      seed = raw;
    }
    let negativePrompt: string | undefined;
    if (body?.negativePrompt !== undefined && body?.negativePrompt !== null) {
      const raw = body.negativePrompt;
      if (typeof raw !== "string" || raw.length > MAX_NEGATIVE_PROMPT_CHARS) {
        return json({
          error: `negativePrompt must be a string of at most ${MAX_NEGATIVE_PROMPT_CHARS} characters`,
        }, 400);
      }
      negativePrompt = raw;
    }

    // IDENTIFIERS, NOT PATHS. The job id comes from the TOKEN, never the body,
    // so a token for job A cannot animate a still belonging to job B however
    // the body is shaped.
    let stillKey: string;
    let outputKey: string;
    let logicalKey: string;
    let sceneId = "";
    let shotId = "";
    let index = 0;
    try {
      sceneId = assertSafeId("sceneId", String(body?.sceneId ?? ""));
      shotId = assertSafeId("shotId", String(body?.shotId ?? ""));
      const version = Number(body?.version ?? 1);
      index = Number(body?.index ?? 0);
      if (!Number.isInteger(version) || version < 1) throw new Error("bad version");
      if (!Number.isInteger(index) || index < 0) throw new Error("bad index");
      stillKey = stillKeyFor(verified.jobId, sceneId, shotId);
      logicalKey = unitKey(verified.jobId, sceneId, shotId, version, index);
      outputKey = outputKeyFor(logicalKey);
    } catch (err) {
      return json({ error: `Bad shot reference: ${String(err)}` }, 400);
    }

    // Entitlement is the film's, decided when the job was priced. The runner
    // reports it; it cannot invent it, because a token names one job and the
    // watermark verdict is proved against the worker's own report downstream.
    const watermark = body?.noWatermark !== true;

    // RESERVE → GENERATE → SETTLE. The order lives in inHouseMotion so it can
    // be proved against fakes; this function only supplies the real I/O.
    const rpc = serviceRoleRpc();
    if (!rpc) return json({ error: "Spend ledger unavailable", unit: logicalKey }, 503);

    const outcome = await runBilledUnit(
      { key: logicalKey, sceneId, shotId, index },
      verified.jobId,
      {
        admit: (request) => admitProviderSpend(rpc, request),
        generate: () =>
          generateMotionClip(
            { prompt, inputKey: stillKey, outputKey, watermark, seed, negativePrompt },
            { apiKey, endpointId, publicBase },
            {
              fetchImpl: fetch,
              now: () => Date.now(),
              sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            },
          ),
        settle: (requestId, settlement) => settleProviderSpend(rpc, requestId, settlement),
      },
      { stillKey, outputKey },
    );

    if (!outcome.ok) {
      if (outcome.stage === "admission") {
        return json(
          {
            error: refusalMessage(outcome.reason as never),
            blocked: outcome.reason,
            unit: logicalKey,
          },
          402,
        );
      }
      console.error("story-motion in-house engine", outcome.reason.slice(0, 300));
      return json(
        { error: `Could not animate that frame: ${outcome.reason}`, unit: logicalKey },
        502,
      );
    }

    const clip = outcome.result;
    return json({
      configured: true,
      done: true,
      mime: clip.mime,
      data: clip.data,
      bytes: clip.bytes,
      // Observability (§17): which unit, which GPU job, which key.
      unit: logicalKey,
      gpuJobId: clip.gpuJobId,
      outputKey: clip.key,
      stillKey,
      engine: "oniq-ltx-a5000",
    });
  } catch {
    return json({ error: "Something went sideways — try again" }, 500);
  }
});
