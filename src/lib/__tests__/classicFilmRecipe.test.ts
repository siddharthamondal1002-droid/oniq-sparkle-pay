/**
 * THE CLASSIC FILM RECIPE, PINNED TO THE CODE IT DESCRIBES.
 *
 * Owner directive 2026-09-12: "Learn, record and use it exactly for making
 * videos." The recipe lives in
 * .claude/skills/oniq-video/references/classic-film-recipe.md and was taken
 * from one measured run (job a2c0788b, story worker run 166).
 *
 * A recipe is only worth having while it is still true. Three of its claims
 * are facts about code that someone could change without ever opening the
 * document, so they are asserted here rather than trusted:
 *
 *   the still provider default   the recipe says 9 GATEWAY stills
 *   the MOTION_STAGE=off line    the recipe tells you to grep for it
 *   the fallback reason          the recipe says 9 of these means it worked
 *
 * Comments are STRIPPED before reading source, because story-worker.mjs and
 * motionRuntime.ts both explain these strings in prose beside them — the
 * prose-match trap this repo has hit fourteen times. Comments are stripped
 * and STRINGS ARE KEPT, because the strings are the subject here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "@/test/sourceText";
import { DEFAULT_STILL_PROVIDER } from "../../../supabase/functions/_shared/stillRoute.ts";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const RECIPE = ".claude/skills/oniq-video/references/classic-film-recipe.md";

/**
 * Read the recipe as CONTENT, never as layout.
 *
 * The first draft of this file asserted a sentence that markdown had wrapped
 * across two lines, and went red against a document that says exactly the
 * right thing. That is the lesson this repo already carries from
 * marketingCopy.ts and the quantum doc table: where a test reads a document,
 * it must read what the document SAYS, not how it is set. Every whitespace
 * run collapses to one space so a reflow, a re-indent or a Prettier pass
 * cannot fail an assertion about meaning.
 */
const recipeText = () => read(RECIPE).replace(/\s+/g, " ");

describe("the classic film recipe still matches the code", () => {
  it("is where the skill says it is", () => {
    const skill = read(".claude/skills/oniq-video/SKILL.md");
    expect(skill).toContain("references/classic-film-recipe.md");
    expect(read(RECIPE).length).toBeGreaterThan(1000);
  });

  it("names the still provider the pipeline actually defaults to", () => {
    // The whole recipe rests on this: STILL_PROVIDER is not passed by the
    // workflow, so the default decides who draws. Flip it to in_house and the
    // recipe's "9 gateway stills" — and its entire cost section — is wrong.
    expect(DEFAULT_STILL_PROVIDER).toBe("gateway");
    expect(recipeText()).toContain(`DEFAULT_STILL_PROVIDER = "${DEFAULT_STILL_PROVIDER}"`);
  });

  it("quotes a log line the worker still emits", () => {
    // Asserted as the two concatenated HALVES, never as the joined sentence:
    // story-worker.mjs builds this line with a `+` across two source lines, so
    // a toContain() of the whole sentence would fail against correct code.
    const worker = stripComments(read("remotion/scripts/story-worker.mjs"));
    const halves = [
      "MOTION_STAGE=off MOTION_PROVIDER=none MOTION_ENGINE=none",
      "stills and camera only (STORY_MOVIE unset)",
    ];
    for (const half of halves) {
      expect(worker).toContain(half);
      expect(recipeText()).toContain(half);
    }
  });

  it("quotes the fallback reason that proves the path ran", () => {
    const runtime = stripComments(read("src/lib/motionRuntime.ts"));
    const reason = "no motion provider enabled (owner-gated)";
    expect(runtime).toContain(reason);
    expect(recipeText()).toContain(reason);
  });

  it("does not claim the GPU or a video model produced the film", () => {
    // The run this recipe came from was named INTERNAL MOTION TEST and used
    // neither. If a future edit reintroduces that claim, the recipe stops
    // being a record of what happened.
    const recipe = recipeText();
    expect(recipe).toMatch(/No generated video anywhere/i);
    expect(recipe).not.toMatch(/\bVeo (produced|generated|rendered|animated)\b/i);
  });
});
