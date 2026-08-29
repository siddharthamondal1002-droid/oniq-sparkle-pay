// story-still — one frame of a Story, drawn by ONIQ'S OWN image engine.
//
// OWNER DIRECTIVE, 2026-08-27 (fully in-house generation): the still comes
// from ONIQ's GPU worker — the image_generate op, LTX over the model baked
// into that image, frame 0 at the video canvas — and from no external image
// provider. This SUPERSEDES the 2026-08-14 routing of stills through the
// Lovable gateway (which itself reversed a 2026-08-09 engineering call onto
// the metered Google key). Provider choices are the owner's; this one is
// made, and the previous provider is gone from this file rather than left
// as a fallback: a stage that can silently outsource is the behaviour the
// directive ends.
//
// `story-plot` returns the still prompts; this turns one of them into an
// actual image. The worker's contract is unchanged: { configured, mime,
// data } with base64 bytes, refusals as 422 with the reason why.
//
// ONE IMAGE PER CALL, ON PURPOSE. The guard order this project enforces —
// admin/auth, kill switch, cap, validation, then the billable call — exists
// because a loop over an array is how a month of credits disappears in an hour.
// The caller walks the shot list and comes back per shot, so every image passes
// the rate limit individually and a runaway plan stops at the limit rather than
// at the bill.
//
// NO RETRY HERE EITHER. Same reasoning as runwayOps: a prompt that fails
// fails identically the second time, and retrying spends GPU seconds to reach
// the same answer. A caller that wants a retry can make one, having seen why
// the first failed — and the Story worker's ladder does exactly that.
//
// THE IMAGE COMES BACK AS BASE64 AND IS NOT STORED. Storage is the caller's
// decision, because a Story's bytes are governed by storyLifecycle.ts — every
// path ends in `purged` — and a function that quietly wrote to a bucket would
// create files nothing is tracking.

import { verifyJobToken } from "../_shared/jobToken.ts";
import { ASPECT_SUFFIX, EngineError, MAX_ASK_CHARS, generateStill } from "../_shared/oniqImage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Portrait, matching the episode pipeline. The aspect rides IN THE PROMPT
 * rather than in a request field, and the composition's objectFit: cover
 * crops any drift rather than breaking.
 *
 * Two doc comments stood here describing a model constant and a gateway id
 * that the 2026-08-27 in-house directive deleted. Nothing referenced them;
 * they only left the name of a provider this file must never call sitting
 * in the file. Removed 2026-08-28, alongside the worker's "RENTED clip
 * experiment" line, which had gone stale the same way.
 */

/**
 * Cap on an inlined reference data URL. The owner character frames are ~1.4 MB
 * PNGs (~1.9 MB once base64'd); 12 MB is generous headroom for those while
 * still refusing a payload that could only be an abuse.
 */
const MAX_REFERENCE = 12 * 1024 * 1024;

const rlBuckets = new Map<string, number[]>();
function _subFromAuth(req: Request): string {
  const h = req.headers.get("Authorization") ?? "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const p = t.split(".");
  if (p.length !== 3) return "anon";
  try {
    return JSON.parse(atob(p[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || "anon";
  } catch {
    return "anon";
  }
}
function _rateLimit(id: string, limit: number, windowMs = 60000): boolean {
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
    const authFail = await requireAuth(req);
    if (authFail) return authFail;
    // A minute of finished Story is ~9 shots. Thirty a minute lets one job move
    // at a sensible pace and still bounds what a single account can spend.
    if (!_rateLimit(_subFromAuth(req), 30)) return json({ error: "slow down bestie 😅" }, 429);

    // ONIQ'S OWN IMAGE ENGINE (owner directive 2026-08-27, fully in-house
    // generation). The still is drawn by ONIQ's GPU worker — image_generate,
    // LTX over the baked snapshot, frame 0 at the video canvas — and by
    // nothing else. There is deliberately no cloud branch left below: a
    // failure here fails clearly, because silently outsourcing the request
    // is the exact behaviour the directive ends.
    const apiKey = Deno.env.get("RUNPOD_API_KEY");
    const endpointId = Deno.env.get("RUNPOD_ENDPOINT_ID");
    const publicBase = Deno.env.get("R2_PUBLIC_BASE_URL");
    if (!apiKey || !endpointId || !publicBase) {
      return json({ configured: false }, 200);
    }

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ error: "No prompt." }, 400);
    // OVER THE ENGINE'S CEILING IS A 422, NOT A 400 AND NOT A GPU JOB.
    //
    // This accepted 2000 characters while the worker's contract refuses
    // above 1000, so every long ask was accepted here and refused there —
    // deterministically, and at the price of a GPU job each time. That
    // mismatch is the measured 27% failure rate.
    //
    // 422 because the caller's ask ladder reads it as "this CONTENT was
    // refused, step down" and asks again with a shorter rung, which is
    // exactly the right move and costs nothing. A 400 would be fatal and a
    // 5xx would burn the retry budget on an answer that cannot change.
    if (prompt.length > MAX_ASK_CHARS) {
      return json(
        {
          error:
            `That prompt is ${prompt.length} characters; the image engine takes ` +
            `${MAX_ASK_CHARS} once the aspect line is counted.`,
          retryable: false,
        },
        422,
      );
    }

    // REFERENCE CONDITIONING IS NOT AVAILABLE IN-HOUSE YET, and this says so
    // rather than drawing an unconditioned frame and letting the caller
    // believe it was conditioned. 422 is the caller's own step-down signal:
    // the ask ladder drops the reference and asks again, which is how a film
    // stays alive. The in-house route to conditioning is a character asset
    // the engine itself drew, addressed by its key — not an inlined upload,
    // because the bucket's write credentials live in the endpoint alone.
    const referenceImage =
      typeof body?.referenceImage === "string" ? body.referenceImage.trim() : "";
    if (referenceImage) {
      return json(
        { error: "The in-house image engine does not condition on a reference yet." },
        422,
      );
    }

    try {
      const still = await generateStill(
        prompt + ASPECT_SUFFIX,
        { apiKey, endpointId, publicBase },
        {
          fetchImpl: fetch,
          now: () => Date.now(),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          newId: () => crypto.randomUUID(),
        },
      );
      return json({ configured: true, mime: still.mime, data: still.data });
    } catch (err) {
      // Named plainly, and NEVER converted into a cloud call. There is no
      // provider behind this except ONIQ's own engine, and a failure here
      // stays a failure.
      //
      // `retryable` is the engine's own verdict, carried out to the worker
      // so its ladder stops guessing from an HTTP code. Every EngineError
      // arrives as 502 today, so "the container hiccuped" and "that output
      // was not a png" are indistinguishable to the caller and both get
      // retried — one of those is money spent to be told the same thing.
      // Absent the flag (an older worker reading a newer function, or the
      // reverse) the caller falls back to its previous behaviour.
      const why = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof EngineError ? err.retryable : false;
      console.error("story-still in-house engine", `retryable=${retryable}`, why.slice(0, 300));
      return json({ error: `Could not draw that frame: ${why}`, retryable }, 502);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return json({ error: "That frame took too long." }, 504);
    }
    console.error("story-still fn error", e);
    return json({ error: "Something went sideways — try again" }, 500);
  }
});
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAuth(req: Request): Promise<Response | null> {
  // A RUNNER IS NOT A USER. The Story worker holds a per-job capability token,
  // not a Supabase session, so /auth/v1/user would reject it — and passing the
  // service-role key here would not work either, because that is not a user
  // JWT. A valid job token is its own proof: it is signed, it names one job,
  // and it expires within the hour.
  const jobToken = req.headers.get("x-story-job-token");
  if (jobToken) {
    const secret = Deno.env.get("STORY_JOB_SECRET");
    if (!secret) return json({ error: "Auth unavailable" }, 500);
    const verified = await verifyJobToken(jobToken, secret);
    return verified.ok ? null : json({ error: `token ${verified.reason}` }, 401);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Auth unavailable" }, 500);
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: anon },
  });
  if (!res.ok) return json({ error: "Unauthorized" }, 401);
  return null;
}
