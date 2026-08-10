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
// CLAUDE WRITES THIS. Claude Opus 5 is Ting's engine everywhere else in ONIQ,
// and the plot is the one step where that judgement actually shows: it decides
// the cast, the locks and the shot list that every later stage repeats
// verbatim. So Claude gets TWO goes — the second one told what was wrong with
// the first — before anything else is asked. Gemini is the last resort, for a
// missing key or an Anthropic outage, not a second opinion.
//
// The retry is only for a reply that arrived and would not parse. An error is
// not retried: a 401 or a quota refusal fails identically the second time and
// spends 45 seconds of the user's wait to reach the same answer, which is the
// same no-retry reasoning runwayOps applies to billable calls.
//
// Both engines go through the shared helper, which translates Gemini's response
// into Anthropic's shape, so the parser below is written once and does not care
// which model answered.
//
// This was Gemini-first for a while. It was cheaper, and a plan is structured
// JSON rather than prose, so the cheap end looked like enough. It is the wrong
// trade here: everything downstream of the plan costs real money per shot, and
// a weaker cast lock is not a cheaper film — it is a film that has to be made
// twice.
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
import { verifyJobToken } from "../_shared/jobToken.ts";

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
      // 260 a shot, not 160. Rule 2 of the system prompt makes every `still`
      // repeat its character's lock VERBATIM and rule 3 does the same for the
      // setting — that is the whole anti-drift mechanism, and it means a shot
      // is a paragraph, not a line. The old budget was sized as if a shot were
      // a sentence, and a plan truncated mid-JSON parses as a failure rather
      // than as a short film, so being wrong here is silently expensive: the
      // user is charged and gets nothing.
      maxTokens: Math.min(8192, 1200 + shots * 260),
      // A long plan is slower than a chat reply and the default 12s cuts a
      // 40-shot film off mid-sentence. Budgeted so the worst case — Claude,
      // Claude again, then Gemini — still lands inside the edge function's
      // wall clock: 45 + 35 + 25 is 105 seconds, not 135.
      timeoutMs: 45000,
    };

    // THIS IS TING WRITING THE FILM, so Claude gets two goes before anything
    // else is asked.
    //
    // Claude Opus 5 is Ting's engine everywhere else in ONIQ, and the plot is
    // the step where that matters most: it fixes the cast, the locks and the
    // shot list that every later stage repeats verbatim. One attempt then a
    // hand-off to a different model made "Claude-first" true only on paper —
    // a single malformed reply was enough to have the film written by
    // something else.
    //
    // THE SECOND GO IS ONLY FOR A PARSE FAILURE, never for an error. A 401 or a
    // quota refusal fails identically the second time and burns 45 seconds of
    // the user's wait to reach the same answer — the same no-retry reasoning
    // runwayOps uses for billable calls. A reply that arrived but came back
    // malformed is the opposite case: it is worth one corrective ask, because
    // everything downstream of this plan costs real money per shot.
    let plan: Plan | null = null;
    let servedBy = "anthropic";
    // Every attempt records why it did not work. This travels back in the 502
    // body, because the runner's log is readable when the platform's is not —
    // when this first failed live, Supabase's log pipeline was returning empty
    // for every function and the only thing anyone had was "no usable plan".
    const tried: { engine: string; reason: string }[] = [];

    if (hasClaude) {
      const first = await callClaude(opts);
      if (first.ok) {
        const r = parsePlan(textOf(first.data), shots);
        if ("plan" in r) plan = r.plan;
        else tried.push({ engine: "anthropic", reason: r.reason });
      } else {
        tried.push({ engine: "anthropic", reason: String(first.reason ?? "failed").slice(0, 160) });
      }

      // Second go: same request, with the failure named. Telling it what went
      // wrong beats asking again identically — a model that truncated needs to
      // be told to be terser, and one that miscounted needs the count repeated.
      const firstReason = tried.at(-1)?.reason;
      if (!plan && first.ok && firstReason) {
        const retry = await callClaude({
          ...opts,
          timeoutMs: 35000,
          messages: [
            ...opts.messages,
            {
              role: "assistant" as const,
              content: "I returned a plan that could not be used.",
            },
            {
              role: "user" as const,
              content:
                `That reply was rejected: ${firstReason}.\n` +
                `Return ONLY the JSON object, with exactly ${shots} shots. ` +
                `Keep every 'still' under sixty words while still repeating the ` +
                `character lock and the setting.`,
            },
          ],
        });
        if (retry.ok) {
          const r = parsePlan(textOf(retry.data), shots);
          if ("plan" in r) {
            plan = r.plan;
            servedBy = "anthropic:retry";
          } else {
            tried.push({ engine: "anthropic:retry", reason: r.reason });
          }
        } else {
          tried.push({
            engine: "anthropic:retry",
            reason: String(retry.reason ?? "failed").slice(0, 160),
          });
        }
      }
    }

    // Gemini is the last resort, not the second opinion. It runs only when
    // Claude has had both goes, or has no key at all.
    if (!plan && hasGemini) {
      servedBy = "gemini";
      const g = await callGemini({ ...opts, timeoutMs: 25000 });
      if (g.ok) {
        const r = parsePlan(textOf(g.data), shots);
        if ("plan" in r) plan = r.plan;
        else tried.push({ engine: "gemini", reason: r.reason });
      } else {
        tried.push({ engine: "gemini", reason: String(g.reason ?? "failed").slice(0, 160) });
      }
    }

    if (!plan) {
      // A malformed plan must not reach the pipeline: every downstream stage
      // costs money and a half-built plan spends it on a film that cannot
      // finish. Fail here, where nothing has been generated yet.
      console.error("story-plot produced no usable plan", JSON.stringify(tried));
      return json(
        { error: "Ting could not write that one — try again.", shots, tried },
        502,
      );
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
/**
 * A parse either yields a plan or SAYS WHY IT DID NOT.
 *
 * It used to return null four different ways. When the first live Story failed
 * here, "no usable plan" was all anyone had, Supabase's log pipeline was
 * returning empty for every function, and there was no way to tell a truncated
 * reply from a miscounted one — two problems with opposite fixes. A reason
 * string costs nothing and travels back to the runner's log, which is readable
 * even when the platform's is not.
 */
type ParseResult = { plan: Plan } | { reason: string };

function parsePlan(text: string, shots: number): ParseResult {
  if (!text) return { reason: "empty reply" };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  // A reply with an opening brace and no closing one is the signature of
  // max_tokens truncation, which is a budget problem, not a prompt problem.
  if (start < 0) return { reason: `no JSON object in ${text.length} chars` };
  if (end <= start) return { reason: `unterminated JSON — truncated at ${text.length} chars` };

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return { reason: `bad JSON: ${(e as Error).message.slice(0, 80)}` };
  }
  if (typeof raw !== "object" || raw === null) return { reason: "JSON was not an object" };
  const p = raw as Record<string, unknown>;

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const title = str(p.title);
  const setting = str(p.setting);
  if (!title || !setting) {
    return { reason: `missing ${!title ? "title" : "setting"}` };
  }

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

  // EXTRA SHOTS ARE TRIMMED, NOT REFUSED.
  //
  // The old rule was "exactly N or nothing", and nothing meant a user who had
  // already been charged got a refund instead of a film. A model that returns
  // five usable shots when asked for four has not failed at anything the user
  // cares about — the finished length comes from measured narration anyway, not
  // from the shot count. Taking the first four is strictly better than throwing
  // the whole plan away.
  //
  // TOO FEW still fails. Half a plan is a different film from the one that was
  // paid for, and padding it would mean inventing shots here, which is exactly
  // the second-planner problem this file exists to avoid.
  if (parsed.length < shots) {
    return { reason: `got ${parsed.length} usable shots, wanted ${shots}` };
  }
  const kept = parsed.slice(0, shots);

  return { plan: { title, logline: str(p.logline), setting, cast, shots: kept } };
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
