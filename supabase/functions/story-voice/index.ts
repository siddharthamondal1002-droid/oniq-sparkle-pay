// story-voice — the narration, through the Lovable gateway.
//
// OWNER DIRECTIVE, 2026-08-14: Story generation runs through Lovable
// (ai.gateway.lovable.dev on LOVABLE_API_KEY), spending the Lovable credit
// pool — see story-still's header for the full record. Same Gemini TTS
// family underneath, addressed by gateway id.
//
// Closes the last gap in the Story pipeline. Without it a Story is a silent
// slideshow, which this project has already shipped once — Episode 1 went out
// as 4:47 of silence with all twelve mp3s generated and none of them mounted.
//
// TWO THINGS DEPEND ON THIS, not one. The obvious one is that the film has a
// voice. The other is that the MOUTHS have something to sync to: the rig needs
// measured [start, end) frames of real speech, and those can only be measured
// from audio that exists. No narration means no spans means a character who
// either never moves their mouth or never stops.
//
// RETURNS WHATEVER AUDIO THE GATEWAY RETURNS, base64 with its mime. The
// Google path answered raw 24kHz PCM; the gateway's /v1/audio/speech
// answers container bytes (wav/mp3, named in content-type). The worker
// checks the mime: PCM gets the WAV header wrapped on, containers are
// written as-is — its ffmpeg sniffs content, not extensions.

import { verifyJobToken } from "../_shared/jobToken.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Gemini's TTS through the gateway. The Google-path flash/pro two-bucket
 * dance is gone with the reroute — the gateway is one pool, so a throttle
 * here is the pool itself and no second model would dodge it. The worker's
 * own step-down (in-house Piper) is the fallback that remains, and it is
 * free.
 */
const TTS_MODEL = "google/gemini-2.5-flash-tts";

/**
 * Default narrator.
 *
 * One voice per Story, chosen by the caller and then held for every shot. A
 * voice that changes between shots reads as a different narrator, which is the
 * audio version of the character-drift problem the cast locks exist to fix.
 */
const DEFAULT_VOICE = "Charon";

const MAX_TEXT = 1200;

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
    // Matches story-still: a minute of Story is ~9 shots and each needs one
    // line read, so the two calls run at the same cadence.
    if (!_rateLimit(_subFromAuth(req), 30)) return json({ error: "slow down bestie 😅" }, 429);

    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const voice = typeof body?.voice === "string" && body.voice ? body.voice : DEFAULT_VOICE;
    if (!text) return json({ error: "Nothing to read." }, 400);
    if (text.length > MAX_TEXT) return json({ error: "That line is too long." }, 400);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        signal: ctrl.signal,
        // MEASURED FROM THE LIVE 400, not the docs: for google/*-tts the
        // gateway PASSES THROUGH Google's own body — it rejected the OpenAI
        // input/voice fields with Google's "Unknown name" error. So this is
        // the pre-reroute Gemini body verbatim, plus `model` for routing.
        // The prebuilt voice names (Charon and the cast) ride unchanged.
        body: JSON.stringify({
          model: TTS_MODEL,
          contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) return json({ configured: false }, 200);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("story-voice upstream", res.status, detail.slice(0, 300));
      // The upstream status rides in the body: the worker retries a THROTTLE
      // (429/5xx passes with time) but not a refusal, and a bare "could not
      // read" left it unable to tell the two apart — three narrations died
      // that way in one proof run while the platform's own logs were the
      // only place the 429 was written. A 502 here is also what trips the
      // worker's own step-down to the free in-house Piper voice.
      return json({ error: `Could not read that line. (upstream ${res.status})` }, 502);
    }

    // Two reply dialects, JSON first: a pass-through gateway answers in
    // Google's generateContent shape (inlineData carrying base64 PCM with
    // the rate in its mime — the worker wraps it); a normalizing one would
    // answer raw audio bytes with the mime in the header. Read whichever
    // arrived.
    let audio: { mime: string; data: string } | null = null;
    const replyType = res.headers.get("content-type") ?? "";
    if (/json/i.test(replyType)) {
      const data = await res.json().catch(() => null);
      audio = firstInlineAudio(data);
    } else {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 0) {
        audio = { mime: replyType || "audio/wav", data: b64(bytes) };
      }
    }
    if (audio) {
      // Feed the ledger the dispatcher gates on (public.api_budget).
      // SUCCESSES ONLY — a 429 consumes nothing upstream, so counting it
      // would make the ledger pessimistic and hold films back for spend
      // that never happened. Fire-and-forget: a ledger hiccup must never
      // fail a voice line that already exists.
      const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const svcUrl = Deno.env.get("SUPABASE_URL");
      if (svcKey && svcUrl) {
        fetch(`${svcUrl}/rest/v1/rpc/record_api_use`, {
          method: "POST",
          headers: {
            apikey: svcKey,
            Authorization: `Bearer ${svcKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ _bucket: "tts", _amount: 1 }),
        }).catch((e) => console.warn("story-voice ledger write failed", e));
      }
    }
    if (!audio) {
      // A refusal arrives as a 200 with no audio bytes rather than an error
      // status. Treating "ok but empty" as success is how a shot ends up with
      // a zero-length narration and the whole film's timing shifts. (The
      // Lovable agent caught the first cut of this branch logging a variable
      // the reroute had removed — a 422 that would have thrown into a 500.)
      console.error(
        "story-voice empty audio body",
        res.headers.get("content-type") ?? "no content-type",
      );
      return json({ error: "That line was refused." }, 422);
    }

    return json({ configured: true, mime: audio.mime, data: audio.data, voice });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return json({ error: "That line took too long." }, 504);
    }
    console.error("story-voice fn error", e);
    return json({ error: "Something went sideways — try again" }, 500);
  }
});

/**
 * The first inline audio part of a Google-shaped reply, if there is one.
 * The mime (e.g. "audio/L16;codec=pcm;rate=24000") carries the sample rate
 * the worker's WAV wrap needs, so it passes through un-normalized.
 */
function firstInlineAudio(data: unknown): { mime: string; data: string } | null {
  const parts = (data as { candidates?: { content?: { parts?: unknown[] } }[] })?.candidates?.[0]
    ?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inline = (part as { inlineData?: { mimeType?: string; data?: string } })?.inlineData;
    if (inline?.data && typeof inline.data === "string") {
      return { mime: inline.mimeType ?? "audio/L16;rate=24000", data: inline.data };
    }
  }
  return null;
}

/** Base64 without blowing the call stack on a multi-megabyte line. */
function b64(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

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
