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
import { generateMotionClip, MotionEngineError } from "../_shared/oniqMotion.ts";
import {
  assertSafeId,
  outputKeyFor,
  stillKeyFor,
  unitKey,
} from "../_shared/inHouseMotion.ts";
import { MAX_PROMPT_CHARS } from "../_shared/gpuVideoCore.ts";

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

    // IDENTIFIERS, NOT PATHS. The job id comes from the TOKEN, never the body,
    // so a token for job A cannot animate a still belonging to job B however
    // the body is shaped.
    let stillKey: string;
    let outputKey: string;
    let logicalKey: string;
    try {
      const sceneId = assertSafeId("sceneId", String(body?.sceneId ?? ""));
      const shotId = assertSafeId("shotId", String(body?.shotId ?? ""));
      const version = Number(body?.version ?? 1);
      const index = Number(body?.index ?? 0);
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

    try {
      const clip = await generateMotionClip(
        { prompt, inputKey: stillKey, outputKey, watermark },
        { apiKey, endpointId, publicBase },
        {
          fetchImpl: fetch,
          now: () => Date.now(),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        },
      );
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
    } catch (err) {
      const why = err instanceof MotionEngineError ? err.message : String(err);
      console.error("story-motion in-house engine", why.slice(0, 300));
      return json({ error: `Could not animate that frame: ${why}`, unit: logicalKey }, 502);
    }
  } catch {
    return json({ error: "Something went sideways — try again" }, 500);
  }
});
