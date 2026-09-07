// voice-clone — speaking in YOUR OWN voice, on Vertex AI.
//
// OWNER DIRECTIVE 2026-09-05: asked how "a song in my own voice" should work,
// the owner answered "Use vertex api through firebase". This is that, wired.
//
// WHAT WAS ACTUALLY WRONG, because it was not what four probes said it was.
// `_shared/voiceReplication.ts` has been complete since 2026-09-04 — the
// consent scripts, the WAV rules, both request bodies, the key reader, the
// expiry rule, all unit-tested. And NO DEPLOYED FUNCTION IMPORTED IT. A grep
// for it across supabase/functions returned nothing, and `voice-generate` can
// only ask for `prebuiltVoiceConfig.voiceName` — a fixed Google voice. So the
// feature was not blocked on Google at all for the last step: built and
// unit-tested is not reachable, and the missing piece was ours. This file is
// the piece.
//
// THE PROBE THAT KEPT GETTING RUN WAS THE WRONG VERB. Every measurement of
// this blocker was a GET of .../locations/global/voices — a LIST. Minting is a
// POST to the same path, and it needs a different permission. This repo's own
// first rule is "verify by POST, not by ListModels: a catalogue says what
// exists, only a POST says what this key may call", and the voice work spent
// days ignoring it. `create` below is the first POST anyone has made.
//
// ADMIN-ONLY FOR NOW, DELIBERATELY. Vertex replication spends the METERED
// GOOGLE KEY, not Lovable credits — the one account CLAUDE.md says an agent
// must never route spend onto uninvited. Who may mint, how many a day and at
// what price are the owner's to set, so until they do, the gate is is_admin
// and the caps below are a floor rather than a policy. Opening it to users is
// a one-line change to the gate AND a decision that has to be asked for.
//
// THE CONSENT RECORDING IS THE PRODUCT SAFETY CONTROL, not a formality.
// Google matches it against the script word for word, which is what stops
// this being a tool for cloning somebody who never agreed. ONIQ refuses the
// five languages whose scripts arrived corrupted (voiceReplication.ts records
// which characters and why) rather than sending a sentence that cannot match.
//
// NOTHING IS LOGGED THAT COULD RECONSTRUCT A VOICE. Not the recordings, not
// their base64, not the minted key. Errors carry Google's own message, which
// is the difference between a fixable answer and a shrug — the lesson the
// weather build paid for — but the payloads never appear.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";
import { vertexErrorDetail } from "../_shared/vertexError.ts";
import { googleAccessToken, vertexHeaders } from "../_shared/googleAuth.ts";
import { needsWavHeader, rateOf, validateVoiceText, wrapPcmAsWav } from "../_shared/voiceCore.ts";
import {
  audioBytesOf,
  consentScript,
  CONSENT_SCRIPTS_WITHHELD,
  keyExpired,
  oneStepSpeechBody,
  prebuiltSpeechBody,
  PROBE_CONTROL_VOICE,
  PROBE_TEXT,
  readReplicationKey,
  replicatedSpeechBody,
  replicatedSynthesisUrl,
  replicationKeyBody,
  REPLICATION_MODEL,
  speechVerdict,
  syntheticSineWav,
  validateReplicationAudio,
  voicesUrl,
} from "../_shared/voiceReplication.ts";

const BUCKET = "video-gen";

/** Well inside the function timeout, and generous for a 30s upload. */
const CALL_TIMEOUT_MS = 120_000;

/**
 * A 30-second 24kHz 16-bit mono WAV is ~1.44 MB, ~1.92 MB as base64. Four
 * megabytes leaves room for a header-heavy file and refuses anything that
 * could only be an attempt to exhaust memory. The cap is checked on the
 * BASE64 length, before decoding — a limit applied after the allocation is
 * not a limit.
 */
const MAX_B64 = 4 * 1024 * 1024;

/** Floors, not policy — see the header. Both count rows over a rolling 24h. */
const MINTS_PER_USER_PER_DAY = 3;
const MINTS_PER_HOUSE_PER_DAY = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Decode base64 to bytes without letting a huge string through first. */
function decodeAudio(b64: string): Uint8Array | null {
  if (typeof b64 !== "string" || b64.length === 0 || b64.length > MAX_B64) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Base64 without blowing the call stack on a multi-megabyte clip. */
function b64Of(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/**
 * POST to Vertex and keep whatever it says, refusal included.
 *
 * Google's own words travel back to the caller. A bare status cannot tell a
 * missing IAM role from an allowlist refusal from a disabled API, and all
 * three arrive as 403.
 */
async function vertexPost(
  url: string,
  token: string,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; detail: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: vertexHeaders(token, projectId),
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Vertex answers some wrong-path requests with an HTML page. Say so
      // rather than pretending it was JSON.
      return { ok: false, status: res.status, detail: `non-json: ${text.slice(0, 200)}` };
    }
    // The shape is read by _shared/vertexError.ts, which knows about the JSON
    // ARRAY wrapper this endpoint uses and, failing every known shape, hands
    // back the raw body. Reading `parsed.error` inline here is what turned the
    // first real 404 into "http 404" — see that file's header.
    const node = Array.isArray(parsed) ? parsed[0] : parsed;
    const err = (node as { error?: unknown } | null | undefined)?.error;
    if (!res.ok || err) {
      return { ok: false, status: res.status, detail: vertexErrorDetail(parsed, text, res.status) };
    }
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, status: 0, detail: `fetch failed: ${(e as Error).message}`.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "Sign in to use your own voice" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // THE CALLER IS RE-DERIVED, NEVER READ FROM THE BODY. Every row below is
  // keyed to this id and there is no user field in the request, so a caller
  // cannot mint against, list or delete somebody else's voice by naming them.
  const { data: userRes } = await asCaller.auth.getUser();
  const user = userRes?.user;
  if (!user) return json(401, { error: "Sign in to use your own voice" });

  let body: {
    action?: string;
    id?: string;
    label?: string;
    language?: string;
    text?: string;
    /** WAV bytes, base64, no data: prefix. Never logged. */
    sample?: string;
    consent?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const action = typeof body.action === "string" ? body.action : "";

  // ---- free, no gate: the sentence a person has to read ---------------------
  // Handing back the script cannot spend anything and is needed BEFORE a
  // recording exists, so it sits above every gate below.
  if (action === "script") {
    const lang = typeof body.language === "string" ? body.language.trim() : "";
    if (!lang) return json(400, { error: "Which language?" });
    const script = consentScript(lang);
    if (!script) {
      // Naming the reason matters: this is not "unsupported language", it is
      // ONIQ refusing to hand over a sentence it knows cannot match.
      return json(400, {
        error: "ONIQ doesn't have a verified consent sentence for that language yet.",
        withheld: CONSENT_SCRIPTS_WITHHELD,
      });
    }
    return json(200, { language: lang, script });
  }

  // ---- free: what this person already has ----------------------------------
  if (action === "list") {
    const { data, error } = await admin
      .from("voice_clones")
      .select("id, label, language, expires_at, created_at")
      .eq("user_id", user.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return json(500, { error: "Couldn't read your voices" });
    const rows = (data ?? []) as { id: string; expires_at: string }[];
    return json(200, {
      voices: rows.map((r) => ({ ...r, expired: keyExpired(r.expires_at) })),
    });
  }

  // ---- free, and ABOVE the gates on purpose --------------------------------
  // Someone at their cap must still be able to remove a voice. Below the
  // gates this would read as "you are out of mints, so you may not tidy up",
  // which is the same mistake the creations delete avoided on 2026-09-06.
  //
  // MARKS AND DESTROYS THE KEY, never a hard DELETE: the row is the cap
  // ledger, and the counts below do not filter on status. Nulling voice_key
  // is the part that matters for the person — the credential really goes.
  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return json(400, { error: "Which voice?" });
    const { data: mine, error: readErr } = await admin
      .from("voice_clones")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) return json(500, { error: "Couldn't remove that voice" });
    // "Not yours" and "not there" answer identically so the endpoint cannot
    // be used to probe ids.
    if (!mine) return json(404, { error: "That voice is not there" });
    const { error: markErr } = await admin
      .from("voice_clones")
      .update({ status: "deleted", voice_key: null })
      .eq("id", id)
      .eq("user_id", user.id);
    if (markErr) return json(500, { error: "Couldn't remove that voice" });
    return json(200, { deleted: id });
  }

  // ---- everything past here can spend the owner's metered key --------------
  const { data: isAdmin } = await admin.rpc("is_admin", { _uid: user.id });
  if (isAdmin !== true) {
    return json(403, { error: "Voice replication isn't open yet." });
  }

  const auth = await googleAccessToken();
  if (!auth.ok) {
    // Names the missing SECRET, never a value — googleAuth guarantees that.
    return json(503, { error: "Voice replication is not configured", reason: auth.reason });
  }
  const projectId = auth.projectId;
  if (!projectId) return json(503, { error: "Voice replication has no Google project" });

  // ---- does Vertex let this credential MINT? -------------------------------
  // THE MEASUREMENT THE VOICE WORK KEPT MISSING, and it costs nothing. Every
  // earlier probe was a GET of this same path — a LIST — refused as
  // "aiplatform.voices.list denied". Minting is a POST and needs a different
  // permission, so a list refusal never said anything about it.
  //
  // THE BODY IS DELIBERATELY EMPTY. Google validates the request before doing
  // any work, so nothing is modelled, nothing is stored and nothing is billed
  // — and the answer is WHICH error comes back:
  //
  //   400 INVALID_ARGUMENT   AUTHORIZED. The call cleared every gate and only
  //                          the payload was missing, which is the one thing
  //                          a real mint supplies.
  //   403 PERMISSION_DENIED  still shut. A missing IAM role, an allowlist
  //                          refusal and a disabled API all wear this, and
  //                          only the TEXT separates them — so it travels back
  //                          verbatim rather than as a boolean.
  //
  // Same shape as check-firebase-blockers.mjs sending a deliberately too-short
  // password instead of creating an account: a diagnostic that mutates what it
  // measures is not a diagnostic.
  if (action === "probe") {
    const probed = await vertexPost(voicesUrl(projectId), auth.token, projectId, {});

    // ---- and can it SPEAK at all? A control, then the one-step experiment --
    // 2026-09-07: this exact pair went through the Lovable agent (2.3 credits)
    // and both legs answered 403 aiplatform.endpoints.predict — proof only that
    // the service account had no Vertex AI role. It lives here now so a tap
    // re-measures for free. The control is the leg that can bill (a few paise
    // of synthesised speech when it succeeds) and the one that makes the
    // replicated leg readable at all; the sample is a sine wave built in
    // memory, so no recording of anyone exists on this path. Admin-only, like
    // everything below the gate.
    const speechUrl = replicatedSynthesisUrl(projectId);
    const sample = b64Of(syntheticSineWav());
    const control = await vertexPost(
      speechUrl,
      auth.token,
      projectId,
      prebuiltSpeechBody(PROBE_TEXT, PROBE_CONTROL_VOICE),
    );
    const replicated = await vertexPost(
      speechUrl,
      auth.token,
      projectId,
      oneStepSpeechBody(PROBE_TEXT, sample),
    );
    const leg = (r: Awaited<ReturnType<typeof vertexPost>>) =>
      r.ok
        ? { status: 200, audioBase64Chars: audioBytesOf(r.data) }
        : { status: r.status, detail: r.detail };

    return json(200, {
      project: projectId,
      url: voicesUrl(projectId),
      authMode: auth.mode,
      status: probed.ok ? 200 : probed.status,
      detail: probed.ok ? null : probed.detail,
      verdict: probed.ok
        ? "minting is open"
        : probed.status === 400
          ? "AUTHORIZED — the call cleared every gate; only the payload was missing"
          : probed.status === 403
            ? "STILL SHUT — read the detail; an IAM role, an allowlist and a disabled API all give 403"
            : `UNEXPECTED ${probed.status} — read the detail`,
      speech: {
        url: speechUrl,
        model: REPLICATION_MODEL,
        sample: "synthetic 220 Hz sine, 3 s, 24 kHz mono 16-bit — never a real voice",
        control: leg(control),
        replicated: leg(replicated),
        verdict: speechVerdict(control, replicated),
      },
    });
  }

  // ---- speak in a voice already minted -------------------------------------
  if (action === "speak") {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return json(400, { error: "Which voice?" });
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const textErr = validateVoiceText(text);
    if (textErr) return json(400, { error: textErr });

    const { data: row, error: readErr } = await admin
      .from("voice_clones")
      .select("voice_key, language, expires_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "ready")
      .maybeSingle();
    if (readErr) return json(500, { error: "Couldn't read that voice" });
    if (!row) return json(404, { error: "That voice is not there" });

    const clone = row as { voice_key: string | null; language: string; expires_at: string };
    // A KEY LIVES SEVEN DAYS AND GOOGLE KEEPS NO COPY (`store: false`), so an
    // expired one cannot be refreshed — it has to be minted again from a new
    // recording. Saying that is the whole point of checking here: Vertex's own
    // failure on a stale key names nothing the person can act on.
    if (!clone.voice_key || keyExpired(clone.expires_at)) {
      return json(410, { error: "That voice has expired. Record it again to use it." });
    }

    const spoke = await vertexPost(
      replicatedSynthesisUrl(projectId),
      auth.token,
      projectId,
      replicatedSpeechBody(text, clone.voice_key, clone.language),
    );
    if (!spoke.ok) {
      console.error("voice-clone speak", spoke.status, spoke.detail);
      return json(502, { error: "That voice couldn't speak just now.", detail: spoke.detail });
    }

    const part = (
      spoke.data as {
        candidates?: {
          content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
        }[];
      }
    )?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data)?.inlineData;
    if (!part?.data) {
      // A refusal arrives as a 200 with no audio rather than as an error
      // status, which is exactly how a silent failure ships as a feature.
      return json(502, { error: "Nothing came back for that. Try again." });
    }

    // Headerless PCM needs a container before a browser can play it, and the
    // rate is never guessed: an unstated one fails rather than shipping audio
    // at the wrong speed, which reads as a strange voice rather than a bug.
    let bytes = decodeAudio(part.data);
    if (!bytes) return json(502, { error: "That clip came back unreadable." });
    let mime = part.mimeType ?? "audio/wav";
    if (needsWavHeader(mime)) {
      const rate = rateOf(mime);
      if (rate === null) return json(502, { error: "That clip came back unplayable." });
      bytes = wrapPcmAsWav(bytes, rate);
      mime = "audio/wav";
    }

    // Under the person's own folder, so the bucket's existing own-folder read
    // policy scopes it and no new storage policy is invented for this.
    const path = `${user.id}/voice/${crypto.randomUUID()}.wav`;
    const up = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (up.error) {
      console.error("voice-clone storage", up.error.message);
      return json(500, { error: "The clip was made but could not be saved." });
    }
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    return json(200, { id, url: signed?.signedUrl ?? null, mime, bytes: bytes.byteLength });
  }

  // ---- mint a voice --------------------------------------------------------
  if (action !== "create") return json(400, { error: "Unknown action" });

  const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
  if (!label) return json(400, { error: "Give the voice a name" });
  const language = typeof body.language === "string" ? body.language.trim() : "";
  if (!language) return json(400, { error: "Which language?" });
  if (!consentScript(language)) {
    return json(400, {
      error: "ONIQ doesn't have a verified consent sentence for that language yet.",
      withheld: CONSENT_SCRIPTS_WITHHELD,
    });
  }

  // BOTH RECORDINGS ARE CHECKED BEFORE THE BILLABLE CALL. A wrong sample rate
  // is a refusal Google would charge for finding, and every message here names
  // the fix — "Invalid audio" tells somebody holding a phone nothing.
  const sample = decodeAudio(body.sample ?? "");
  if (!sample) return json(400, { error: "Send the voice sample as a WAV recording." });
  const consent = decodeAudio(body.consent ?? "");
  if (!consent) return json(400, { error: "Send the consent recording as a WAV recording." });

  const sampleBad = validateReplicationAudio(sample, "source");
  if (sampleBad) return json(400, { error: sampleBad });
  const consentBad = validateReplicationAudio(consent, "consent");
  if (consentBad) return json(400, { error: consentBad });

  // ---- caps, counted the way every other generate function counts ----------
  // Rows over a rolling 24h, NOT filtered on status — a deleted row still
  // cost money, and filtering it out is precisely what would let a delete
  // loop reset the cap.
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const { count: mine } = await admin
    .from("voice_clones")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if ((mine ?? 0) >= MINTS_PER_USER_PER_DAY) {
    return json(429, { error: "That's all the voices you can make today." });
  }
  const { count: house } = await admin
    .from("voice_clones")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if ((house ?? 0) >= MINTS_PER_HOUSE_PER_DAY) {
    return json(429, { error: "Voice replication is busy today. Try tomorrow." });
  }

  const minted = await vertexPost(
    voicesUrl(projectId),
    auth.token,
    projectId,
    replicationKeyBody(
      { mimeType: "audio/wav", data: b64Of(sample) },
      { mimeType: "audio/wav", data: b64Of(consent) },
    ),
  );
  if (!minted.ok) {
    // GOOGLE'S OWN WORDS, PASSED THROUGH. This is the first POST anyone has
    // made to this endpoint, so whatever comes back is the measurement the
    // voice work has been missing — a missing IAM role, an allowlist refusal
    // and a disabled API all arrive as 403 and only the text separates them.
    console.error("voice-clone mint", minted.status, minted.detail);
    return json(502, { error: "Google would not model that voice.", detail: minted.detail });
  }

  const key = readReplicationKey(minted.data);
  if (!key) {
    return json(502, { error: "Google returned no voice key.", detail: "no key in response" });
  }

  const { data: row, error: insErr } = await admin
    .from("voice_clones")
    .insert({
      user_id: user.id,
      label,
      language,
      voice_key: key.key,
      expires_at: key.expiresAt,
      status: "ready",
    })
    .select("id, created_at")
    .maybeSingle();
  if (insErr) {
    // The mint SPENT. Saying so is better than a silent 500 that looks free.
    console.error("voice-clone insert", insErr.message);
    return json(500, { error: "Your voice was modelled but could not be saved." });
  }

  return json(200, {
    id: (row as { id?: string } | null)?.id ?? null,
    label,
    language,
    model: REPLICATION_MODEL,
    expiresAt: key.expiresAt,
  });
});
