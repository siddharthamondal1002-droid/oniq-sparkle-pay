// story-plot — Ting writes the film. Lores video is powered by Ting AI.
//
// A user types one sentence. This turns it into the thing the in-house
// generator actually needs: a plot, a locked setting, and one still prompt plus
// one narration line per shot.
//
// SAME METHOD AS EVERY OTHER AI FEATURE HERE, through the shared _shared/llm.ts
// helpers: the same auth gate, the same per-isolate rate limit, the same
// `{ configured: false }` when no key is present so a missing secret degrades
// instead of erroring.
//
// GEMINI FIRST, ANTHROPIC SECOND. `callGemini` on gemini-2.5-flash with
// GOOGLE_AI_API_KEY, falling back to Claude only when Gemini is unavailable or
// returns something unusable. Both go through the shared helper, which already
// translates Gemini's response into Anthropic's shape — so the parser below is
// written once and does not care which model answered.
//
// A plan is structured JSON with a fixed shot count, not prose, which is the
// cheap end of what either model does well. Spending the expensive model on it
// by default would be paying for judgement this task does not need.
//
// WHY THE PLOT IS A SERVER CALL AND NOT A PROMPT SENT STRAIGHT TO A GENERATOR.
// Episode 3 proved the shape: a shot list with locked characters and locked
// props is what keeps sixty shots looking like one film. A user's one-line
// prompt has neither, so something has to invent them ONCE and then repeat them
// verbatim in every shot. That is a language job, and Ting is the language
// model this app already runs.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO.
//
// It does not generate images. Nothing in ONIQ generates images today — the
// Episode 3 stills came from the Lovable agent out of band, and there is no
// in-app image generator to reuse. This returns the PROMPTS an image generator
// would need, so the moment one exists the plan already fits it.
//
// It does not decide how many shots. `planStory()` owns that, from the
// requested duration, and the count is passed in. A second shot planner living
// in a system prompt would drift from the first one and nobody would notice
// until a Story came back the wrong length.
import { callGemini, callClaude, langInstruction } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * The house rules, and most of them are scar tissue from Episode 3.
 *
 * The cast/prop lock instruction is the important one. Nothing carries between
 * image generations, so a character described only by role comes back as a
 * different person every shot — a bearded adult in three and a chibi child in
 * the fourth. The fix is a verbatim description repeated in every prompt, and
 * the model writing the plan is the only thing positioned to write it once.
 */
const SYSTEM = [
  "You are Ting 🔮, ONIQ's built-in assistant, working as a story editor for ONIQ Lores.",
  "You turn one line from a user into a shootable plan for a short animated film.",
  "",
  "Return ONLY a JSON object. No prose, no markdown fence, no commentary.",
  "",
  "Shape:",
  '{ "title": string, "logline": string, "setting": string,',
  '  "cast": [{ "name": string, "lock": string }],',
  '  "shots": [{ "still": string, "narration": string }] }',
  "",
  "RULES THAT MATTER:",
  "1. Return EXACTLY the number of shots asked for. Not more, not fewer.",
  "2. `lock` is a verbatim physical description — age, build, hair, clothing,",
  "   colours. Nothing carries between image generations, so a character",
  "   described only by their role comes back as a different person in every",
  "   shot. Every `still` that shows a character must repeat that character's",
  "   lock word for word.",
  "3. `setting` is locked the same way: time of day, weather, palette. Repeat it",
  "   in every `still`.",
  "4. `still` describes what the FRAME IS — a static image. No camera moves, no",
  "   'then', no cuts. One moment.",
  "5. `narration` is one or two spoken sentences for that shot. Write numbers as",
  "   words. It will be read aloud by a voice, not displayed.",
  "6. Vary the shot sizes across the film: establishing, wide, medium, close.",
  "   Say the size at the start of each `still`.",
  "",
  "CONTENT RULES, non-negotiable, carried from the Arabian Nights season:",
  "no prophets, no divine figures, no scripture; no real living people; no",
  "named brands or copyrighted characters; violence implied, never depicted;",
  "nothing sexual. If the user's idea requires any of these, write the nearest",
  "story that does not, and say so in `logline`.",
].join("\n");

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

/** Bounds on what a caller may ask for, so one request cannot become a novel. */
const MAX_PROMPT = 2000;
const MAX_SHOTS = 90;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authFail = await requireAuth(req);
    if (authFail) return authFail;
    // Tighter than Ting's ten a minute: a plot call is the front of a pipeline
    // that spends real money behind it, and nobody needs four films a minute.
    if (!_rateLimit(_subFromAuth(req), 4)) return json({ error: "slow down bestie 😅" }, 429);

    const hasGemini = Boolean(Deno.env.get("GOOGLE_AI_API_KEY"));
    const hasClaude = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
    if (!hasGemini && !hasClaude) return json({ configured: false }, 200);

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const shots = Number(body?.shots);
    const lang = typeof body?.lang === "string" ? body.lang : "en";

    if (!prompt) return json({ error: "Tell me what happens in your story." }, 400);
    if (prompt.length > MAX_PROMPT) return json({ error: "That prompt is too long." }, 400);
    if (!Number.isInteger(shots) || shots < 1 || shots > MAX_SHOTS) {
      return json({ error: "Bad shot count." }, 400);
    }

    const opts = {
      system: SYSTEM + langInstruction(lang),
      messages: [
        {
          role: "user" as const,
          content:
            `Write a ${shots}-shot film from this idea:\n\n${prompt}\n\n` +
            `Return exactly ${shots} shots.`,
        },
      ],
      // Roughly 160 tokens a shot plus the header. A plan truncated mid-JSON
      // parses as a failure rather than as a short film.
      maxTokens: Math.min(8192, 900 + shots * 160),
      // A long plan is slower than a chat reply and the default 12s cuts a
      // 40-shot film off mid-sentence.
      timeoutMs: 45000,
    };

    // Gemini first. Claude only if Gemini is not configured, errored, or came
    // back with something parsePlan rejects — a miscounted plan from the cheap
    // model is worth one retry on the expensive one, because everything
    // downstream of here costs real money.
    let plan: Plan | null = null;
    let servedBy = "gemini";

    if (hasGemini) {
      const g = await callGemini(opts);
      if (g.ok) plan = parsePlan(textOf(g.data), shots);
      else console.warn("story-plot gemini", g.reason);
    }

    if (!plan && hasClaude) {
      servedBy = "anthropic";
      const c = await callClaude(opts);
      if (c.ok) plan = parsePlan(textOf(c.data), shots);
      else console.warn("story-plot anthropic", c.reason);
    }

    if (!plan) {
      // A malformed plan must not reach the pipeline: every downstream stage
      // costs money and a half-built plan spends it on a film that cannot
      // finish. Fail here, where nothing has been generated yet.
      console.error("story-plot produced no usable plan");
      return json({ error: "Ting could not write that one — try again." }, 502);
    }

    return json({ configured: true, plan, servedBy });
  } catch (e) {
    console.error("story-plot fn error", e);
    return json({ error: "Something went sideways — try again" }, 500);
  }
});

/** The text blocks of an Anthropic-shaped reply, joined. Gemini answers arrive
 *  in this shape too — _shared/llm.ts translates them — so one reader serves
 *  both and neither path gets its own parsing bug. */
function textOf(data: unknown): string {
  const blocks = (data as { content?: unknown })?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b: { type?: string }) => b?.type === "text")
    .map((b: { text?: string }) => b.text ?? "")
    .join("");
}

type Shot = { still: string; narration: string };
type Plan = {
  title: string;
  logline: string;
  setting: string;
  cast: { name: string; lock: string }[];
  shots: Shot[];
};

/**
 * Parse and VALIDATE, in that order.
 *
 * The model is told to return bare JSON and mostly does, but a stray fence or a
 * sentence of preamble is the commonest failure, so the object is located
 * rather than assumed to start at character zero.
 *
 * The shot count is enforced here rather than trusted. `planStory` allocated a
 * duration across exactly this many shots; a plan with one fewer leaves a hole
 * in the timeline, and one more silently drops the ending.
 */
function parsePlan(text: string, shots: number): Plan | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const title = str(p.title);
  const setting = str(p.setting);
  if (!title || !setting) return null;

  const castRaw = Array.isArray(p.cast) ? p.cast : [];
  const cast = castRaw
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { name: str(o.name), lock: str(o.lock) };
    })
    .filter((c) => c.name && c.lock);

  const shotsRaw = Array.isArray(p.shots) ? p.shots : [];
  const parsed: Shot[] = shotsRaw
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { still: str(o.still), narration: str(o.narration) };
    })
    .filter((s) => s.still && s.narration);

  if (parsed.length !== shots) return null;

  return { title, logline: str(p.logline), setting, cast, shots: parsed };
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
