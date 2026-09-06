// voice-generate — a spoken line from typed text, direct on Google.
//
// Owner reference, 2026-09-04: Voice is a live Create card. The ENGINE is not
// new — ONIQ has read story narration through this gateway since 2026-08-14,
// on the id the owner's model mapping moved to Gemini 3.1 Flash TTS. What was
// missing was a screen and the guards a user-facing, money-spending button
// needs.
//
// WHOSE MONEY. The METERED GOOGLE ACCOUNT, per owner directive 2026-09-04b —
// the same key music and Veo clips already spend. It was Lovable credits until
// that directive; story NARRATION still is, so ONIQ now runs two TTS routes on
// two different bills. That split is deliberate (the directive named the four
// Create features, not story narration) and voiceCore.test.ts pins both sides
// so it cannot drift into being an accident.
//
// The guards are the order every ONIQ generation tool enforces:
//
//     caller gate -> kill switch -> admin gate -> house cap
//     -> per-user cap -> validation -> ONE billable call
//
// Both caps are counted BEFORE the charge, over a rolling 24h from one shared
// `since` so midnight cannot double either. There is no batching and no
// retry: text the gateway refuses will be refused again identically.
// The kill switch ships OFF, because nothing should start spending on the
// strength of a deploy nobody watched.
//
// DELIBERATELY NOT SHARED WITH music-generate OR image-generate. The three
// read almost the same, and a later pass may unify the Create paths on
// purpose. Until someone does that deliberately, a money guard that reads top
// to bottom in one file is worth more than the duplication it costs.
//
// OWNER DIRECTIVE 2026-09-04b: "make images, Voice, music, documents direct
// Gemini not via lovable". Create — Voice spends the METERED GOOGLE ACCOUNT
// now, not Lovable credits. Story NARRATION was not in that list and stays on
// the gateway, so ONIQ runs two TTS routes on two bills — deliberate, and
// pinned by voiceCore.test.ts so it cannot become an accident.
//
// MEASURED before it was written, direct: gemini-3.1-flash-tts-preview with
// generationConfig {responseModalities:['AUDIO'], speechConfig:{...voiceName}}
// answers 200, 144,129 bytes, inlineData 'audio/l16; rate=24000; channels=1'.
// WITHOUT speechConfig the same id returns 400 INVALID_ARGUMENT — a 400 that
// looks like a dead id and is not.
//
// GOOGLE_AI_API_KEY is read here and nowhere else in this file's reach. Never
// returned, never logged, never in an error message.
//
// MEASURED before it was written: all eight voices in VOICE_CHOICES answered
// this exact body 200 with a RIFF/WAVE, 44-60 KB for one word.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";
import { type SearchBudget } from "../_shared/searchBudget.ts";
import {
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withProviderSpendGuard,
} from "../_shared/financialLedger.ts";
import {
  firstInlinePart,
  googleGenerateContent,
  googleUsage,
  joinedText,
} from "../_shared/googleDirect.ts";
import {
  needsWavHeader,
  rateOf,
  resolveVoice,
  validateVoiceText,
  AUDIO_UNDERSTANDING_MODEL,
  validateAudioAttachment,
  VOICE_MODEL,
  VOICE_TEXT_MAX,
  wrapPcmAsWav,
} from "../_shared/voiceCore.ts";

/**
 * The spend reservation for one spoken line.
 *
 * NO SEARCH — the input is typed text and the answer is audio, so the search
 * fields are zero and the reservation is for exactly one provider call.
 *
 * `maxEstimatedUsd` carries the owner's $20 per 1M output audio tokens, priced
 * for the longest line this path admits. It is what ONIQ RESERVES against, not
 * what settles the call: this id is absent from MODEL_RATES, so settlement
 * records the call with the dollars marked unknown. AND THE GATEWAY IS A
 * RESELLER — that rate is Google's list price; what ONIQ actually pays is
 * Lovable credits at whatever rate the gateway sets, which no response
 * reports. The same reasoning the music and image paths record.
 *
 * `maxWallClockMs` is 90s because reading is not a chat turn, and a ceiling
 * that fires mid-read abandons a call the gateway has already begun to bill.
 */
export const VOICE_BUDGET: SearchBudget = {
  maxSearches: 0,
  maxProviderCalls: 1,
  maxLlmCalls: 1,
  maxInputTokens: 1_000,
  maxOutputTokens: 8_000,
  maxWallClockMs: 90_000,
  maxEstimatedUsd: 0.16,
};

const BUCKET = "video-gen";

/** One generation's ceiling, kept well inside the function timeout. */
const CALL_TIMEOUT_MS = 90_000;

type Row = {
  id: string;
  created_at: string;
  prompt: string;
  voice: string;
  stored_path: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ---- caller gate ---------------------------------------------------------
  // The platform's verify_jwt has already run; this re-derives the person
  // anyway rather than trusting a claim in the body, the same shape
  // story-deliver and gpu-video use.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "Sign in to make voice clips" });

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
  if (!user) return json(401, { error: "Sign in to make voice clips" });

  let body: {
    action?: string;
    /** The row to remove. Read only by the `delete` action. */
    id?: string;
    text?: string;
    voice?: string;
    requestId?: string;
    /** A recording to transcribe, base64 with no data: prefix. */
    audio?: { mimeType: string; data: string };
    /** A language name; present means translate rather than transcribe. */
    translateTo?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // ---- listing is free and needs none of the gates below --------------------
  if (body.action === "list") {
    const { data, error } = await admin
      .from("voice_jobs")
      .select("id, created_at, prompt, voice, stored_path")
      .eq("user_id", user.id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return json(500, { error: "Couldn't load your voice clips" });
    const clips = [];
    for (const row of (data ?? []) as Row[]) {
      if (!row.stored_path) continue;
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(row.stored_path, 60 * 60);
      clips.push({
        id: row.id,
        createdAt: row.created_at,
        prompt: row.prompt,
        voice: row.voice,
        url: signed?.signedUrl ?? null,
      });
    }
    return json(200, { clips });
  }

  // ---- deleting is free, and sits with `list` ABOVE every spend gate -------
  //
  // Above them deliberately. Deleting costs nothing, and a person who has hit
  // their daily cap must still be able to remove what they already made —
  // below the gates this would mean "you are out of generations, so you may
  // not tidy up", which is absurd.
  //
  // THE ROW SURVIVES. ONLY THE BYTES GO. That is not squeamishness, it is the
  // spend guard: voice_jobs IS the daily-cap ledger. Both counts further down
  // — the house cap and the per-user cap — are `count` over rows in this
  // table across a rolling 24h, and NEITHER filters on `status`. A hard
  // DELETE would therefore let anyone reset their own cap, and the HOUSE cap,
  // by deleting their voice clips in a loop: unlimited generation on the
  // owner's metered key for the price of a delete. The table's own comment
  // already said it — "a failed attempt that cost money is still recorded
  // rather than vanishing" — and `delete_story_job` reached the same
  // conclusion for films ("that could DELETE rows there could delete the
  // record of what it was charged").
  //
  // `status = "deleted"` needs no migration and hides it everywhere for free,
  // because the `list` action above already filters `.eq("status", "done")`.
  // The path is nulled in the same statement so nothing can later sign a URL
  // to bytes that are being removed.
  if (body.action === "delete") {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return json(400, { error: "Which clip?" });

    // Read first, scoped to the caller — this both AUTHORIZES and yields the
    // path. `admin` is the service role and bypasses RLS, so
    // `.eq("user_id", user.id)` is the entire ownership boundary here; drop
    // it and any signed-in person could delete anyone's clip by id.
    const { data: mine, error: readErr } = await admin
      .from("voice_jobs")
      .select("stored_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) return json(500, { error: "Couldn't delete that clip" });
    // The same answer for "not yours" and "not there", so this cannot be used
    // to ask whether an id exists.
    if (!mine) return json(404, { error: "That clip is not there" });

    const { error: markErr } = await admin
      .from("voice_jobs")
      .update({ status: "deleted", stored_path: null })
      .eq("id", id)
      .eq("user_id", user.id);
    if (markErr) return json(500, { error: "Couldn't delete that clip" });

    // Bytes last, best effort. If this fails the object is orphaned in a
    // PRIVATE bucket — unreachable without a signed URL that nothing will now
    // mint — costing a little storage and showing nobody anything. The
    // reverse order risks the opposite: bytes gone while the row still lists,
    // a visible item that 404s. Orphaned-and-invisible beats listed-and-broken.
    const path = (mine as { stored_path: string | null }).stored_path;
    if (path) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove([path]);
      if (rmErr) console.warn("[voice-generate] delete left an orphan", path, rmErr.message);
    }
    return json(200, { deleted: id });
  }

  // ---- TRANSCRIBE: an attached recording, turned into text -----------------
  //
  // The reference's "Voice Input" and "Translate" tabs. This is NOT the TTS
  // model — that one speaks and does not listen, which is the confusion
  // recorded at length in voiceCore.ts. It goes to an ordinary text model,
  // which was measured accepting inlineData audio/wav at 200 on 2026-09-04.
  //
  // It gets the SAME gates as speaking, in the same order, because it is the
  // same kind of thing: a user-facing button that spends money on a provider
  // call. Cheaper per call than TTS, not free.
  if (body.action === "transcribe") {
    const badAudio = validateAudioAttachment(body.audio);
    if (badAudio) return json(400, { error: badAudio });
    if (!body.audio) return json(400, { error: "Attach a recording first." });

    const { data: tcfg } = await admin
      .from("video_gen_config")
      .select("voice_enabled, voice_admin_only, voice_per_user_daily_cap")
      .maybeSingle();
    if (!tcfg || tcfg.voice_enabled !== true) {
      return json(503, { error: "Voice is switched off right now." });
    }
    const { data: tprof } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (tcfg.voice_admin_only === true && tprof?.is_admin !== true) {
      return json(403, { error: "Voice isn't open to everyone yet." });
    }
    // One rolling 24h window, counted against THIS user, sharing the voice
    // per-user cap rather than inventing a second uncapped surface.
    const tSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: tMine } = await admin
      .from("voice_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", tSince);
    const tCap =
      typeof tcfg.voice_per_user_daily_cap === "number" ? tcfg.voice_per_user_daily_cap : 0;
    if ((tMine ?? 0) >= tCap) {
      return json(429, { error: `You've used voice ${tMine} times today (limit ${tCap}).` });
    }

    const tKey = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!tKey) return json(503, { error: "Voice is not configured." });

    const translateTo = typeof body.translateTo === "string" ? body.translateTo.trim() : "";
    // The instruction is built HERE, not taken from the client: a caller that
    // could send arbitrary instructions alongside their audio would be an open
    // prompt surface on a paid model.
    const ask = translateTo
      ? `Transcribe this audio and translate it into ${translateTo}. Reply with the translation only, no commentary.`
      : "Transcribe this audio exactly. Reply with the transcript only, no commentary.";

    const tGuarded = await withProviderSpendGuard(
      serviceRoleRpc(),
      {
        requestId: requestIdFrom(typeof body.requestId === "string" ? body.requestId : undefined),
        capability: "TTS",
        provider: "google",
        model: AUDIO_UNDERSTANDING_MODEL,
        unit: "provider_unit",
        units: 1,
        // Reserved at the SPEAKING rate even though listening is cheaper.
        // Over-reserving refuses too early; under-reserving lets a charge
        // through a ceiling that was supposed to stop it, and only one of
        // those two failures costs money.
        estimatedUsd: VOICE_BUDGET.maxEstimatedUsd,
        userId: user.id,
      },
      async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
        try {
          const res = await googleGenerateContent({
            model: AUDIO_UNDERSTANDING_MODEL,
            key: tKey,
            // The recording FIRST, then the instruction about it — the same
            // ordering the image reference needed.
            parts: [
              { inlineData: { mimeType: body.audio!.mimeType, data: body.audio!.data } },
              { text: ask },
            ],
            signal: ctrl.signal,
          });
          return {
            value: {
              ok: res.ok,
              status: res.status,
              text: res.ok ? joinedText(res.data).trim() : "",
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

    if (!tGuarded.admitted) {
      console.warn(`voice-generate: transcribe refused (${tGuarded.reason})`);
      return json(429, { error: refusalMessage(tGuarded.reason) });
    }
    const t = tGuarded.value;
    if (!t.ok) {
      console.error("voice-generate transcribe upstream", t.status, t.errorMessage ?? "");
      return json(502, { error: "Couldn't read that recording. Try another one." });
    }
    if (!t.text) {
      // A 200 with no text is a refusal wearing a success status — the same
      // silent-failure shape the speaking path guards against.
      return json(502, { error: "Nothing could be heard in that recording." });
    }
    return json(200, { text: t.text, translated: Boolean(translateTo) });
  }

  // ---- kill switch ---------------------------------------------------------
  const { data: cfg } = await admin
    .from("video_gen_config")
    .select("voice_enabled, voice_daily_cap, voice_admin_only, voice_per_user_daily_cap")
    .maybeSingle();
  if (!cfg || cfg.voice_enabled !== true) {
    return json(503, { error: "Voice generation is switched off right now." });
  }

  // ---- admin gate ----------------------------------------------------------
  // Voice ships admin-only for the same reason music and image did: it spends
  // real money with no per-user ledger behind it yet. `voice_admin_only` is the
  // row the owner flips to open it, and flipping it needs no deploy.
  const { data: prof } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = prof?.is_admin === true;
  if (cfg.voice_admin_only !== false && !isAdmin) {
    return json(403, { error: "Voice is not open to everyone yet." });
  }

  // ---- the two caps, BOTH BEFORE any charge --------------------------------
  //
  // THE HOUSE CAP bounds the bill. THE PER-USER CAP bounds who can spend it,
  // and it exists because the house cap alone does not: once a Create tool is
  // open to everyone, a single account — or a script — can take the entire
  // day's allowance in one run, which is both the whole bill and a feature
  // nobody else can use until tomorrow. The pair is the point: one number
  // protects the money, the other protects its distribution.
  //
  // Both are counted over a rolling 24h rather than a calendar day, so the
  // limit cannot be doubled by generating either side of midnight.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: houseCount } = await admin
    .from("voice_jobs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  const usedToday = houseCount ?? 0;
  const cap = typeof cfg.voice_daily_cap === "number" ? cfg.voice_daily_cap : 0;
  if (usedToday >= cap) {
    return json(429, { error: `Daily voice cap reached (${usedToday}/${cap}). Try tomorrow.` });
  }

  const { count: mineCount } = await admin
    .from("voice_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  const usedByMe = mineCount ?? 0;
  const perUserCap =
    typeof cfg.voice_per_user_daily_cap === "number" ? cfg.voice_per_user_daily_cap : 0;
  if (usedByMe >= perUserCap) {
    // Deliberately says YOUR limit, not the house's: a person who has used
    // their own allowance should not be told the service is out, and a person
    // locked out by someone else's usage should not be told it was theirs.
    return json(429, {
      error: `You've made ${usedByMe} voice clips today (limit ${perUserCap}). Try again tomorrow.`,
    });
  }

  // ---- validation ----------------------------------------------------------
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const invalid = validateVoiceText(text);
  if (invalid) return json(400, { error: invalid });
  // An unrecognised name falls back rather than reaching the provider.
  const voice = resolveVoice(body.voice);

  // OWNER DIRECTIVE 2026-09-04b: direct Google, not the Lovable gateway.
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) {
    console.error("voice-generate: GOOGLE_AI_API_KEY is not set");
    return json(503, { error: "Voice generation is not configured." });
  }

  // ---- ONE billable call, inside the financial ledger ----------------------
  //
  // ITS OWN CAPABILITY, not the shared per-token search guard — the same fix
  // music-generate needed (20260904110000). withSearchSpendGuard reserves via
  // a MODEL_RATES lookup, which is per token; this id is absent from that
  // table (below), so an absent rate always throws and admission always
  // refuses "unpriced-model" before the gateway is ever reached. Caught here
  // before it shipped live: voice_enabled is still false, so nothing has hit
  // this yet, but turning it on would have broken exactly like music did.
  //
  // ONE THING THE LEDGER STILL CANNOT DO HERE, recorded rather than papered
  // over. Settlement prices a call from MODEL_RATES, and this id is absent
  // from it. TTS is billed per output AUDIO token, a unit MODEL_RATES does
  // not carry, and the gateway is a reseller charging credits whose price no
  // response states. The ledger therefore charges the flat reservation and
  // keeps no per-token detail here (the gateway reports none) — the same
  // choice the music and image paths make.
  const guarded = await withProviderSpendGuard(
    serviceRoleRpc(),
    {
      requestId: requestIdFrom(typeof body.requestId === "string" ? body.requestId : undefined),
      capability: "TTS",
      // OWNER DIRECTIVE 2026-09-04b — the metered Google account now, not
      // Lovable credits. The reservation is unchanged; whose money it reserves
      // against is what moved.
      provider: "google",
      model: VOICE_MODEL,
      unit: "provider_unit",
      units: 1,
      estimatedUsd: VOICE_BUDGET.maxEstimatedUsd,
      userId: user.id,
    },
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
      // NO CATCH, DELIBERATELY. googleGenerateContent does not throw — a
      // timeout or a dropped connection comes back as `transport`, with ok
      // false and status 0. The catch that used to sit here was unreachable.
      try {
        // speechConfig IS REQUIRED, and its absence is not a dead id.
        // Measured 2026-09-04: this exact id answered 400 INVALID_ARGUMENT to
        // a bare responseModalities:["AUDIO"] body and 200 to the same body
        // with a prebuilt voice attached. The reflex on that 400 is to strike
        // the id off the list, and it would have been wrong.
        const res = await googleGenerateContent({
          model: VOICE_MODEL,
          key,
          parts: [{ text }],
          responseModalities: ["AUDIO"],
          generationConfig: {
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
          signal: ctrl.signal,
        });
        // ONE DIALECT NOW. The gateway had two — pass-through JSON, or
        // container bytes with the mime in the header — and this file read
        // both. Google's own endpoint always answers generateContent JSON
        // with headerless PCM inline, measured at 143,360 base64 characters
        // of 'audio/l16; rate=24000; channels=1', so the second branch is
        // gone rather than kept as dead code that nothing can reach.
        const audio = res.ok ? firstInlinePart(res.data, "audio/") : null;
        const usage = googleUsage(res.data);
        return {
          value: {
            ok: res.ok,
            status: res.status,
            audio,
            errorMessage: res.errorMessage,
          } as const,
          neverCalled: false,
          outcome: res.ok ? ("ACCEPTED" as const) : ("FAILED" as const),
          detail: usage ?? undefined,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  );

  if (!guarded.admitted) {
    console.warn(`voice-generate: spend guard refused (${guarded.reason})`);
    return json(429, { error: refusalMessage(guarded.reason) });
  }

  const outcome = guarded.value;
  // A failed attempt that may still have cost money is recorded, not
  // discarded — the ledger is for what happened, not for what worked.
  const fail = async (why: string, message: string, status: number) => {
    await admin.from("voice_jobs").insert({
      user_id: user.id,
      prompt: text,
      voice,
      model: VOICE_MODEL,
      status: "failed",
      error: why,
    });
    return json(status, { error: message });
  };

  if (!outcome.ok) {
    // GOOGLE'S OWN MESSAGE, kept. A bare status cannot tell a dead id from a
    // refused prompt from exhausted quota, and all three arrive as a 4xx.
    const detail = "errorMessage" in outcome ? (outcome.errorMessage ?? null) : null;
    console.error("voice-generate upstream", outcome.status, detail ?? "");
    return await fail(
      [outcome.status ? `http ${outcome.status}` : "network", detail]
        .filter(Boolean)
        .join(": ")
        .slice(0, 500),
      "The voice engine refused that one. Try different words.",
      502,
    );
  }

  if (!outcome.audio) {
    // A refusal arrives as a 200 with no audio rather than as an error status,
    // which is exactly how a silent failure gets shipped as a feature.
    return await fail("no audio in response", "Nothing came back for that. Try again.", 502);
  }

  const raw = Uint8Array.from(atob(outcome.audio.data), (c) => c.charCodeAt(0));
  // Headerless PCM needs a container before a browser can play it; container
  // bytes must be written AS-IS. Wrapping already-containered bytes in a
  // second header is corrupt audio that still half-opens — a click at the top
  // of every clip and nothing else to see. The rate is never guessed: an
  // unstated one fails rather than shipping audio at the wrong speed, which
  // reads as a strange voice rather than as a bug.
  let bytes = raw;
  let mime = outcome.audio.mime;
  if (needsWavHeader(mime)) {
    const rate = rateOf(mime);
    if (rate === null) {
      return await fail(`no sample rate in "${mime}"`, "That clip came back unplayable.", 502);
    }
    bytes = wrapPcmAsWav(raw, rate);
    mime = "audio/wav";
  }

  // Under the user's own folder: the bucket's own-folder read policy is then
  // what scopes it, with no new storage policy invented for this feature.
  const ext = /mpeg|mp3/i.test(mime) ? "mp3" : "wav";
  const path = `${user.id}/voice/${crypto.randomUUID()}.${ext}`;

  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (up.error) {
    console.error("voice-generate storage", up.error.message);
    return await fail("storage", "The clip was made but could not be saved.", 500);
  }

  const { data: row } = await admin
    .from("voice_jobs")
    .insert({
      user_id: user.id,
      prompt: text,
      voice,
      model: VOICE_MODEL,
      status: "done",
      stored_path: path,
      mime,
      bytes: bytes.byteLength,
    })
    .select("id, created_at")
    .maybeSingle();

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return json(200, {
    id: row?.id ?? null,
    createdAt: row?.created_at ?? new Date().toISOString(),
    prompt: text,
    voice,
    url: signed?.signedUrl ?? null,
    textMax: VOICE_TEXT_MAX,
  });
});

/** Base64 without blowing the call stack on a multi-megabyte clip. */
function b64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
