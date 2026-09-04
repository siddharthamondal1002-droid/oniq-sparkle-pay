// voice-generate — a spoken line from typed text, on Lovable credits.
//
// Owner reference, 2026-09-04: Voice is a live Create card. The ENGINE is not
// new — ONIQ has read story narration through this gateway since 2026-08-14,
// on the id the owner's model mapping moved to Gemini 3.1 Flash TTS. What was
// missing was a screen and the guards a user-facing, money-spending button
// needs.
//
// WHOSE MONEY. Lovable credits, not the metered Google key — the same pool
// story-voice and story-still already spend, and the route the 2026-09-04
// directive put every model on except music.
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
// LOVABLE_API_KEY is read here and nowhere else in this file's reach. Never
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
  withSearchSpendGuard,
} from "../_shared/searchGuard.ts";
import { firstInlineAudio, GATEWAY_VOICE_URL, voiceRequestBody } from "../_shared/gatewayVoice.ts";
import {
  needsWavHeader,
  rateOf,
  resolveVoice,
  validateVoiceText,
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

const VOICE_URL = GATEWAY_VOICE_URL;
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

  let body: { action?: string; text?: string; voice?: string; requestId?: string };
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

  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) {
    console.error("voice-generate: LOVABLE_API_KEY is not set");
    return json(503, { error: "Voice generation is not configured." });
  }

  // ---- ONE billable call, inside the financial ledger ----------------------
  //
  // Same reservation path as every other billable caller in the repository,
  // and it is why voice-generate is not in searchSpendCoverage's frozen tail:
  // that list records what was already unguarded on 2026-08-24, and its own
  // header says the right move for a NEW caller is to guard it.
  //
  // ONE THING THE LEDGER CANNOT DO HERE, recorded rather than papered over.
  // Settlement prices a call from MODEL_RATES, and this id is absent from it.
  // TTS is billed per output AUDIO token, a unit MODEL_RATES does not carry,
  // and the gateway is a reseller charging credits whose price no response
  // states. The ledger therefore records the call with the dollars marked
  // unknown — the same choice the music and image paths made.
  const guarded = await withSearchSpendGuard(
    serviceRoleRpc(),
    {
      requestId: requestIdFrom(typeof body.requestId === "string" ? body.requestId : undefined),
      provider: "lovable-gateway",
      model: VOICE_MODEL,
      searchType: "voice-generate",
      userId: user.id,
      budget: VOICE_BUDGET,
    },
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
      try {
        const res = await fetch(VOICE_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: voiceRequestBody(text, voice),
          signal: ctrl.signal,
        });
        // TWO REPLY DIALECTS, and story-voice learned both the hard way. A
        // pass-through gateway answers Google's generateContent JSON, with
        // headerless PCM inline and the sample rate in its mime; a normalizing
        // one answers container bytes with the mime in the header. Measured
        // 2026-09-04, this id took the second road — but reading only that one
        // would make a gateway-side change look like a refusal.
        let audio: { mime: string; data: string } | null = null;
        if (res.ok) {
          const replyType = res.headers.get("content-type") ?? "";
          if (/json/i.test(replyType)) {
            audio = firstInlineAudio(await res.json().catch(() => null));
          } else {
            const heard = new Uint8Array(await res.arrayBuffer());
            if (heard.length > 0) audio = { mime: replyType || "audio/wav", data: b64(heard) };
          }
        }
        return {
          value: { ok: res.ok, status: res.status, audio } as const,
          neverCalled: false,
          // The gateway reports no usage on this endpoint — it answers bytes,
          // not a JSON envelope with a token count. Reporting zeros would be a
          // measurement nobody made, so it reports none.
          usage: null,
          stopReason: null,
          terminationReason: res.ok ? undefined : ("PROVIDER_ERROR" as const),
        };
      } catch (e) {
        const reason = (e as Error)?.name === "AbortError" ? "timeout" : "network";
        return {
          value: { ok: false, status: 0, audio: null, reason } as const,
          // The request left this machine, so it may have been charged even
          // though no answer came back. `neverCalled` would tell the ledger to
          // release the whole reservation, and that would be a guess.
          neverCalled: false,
          usage: null,
          stopReason: null,
          terminationReason: "PROVIDER_ERROR" as const,
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
    console.error("voice-generate upstream", outcome.status);
    return await fail(
      outcome.status ? `http ${outcome.status}` : "network",
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
