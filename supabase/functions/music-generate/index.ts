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
  withSearchSpendGuard,
} from "../_shared/searchGuard.ts";
import { MUSIC_MODEL, MUSIC_PROMPT_MAX, validateMusicPrompt } from "../_shared/musicCore.ts";

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

const GOOGLE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MUSIC_MODEL}:generateContent`;
const BUCKET = "video-gen";

/** Google's own ceiling on one generation, kept well inside the function timeout. */
const CALL_TIMEOUT_MS = 120_000;

type Row = { id: string; created_at: string; prompt: string; stored_path: string | null };

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

  let body: { action?: string; prompt?: string; requestId?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // ---- listing is free and needs none of the gates below --------------------
  if (body.action === "list") {
    const { data, error } = await admin
      .from("music_jobs")
      .select("id, created_at, prompt, stored_path")
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

  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) {
    console.error("music-generate: GOOGLE_AI_API_KEY is not set");
    return json(503, { error: "Music generation is not configured." });
  }

  // ---- ONE billable call, inside the financial ledger ----------------------
  //
  // Same reservation path as every other billable caller in the repository,
  // and it is why music-generate is not in searchSpendCoverage's frozen tail:
  // that list records what was already unguarded on 2026-08-24, and its own
  // header says the right move for a NEW caller is to guard it.
  //
  // ONE THING THE LEDGER CANNOT DO HERE, recorded rather than papered over.
  // Settlement prices a call from MODEL_RATES, which is per token. Lyria is
  // not priced per token — the owner's figure is $0.08 A SONG — and Google's
  // response carries no cost and no duration to settle against. So the model
  // is deliberately absent from MODEL_RATES, actualUsdFromUsage returns null,
  // and the ledger records the call and its measured tokens with the dollars
  // marked unknown. An invented per-token rate that happened to average $0.08
  // would look like arithmetic and be a guess.
  const guarded = await withSearchSpendGuard(
    serviceRoleRpc(),
    {
      requestId: requestIdFrom(typeof body.requestId === "string" ? body.requestId : undefined),
      provider: "google",
      model: MUSIC_MODEL,
      searchType: "music-generate",
      userId: user.id,
      budget: MUSIC_BUDGET,
    },
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
      try {
        const res = await fetch(`${GOOGLE_URL}?key=${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Google's NATIVE shape with an explicit role — measured. The OpenAI
          // field names this upstream is often given (`prompt`, `input`) come
          // back as "Unknown name ...: Cannot find field".
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
          signal: ctrl.signal,
        });
        const parsed = res.ok ? await res.json().catch(() => null) : null;
        const meta = parsed?.usageMetadata ?? null;
        return {
          value: { ok: res.ok, status: res.status, data: parsed } as const,
          neverCalled: false,
          usage: meta
            ? {
                input_tokens: typeof meta.promptTokenCount === "number" ? meta.promptTokenCount : 0,
                output_tokens: geminiOutputTokens(meta),
                server_tool_use: { web_search_requests: 0 },
              }
            : null,
          stopReason: null,
          terminationReason: res.ok ? undefined : ("PROVIDER_ERROR" as const),
        };
      } catch (e) {
        const reason = (e as Error)?.name === "AbortError" ? "timeout" : "network";
        return {
          value: { ok: false, status: 0, data: null, reason } as const,
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
    console.warn(`music-generate: spend guard refused (${guarded.reason})`);
    return json(429, { error: refusalMessage(guarded.reason) });
  }

  const outcome = guarded.value;
  if (!outcome.ok) {
    console.error("music-generate upstream", outcome.status);
    // A failed attempt that may still have cost money is recorded, not
    // discarded — the ledger is for what happened, not for what worked.
    await admin.from("music_jobs").insert({
      user_id: user.id,
      prompt,
      model: MUSIC_MODEL,
      status: "failed",
      error: outcome.status ? `http ${outcome.status}` : "network",
    });
    return json(502, { error: "The music engine refused that one. Try different words." });
  }

  const data = outcome.data;
  const parts = data?.candidates?.[0]?.content?.parts;
  const audio = Array.isArray(parts)
    ? parts.find(
        (p: { inlineData?: { data?: unknown; mimeType?: unknown } }) =>
          typeof p?.inlineData?.data === "string" &&
          String(p?.inlineData?.mimeType ?? "").startsWith("audio/"),
      )?.inlineData
    : null;

  if (!audio) {
    // A refusal arrives as a 200 with no audio rather than as an error status,
    // which is exactly how a silent failure gets shipped as a feature.
    await admin.from("music_jobs").insert({
      user_id: user.id,
      prompt,
      model: MUSIC_MODEL,
      status: "failed",
      error: "no audio in response",
    });
    return json(502, { error: "No music came back for that. Try different words." });
  }

  const bytes = Uint8Array.from(atob(audio.data as string), (c) => c.charCodeAt(0));
  const mime = String(audio.mimeType);
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
  });
});
