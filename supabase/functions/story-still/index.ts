// story-still — one frame of a Story, generated through the Lovable gateway.
//
// OWNER DIRECTIVE, 2026-08-14: Story generation runs through Lovable
// (ai.gateway.lovable.dev on LOVABLE_API_KEY), spending the Lovable credit
// pool — reversing the 2026-08-09 engineering call that routed it onto the
// metered Google key without asking. Provider and payment-source choices
// are the owner's; this one is now made and recorded.
//
// `story-plot` returns the still prompts; this turns one of them into an
// actual image. The worker's contract is unchanged: { configured, mime,
// data } with base64 bytes, refusals as 422 with the upstream's why.
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

import { verifyJobToken } from "../_shared/jobToken.ts";

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
/** Same underlying model as before the reroute, addressed by gateway id. */
const IMAGE_MODEL = "google/gemini-2.5-flash-image";

/**
 * Portrait, matching the episode pipeline. The gateway's OpenRouter-shaped
 * request has no imageConfig, so the aspect rides IN THE PROMPT and the
 * composition's objectFit: cover crops any drift rather than breaking.
 * KNOWN REGRESSION, accepted with the reroute: the Google-path 2K
 * imageSize field has no gateway equivalent, so stills return at the
 * model's default resolution until the gateway grows a size control.
 */
const ASPECT_SUFFIX = "\n\nVertical 9:16 portrait composition, full-bleed.";

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

    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return json({ error: "No prompt." }, 400);
    if (prompt.length > MAX_PROMPT) return json({ error: "That prompt is too long." }, 400);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: IMAGE_MODEL,
          messages: [{ role: "user", content: prompt + ASPECT_SUFFIX }],
          modalities: ["image", "text"],
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) return json({ configured: false }, 200);
    // The pool itself running dry is ITS OWN failure, named plainly: the
    // worker's log must say "credits", not "the model refused the frame".
    if (res.status === 402 || res.status === 429) {
      const detail = await res.text().catch(() => "");
      console.error("story-still gateway limit", res.status, detail.slice(0, 200));
      return json({ error: "Image credits exhausted or rate limited — try again later." }, 502);
    }
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
      // caller stores an undefined and finds out at assembly. The WHY rides
      // in the body: the worker retries refused frames down a ladder of
      // safer prompts, and a bare "refused" left it (and the runner log)
      // guessing whether the trigger was the wording, the safety filter or
      // the prompt being blocked outright.
      const d = data as {
        choices?: { finish_reason?: string; message?: { content?: string } }[];
      };
      const why = [
        d?.choices?.[0]?.finish_reason,
        (d?.choices?.[0]?.message?.content ?? "").slice(0, 120),
      ]
        .filter(Boolean)
        .join("/");
      console.error("story-still no image part", why, JSON.stringify(data).slice(0, 300));
      return json(
        { error: `That frame was refused (${why || "no image part"}). Try rewording the shot.` },
        422,
      );
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

/**
 * The first image in a gateway reply, if there is one. The gateway answers
 * in the OpenRouter image shape: choices[0].message.images[].image_url.url
 * carrying a data: URI. Returned SPLIT into { mime, data } so the caller's
 * contract — raw base64, mime alongside — survives the reroute untouched.
 */
function firstImage(data: unknown): { mime: string; data: string } | null {
  const images = (
    data as { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[] }
  )?.choices?.[0]?.message?.images;
  if (!Array.isArray(images)) return null;
  for (const img of images) {
    const url = img?.image_url?.url;
    if (typeof url !== "string") continue;
    const m = url.match(/^data:([^;]+);base64,(.+)$/s);
    if (m) return { mime: m[1] || "image/png", data: m[2] };
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
