// story-still — one frame of a Story, generated in-house on the Gemini key.
//
// This closes the last hole between a plan and a film. `story-plot` returns the
// still prompts; this turns one of them into an actual image, using the SAME
// GOOGLE_AI_API_KEY that already powers Ting's primary path. No new provider,
// no new secret, and nothing routed through the Lovable gateway — so a Story
// does not draw down the credit pool that builds ONIQ.
//
// ONE IMAGE PER CALL, ON PURPOSE. The guard order this project enforces —
// admin/auth, kill switch, cap, validation, then the billable call — exists
// because a loop over an array is how a month of credits disappears in an hour.
// The caller walks the shot list and comes back per shot, so every image passes
// the rate limit individually and a runaway plan stops at the limit rather than
// at the bill.
//
// NO RETRY HERE EITHER. Same reasoning as runwayOps: a prompt that trips a
// safety filter trips it identically the second time, and retrying spends money
// to reach the same answer. A caller that wants a retry can make one, having
// seen why the first failed.
//
// THE IMAGE COMES BACK AS BASE64 AND IS NOT STORED. Storage is the caller's
// decision, because a Story's bytes are governed by storyLifecycle.ts — every
// path ends in `purged` — and a function that quietly wrote to a bucket would
// create files nothing is tracking.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Gemini's image model. Separate constant from the text model deliberately:
 * they move on different schedules and pointing image generation at a text
 * model fails with a message about modalities that reads like a bug in this
 * file rather than a wrong model name.
 */
const IMAGE_MODEL = "gemini-2.5-flash-image";

/** Portrait, matching the episode pipeline. Everything downstream assumes it. */
const ASPECT = "9:16";

const MAX_PROMPT = 2000;

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

    const key = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!key) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ error: "No prompt." }, 400);
    if (prompt.length > MAX_PROMPT) return json({ error: "That prompt is too long." }, 400);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ["IMAGE"],
              imageConfig: { aspectRatio: ASPECT },
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
      console.error("story-still upstream", res.status, detail.slice(0, 300));
      return json({ error: "Could not draw that frame." }, 502);
    }

    const data = await res.json();
    const image = firstImage(data);
    if (!image) {
      // A refusal comes back as a 200 with no image part rather than an error
      // status, so "ok but empty" has to be treated as a failure here or the
      // caller stores an undefined and finds out at assembly.
      console.error("story-still no image part", JSON.stringify(data).slice(0, 300));
      return json({ error: "That frame was refused. Try rewording the shot." }, 422);
    }

    return json({ configured: true, mime: image.mime, data: image.data });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return json({ error: "That frame took too long." }, 504);
    }
    console.error("story-still fn error", e);
    return json({ error: "Something went sideways — try again" }, 500);
  }
});

/** The first inline image in a Gemini reply, if there is one. */
function firstImage(data: unknown): { mime: string; data: string } | null {
  const parts = (data as { candidates?: { content?: { parts?: unknown[] } }[] })?.candidates?.[0]
    ?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inline = (part as { inlineData?: { mimeType?: string; data?: string } })?.inlineData;
    if (inline?.data && typeof inline.data === "string") {
      return { mime: inline.mimeType ?? "image/png", data: inline.data };
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
