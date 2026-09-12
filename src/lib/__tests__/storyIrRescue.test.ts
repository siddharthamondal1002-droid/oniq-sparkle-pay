/**
 * THE STORY IR ENGINE HAS A CALLER, AND THIS PINS THE THREE THINGS THAT MAKE
 * IT ONE.
 *
 * `storyModel.ts` — DNA retrieval, blend, prompt, parse, repair, validator —
 * was complete and unit-tested from the 2026-08-27 directive and imported by
 * NOTHING until `story-plot` grew a third rung. So the assertions here are
 * about reachability and shape, not about story quality:
 *
 *   1. the converter drops rather than invents,
 *   2. the rung runs where the answer today is a 502, never before it,
 *   3. the model id is the one a POST proved emits TEXT.
 *
 * Comments are stripped before every source read: the rescue module's header
 * quotes all seven probed ids to explain which answered, so a raw grep would
 * find `openai/gpt-5-mini` in the paragraph saying not to use it. Fifteenth
 * prose match in this repo.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "../../test/sourceText.ts";

const FN = resolve(__dirname, "../../../supabase/functions");
const rescueSrc = () => stripComments(readFileSync(`${FN}/_shared/storyIrRescue.ts`, "utf8"));
const plotSrc = () => stripComments(readFileSync(`${FN}/story-plot/index.ts`, "utf8"));

/**
 * THE SPECIFIER IS A VARIABLE ON PURPOSE — the 2026-09-11 lesson, verbatim.
 * A literal import would pull `storyIrRescue.ts` and through it `llm.ts` into
 * the browser program's typecheck, where their `Deno.` references are three
 * `tsc` errors. Measured: `tsc --noEmit` went red the moment this file used a
 * literal, and clean the moment it stopped.
 */
const RESCUE = "../../../supabase/functions/_shared/storyIrRescue.ts";
type PlanShot = {
  still: string;
  narration: string;
  motion?: string;
  dialogue?: { speaker: string; line: string };
};
type Plan = {
  title: string;
  logline: string;
  setting: string;
  cast: { name: string; lock: string }[];
  shots: PlanShot[];
};
type Rescue = { planFromIr: (ir: Ir, want: number) => Plan | { reason: string } };
const rescue = (): Promise<Rescue> => import(/* @vite-ignore */ RESCUE) as Promise<Rescue>;

/** The Story IR shape this converter reads, structurally — see RESCUE above. */
type Ir = {
  title: string;
  logline: string;
  world: { locations: { id: string; name: string; description: string }[]; visualStyle: string };
  characters: { id: string; name: string; appearance: string }[];
  scenes: {
    shots: {
      visualDescription: string;
      motionDescription: string;
      narration?: string;
      dialogue?: { speaker: string; line: string };
    }[];
  }[];
  [k: string]: unknown;
};

function ir(over: Partial<Ir> = {}): Ir {
  return {
    title: "The Keeper",
    logline: "A lighthouse keeper meets the sea.",
    genre: "drama",
    tone: "quiet",
    theme: "duty",
    targetDurationSeconds: 10,
    characters: [
      {
        id: "c1",
        name: "Mira",
        appearance: "tall, grey coat",
        personality: "",
        goal: "",
        fear: "",
        contradiction: "",
      },
      {
        id: "c2",
        name: "",
        appearance: "nameless",
        personality: "",
        goal: "",
        fear: "",
        contradiction: "",
      },
    ],
    world: {
      locations: [{ id: "l1", name: "The lighthouse", description: "salt-bleached stone" }],
      visualStyle: "cold blues",
    },
    acts: [],
    scenes: [
      {
        id: "s1",
        purpose: "",
        conflict: "",
        shots: [
          {
            id: "sh1",
            visualDescription: "Mira on the gallery",
            motionDescription: "slow push in",
            cameraDescription: "wide",
            characters: ["c1"],
            locationId: "l1",
            durationSeconds: 5,
            narration: "The light turned.",
            dialogue: { speaker: "Mira", line: "Not tonight." },
          },
          {
            id: "sh2",
            visualDescription: "The lamp room",
            motionDescription: "",
            cameraDescription: "close",
            characters: [],
            locationId: "l1",
            durationSeconds: 5,
            narration: "Glass and brass.",
          },
        ],
      },
    ],
    dnaSources: [],
    ...over,
  } as Ir;
}

describe("planFromIr drops rather than invents", () => {
  it("maps every field off the IR and nothing else", async () => {
    const { planFromIr } = await rescue();
    const out = planFromIr(ir(), 2);
    expect("reason" in out).toBe(false);
    if ("reason" in out) return;
    expect(out.title).toBe("The Keeper");
    expect(out.setting).toBe("The lighthouse — salt-bleached stone — cold blues");
    // A character with no name, or no appearance to lock, is dropped — a cast
    // entry invented here would be a lock no model ever wrote.
    expect(out.cast).toEqual([{ name: "Mira", lock: "tall, grey coat" }]);
    expect(out.shots[0]).toEqual({
      still: "Mira on the gallery",
      narration: "The light turned.",
      motion: "slow push in",
      dialogue: { speaker: "Mira", line: "Not tonight." },
    });
    // Empty motion is ABSENT, never an empty string: the movie fields are
    // additive downstream and "" would read as a motion cue that says nothing.
    expect(out.shots[1]).toEqual({ still: "The lamp room", narration: "Glass and brass." });
  });

  it("refuses rather than padding when the IR is short", async () => {
    const { planFromIr } = await rescue();
    const out = planFromIr(ir(), 5);
    expect("reason" in out && out.reason).toMatch(/2 usable shots, wanted 5/);
  });

  it("a shot missing its still or its narration is not a shot", async () => {
    const { planFromIr } = await rescue();
    const bare = ir();
    bare.scenes[0].shots[1].narration = "";
    expect("reason" in planFromIr(bare, 2)).toBe(true);
  });

  it("refuses without a setting, because a still must repeat one verbatim", async () => {
    const { planFromIr } = await rescue();
    const out = planFromIr(ir({ world: { locations: [], visualStyle: "" } }), 2);
    expect("reason" in out && out.reason).toMatch(/missing setting/);
  });
});

describe("the rung is reachable, and it is the last one", () => {
  it("story-plot imports the rescue", () => {
    expect(plotSrc()).toContain('from "../_shared/storyIrRescue.ts"');
  });

  it("it runs BEFORE the 502 and only when no plan was produced", () => {
    const src = plotSrc();
    const rung = src.indexOf("storyIrRescue({");
    const giveUp = src.indexOf("Ting could not write that one");
    expect(rung).toBeGreaterThan(-1);
    expect(giveUp).toBeGreaterThan(rung);
    // The guard, not merely its presence: a rung that ran unconditionally
    // would spend a third engine on every film that already had a plan.
    const before = src.slice(0, rung);
    expect(before.slice(-120)).toContain("if (!plan && shots <= SINGLE_CALL_MAX_SHOTS) {");
  });

  it("a failure records a reason instead of throwing the request away", () => {
    const src = plotSrc();
    const window = src.slice(src.indexOf("storyIrRescue({"));
    expect(window.slice(0, 600)).toContain('tried.push({ engine: "story-ir"');
  });
});

describe("the model id is the one that answered", () => {
  it("names the POST-verified id and not a sibling that returned empty", () => {
    const src = rescueSrc();
    expect(src).toContain('GATEWAY_STORY_MODEL = "openai/gpt-5.4-mini"');
    // Measured 2026-09-12: these three answered 200 with an EMPTY body, having
    // spent the whole ceiling on reasoning tokens. A 200 is not an answer.
    for (const empty of ["openai/gpt-5-mini", "openai/gpt-5-nano"]) {
      expect(src).not.toContain(empty);
    }
  });

  it("the id reaches the gateway as its OWN field, never as the Anthropic one", () => {
    const src = rescueSrc();
    expect(src).toContain("gatewayModel: model");
    expect(src).not.toMatch(/\bmodel: model\b/);
  });

  it("an empty reply is reported as one, not handed to a JSON parser", () => {
    expect(rescueSrc()).toContain("gateway returned an empty reply");
  });

  it("no key means the rung is skipped, not that an engine refused", () => {
    expect(rescueSrc()).toContain('if (!Deno.env.get("LOVABLE_API_KEY")) return null;');
  });
});
