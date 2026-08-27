/**
 * The local story model — ONIQ's own, or nothing.
 *
 * Owner directive 2026-08-27 (local story intelligence). This module is
 * the SEAM the model plugs into, and the whole point of its shape is what
 * it does NOT contain: there is no provider, no key, no base URL and no
 * fallback anywhere in it. If the local model is unavailable, story
 * generation FAILS — it does not quietly become someone else's API call.
 *
 * WHAT IS AND IS NOT DONE. Everything around the model is implemented and
 * tested: the brief, the prompt the model is given, the parse, the repair
 * of the shapes a small model most often gets slightly wrong, and the
 * refusal when it cannot. The model itself is NOT here: no open-weight
 * checkpoint is baked into ONIQ's worker image today, and the honest
 * consequence is that `generateStoryIr` throws LocalModelUnavailable
 * until one is. Directive section 28: implement everything that does not
 * depend on the missing model, then name exactly what is missing — never
 * substitute a provider to make the path look finished.
 */

import type { StoryBrief } from "./storyDna.ts";
import { budgetFor, type StoryIr } from "./storyIr.ts";

export class LocalModelUnavailable extends Error {}
export class StoryModelRefused extends Error {}

/**
 * The exact thing that is missing, in the form a build needs it.
 *
 * Sized from what the worker already carries, not from a wish: the A5000
 * has 24GB and LTX peaked at 15.9GB on the measured 2026-08-27 job, so a
 * story model must either fit the remainder or — the architecture the
 * directive asks for — run in its own stage and be unloaded before LTX
 * loads. Staged execution is why a 7-8B class checkpoint at 4-bit is the
 * target rather than something that must share the card.
 */
export const REQUIRED_LOCAL_MODEL = {
  /** Where the worker would load it from, exactly like the LTX snapshot. */
  modelDir: "/app/models/story",
  /** Baked at build time and loaded local_files_only, same as LTX. */
  bakedAtBuild: true,
  /** Runs alone: loaded, used, unloaded, before any image or video stage. */
  stagedExecution: true,
  vramBudgetGb: 8,
  /** What the checkpoint must be able to do, not which vendor made it. */
  requirements: [
    "open weights, license permitting commercial use",
    "instruction-following, structured JSON output",
    "context window >= 8k tokens (brief + budget + schema + output)",
    "7-8B class at 4-bit, or smaller — it must not need the whole card",
  ],
} as const;

/** The transport a worker op provides. The ONLY way tokens are produced. */
export type LocalInvoke = (prompt: string, opts: { maxTokens: number }) => Promise<string>;

/**
 * The prompt: a brief, a budget, and a schema. No few-shot story text,
 * deliberately — showing a model a finished story is how a library that
 * must never be reproduced gets reproduced.
 */
export function buildStoryPrompt(brief: StoryBrief): string {
  const budget = budgetFor(brief.seconds);
  return [
    "You are ONIQ's story engine. Write ONE original story as JSON.",
    "",
    "THE IDEA (the user's own words, honour them):",
    brief.idea,
    "",
    "STRUCTURAL DNA — recombine these, never reproduce any source:",
    `genre: ${brief.genre}`,
    `core engine: ${brief.coreEngine}`,
    `protagonist need: ${brief.protagonistNeed}`,
    `central twist: ${brief.centralTwist}`,
    `ending family: ${brief.endingFamily}`,
    `structure: ${brief.structure}`,
    `pacing: ${brief.pacing}`,
    "",
    "HOUSE RULES:",
    brief.policy.generation_rule,
    brief.policy.character_engine,
    brief.policy.setting_engine,
    "",
    "BUDGET — write to it, do not exceed it:",
    `total ${budget.targetSeconds}s, ${budget.scenes} scenes, ${budget.shots} shots`,
    `each shot ${4}s, at most ${budget.wordsPerShot} spoken words`,
    "",
    "Every shot needs visualDescription (what the frame IS),",
    "motionDescription (what MOVES: camera and movement only, never a",
    "re-description of the frame) and cameraDescription.",
    "Characters are referenced by id everywhere after they are defined.",
    "Do not assign any character an ethnicity, gender, nationality or",
    "occupation the idea did not ask for.",
    "",
    "Reply with JSON only, matching the StoryIr schema.",
  ].join("\n");
}

/** Pull the JSON object out of a model's reply, fenced or not. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new StoryModelRefused("the model returned no JSON object");
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (err) {
    throw new StoryModelRefused(
      `the model returned invalid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Fill in what a small model reliably omits, and NOTHING creative.
 *
 * Ids, the durations that follow from the shot clock, and the provenance
 * the retrieval stage already knows — never a missing visual, a missing
 * motion or a missing line, because inventing those would hide exactly
 * the failure the validator exists to catch.
 */
export function repairStoryIr(parsed: unknown, brief: StoryBrief): StoryIr {
  if (!parsed || typeof parsed !== "object") {
    throw new StoryModelRefused("the model did not return an object");
  }
  const ir = parsed as StoryIr;
  ir.targetDurationSeconds ||= brief.seconds;
  ir.genre ||= brief.genre;
  ir.dnaSources = brief.sources;
  ir.characters = (ir.characters ?? []).map((c, i) => ({
    ...c,
    id: c.id?.trim() || `char-${i + 1}`,
  }));
  ir.scenes = (ir.scenes ?? []).map((scene, si) => ({
    ...scene,
    id: scene.id?.trim() || `scene-${si + 1}`,
    shots: (scene.shots ?? []).map((shot, shi) => ({
      ...shot,
      id: shot.id?.trim() || `scene-${si + 1}-shot-${shi + 1}`,
      durationSeconds: shot.durationSeconds > 0 ? shot.durationSeconds : 4,
    })),
  }));
  return ir;
}

/**
 * Generate the Story IR on ONIQ's own model.
 *
 * `invoke` is the local transport. There is no default and no fallback:
 * omit it and this throws, which is the correct outcome while no
 * checkpoint is baked. It is never a reason to call a provider.
 */
export async function generateStoryIr(brief: StoryBrief, invoke?: LocalInvoke): Promise<StoryIr> {
  if (!invoke) {
    throw new LocalModelUnavailable(
      "no local story model is available; story generation is unavailable — " +
        `bake a checkpoint into ${REQUIRED_LOCAL_MODEL.modelDir} on the worker`,
    );
  }
  const raw = await invoke(buildStoryPrompt(brief), { maxTokens: 8192 });
  return repairStoryIr(extractJson(raw), brief);
}
