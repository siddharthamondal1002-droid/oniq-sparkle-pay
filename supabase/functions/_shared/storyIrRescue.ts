/**
 * THE STORY IR RESCUE — the Director's story engine, reached at last.
 *
 * `storyModel.ts` has been complete since the 2026-08-27 local-story-intelligence
 * directive and had ZERO importers until this file: DNA retrieval, blending,
 * the prompt, the parse, the repair and the validator, all built, all tested,
 * and never run by anything a user could reach. `#4`'s module door test is
 * what named it, and this is the door.
 *
 * WHY IT GOES IN AS A RESCUE AND NOT AS THE PLANNER. `story-plot` already has
 * a ladder — batches, then a single-call Claude rescue, then a single-call
 * Gemini rescue, then a 502. Replacing the planner would stake every film on a
 * path nothing has ever run; adding a rung stakes nothing, because the case it
 * covers is the case that returns 502 today. A film that would have failed
 * either gets a validated Story IR or fails exactly as before.
 *
 * AND IT IS A GENUINELY DIFFERENT ATTEMPT, which is the only thing that makes
 * a third rung worth its latency. Rungs one and two are the same prompt on two
 * engines. This one is a different PROMPT (built from Story DNA), a different
 * SCHEMA (Story IR), a different VALIDATOR (`validateStoryIr`) and a different
 * PROVIDER. Retrying the same prompt a third time is how a ladder becomes a
 * delay.
 *
 * ============================ THE MODEL ID ============================
 *
 * "OpenAI through Lovable" — owner directive 2026-09-12. The gateway's chat
 * endpoint is OpenAI-SHAPED and vendor-NAMESPACED, so an `openai/…` id there
 * is OpenAI paid for in Lovable credits the owner already buys rather than on
 * a second metered provider bill.
 *
 * POST-VERIFIED on the gateway 2026-09-12 through `frontier-probe`, and the
 * result is the reason this constant is `gpt-5.4-mini` and not the obvious
 * `gpt-5-mini`:
 *
 *     openai/gpt-5-mini     200  13 in / 16 out   outputText ""     <- EMPTY
 *     openai/gpt-5          200  13 in / 16 out   outputText ""     <- EMPTY
 *     openai/gpt-5-nano     200  13 in / 16 out   outputText ""     <- EMPTY
 *     openai/gpt-5.4-mini   200  13 in /  5 out   outputText "ok"   <- ANSWERED
 *     gpt-5-mini            400  invalid model (the gateway namespaces by vendor)
 *     openai/gpt-4.1-mini   400  invalid model
 *     openai/o4-mini        400  invalid model
 *
 * **A 200 IS NOT AN ANSWER.** Three ids returned HTTP 200, a well-formed body,
 * a usage block — and no content, having spent the whole 16-token ceiling on
 * reasoning tokens. Reading the status alone would have written one of them in
 * here and shipped a story engine that returns empty strings; only the reply's
 * own TEXT separates them. This file's oldest rule is "a catalogue is not a
 * POST"; this is the next one along — **a POST is not a reply.**
 *
 * Stated as a limit rather than glossed: the three empty ids are UNVERIFIED,
 * not refuted. A larger ceiling may well make them answer, and the probe's
 * ceiling is fixed at 16. If a reasoning tier is ever wanted here, re-measure
 * with a real budget first — do not promote one on the strength of its 200.
 */

import { callGatewayText } from "./llm.ts";
import type { GatewayRpc } from "./gatewayLedger.ts";
import { FILM_CONTINUITY_RULES } from "./filmQuality.ts";
import type { LocalInvoke } from "./localStoryModel.ts";
import { generateStory, StoryInvalid, type StoryRequest } from "./storyModel.ts";
import { LocalModelUnavailable } from "./localStoryModel.ts";
import type { StoryIr } from "./storyIr.ts";

/** POST-verified on the Lovable gateway 2026-09-12 — see the header. */
export const GATEWAY_STORY_MODEL = "openai/gpt-5.4-mini";

/**
 * Seconds per shot, when the caller counts shots and the story engine budgets
 * seconds. `VIDEO_CLOCK_SECONDS` is the clip length every other stage already
 * assumes, so this is the existing number rather than a new one.
 */
export const RESCUE_SECONDS_PER_SHOT = 5;

/** A plan in the shape `story-plot` returns, built from a validated Story IR. */
export type RescuePlan = {
  title: string;
  logline: string;
  setting: string;
  cast: { name: string; lock: string }[];
  shots: {
    still: string;
    narration: string;
    motion?: string;
    dialogue?: { speaker: string; line: string };
  }[];
};

/**
 * A Story IR is richer than a plan, so this DROPS rather than invents. Every
 * field below is read straight off the IR; nothing is synthesised, because a
 * plan field filled in by this converter would be a sentence no model wrote
 * and no validator checked.
 */
export function planFromIr(ir: StoryIr, want: number): RescuePlan | { reason: string } {
  const shots = ir.scenes
    .flatMap((s) => s.shots)
    .map((s) => {
      const out: RescuePlan["shots"][number] = {
        still: (s.visualDescription ?? "").trim(),
        narration: (s.narration ?? "").trim(),
      };
      const motion = (s.motionDescription ?? "").trim();
      if (motion) out.motion = motion.slice(0, 400);
      const speaker = (s.dialogue?.speaker ?? "").trim();
      const line = (s.dialogue?.line ?? "").trim();
      if (speaker && line) {
        out.dialogue = { speaker: speaker.slice(0, 60), line: line.slice(0, 200) };
      }
      return out;
    })
    .filter((s) => s.still && s.narration);

  if (shots.length < want) {
    return { reason: `story-ir: ${shots.length} usable shots, wanted ${want}` };
  }

  // The world's first location is the setting a still can repeat verbatim;
  // `visualStyle` alone describes how it looks and not where it is.
  const place = ir.world.locations[0];
  const setting = [place?.name, place?.description, ir.world.visualStyle]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" — ");
  if (!ir.title || !setting) {
    return { reason: `story-ir: missing ${!ir.title ? "title" : "setting"}` };
  }

  return {
    title: ir.title,
    logline: ir.logline,
    setting,
    cast: ir.characters
      .map((c) => ({ name: (c.name ?? "").trim(), lock: (c.appearance ?? "").trim() }))
      .filter((c) => c.name && c.lock),
    shots: shots.slice(0, want),
  };
}

/** Who is paying, and for which film — supplied by the edge function, never
 *  by the client. `rpc` null ⇒ the attempt is announced as unrecorded rather
 *  than silently skipped (see gatewayLedger.ts). */
export type RescueSpend = {
  rpc: GatewayRpc | null;
  jobId?: string | null;
  userId?: string | null;
};

/**
 * The transport, and the ONE place a gateway id is named for this path.
 *
 * Returns null when `LOVABLE_API_KEY` is absent, so the caller skips the rung
 * instead of adding a failed attempt to its reasons — an "engine missing" line
 * in `tried` reads to whoever debugs it as an engine that refused.
 *
 * EVERY INVOCATION IS ITS OWN ATTEMPT. `generateStory` may call the transport
 * more than once (a repair pass on a plan that failed validation), and each of
 * those is a separate request the gateway charges for — so the request id and
 * the attempt number are minted per call, not per rescue.
 */
export function makeGatewayStoryInvoke(
  model = GATEWAY_STORY_MODEL,
  spend?: RescueSpend,
): LocalInvoke | null {
  if (!Deno.env.get("LOVABLE_API_KEY")) return null;
  let attempt = 0;
  return async (prompt: string, opts: { maxTokens: number }): Promise<string> => {
    attempt += 1;
    const res = await callGatewayText({
      system: "You are ONIQ's story engine. Reply with JSON only.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: opts.maxTokens,
      gatewayModel: model,
      timeoutMs: 60_000,
      ...(spend
        ? {
            gatewaySpend: {
              rpc: spend.rpc,
              requestId: `story-ir:${crypto.randomUUID()}`,
              jobId: spend.jobId ?? null,
              userId: spend.userId ?? null,
              attempt,
            },
          }
        : {}),
    });
    if (!res.ok) throw new LocalModelUnavailable(String(res.reason ?? "gateway refused"));
    const blocks = (res.data as { content?: { type?: string; text?: string }[] })?.content ?? [];
    const text = blocks
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    // A 200 with no text is the measured failure mode of a reasoning tier that
    // spent its whole ceiling thinking. Saying so beats handing "" to a parser
    // that will report it as bad JSON.
    if (!text.trim()) throw new LocalModelUnavailable("gateway returned an empty reply");
    return text;
  };
}

export type RescueInput = {
  idea: string;
  shots: number;
  seed: string;
  grade: "classic" | "movie";
  characters?: { name: string; description: string }[];
  pacingGuidance?: string;
  /** Accounting binding for the real caller. Absent in unit tests, which pass
   *  their own transport and never reach a gateway. */
  spend?: RescueSpend;
};

/** A plan, or WHY there is not one — the shape `story-plot`'s ladder records. */
export async function storyIrRescue(
  input: RescueInput,
  invoke?: LocalInvoke | null,
): Promise<{ plan: RescuePlan } | { reason: string }> {
  const transport = invoke ?? makeGatewayStoryInvoke(GATEWAY_STORY_MODEL, input.spend);
  if (!transport) return { reason: "story-ir: no gateway key" };


  const request: StoryRequest = {
    idea: input.idea,
    seconds: Math.max(1, input.shots) * RESCUE_SECONDS_PER_SHOT,
    grade: input.grade,
    seed: input.seed,
    ...(input.characters?.length ? { characters: input.characters } : {}),
    constraints: [
      FILM_CONTINUITY_RULES,
      ...(input.pacingGuidance ? [input.pacingGuidance] : []),
    ],
  };

  try {
    const { ir } = await generateStory(request, transport);
    const plan = planFromIr(ir, input.shots);
    return "reason" in plan ? plan : { plan };
  } catch (e) {
    if (e instanceof StoryInvalid) {
      return { reason: `story-ir: ${e.problems.map((p) => p.code).join(",")}`.slice(0, 160) };
    }
    return { reason: `story-ir: ${(e as Error).message}`.slice(0, 160) };
  }
}
