// story-still — one frame of a Story.
//
// OWNER DIRECTIVE, 2026-09-01 (stills return to the Lovable gateway; the GPU
// leaves the still path). The owner's words: "I want old version back where
// in-house and Veo both was there without gpu" — the 14–27 August shape,
// where the still was drawn through ai.gateway.lovable.dev on
// LOVABLE_API_KEY and motion was either ONIQ's own Remotion Ken Burns
// (classic grade) or Veo (movie grade). Whose money: Lovable credits, the
// same pool story-voice and translate already spend, and NOT the metered
// Google key.
//
// WHY, measured rather than assumed. The GPU worker has never drawn a frame
// on this configuration. Both films on 2026-09-01 (jobs e09a0dcf, 4b335729)
// died at `still 1` with the endpoint reporting `initializing: 1, ready: 0`
// for the whole wait — the image pull never finished, so no GPU second was
// ever spent on drawing and no timeout here could have helped. Veo is
// image-to-video and needs a starting frame, so while stills cannot be drawn
// no story completes on any motion setting. This is the stage that unblocks
// everything downstream of it.
//
// WHAT THE 2026-08-27 DIRECTIVE GOT RIGHT, AND WHAT SURVIVES OF IT. That
// directive routed stills to ONIQ's own GPU worker and DELETED the previous
// provider rather than leaving it as a fallback, on the grounds that "a stage
// that can silently outsource is the behaviour the directive ends". That
// reasoning is still correct and is preserved exactly: the second engine is
// back as a CHOICE, never as a safety net.
//
//   * One engine is chosen from STILL_PROVIDER BEFORE anything is called
//     (_shared/stillRoute.ts, pure and tested).
//   * A chosen engine that is not configured FAILS. It does not fall through
//     to the other one — in either direction.
//   * Every reply names the engine that drew the frame, in `provider`. The
//     failure this design is built against is not "the wrong engine ran"; it
//     is "the wrong engine ran and nothing said so", which is the 2026-08-09
//     incident this repo's CLAUDE.md opens with.
//
// WHAT DIFFERS BETWEEN THE TWO, reported rather than silently dropped, so a
// caller never believes it got something it did not:
//
//   seed             in-house only. The gateway takes no seed, so the same
//                    ask twice is two different frames; `seedHonoured` says
//                    so. (storySeed.ts derives per-attempt seeds precisely so
//                    a retry differs from its predecessor — under the gateway
//                    that happens anyway, by sampling.)
//   negativePrompt   in-house: a real negative conditioning tensor. Gateway:
//                    the terms ride in the ask as a sentence.
//                    `negativeApplied` names which.
//   referenceStrength in-house only; the gateway has no strength dial.
//   the reference    both, by different routes and from the SAME id — the
//                    caller names a published canonical character, the
//                    server-side allowlist makes the key, and then in-house
//                    hands the KEY to the worker while the gateway gets the
//                    BYTES, read here from ONIQ's own bucket. Inline bytes
//                    from a CALLER stay refused in both, because there is
//                    still nowhere for them to land and no way to know what
//                    face they carry.
//   the bucket key   in-house writes the still into the bucket and returns
//                    its key, which is what story-motion animates. The
//                    gateway writes nothing and returns `key: null`. In-house
//                    MOTION therefore cannot animate a gateway still, and the
//                    worker refuses that pairing out loud rather than sending
//                    story-motion after an object that was never written.
//   start / poll     in-house is minutes and needs the resume pair. The
//                    gateway is one request measured in seconds, so `start`
//                    answers with the finished frame and there is nothing to
//                    poll.
//
// `story-plot` returns the still prompts; this turns one of them into an
// actual image. The contract out is unchanged either way: { configured, mime,
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
// fails identically the second time, and retrying spends money or GPU seconds
// to reach the same answer. A caller that wants a retry can make one, having
// seen why the first failed — and the Story worker's ladder does exactly that.
//
// THE IMAGE COMES BACK AS BASE64 AND IS NOT STORED BY THIS FUNCTION. Storage
// is the caller's decision, because a Story's bytes are governed by
// storyLifecycle.ts — every path ends in `purged` — and a function that
// quietly wrote to a bucket would create files nothing is tracking. (The
// in-house engine's own write into the GPU bucket is the worker's, not this
// function's, and it is what `key` names.)

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
import {
  GatewayError,
  MAX_GATEWAY_ASK_CHARS,
  drawStillViaGateway,
  inlineReference,
} from "../_shared/gatewayImage.ts";
import { readStillProvider, routeStill } from "../_shared/stillRoute.ts";

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

    // WHICH ENGINE, DECIDED ONCE, BEFORE ANYTHING IS CALLED.
    //
    // The two engines are read as whole configurations rather than as loose
    // variables, so "in-house is available" is one fact with one definition
    // and the type system carries it into the branches. STILL_PROVIDER picks
    // between them; unset means the 2026-09-01 directive's default, which is
    // the gateway. An UNRECOGNISED value is not a default — routeStill answers
    // `blocked`, because a typo in STILL_PROVIDER must never be
    // indistinguishable from an unset one, or a slip decides which pool pays.
    const apiKey = Deno.env.get("RUNPOD_API_KEY");
    const endpointId = Deno.env.get("RUNPOD_ENDPOINT_ID");
    const publicBase = Deno.env.get("R2_PUBLIC_BASE_URL");
    const inHouseEnv =
      apiKey && endpointId && publicBase ? { apiKey, endpointId, publicBase } : null;
    const gatewayKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    const provider = readStillProvider(Deno.env.get("STILL_PROVIDER"));
    const route = routeStill({
      provider,
      gatewayConfigured: Boolean(gatewayKey),
      inHouseConfigured: Boolean(inHouseEnv),
    });
    if (route.engine === "blocked") {
      // `configured: false` is the contract the worker already reads (it
      // throws "not configured"), and `reason` is added so the runner's log
      // says WHICH engine was asked for and what it was missing, instead of
      // the generic message that sent a previous debugging session looking at
      // the wrong provider entirely.
      console.error("story-still blocked", route.reason, `provider=${provider ?? "unrecognised"}`);
      return json({ configured: false, provider: null, reason: route.reason }, 200);
    }
    const usingGateway = route.engine === "gateway";

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
    //
    // THE CEILING IS THE ENGINE'S, NOT THIS FUNCTION'S. MAX_ASK_CHARS is the
    // GPU worker's contract (contract.py, 1000) mirrored on both ends so the
    // two cannot drift; the gateway's is 2000 and always was. Holding the
    // smaller number for both would demote a drawable 1400-character shot to
    // a blander rung against an engine that would have drawn it.
    const askCeiling = usingGateway ? MAX_GATEWAY_ASK_CHARS : MAX_ASK_CHARS;
    if (prompt.length > askCeiling) {
      return json(
        {
          error:
            `That prompt is ${prompt.length} characters; the image engine takes ` +
            `${askCeiling}.`,
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

    // THE SAME ANCHOR, BY THE ROUTE THE CHOSEN ENGINE CAN ACTUALLY TAKE.
    //
    // The id has already become a server-owned key through the allowlist
    // above; what differs is who reads that key. The GPU worker reads it
    // itself, with the endpoint's credentials — which is why the key travels
    // and the bytes do not. The gateway has no bucket and no credentials, so
    // this side reads the object over the bucket's public base and inlines
    // the bytes, exactly the shape the 2026-08-20 capability probe measured
    // holding a character's face across shots.
    //
    // Nothing about the caller's contribution changes: it named a published
    // canonical character and nothing else. It cannot name an object, choose
    // a host, or cause a fetch of anything it supplied — every guard in
    // characterRef.ts is upstream of this line.
    //
    // A reference that cannot be read is NOT an error, and is emphatically
    // not a refusal of the prompt. It is a shot that draws without an anchor,
    // which is what every shot did before references existed, and the reason
    // travels back so the caller can tell the two apart. Charging a
    // capability gap against the shot's subject is the 2026-08-31 bug where a
    // person became an empty landscape.
    let referenceDataUrl: string | undefined;
    if (referenceKey && usingGateway) {
      if (!publicBase) {
        // The gateway needs no RunPod credentials, but it does need somewhere
        // to read ONIQ's own published characters from.
        referenceUnresolved = "reference-store-not-configured";
      } else {
        const got = await inlineReference(publicBase, referenceKey, { fetchImpl: fetch });
        if ("dataUrl" in got) {
          referenceDataUrl = got.dataUrl;
        } else {
          referenceUnresolved = got.unresolved;
        }
      }
      // The anchor is only real if the bytes arrived. Reporting `conditioned`
      // off the KEY alone would tell the caller a frame was anchored when the
      // fetch had failed — the precise lie this whole field exists to prevent.
      if (!referenceDataUrl) referenceKey = null;
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
    // WHAT THIS ENGINE ACTUALLY DID WITH WHAT IT WAS SENT.
    //
    // Every reply carries it, on both paths and both engines. The seed, the
    // negative prompt and the reference strength are real conditioning inputs
    // on the GPU and are simply not available through the gateway — so a
    // caller that sent them is told, rather than left to infer determinism it
    // does not have. storySeed.ts derives a per-attempt seed precisely so
    // attempt 2 differs from attempt 1; under the gateway that happens by
    // sampling anyway, and `seedHonoured: false` is what stops a reader
    // concluding a frame can be reproduced exactly when it cannot.
    //
    // `provider` is the load-bearing one. A pipeline that can run on either of
    // two engines and does not say which ran is how a provider switch becomes
    // invisible, and an invisible provider switch is the 2026-08-09 incident.
    const engineShape = usingGateway
      ? {
          provider: "gateway" as const,
          seedHonoured: false,
          negativeApplied: negativePrompt ? ("prompt-text" as const) : ("none" as const),
          referenceStrengthApplied: false,
        }
      : {
          provider: "in-house" as const,
          seedHonoured: seed !== undefined,
          negativeApplied: negativePrompt ? ("sampler" as const) : ("none" as const),
          referenceStrengthApplied: Boolean(referenceKey),
        };

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
      // THE GATEWAY HAS NOTHING TO POLL, and says so instead of pretending.
      //
      // start/poll exists for ONE reason: a cold GPU takes minutes and an edge
      // function has seconds, so the wait has to live on the runner. A gateway
      // draw is a single request measured in seconds, so `start` simply
      // returns the finished frame with `done: true` and the worker takes it
      // without a single poll.
      //
      // A `poll` against this engine is therefore a caller that missed the
      // frame it was already handed. That is a 400 naming the mistake, not a
      // silent redraw — a redraw would spend a second image to answer a
      // question the first one had already answered.
      if (usingGateway) {
        if (action === "poll") {
          return json(
            {
              error:
                "the gateway draws in one call — start already returned the frame, " +
                "there is no job to poll",
              retryable: false,
            },
            400,
          );
        }
        try {
          const drawn = await drawStillViaGateway(
            prompt,
            { key: gatewayKey },
            { fetchImpl: fetch },
            { negativePrompt, referenceDataUrl },
          );
          return json({
            configured: true,
            ...engineShape,
            // DONE ON THE FIRST REPLY. The worker's drawStill checks this
            // before it starts polling; a worker too old to check it will
            // poll once and get the 400 above, which is loud and cheap.
            done: true,
            mime: drawn.mime,
            data: drawn.data,
            // Nothing was written to a bucket, so there is no key. Said as
            // null rather than omitted: a caller that goes looking for the
            // still under some derived path must find an explicit "there
            // isn't one" instead of an undefined it can misread as a bug.
            key: null,
            conditioned: Boolean(referenceKey),
            referenceUnresolved,
            referenceVersion: referenceKey ? characterRefVersion : null,
          });
        } catch (err) {
          return engineFailure(err);
        }
      }

      if (!inHouseEnv) return json({ configured: false, reason: "in-house-not-configured" }, 200);
      const engineEnv = inHouseEnv;
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
          return json({ configured: true, ...engineShape, engineJobId, key, ...provenance });
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
        if (!got.done) return json({ configured: true, ...engineShape, done: false });
        // THE FRAME ONLY. Provenance is decided at SUBMIT time and is
        // deliberately not repeated here: a poll carries no characterRefId —
        // resolving one on every poll would be a lookup per tick — so
        // recomputing it from this body would report `conditioned: false` for
        // a still that was in fact anchored. The caller keeps what `start`
        // told it, which is the only answer that was ever true.
        return json({
          configured: true,
          ...engineShape,
          done: true,
          mime: got.mime,
          data: got.data,
          key: got.key,
        });
      } catch (err) {
        return engineFailure(err);
      }
    }

    // THE BOUNDED PATH — one call, one answer, no resume. Kept because a
    // signed-in user drawing a single frame from the app has no runner to hold
    // a poll loop, and because removing it would break every caller that
    // predates start/poll. Under the gateway it is the ONLY sensible shape:
    // there is nothing to resume from.
    if (usingGateway) {
      try {
        const drawn = await drawStillViaGateway(
          prompt,
          { key: gatewayKey },
          { fetchImpl: fetch },
          { negativePrompt, referenceDataUrl },
        );
        return json({
          configured: true,
          ...engineShape,
          mime: drawn.mime,
          data: drawn.data,
          key: null,
          conditioned: Boolean(referenceKey),
          referenceUnresolved,
          referenceVersion: referenceKey ? characterRefVersion : null,
        });
      } catch (err) {
        return engineFailure(err);
      }
    }

    if (!inHouseEnv) return json({ configured: false, reason: "in-house-not-configured" }, 200);
    try {
      const still = await generateStill(
        // The ask, VERBATIM. The aspect sentence this used to append is gone
        // (oniqImage.ts): the canvas is portrait in contract.py, which is the
        // one place an aspect ratio can be true.
        prompt,
        inHouseEnv,
        {
          fetchImpl: fetch,
          now: () => Date.now(),
          sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
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
        ...engineShape,
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
  // Named plainly, and NEVER converted into a call to the OTHER engine. One
  // engine was chosen before anything was called; a failure here is that
  // engine's failure and stays one. Falling through to the other provider is
  // exactly the silent-outsourcing behaviour the 2026-08-27 directive ended,
  // and restoring a second engine as a choice does not restore it as a net.
  //
  // `retryable` is the engine's own verdict, carried out to the worker so its
  // ladder stops guessing from an HTTP code. Absent the flag (an older worker
  // reading a newer function, or the reverse) the caller falls back to its
  // previous behaviour.
  const why = err instanceof Error ? err.message : String(err);

  if (err instanceof GatewayError) {
    console.error("story-still gateway", err.kind, `retryable=${err.retryable}`, why.slice(0, 300));
    switch (err.kind) {
      case "unconfigured":
        // The key is there but the gateway will not take it. Reported as
        // unconfigured rather than as a draw failure, because retrying it
        // spends nothing and fixes nothing — someone has to look at the key.
        return json({ configured: false, provider: null, reason: "gateway-credential-rejected" }, 200);
      case "refused":
        // THE CONTENT, and only the content. 422 with promptRefused is what
        // the worker's ask ladder reads as "step down and try a safer
        // wording" — the one failure where rewriting the ask is the right
        // move. Crucially this is NOT what a credit exhaustion returns: that
        // one rewrites a perfectly good prompt into a blander one and still
        // gets nothing, which is the whole reason GatewayError carries a kind.
        return json(
          { error: `That frame was refused: ${why}`, retryable: false, promptRefused: true },
          422,
        );
      case "timeout":
        return json({ error: "That frame took too long.", retryable: true }, 504);
      default:
        return json({ error: `Could not draw that frame: ${why}`, retryable: true }, 502);
    }
  }

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
