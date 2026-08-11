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
// LONG FILMS ARE WRITTEN IN TWO STAGES, and that is not an optimisation. A
// five-minute Story is 43 shots; each shot repeats the cast lock and the
// setting verbatim, so 43 of them is ~11,000 output tokens — past the model's
// cap, and minutes of generation inside a function with a wall clock. Over
// twelve shots this writes a SPINE first (title, setting, cast locks, one line
// per shot) and then expands the beats into shots in PARALLEL batches of eight,
// each handed the same lock text to repeat. See the block above parseSpine.
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

import { MOVIE_RULES, MAX_DIALOGUE_WORDS } from "../_shared/movieGrammar.ts";

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
  '  "shots": [{ "still": string, "narration": string, "motion": string,',
  '             "dialogue"?: { "speaker": string, "line": string }, "vfx"?: string }] }',
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
  MOVIE_RULES,
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

/**
 * How long ONE model attempt gets, by size of film.
 *
 * A four-shot plan came back well inside 45 seconds; a nine-shot plan timed out
 * at it. The work is roughly linear in shots — each one is a paragraph that
 * repeats the cast lock and the setting verbatim — so the budget should be too.
 *
 * Capped at 90s because an edge function has a wall clock and this is not the
 * only call inside it. This budget only ever applies to the SINGLE-CALL path,
 * which is capped at SINGLE_CALL_MAX_SHOTS — a longer film goes through the
 * spine-and-batches path instead, where no single call is ever asked to write
 * more than eight shots.
 */
function attemptBudget(shots: number): number {
  return Math.min(90_000, 30_000 + shots * 5_000);
}

/**
 * The whole function's wall clock, shared across every attempt.
 *
 * Scaling one attempt is not enough on its own: three scaled attempts in a row
 * would run to five minutes and be killed by the platform mid-flight, which
 * looks like a hang rather than a timeout. Each attempt takes the smaller of
 * its own budget and whatever is left, and an attempt with no room left is
 * skipped instead of started.
 */
const TOTAL_BUDGET_MS = 115_000;

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
    // The user's cast library, if the job carried one. Bounded hard: six
    // characters with short locks, or the reuse block crowds the plan prompt
    // out of its own token budget. Anything malformed is DROPPED, not
    // rejected — a film without reuse is still the film that was paid for.
    const reuse: { name: string; lock: string }[] = (Array.isArray(body?.reuse) ? body.reuse : [])
      .slice(0, 6)
      .map((c: unknown) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
        const lock = typeof o.lock === "string" ? o.lock.trim().slice(0, 400) : "";
        return { name, lock };
      })
      .filter((c: { name: string; lock: string }) => c.name && c.lock);
    const reuseBlock =
      reuse.length > 0
        ? `\n\nREUSE THIS EXISTING CAST. These are the user's own recurring characters; ` +
          `where the story allows, use them instead of inventing new people, keep their ` +
          `names, and repeat each lock VERBATIM in every still that shows them:\n` +
          reuse.map((c) => `- ${c.name}: ${c.lock}`).join("\n")
        : "";

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
            `Write a ${shots}-shot film from this idea:\n\n${prompt}${reuseBlock}\n\n` +
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
      // SCALED, because a fixed 45s was a budget sized for a short film and
      // silently applied to long ones. A 60-second Story is nine shots, each of
      // them a paragraph repeating the cast lock verbatim, and it timed out —
      // `{"engine":"anthropic","reason":"timeout"}` — while the four-shot film
      // before it finished comfortably. The retry did not save it either, and
      // correctly so: a retry is for a reply that arrived and would not parse,
      // and a timeout is not that.
      timeoutMs: attemptBudget(shots),
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
    // One clock for the whole function. `remaining()` is what each attempt is
    // actually allowed, so a generous first attempt cannot starve the ones
    // after it into being started with no time to finish.
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const remaining = () => deadline - Date.now();
    /** Under ten seconds left is not an attempt, it is a guaranteed timeout. */
    const roomFor = (want: number) => (remaining() > 10_000 ? Math.min(want, remaining()) : 0);

    let plan: Plan | null = null;
    let servedBy = "anthropic";
    // Every attempt records why it did not work. This travels back in the 502
    // body, because the runner's log is readable when the platform's is not —
    // when this first failed live, Supabase's log pipeline was returning empty
    // for every function and the only thing anyone had was "no usable plan".
    const tried: { engine: string; reason: string }[] = [];

    // LONG FILMS TAKE THE TWO-STAGE PATH. Below the threshold the single call
    // is proven and simpler, and simpler is worth keeping for the common case.
    if (!plan && hasClaude && shots > SINGLE_CALL_MAX_SHOTS) {
      const spineRes = await callClaude({
        system: SPINE_SYSTEM + langInstruction(lang),
        messages: [
          {
            role: "user" as const,
            content:
              `Write the skeleton of a ${shots}-shot film from this idea:\n\n${prompt}${reuseBlock}\n\n` +
              `Return exactly ${shots} beats.`,
          },
        ],
        maxTokens: Math.min(8192, 1200 + shots * 40),
        timeoutMs: roomFor(45_000),
      });

      if (!spineRes.ok) {
        tried.push({
          engine: "anthropic:spine",
          reason: String(spineRes.reason ?? "failed").slice(0, 160),
        });
      } else {
        const parsedSpine = parseSpine(textOf(spineRes.data), shots);
        if ("reason" in parsedSpine) {
          tried.push({ engine: "anthropic:spine", reason: parsedSpine.reason });
        } else {
          const spine = parsedSpine.spine;
          const locks = lockText(spine);

          // Batches run AT THE SAME TIME. Six sequential expansions would be the
          // timeout again; six concurrent ones cost one expansion of wall clock.
          const batches: { from: number; beats: string[] }[] = [];
          for (let i = 0; i < shots; i += BATCH_SHOTS) {
            batches.push({ from: i, beats: spine.beats.slice(i, i + BATCH_SHOTS) });
          }
          const batchMs = roomFor(60_000);
          const results = await Promise.all(
            batches.map(async (b) => {
              if (batchMs === 0) return { reason: "batch: no time left after the spine" };
              const res = await callClaude({
                system: BATCH_SYSTEM + langInstruction(lang),
                messages: [
                  {
                    role: "user" as const,
                    content:
                      `${locks}\n\nFILM: ${spine.title}\n\n` +
                      `Draw shots ${b.from + 1}–${b.from + b.beats.length} of ${shots}. ` +
                      `One shot per beat, in order:\n` +
                      b.beats.map((t, i) => `${b.from + i + 1}. ${t}`).join("\n"),
                  },
                ],
                maxTokens: Math.min(8192, 600 + b.beats.length * 300),
                timeoutMs: batchMs,
              });
              if (!res.ok)
                return { reason: `batch ${b.from + 1}: ${String(res.reason ?? "failed")}` };
              return parseShots(textOf(res.data), b.beats.length);
            }),
          );

          // ALL OR NOTHING. A film missing shots nine to sixteen is not a
          // shorter film, it is a broken one, and every shot downstream costs
          // money — so a gap must fail here, before any of it is spent.
          const bad = results.find((r) => "reason" in r);
          if (bad && "reason" in bad) {
            tried.push({ engine: "anthropic:batch", reason: bad.reason.slice(0, 160) });
          } else {
            const all = results.flatMap((r) => ("shots" in r ? r.shots : []));
            if (all.length !== shots) {
              tried.push({
                engine: "anthropic:batch",
                reason: `assembled ${all.length} shots, wanted ${shots}`,
              });
            } else {
              plan = {
                title: spine.title,
                logline: spine.logline,
                setting: spine.setting,
                cast: spine.cast,
                shots: all,
              };
              servedBy = `anthropic:spine+${batches.length}`;
            }
          }
        }
      }
    }

    if (!plan && hasClaude) {
      const firstMs = roomFor(attemptBudget(shots));
      const first = await callClaude({ ...opts, timeoutMs: firstMs });
      if (first.ok) {
        const r = parsePlan(textOf(first.data), shots);
        if ("plan" in r) plan = r.plan;
        else tried.push({ engine: "anthropic", reason: r.reason });
      } else {
        const why = String(first.reason ?? "failed");
        tried.push({
          engine: "anthropic",
          reason: (why === "timeout"
            ? `timeout after ${Math.round(firstMs / 1000)}s on ${shots} shots`
            : why
          ).slice(0, 160),
        });
      }

      // Second go: same request, with the failure named. Telling it what went
      // wrong beats asking again identically — a model that truncated needs to
      // be told to be terser, and one that miscounted needs the count repeated.
      const firstReason = tried.at(-1)?.reason;
      if (!plan && first.ok && firstReason) {
        const retryMs = roomFor(attemptBudget(shots));
        const retry =
          retryMs === 0
            ? ({ ok: false, reason: "no time left after the first attempt" } as const)
            : await callClaude({
                ...opts,
                timeoutMs: retryMs,
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
      const geminiMs = roomFor(25_000);
      const g =
        geminiMs === 0
          ? ({ ok: false, reason: "no time left after Claude" } as const)
          : await callGemini({ ...opts, timeoutMs: geminiMs });
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
      return json({ error: "Ting could not write that one — try again.", shots, tried }, 502);
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

type Shot = {
  still: string;
  narration: string;
  /** What MOVES — camera + subject movement. Never re-describes the frame. */
  motion?: string;
  /** Optional spoken line, lip-synced by the video model's native audio. */
  dialogue?: { speaker: string; line: string };
  /** Optional atmosphere/effect cue. */
  vfx?: string;
};
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
// --- long films: a spine, then shots written in parallel batches ------------
//
// A FIVE-MINUTE STORY IS 43 SHOTS AND WILL NOT FIT IN ONE CALL. Each shot is a
// paragraph that repeats the cast lock and the setting verbatim — that
// repetition IS the anti-drift mechanism — so 43 of them is roughly 11,000
// output tokens, past the 8,192 cap, and minutes of generation inside an edge
// function with a wall clock. Raising the timeout does not fix that. It moves
// the failure.
//
// A long film is therefore written in two stages:
//
//   1. THE SPINE, once: title, logline, setting, cast locks, and a one-line
//      beat per shot. Beats are short, so 43 of them fit comfortably.
//   2. THE SHOTS, in parallel batches of eight, each batch handed the SAME
//      locked setting and cast text and told to repeat it word for word.
//
// Parallel is what makes it fit. Six batches at once cost one batch of wall
// clock, not six; sequential expansion would be the timeout again with extra
// steps.
//
// THIS IS NOT THE BATCHING THE COST RULES FORBID. That rule is about billable
// media — a loop over an array of images is how a month of credits disappears
// in an hour. This is the PLANNING call. Its fan-out is bounded by the shot
// count, the shot count is bounded by requested_seconds, and the quota has
// already taken payment for those seconds. The image and voice calls
// downstream remain strictly one per shot, sequential, unchanged.
//
// THE LOCKS ARE PASSED IN, NOT RE-INVENTED. A batch that wrote its own
// description would give you a different girl in shots nine to sixteen — the
// exact failure the lock mechanism exists to prevent, and invisible until
// somebody watched the film.

/** The spine prompt: everything except the shots themselves. */
const SPINE_SYSTEM = [
  "You are Ting 🔮, ONIQ's built-in assistant, working as a story editor for ONIQ Lores.",
  "You turn one line from a user into the SKELETON of a short animated film.",
  "",
  "Return ONLY a JSON object. No prose, no markdown fence, no commentary.",
  "",
  "Shape:",
  '{ "title": string, "logline": string, "setting": string,',
  '  "cast": [{ "name": string, "lock": string }],',
  '  "beats": [string] }',
  "",
  "RULES:",
  "1. Return EXACTLY the number of beats asked for. Not more, not fewer.",
  "2. A beat is ONE SHORT LINE saying what happens in that shot. Ten words is",
  "   plenty. Do not describe the frame — that comes later.",
  "3. `lock` is a verbatim physical description — age, build, hair, clothing,",
  "   colours — detailed enough that repeating it produces the same person every",
  "   time. Nothing carries between image generations, so this text IS the",
  "   character.",
  "4. `setting` is locked the same way: place, time of day, weather, palette.",
  "5. The beats must tell one story with a beginning, a turn and an ending.",
  "",
  "CONTENT RULES, non-negotiable, carried from the Arabian Nights season:",
  "no prophets, no divine figures, no scripture; no real living people; no",
  "named brands or copyrighted characters; violence implied, never depicted;",
  "nothing sexual. If the user's idea requires any of these, write the nearest",
  "story that does not, and say so in `logline`.",
].join("\n");

/** The expansion prompt: turn beats into shots, repeating the locks verbatim. */
const BATCH_SYSTEM = [
  "You are Ting 🔮, working as a storyboard artist for ONIQ Lores.",
  "You turn story beats into shootable frames.",
  "",
  "Return ONLY a JSON object. No prose, no markdown fence, no commentary.",
  "",
  'Shape: { "shots": [{ "still": string, "narration": string, "motion": string,',
  '           "dialogue"?: { "speaker": string, "line": string }, "vfx"?: string }] }',
  "",
  "RULES:",
  "1. Return EXACTLY one shot per beat, in the same order.",
  "2. Every `still` that shows a character MUST repeat that character's lock",
  "   word for word, and MUST repeat the setting. You are given both. Do not",
  "   paraphrase them and do not invent your own — other batches are drawing the",
  "   same film from the same text, and any difference becomes a different",
  "   person or a different place on screen.",
  "3. `still` describes what the FRAME IS — a static image. No camera moves, no",
  "   'then', no cuts. One moment.",
  "4. `narration` is one or two spoken sentences. Write numbers as words. It is",
  "   read aloud by a voice, not displayed.",
  "5. Say the shot size at the start of each `still`: establishing, wide, medium",
  "   or close. Vary them.",
  "",
  MOVIE_RULES,
  "",
  "CONTENT RULES: no prophets, no divine figures, no scripture; no real living",
  "people; no named brands or copyrighted characters; violence implied, never",
  "depicted; nothing sexual.",
].join("\n");

/** Above this many shots, one call stops being realistic. Below it, the proven path. */
const SINGLE_CALL_MAX_SHOTS = 12;

/** Shots per expansion batch. Eight is ~2,100 tokens — comfortable, not tight. */
const BATCH_SHOTS = 8;

type Spine = {
  title: string;
  logline: string;
  setting: string;
  cast: { name: string; lock: string }[];
  beats: string[];
};

/** The JSON object in a reply, or why there wasn't one. */
function jsonIn(text: string, what: string): { obj: Record<string, unknown> } | { reason: string } {
  if (!text) return { reason: `${what}: empty reply` };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0) return { reason: `${what}: no JSON in ${text.length} chars` };
  if (end <= start)
    return { reason: `${what}: unterminated JSON, truncated at ${text.length} chars` };
  try {
    const raw = JSON.parse(text.slice(start, end + 1));
    if (typeof raw !== "object" || raw === null)
      return { reason: `${what}: JSON was not an object` };
    return { obj: raw as Record<string, unknown> };
  } catch (e) {
    return { reason: `${what}: bad JSON: ${(e as Error).message.slice(0, 60)}` };
  }
}

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function parseSpine(text: string, shots: number): { spine: Spine } | { reason: string } {
  const got = jsonIn(text, "spine");
  if ("reason" in got) return got;
  const p = got.obj;
  const title = trimmed(p.title);
  const setting = trimmed(p.setting);
  if (!title || !setting) return { reason: `spine: missing ${!title ? "title" : "setting"}` };
  const cast = (Array.isArray(p.cast) ? p.cast : [])
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { name: trimmed(o.name), lock: trimmed(o.lock) };
    })
    .filter((c) => c.name && c.lock);
  const beats = (Array.isArray(p.beats) ? p.beats : []).map(trimmed).filter(Boolean);
  // Extra beats are trimmed, same rule as extra shots. Too few is a shorter
  // film than was paid for, and inventing the rest here is the second-planner
  // problem again.
  if (beats.length < shots) return { reason: `spine: ${beats.length} beats, wanted ${shots}` };
  return {
    spine: { title, logline: trimmed(p.logline), setting, cast, beats: beats.slice(0, shots) },
  };
}

/**
 * The movie fields, read leniently. `motion`/`dialogue`/`vfx` are ADDITIVE —
 * a model that omits them has still produced a renderable film (the current
 * renderer only consumes still+narration), so their absence must never reject
 * a shot the way a missing still does. Dialogue is bounded here because a
 * ten-second clip truncates a speech mid-word, and it is cheaper to trim at
 * the plan than to discover it in the render.
 */
function movieFields(o: Record<string, unknown>): Pick<Shot, "motion" | "dialogue" | "vfx"> {
  const out: Pick<Shot, "motion" | "dialogue" | "vfx"> = {};
  const motion = trimmed(o.motion);
  if (motion) out.motion = motion.slice(0, 400);
  const vfx = trimmed(o.vfx);
  if (vfx) out.vfx = vfx.slice(0, 200);
  const d = (o.dialogue ?? null) as { speaker?: unknown; line?: unknown } | null;
  if (d && typeof d === "object") {
    const speaker = trimmed(d.speaker);
    let line = trimmed(d.line);
    if (speaker && line) {
      const words = line.split(/\s+/);
      if (words.length > MAX_DIALOGUE_WORDS) line = words.slice(0, MAX_DIALOGUE_WORDS).join(" ");
      out.dialogue = { speaker: speaker.slice(0, 60), line: line.slice(0, 200) };
    }
  }
  return out;
}

function parseShots(text: string, want: number): { shots: Shot[] } | { reason: string } {
  const got = jsonIn(text, "batch");
  if ("reason" in got) return got;
  const shots = (Array.isArray(got.obj.shots) ? got.obj.shots : [])
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { still: trimmed(o.still), narration: trimmed(o.narration), ...movieFields(o) };
    })
    .filter((s) => s.still && s.narration);
  if (shots.length < want) return { reason: `batch: ${shots.length} shots, wanted ${want}` };
  return { shots: shots.slice(0, want) };
}

/** The cast and setting, written out for a batch to copy verbatim. */
function lockText(spine: Spine): string {
  const cast = spine.cast.map((c) => `- ${c.name}: ${c.lock}`).join("\n");
  return `SETTING (repeat verbatim in every still):\n${spine.setting}\n\nCAST (repeat the matching lock verbatim in every still that shows them):\n${cast || "- (no recurring characters)"}`;
}

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
      return { still: str(o.still), narration: str(o.narration), ...movieFields(o) };
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
