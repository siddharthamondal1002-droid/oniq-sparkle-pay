// story-voice — the narration, on the same Gemini key as the plot and stills.
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
// SAME SHAPE AS story-plot AND story-still: GOOGLE_AI_API_KEY, the same auth
// gate, the same per-isolate rate limit, the same `{ configured: false }` when
// the key is missing so a Story degrades instead of erroring. One provider
// across plot, picture and voice.
//
// RETURNS RAW PCM, NOT A PLAYABLE FILE. Gemini answers with signed 16-bit
// little-endian PCM at 24 kHz and no container. The caller wraps it — see
// story-worker.mjs — because the worker already has ffmpeg and this function
// has no business inventing a WAV header. `mime` carries the rate so the caller
// never has to assume it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Gemini's TTS model. Separate from the text and image models on purpose. */
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

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

    const key = Deno.env.get("GOOGLE_AI_API_KEY");
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
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
          }),
        },
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) return json({ configured: false }, 200);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("story-voice upstream", res.status, detail.slice(0, 300));
      return json({ error: "Could not read that line." }, 502);
    }

    const data = await res.json();
    const audio = firstAudio(data);
    if (!audio) {
      // A refusal arrives as a 200 with no audio part rather than an error
      // status. Treating "ok but empty" as success is how a shot ends up with
      // a zero-length narration and the whole film's timing shifts.
      console.error("story-voice no audio part", JSON.stringify(data).slice(0, 300));
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

/** The first inline audio part, if there is one. */
function firstAudio(data: unknown): { mime: string; data: string } | null {
  const parts = (data as { candidates?: { content?: { parts?: unknown[] } }[] })?.candidates?.[0]
    ?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inline = (part as { inlineData?: { mimeType?: string; data?: string } })?.inlineData;
    if (inline?.data && typeof inline.data === "string") {
      // e.g. "audio/L16;codec=pcm;rate=24000" — the rate matters to the caller
      // wrapping this, so it is passed through rather than normalised away.
      return { mime: inline.mimeType ?? "audio/L16;rate=24000", data: inline.data };
    }
  }
  return null;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireAuth(req: Request): Promise<Response | null> {
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
