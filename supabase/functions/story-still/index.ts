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
import {
  EngineError,
  MAX_ASK_CHARS,
  MAX_NEGATIVE_PROMPT_CHARS,
  MAX_SEED,
  generateStill,
  pollStill,
  submitStill,
} from "../_shared/oniqImage.ts";
import { CAPABILITY_MARKER } from "../_shared/referenceOutcome.ts";
import {
  CANONICAL_VERSION,
  DEFAULT_REFERENCE_STRENGTH,
  MAX_REFERENCE_STRENGTH,
  MIN_REFERENCE_STRENGTH,
  characterRefKey,
} from "../_shared/characterRef.ts";
import { stillIdFor } from "../_shared/inHouseMotion.ts";

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
    const auth = await requireAuth(req);
    if (auth instanceof Response) return auth;
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
            `${MAX_ASK_CHARS}.`,
          retryable: false,
        },
        422,
      );
    }

    // REFERENCE CONDITIONING IS NOT AVAILABLE IN-HOUSE YET, and this says so
    // rather than drawing an unconditioned frame and letting the caller
    // believe it was conditioned. The in-house route to conditioning is a
    // character asset the engine itself drew, addressed by its key — not an
    // inlined upload, because the bucket's write credentials live in the
    // endpoint alone.
    //
    // `code` IS THE FIX, MEASURED 2026-08-31. The status alone was 422, and
    // the worker's ask ladder reads a bare 422 as "the CONTENT was refused,
    // step down" — so a shot that had SUCCESSFULLY resolved a character
    // reference was demoted two rungs to `a place with no people in it`. The
    // engine's inability to use a reference was being charged against the
    // shot's subject matter, and the person the shot was about became an
    // empty landscape.
    //
    // A machine-readable field separates the two meanings. It is a FIELD and
    // not a sentence on purpose: the previous signal was an English error
    // message, and an English error message is not an API. referenceOutcome.ts
    // holds the taxonomy and the caller's response to each branch.
    const referenceImage =
      typeof body?.referenceImage === "string" ? body.referenceImage.trim() : "";
    if (referenceImage) {
      return json(
        {
          error:
            "Inline reference bytes are not accepted. Name a published " +
            "canonical character with characterRefId instead.",
          code: CAPABILITY_MARKER,
          // Explicit, because the whole bug was a caller inferring the wrong
          // thing from silence: this says nothing about the prompt.
          retryable: false,
          promptRefused: false,
        },
        422,
      );
    }

    // THE IDENTITY ANCHOR — an id, resolved here, never a path (owner
    // directive 2026-08-31: character identity is not preserved between
    // character creation, scene creation and motion).
    //
    // The caller names a PUBLISHED CANONICAL CHARACTER. This side turns that
    // name into a bucket key against a fixed server-side allowlist, and the
    // worker's contract independently pins the same prefix and shape before
    // spending a byte of GPU. Two checks that cannot both be talked out of it,
    // and the browser contributes only a name from a closed set.
    //
    // An unknown id is NOT an error. It is a shot that draws without an anchor
    // — which is what every shot did before this existed — and the reason
    // travels back so the caller can tell that apart from a refusal of the
    // content. A capability gap must never make the prompt worse; that is the
    // whole of referenceOutcome.ts.
    const characterRefId =
      typeof body?.characterRefId === "string" ? body.characterRefId.trim() : "";
    let referenceKey: string | null = null;
    let referenceUnresolved: string | null = null;
    // The VERSION travels with the id, because a reference is immutable per
    // version: a shot drawn against v1 must keep looking like v1 after the
    // character is re-published as v2. Absent, the caller means v1.
    const rawVersion = body?.characterRefVersion;
    const characterRefVersion =
      rawVersion === undefined || rawVersion === null ? CANONICAL_VERSION : rawVersion;
    if (characterRefId) {
      if (!Number.isInteger(characterRefVersion) || characterRefVersion < 1) {
        return json({ error: "characterRefVersion must be a positive integer", retryable: false }, 400);
      }
      referenceKey = characterRefKey(characterRefId, characterRefVersion);
      if (!referenceKey) referenceUnresolved = "not-a-published-canonical-character";
    }

    let referenceStrength: number | undefined;
    if (body?.referenceStrength !== undefined && body?.referenceStrength !== null) {
      const raw = body.referenceStrength;
      if (
        typeof raw !== "number" ||
        !Number.isFinite(raw) ||
        raw < MIN_REFERENCE_STRENGTH ||
        raw > MAX_REFERENCE_STRENGTH
      ) {
        return json(
          {
            error:
              `referenceStrength must be between ${MIN_REFERENCE_STRENGTH} and ` +
              `${MAX_REFERENCE_STRENGTH}`,
            retryable: false,
          },
          400,
        );
      }
      referenceStrength = raw;
    }

    // THE SEED, AND WHY IT ARRIVES FROM THE CALLER RATHER THAN BEING ROLLED.
    //
    // videogen.py carried `SEED = 42` as a module constant, so every draw of
    // every shot of every film sampled the same point. Harmless while a
    // failed shot was simply a failed shot; a bug the moment the retry
    // ceiling went 3 -> 10 on 2026-08-31, because ten attempts against a
    // fixed seed are ten byte-identical draws and the retry budget could not
    // succeed. The caller derives it from the shot's identity plus the
    // attempt number (storySeed.ts), so attempt 2 genuinely differs from
    // attempt 1 AND any frame can be drawn again exactly.
    //
    // Validated HERE as well as in the worker: an out-of-range seed refused
    // at the edge costs nothing, and refused on the GPU costs a job.
    let seed: number | undefined;
    if (body?.seed !== undefined && body?.seed !== null) {
      const raw = body.seed;
      if (
        typeof raw !== "number" ||
        !Number.isInteger(raw) ||
        raw < 0 ||
        raw > MAX_SEED
      ) {
        return json({ error: "seed must be an integer in range", retryable: false }, 400);
      }
      seed = raw;
    }

    // THE NEGATIVE PROMPT, PER SHOT. The worker's global one listed five
    // MOTION faults ("worst quality, inconsistent motion, blurry, jittery,
    // distorted") and not one face fault, which is what the audit was opened
    // to explain. A caller that knows whether this shot shows a face sends
    // the terms that matter for it; one that does not sends nothing and the
    // worker's default stands.
    let negativePrompt: string | undefined;
    if (body?.negativePrompt !== undefined && body?.negativePrompt !== null) {
      const raw = body.negativePrompt;
      if (typeof raw !== "string" || raw.length > MAX_NEGATIVE_PROMPT_CHARS) {
        return json(
          {
            error: `negativePrompt must be a string of at most ${MAX_NEGATIVE_PROMPT_CHARS} characters`,
            retryable: false,
          },
          400,
        );
      }
      negativePrompt = raw;
    }

    // WHERE THE STILL LANDS IN THE BUCKET, AND WHY IT IS NOT RANDOM.
    //
    // MEASURED 2026-08-29, reading the motion path end to end before spending
    // a GPU second on it. This function drew every still to
    // `story/still/<crypto.randomUUID()>.png` and returned only the BYTES. The
    // uuid was never returned, never stored, and never told to anybody.
    // story-motion, meanwhile, does not accept a key at all — by design, so a
    // bucket path can never travel from a caller — and DERIVES its input_key as
    // `story/still/<jobId>-<sceneId>-<shotId>.png`.
    //
    // Those two keys can never be the same string. So every video_generate job
    // would have named an object that does not exist, and the worker's
    // `storage.download(input_key, ...)` would have refused it before LTX was
    // ever asked to sample a single frame. Not "poor motion" — no motion, at
    // the price of a GPU job per shot, on every shot, forever.
    //
    // The seam already existed: oniqImage.generateStill takes an optional
    // `opts.id` for exactly this reason, and inHouseMotion.stillIdFor is the
    // one function that names it. It was simply never wired to a request. So
    // the fix is to pass the identifiers, not to invent a second scheme.
    //
    // IDENTIFIERS, NEVER A PATH, and the job id comes from the TOKEN — the same
    // rule story-motion holds. A caller cannot name another film's still,
    // because the only part of the key it contributes is a bounded id inside
    // its own job's namespace. Absent the identifiers (a signed-in user, a
    // classic job that will never be animated) the key stays random and
    // nothing changes.
    let stillId: string | undefined;
    const sceneId = typeof body?.sceneId === "string" ? body.sceneId.trim() : "";
    const shotId = typeof body?.shotId === "string" ? body.shotId.trim() : "";
    if (auth.jobId && sceneId && shotId) {
      try {
        stillId = stillIdFor(auth.jobId, sceneId, shotId);
      } catch (err) {
        // Refused, never sanitised: quietly rewriting an id would make two
        // different shots share one key, and sharing a key means shot 4
        // animating shot 2's frame.
        return json({ error: `Bad shot reference: ${String(err)}`, retryable: false }, 400);
      }
    }

    // START / POLL — the resume path, and why the bounded wait could not stay.
    //
    // A Supabase edge function has a wall-clock ceiling measured in seconds. A
    // COLD RunPod worker pulls ~40 GiB of image and then fetches a 17.74 GiB
    // text encoder out of R2 before it can draw, which is minutes. No deadline
    // held inside one invocation spans that, so the wait moves to the runner,
    // which has hours. story-clip already splits start from poll for the same
    // reason; this is that shape rather than a second one.
    //
    // MEASURED 2026-09-01, jobs e09a0dcf and 4b335729: the bounded path timed
    // out three times at 120s and every attempt submitted a FRESH engine job
    // while the first was still hydrating. At workersMax 1 those queue, so one
    // cold start cost three billed GPU jobs and produced no frame at all.
    //
    // BOTH HALVES NEED THE SHOT'S IDENTITY, because the key is derived from it
    // and never carried: without sceneId and shotId the submit would draw to a
    // random uuid that no later poll could name. That is refused rather than
    // silently falling back to the bounded wait, which would reintroduce the
    // exact failure this path exists to remove.
    const action = typeof body?.action === "string" ? body.action.trim() : "";
    if (action === "start" || action === "poll") {
      if (!stillId) {
        return json(
          {
            error: "start/poll needs sceneId and shotId — the still's key is derived from them",
            retryable: false,
          },
          400,
        );
      }
      const engineEnv = { apiKey, endpointId, publicBase };
      const engineDeps = {
        fetchImpl: fetch,
        now: () => Date.now(),
        sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
        newId: () => crypto.randomUUID(),
      };
      // What the caller is told about the anchor. Returned by START only —
      // it is settled when the job is submitted, and a poll has no
      // reference id with which to recompute it honestly.
      const provenance = {
        conditioned: Boolean(referenceKey),
        referenceUnresolved,
        referenceVersion: referenceKey ? characterRefVersion : null,
      };
      try {
        if (action === "start") {
          const { jobId: engineJobId, key } = await submitStill(
            prompt,
            engineEnv,
            engineDeps,
            {
              id: stillId,
              seed,
              negativePrompt,
              ...(referenceKey
                ? {
                    referenceKey,
                    referenceStrength: referenceStrength ?? DEFAULT_REFERENCE_STRENGTH,
                  }
                : {}),
            },
          );
          return json({ configured: true, engineJobId, key, ...provenance });
        }
        // POLL. The engine's job id is the ONLY thing the caller carries back,
        // and it names a job, not a bucket path — the key is re-derived here
        // from the token's job id, so a caller still cannot name another
        // film's still.
        const engineJobId =
          typeof body?.engineJobId === "string" ? body.engineJobId.trim() : "";
        if (!engineJobId) {
          return json(
            { error: "poll needs the engineJobId that start returned", retryable: false },
            400,
          );
        }
        const got = await pollStill(engineJobId, stillId, engineEnv, engineDeps);
        if (!got.done) return json({ configured: true, done: false });
        // THE FRAME ONLY. Provenance is decided at SUBMIT time and is
        // deliberately not repeated here: a poll carries no characterRefId —
        // resolving one on every poll would be a lookup per tick — so
        // recomputing it from this body would report `conditioned: false` for
        // a still that was in fact anchored. The caller keeps what `start`
        // told it, which is the only answer that was ever true.
        return json({
          configured: true,
          done: true,
          mime: got.mime,
          data: got.data,
          key: got.key,
        });
      } catch (err) {
        return engineFailure(err);
      }
    }

    try {
      const still = await generateStill(
        // The ask, VERBATIM. The aspect sentence this used to append is gone
        // (oniqImage.ts): the canvas is portrait in contract.py, which is the
        // one place an aspect ratio can be true.
        prompt,
        { apiKey, endpointId, publicBase },
        {
          fetchImpl: fetch,
          now: () => Date.now(),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          newId: () => crypto.randomUUID(),
        },
        {
          id: stillId,
          seed,
          negativePrompt,
          ...(referenceKey
            ? {
                referenceKey,
                referenceStrength: referenceStrength ?? DEFAULT_REFERENCE_STRENGTH,
              }
            : {}),
        },
      );
      // `key` travels back so the runner can log WHERE the frame went, and so
      // a film that later fails to animate can be diagnosed from its own log
      // rather than by guessing at a uuid nobody kept.
      return json({
        configured: true,
        mime: still.mime,
        data: still.data,
        key: still.key,
        // WHETHER THE ANCHOR WAS ACTUALLY USED, reported rather than assumed.
        // An unanchored still looks exactly like an anchored one until the
        // character's face changes between shots, so the caller is told which
        // it got and, when it is the wrong one, why.
        conditioned: Boolean(referenceKey),
        referenceUnresolved,
        // WHICH version drew this frame, so a film can be reproduced later
        // even after the character is re-published.
        referenceVersion: referenceKey ? characterRefVersion : null,
      });
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
      return engineFailure(err);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return json({ error: "That frame took too long." }, 504);
    }
    console.error("story-still fn error", e);
    return json({ error: "Something went sideways — try again" }, 500);
  }
});
/**
 * One engine failure, worded one way. Shared by the bounded path and the
 * resume path so the two can never drift — the worker's retry ladder reads
 * `retryable`, and a second copy of this that fell behind would have it
 * retrying things the engine already called final.
 */
function engineFailure(err: unknown) {
  // Named plainly, and NEVER converted into a cloud call. There is no
  // provider behind this except ONIQ's own engine, and a failure here
  // stays a failure.
  //
  // `retryable` is the engine's own verdict, carried out to the worker so its
  // ladder stops guessing from an HTTP code. Absent the flag (an older worker
  // reading a newer function, or the reverse) the caller falls back to its
  // previous behaviour.
  const why = err instanceof Error ? err.message : String(err);
  const retryable = err instanceof EngineError ? err.retryable : false;
  console.error("story-still in-house engine", `retryable=${retryable}`, why.slice(0, 300));
  return json({ error: `Could not draw that frame: ${why}`, retryable }, 502);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Who is asking, or why they may not. A RUNNER's identity is the job it holds;
 * a signed-in user has none here, and `jobId: null` says so — the still then
 * gets a random key, exactly as before.
 */
async function requireAuth(req: Request): Promise<Response | { jobId: string | null }> {
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
    return verified.ok
      ? { jobId: verified.jobId }
      : json({ error: `token ${verified.reason}` }, 401);
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
  return { jobId: null };
}
