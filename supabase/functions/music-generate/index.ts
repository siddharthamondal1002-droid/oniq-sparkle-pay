// music-generate — a song from a sentence, on the metered Google key.
//
// OWNER DIRECTIVE, 2026-09-04. The owner mapped "full music/song" onto Lyria
// 3 Pro and, asked where it should run, sent it to the METERED GOOGLE KEY.
// That is the single exception to the same directive's "gateway for all", and
// it was forced rather than chosen: the Lovable gateway carries no music model
// — its catalogue has no id matching lyria, music or song, and /v1/audio/music
// 404s from the gateway itself. Both facts were measured, not assumed.
//
// SO EVERY CALL HERE SPENDS THE OWNER'S GOOGLE BILL DIRECTLY, and the guards
// below are in the order every ONIQ generation tool enforces:
//
//     caller gate -> kill switch -> admin gate -> daily cap
//     -> validation -> ONE billable call
//
// The cap is checked BEFORE the charge, never after. There is deliberately no
// batching and no retry: a loop over an array is how a month of credits
// disappears in an hour, and a prompt Google refuses will be refused again
// identically. The kill switch is a config row, so it flips without a deploy —
// and it ships OFF, because nothing should start spending a metered key on the
// strength of a deploy nobody watched.
//
// GOOGLE_AI_API_KEY is read here and nowhere else in this file's reach. Never
// returned, never logged, never put in an error message. The NAME of a missing
// variable is operator information; no value ever is.
//
// MEASURED BEFORE IT WAS WRITTEN (2026-09-04), because this repo has a model
// that sat in ListModels with the right method advertised and 404'd on every
// real call for months:
//
//   POST /v1beta/models/lyria-3-pro-preview:generateContent   200
//   audio at candidates[0].content.parts[1].inlineData.data
//   mimeType audio/mpeg, ~1.49 MB decoded for one short prompt
//   usageMetadata { promptTokenCount 10, candidatesTokenCount 950, total 960 }
//   no duration field, and NO cost field anywhere in the response
//
// TWO THINGS THAT MEASUREMENT SETTLED, both worth keeping in view:
//
//   1. THE ID IS AN ALIAS. The call named `lyria-3-pro-preview`; the response
//      came back `modelVersion: "lyria-3.5"`. So pinning this id does not pin
//      the model that serves it, and the version that answered is recorded on
//      every row rather than assumed from the id we asked for.
//   2. GOOGLE DOES NOT PRICE THE RESPONSE. There is no cost or credits field,
//      only tokens, and no duration. ONIQ therefore cannot settle a song
//      against what it actually cost, only count that one happened. That is
//      why the cap here is a COUNT of songs and not a budget of dollars — a
//      dollar budget nobody can reconcile is a number that lies.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";
import { geminiOutputTokens, type SearchBudget } from "../_shared/searchBudget.ts";
import {
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withProviderSpendGuard,
} from "../_shared/financialLedger.ts";
import {
  MUSIC_MODEL,
  MUSIC_PROMPT_MAX,
  validateMusicAudio,
  validateMusicImage,
  validateMusicPrompt,
} from "../_shared/musicCore.ts";
import {
  BRIEF_ASK,
  compileMusicPrompt,
  describeBrief,
  parseMusicBrief,
} from "../_shared/musicBrief.ts";
import {
  firstInlinePart,
  googleGenerateContent,
  googleUsage,
  joinedText,
  type GooglePart,
} from "../_shared/googleDirect.ts";
import { AUDIO_UNDERSTANDING_MODEL } from "../_shared/voiceCore.ts";

/**
 * The spend reservation for one song.
 *
 * NO SEARCH — the prompt is a sentence and the answer is audio, so the search
 * fields are zero and the reservation is for exactly one provider call.
 *
 * `maxEstimatedUsd` carries the OWNER'S figure of $0.08 a song, recorded as
 * the owner gave it. It is not verified here and it is not what settles the
 * call: Lyria is deliberately absent from MODEL_RATES because that table is
 * per token and this model is not priced per token, so settlement records the
 * measured tokens with the dollars marked unknown. The number below is what
 * ONIQ RESERVES against, which is the honest use for a figure nobody here can
 * check.
 *
 * `maxWallClockMs` is 120s because a song is not a chat turn: the measured
 * generation returned ~1.5 MB of MP3 and took long enough that a 30s ceiling
 * would have aborted a call Google had already begun to charge for.
 */
export const MUSIC_BUDGET: SearchBudget = {
  maxSearches: 0,
  maxProviderCalls: 1,
  maxLlmCalls: 1,
  maxInputTokens: 1_000,
  maxOutputTokens: 4_000,
  maxWallClockMs: 120_000,
  maxEstimatedUsd: 0.08,
};

/**
 * The reservation for LISTENING to a reference track — a separate call, so a
 * separate reservation.
 *
 * OWNER DIRECTIVE 2026-09-04c gave the architecture: reference audio ->
 * Gemini audio understanding -> structured music brief -> Lyria. That is TWO
 * provider calls for one song, and folding the second into the first's
 * reservation would mean the ledger recorded a charge it never reserved for.
 *
 * It reserves against MUSIC's own budget row, not TEXT's. The analysis is
 * music's money: a runaway in the listening stage has to be bounded by the
 * same ceiling that bounds the songs, or one capability's overspend drains
 * another's — the warning provider_budget_config's own page carries.
 *
 * The figure is small and deliberately not zero. Listening is a text-model
 * call over a few minutes of audio, far cheaper than a song; reserving
 * nothing would let an unbounded number of them through a gate that exists
 * to stop exactly that.
 */
export const MUSIC_BRIEF_BUDGET: SearchBudget = {
  maxSearches: 0,
  maxProviderCalls: 1,
  maxLlmCalls: 1,
  maxInputTokens: 200_000,
  maxOutputTokens: 1_000,
  maxWallClockMs: 60_000,
  maxEstimatedUsd: 0.02,
};

const BUCKET = "video-gen";

/** Google's own ceiling on one generation, kept well inside the function timeout. */
const CALL_TIMEOUT_MS = 120_000;

type Row = {
  id: string;
  created_at: string;
  prompt: string;
  stored_path: string | null;
  reference: string | null;
  brief: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ---- caller gate ---------------------------------------------------------
  // The platform's verify_jwt has already run; this re-derives the person
  // anyway rather than trusting a claim in the body, the same shape
  // story-deliver and gpu-video use.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "Sign in to make music" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes } = await asCaller.auth.getUser();
  const user = userRes?.user;
  if (!user) return json(401, { error: "Sign in to make music" });

  let body: {
    action?: string;
    prompt?: string;
    requestId?: string;
    /** Goes STRAIGHT to Lyria as an inlineData part — measured 200. */
    referenceImage?: { mimeType: string; data: string } | null;
    /** Goes to GEMINI, never to Lyria. See the two-stage block below. */
    referenceAudio?: { mimeType: string; data: string } | null;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // ---- listing is free and needs none of the gates below --------------------
  if (body.action === "list") {
    const { data, error } = await admin
      .from("music_jobs")
      .select("id, created_at, prompt, stored_path, reference, brief")
      .eq("user_id", user.id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return json(500, { error: "Couldn't load your songs" });
    const songs = [];
    for (const row of (data ?? []) as Row[]) {
      if (!row.stored_path) continue;
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(row.stored_path, 60 * 60);
      songs.push({
        id: row.id,
        createdAt: row.created_at,
        prompt: row.prompt,
        url: signed?.signedUrl ?? null,
        // Shown on the card, so a song made from a reference says so long
        // after the screen that made it has been closed.
        reference: row.reference ?? null,
        brief: row.brief ?? null,
      });
    }
    return json(200, { songs });
  }

  // ---- kill switch ---------------------------------------------------------
  const { data: cfg } = await admin
    .from("video_gen_config")
    .select("music_enabled, music_daily_cap, music_admin_only, music_per_user_daily_cap")
    .maybeSingle();
  if (!cfg || cfg.music_enabled !== true) {
    return json(503, { error: "Music generation is switched off right now." });
  }

  // ---- admin gate ----------------------------------------------------------
  // Music ships admin-only for the same reason movie grade did: it spends a
  // metered key with no per-user ledger behind it yet. `music_admin_only` is
  // the row the owner flips to open it, and flipping it needs no deploy.
  const { data: prof } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = prof?.is_admin === true;
  if (cfg.music_admin_only !== false && !isAdmin) {
    return json(403, { error: "Music is not open to everyone yet." });
  }

  // ---- the two caps, BOTH BEFORE any charge --------------------------------
  //
  // THE HOUSE CAP bounds the bill. THE PER-USER CAP bounds who can spend it,
  // and it exists because the house cap alone does not: with music open to
  // everyone (owner directive 2026-09-04) a single account — or a script —
  // could take the entire day's allowance in one run, which is both the whole
  // bill and a feature nobody else can use until tomorrow. The pair is the
  // point: one number protects the money, the other protects its distribution.
  //
  // Both are counted over a rolling 24h rather than a calendar day, so the
  // limit cannot be doubled by generating either side of midnight.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: houseCount } = await admin
    .from("music_jobs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  const usedToday = houseCount ?? 0;
  const cap = typeof cfg.music_daily_cap === "number" ? cfg.music_daily_cap : 0;
  if (usedToday >= cap) {
    return json(429, { error: `Daily music cap reached (${usedToday}/${cap}). Try tomorrow.` });
  }

  const { count: mineCount } = await admin
    .from("music_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  const usedByMe = mineCount ?? 0;
  const perUserCap =
    typeof cfg.music_per_user_daily_cap === "number" ? cfg.music_per_user_daily_cap : 0;
  if (usedByMe >= perUserCap) {
    // Deliberately says YOUR limit, not the house's: a person who has used
    // their own allowance should not be told the service is out, and a person
    // locked out by someone else's usage should not be told it was theirs.
    return json(429, {
      error: `You've made ${usedByMe} songs today (limit ${perUserCap}). Try again tomorrow.`,
    });
  }

  // ---- validation ----------------------------------------------------------
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const invalid = validateMusicPrompt(prompt);
  if (invalid) return json(400, { error: invalid });

  // Both attachments are validated BEFORE either billable call, so a body a
  // person can fix costs nothing to reject. The client checks the same things;
  // the client is a suggestion.
  const badImage = validateMusicImage(body.referenceImage);
  if (badImage) return json(400, { error: badImage });
  const badAudio = validateMusicAudio(body.referenceAudio);
  if (badAudio) return json(400, { error: badAudio });

  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) {
    console.error("music-generate: GOOGLE_AI_API_KEY is not set");
    return json(503, { error: "Music generation is not configured." });
  }

  // ---- stage one: LISTEN to a reference track, if one came --------------------
  //
  // OWNER DIRECTIVE 2026-09-04c, and the load-bearing sentence is the second
  // one: reference audio -> Gemini audio understanding -> structured music
  // brief -> Lyria. THE RECORDING NEVER REACHES LYRIA. Sending it there is
  // measured closed anyway (400 "Unsupported input mime type for this model:
  // audio/s16le", identically for wav and mp3, on every lyria id, with a
  // text-only control returning 200) — but the architecture is not a
  // workaround for that. Deriving characteristics and generating fresh is
  // what somebody means by "something like this", and it keeps ONIQ making
  // original music rather than transforming a recording it does not own.
  //
  // THE NO-COPYING RULE IS SAID TWICE, once to this model in BRIEF_ASK and
  // once to Lyria in the compiled prompt, because the brief passes through a
  // language model in between and can come back carrying a phrase closer to
  // the original than was asked for.
  //
  // A FAILURE HERE STILL COSTS A SLOT. The failed row below is what the daily
  // caps count, and without it a caller could burn listening calls all day
  // without ever consuming a song. The row is also simply true: the money was
  // spent.
  let lyriaPrompt = prompt;
  let briefLine: string | null = null;
  const refAudio = body.referenceAudio ?? null;

  if (refAudio) {
    const briefGuarded = await withProviderSpendGuard(
      serviceRoleRpc(),
      {
        requestId: requestIdFrom(typeof body.requestId === "string" ? body.requestId : undefined),
        capability: "MUSIC",
        provider: "google",
        model: AUDIO_UNDERSTANDING_MODEL,
        unit: "provider_unit",
        units: 1,
        estimatedUsd: MUSIC_BRIEF_BUDGET.maxEstimatedUsd,
        userId: user.id,
      },
      async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), MUSIC_BRIEF_BUDGET.maxWallClockMs);
        try {
          const res = await googleGenerateContent({
            model: AUDIO_UNDERSTANDING_MODEL,
            key,
            // The recording FIRST, then the instruction about it — the same
            // ordering the transcribe and image-reference paths needed.
            parts: [
              { inlineData: { mimeType: refAudio.mimeType, data: refAudio.data } },
              { text: BRIEF_ASK },
            ],
            // Asked for JSON in the PROMPT, this model still answers inside a
            // ```json fence. The field is the setting; the prompt is a
            // request. parseMusicBrief tolerates the fence anyway, but there
            // is no reason to rely on that.
            responseMimeType: "application/json",
            signal: ctrl.signal,
          });
          return {
            value: {
              ok: res.ok,
              status: res.status,
              text: res.ok ? joinedText(res.data) : "",
              errorMessage: res.errorMessage,
            } as const,
            neverCalled: false,
            outcome: res.ok ? ("ACCEPTED" as const) : ("FAILED" as const),
            detail: googleUsage(res.data) ?? undefined,
          };
        } finally {
          clearTimeout(timer);
        }
      },
    );

    if (!briefGuarded.admitted) {
      console.warn(`music-generate: brief refused (${briefGuarded.reason})`);
      return json(429, { error: refusalMessage(briefGuarded.reason) });
    }

    const heard = briefGuarded.value;
    const brief = heard.ok ? parseMusicBrief(heard.text) : null;
    if (!brief) {
      // Two different failures, one honest message: the call errored, or it
      // returned 200 with nothing usable in it. A brief with no fields would
      // compile to "Create an original piece of music." — what attaching
      // nothing gives you — while telling the person their track was used.
      if (!heard.ok) {
        console.error("music-generate brief upstream", heard.status, heard.errorMessage ?? "");
      }
      await admin.from("music_jobs").insert({
        user_id: user.id,
        prompt,
        model: AUDIO_UNDERSTANDING_MODEL,
        status: "failed",
        reference: "audio",
        error: heard.ok ? "no usable brief" : `http ${heard.status}`,
      });
      return json(502, { error: "Couldn't make out enough in that track. Try another one." });
    }

    // The person's own words LEAD; the reference is the adjective.
    lyriaPrompt = compileMusicPrompt(brief, prompt);
    briefLine = describeBrief(brief);
  }

  // ---- ONE billable call, inside the financial ledger ----------------------
  //
  // ITS OWN CAPABILITY, not the shared per-token search guard. That was the
  // original design (music-generate is why it's not in searchSpendCoverage's
  // frozen tail — that list records what was already unguarded on 2026-08-24,
  // and its own header says the right move for a NEW caller is to guard it)
  // but it shipped wrong: withSearchSpendGuard reserves via a MODEL_RATES
  // lookup, which is per token, and Lyria is deliberately absent from that
  // table (below). An absent rate always throws, so admission always refused
  // "unpriced-model" — every call died before Google was ever reached, for
  // everyone, since the day this shipped. Fixed 2026-09-04 by reserving the
  // owner's flat per-song figure directly against MUSIC's own budget row
  // (provider_budget_config) instead. Reusing SEARCH's bucket was rejected on
  // the same page's own warning: "one capability's runaway drains another's."
  //
  // ONE THING THE LEDGER STILL CANNOT DO HERE, recorded rather than papered
  // over. Settlement prices a call from MODEL_RATES, which is per token, and
  // Google's response carries no cost and no duration to settle against
  // either way. So the model stays out of MODEL_RATES, actualUsdFromUsage
  // returns null, and the ledger charges the $0.08 reservation with the
  // measured tokens kept in `detail` for provenance only. An invented
  // per-token rate that happened to average $0.08 would look like arithmetic
  // and be a guess.
  const guarded = await withProviderSpendGuard(
    serviceRoleRpc(),
    {
      requestId: requestIdFrom(typeof body.requestId === "string" ? body.requestId : undefined),
      capability: "MUSIC",
      provider: "google",
      model: MUSIC_MODEL,
      unit: "provider_unit",
      units: 1,
      // Lyria bills per song, not per token — it has no MODEL_RATES entry and
      // never will (see the settlement note below) — so this reserves the
      // owner's own flat per-song figure directly, the same number
      // MUSIC_BUDGET has always carried. Routing this through the shared
      // token-priced search guard is what caused every call to be refused
      // "unpriced-model" before a single request ever reached Google.
      estimatedUsd: MUSIC_BUDGET.maxEstimatedUsd,
      userId: user.id,
    },
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
      try {
        // A PICTURE, on the other hand, goes straight in. Measured 2026-09-04:
        // a 256x256 PNG before the text returned 200 with audio/mpeg and
        // lyrics visibly derived from the image, and Google billed it in
        // promptTokensDetails as modality IMAGE — so it was read, not ignored.
        // The image FIRST, then the words, the same ordering every other
        // reference path here needed.
        const parts: GooglePart[] = [];
        if (body.referenceImage) {
          parts.push({
            inlineData: {
              mimeType: body.referenceImage.mimeType,
              data: body.referenceImage.data,
            },
          });
        }
        parts.push({ text: lyriaPrompt });

        const res = await googleGenerateContent({
          model: MUSIC_MODEL,
          key,
          parts,
          signal: ctrl.signal,
        });
        const meta = (res.data as { usageMetadata?: Record<string, unknown> })?.usageMetadata;
        return {
          value: {
            ok: res.ok,
            status: res.status,
            data: res.data,
            errorMessage: res.errorMessage,
          } as const,
          // The request left this machine, so it may have been charged even
          // though no answer came back. `neverCalled` would tell the ledger to
          // release the whole reservation, and that would be a guess.
          neverCalled: false,
          outcome: res.ok ? ("ACCEPTED" as const) : ("FAILED" as const),
          // Kept for provenance only — Google's response carries no cost field
          // for Lyria, so there is nothing here to settle a dollar amount
          // against; the ledger charges the reservation instead.
          detail: meta
            ? {
                inputTokens: typeof meta.promptTokenCount === "number" ? meta.promptTokenCount : 0,
                outputTokens: geminiOutputTokens(meta),
              }
            : undefined,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  );

  if (!guarded.admitted) {
    console.warn(`music-generate: spend guard refused (${guarded.reason})`);
    return json(429, { error: refusalMessage(guarded.reason) });
  }

  // Which reference this song was made from, recorded on every row the
  // request writes — including the failures, so a reference that reliably
  // fails is visible in the table rather than only in a log.
  const reference = refAudio ? "audio" : body.referenceImage ? "image" : null;

  const outcome = guarded.value;
  if (!outcome.ok) {
    // Google's own message, which is the only thing separating "that model id
    // does not exist" from "your prompt was refused" from "quota". Logging a
    // bare status is what left this path undiagnosable for months.
    console.error("music-generate upstream", outcome.status, outcome.errorMessage ?? "");
    // A failed attempt that may still have cost money is recorded, not
    // discarded — the ledger is for what happened, not for what worked.
    await admin.from("music_jobs").insert({
      user_id: user.id,
      prompt,
      model: MUSIC_MODEL,
      status: "failed",
      reference,
      brief: briefLine,
      error: outcome.status ? `http ${outcome.status}` : "network",
    });
    return json(502, { error: "The music engine refused that one. Try different words." });
  }

  const data = outcome.data as { modelVersion?: unknown } | null;
  const audio = firstInlinePart(data, "audio/");

  if (!audio) {
    // A refusal arrives as a 200 with no audio rather than as an error status,
    // which is exactly how a silent failure gets shipped as a feature.
    // Measured: lyria-3.5 did this on an image prompt, blockReason
    // PROHIBITED_CONTENT, with a 200 status and no audio part anywhere.
    await admin.from("music_jobs").insert({
      user_id: user.id,
      prompt,
      model: MUSIC_MODEL,
      status: "failed",
      reference,
      brief: briefLine,
      error: "no audio in response",
    });
    return json(502, { error: "No music came back for that. Try different words." });
  }

  const bytes = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
  const mime = audio.mime;
  const ext = mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "bin";
  // Under the user's own folder: the bucket's own-folder read policy is then
  // what scopes it, with no new storage policy invented for this feature.
  const path = `${user.id}/music/${crypto.randomUUID()}.${ext}`;

  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (up.error) {
    console.error("music-generate storage", up.error.message);
    await admin.from("music_jobs").insert({
      user_id: user.id,
      prompt,
      model: MUSIC_MODEL,
      status: "failed",
      reference,
      brief: briefLine,
      error: "storage",
    });
    return json(500, { error: "The song was made but could not be saved." });
  }

  // The version that ANSWERED, which is not always the id that was asked for:
  // `lyria-3-pro-preview` came back as `lyria-3.5` when this was measured.
  const served = typeof data?.modelVersion === "string" ? data.modelVersion : MUSIC_MODEL;
  const { data: row } = await admin
    .from("music_jobs")
    .insert({
      user_id: user.id,
      prompt,
      model: served,
      status: "done",
      stored_path: path,
      mime,
      bytes: bytes.byteLength,
      reference,
      brief: briefLine,
    })
    .select("id, created_at")
    .maybeSingle();

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return json(200, {
    id: row?.id ?? null,
    createdAt: row?.created_at ?? new Date().toISOString(),
    prompt,
    url: signed?.signedUrl ?? null,
    promptMax: MUSIC_PROMPT_MAX,
    reference,
    // Handed back so the screen can SHOW what was heard. The owner asked for
    // it explicitly, and showing the derived characteristics is the plainest
    // way to make clear the reference produced a description and not a copy.
    brief: briefLine,
  });
});
