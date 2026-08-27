// The local story model seam — and the fallback that must not exist.
//
// Owner directive 2026-08-27 (local story intelligence): if local story
// generation fails, it FAILS. It does not become someone else's API call.
// The sharpest test here is the last one: the module's source may not
// name a provider at all.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LocalModelUnavailable,
  REQUIRED_LOCAL_MODEL,
  StoryModelRefused,
  buildStoryPrompt,
  extractJson,
  generateStoryIr,
  repairStoryIr,
} from "../../../supabase/functions/_shared/localStoryModel.ts";
import { briefFor } from "../../../supabase/functions/_shared/storyDna.ts";
import { validateStoryIr } from "../../../supabase/functions/_shared/storyIr.ts";

const SRC = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/localStoryModel.ts"),
  "utf8",
);

const BRIEF = briefFor("a haunted lighthouse keeper", 12, "seed-1");

describe("with no local model, story generation fails — it does not outsource", () => {
  it("throws LocalModelUnavailable and names what is missing", async () => {
    await expect(generateStoryIr(BRIEF)).rejects.toThrow(LocalModelUnavailable);
    await expect(generateStoryIr(BRIEF)).rejects.toThrow(/\/app\/models\/story/);
  });

  it("the module names no provider, no key and no base URL", () => {
    const flat = SRC.toLowerCase();
    for (const forbidden of [
      "anthropic",
      "openai",
      "gemini",
      "googleapis",
      "generativelanguage",
      "lovable",
      "replicate",
      "api_key",
      "apikey",
      "https://",
    ]) {
      expect(flat, forbidden).not.toContain(forbidden);
    }
  });

  it("carries the owner's approval with the facts it was conditional on", () => {
    // Owner directive 2026-08-27: approved conditionally, subject to the
    // licence verification and the transformers compatibility build. The
    // recommendation is recorded with the facts that decided it, so the
    // approval can be re-checked rather than remembered.
    const rec = REQUIRED_LOCAL_MODEL.recommended;
    expect(rec.approved).toBe(true);
    expect(rec.license).toBe("Apache-2.0");
    expect(rec.contextTokens).toBeGreaterThanOrEqual(8192);
    expect(rec.vramGbAt4Bit).toBeLessThanOrEqual(REQUIRED_LOCAL_MODEL.vramBudgetGb);
    // The integration cost stays recorded: it is the version the worker
    // must carry, and the build gate that proves it keys off this number.
    expect(rec.requiresTransformers).toMatch(/4\.51/);
  });

  it("approval does not make the engine live", () => {
    // The sharp edge of the flag above. `approved` records a DECISION; it
    // is not a runtime switch, and nothing may read it as one. Owner
    // directive 2026-08-27: "Do not declare the local Story LLM live
    // until the model has actually generated a Story IR locally." So the
    // seam must behave identically either side of approval — it does,
    // because no code path consults the flag at all.
    expect(REQUIRED_LOCAL_MODEL.recommended.approved).toBe(true);
    const consulted = SRC.split("\n").filter(
      (line) => /\bapproved\b/.test(line) && !/^\s*(\*|\/\*|\/\/)/.test(line),
    );
    // The only non-comment mention is the field's own declaration.
    expect(consulted).toEqual(["    approved: true,"]);
  });

  it("still refuses to generate, approved or not, without a real model", async () => {
    await expect(generateStoryIr(BRIEF)).rejects.toThrow(LocalModelUnavailable);
  });

  it("records the checkpoint requirement as a build input, not a wish", () => {
    expect(REQUIRED_LOCAL_MODEL.bakedAtBuild).toBe(true);
    expect(REQUIRED_LOCAL_MODEL.stagedExecution).toBe(true);
    // Sized against the measured LTX peak on the 24GB card.
    expect(REQUIRED_LOCAL_MODEL.vramBudgetGb).toBeLessThanOrEqual(8);
    expect(REQUIRED_LOCAL_MODEL.requirements.join(" ")).toMatch(/open weights/i);
  });
});

describe("the prompt carries the brief, the budget and the rules", () => {
  it("includes the user's own idea and the recombination rule", () => {
    const prompt = buildStoryPrompt(BRIEF);
    expect(prompt).toContain("haunted lighthouse keeper");
    expect(prompt).toMatch(/do not reproduce/i);
    expect(prompt).toMatch(/never infer identity|did not ask for/i);
  });

  it("shows the model no finished story to copy", () => {
    // Few-shot story text is how a library that must never be reproduced
    // gets reproduced.
    const prompt = buildStoryPrompt(BRIEF);
    expect(prompt).not.toMatch(/example story|for example:|here is a story/i);
  });

  it("states the budget the story must be written to", () => {
    expect(buildStoryPrompt(BRIEF)).toMatch(/total 12s, \d+ scenes, \d+ shots/);
  });
});

describe("what comes back is parsed strictly and repaired narrowly", () => {
  it("reads JSON whether fenced or bare", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('prose then {"a":2} after')).toEqual({ a: 2 });
  });

  it("refuses a reply with no JSON, or broken JSON", () => {
    expect(() => extractJson("no json here")).toThrow(StoryModelRefused);
    expect(() => extractJson("{ not json }")).toThrow(StoryModelRefused);
  });

  it("fills ids and the shot clock, and nothing creative", () => {
    const ir = repairStoryIr(
      {
        title: "T",
        scenes: [{ id: "", shots: [{ id: "", visualDescription: "x" }] }],
        characters: [{ name: "A" }],
      },
      BRIEF,
    );
    expect(ir.characters[0].id).toBe("char-1");
    expect(ir.scenes[0].id).toBe("scene-1");
    expect(ir.scenes[0].shots[0].durationSeconds).toBe(4);
    expect(ir.dnaSources).toEqual(BRIEF.sources);
    // A missing visual is NOT invented — the validator must still catch it.
    const bare = repairStoryIr({ scenes: [{ shots: [{}] }] }, BRIEF);
    expect(bare.scenes[0].shots[0].visualDescription).toBeUndefined();
    expect(validateStoryIr(bare).map((p) => p.code)).toContain("shot-no-visual");
  });

  it("a local model's reply flows through to a validated IR", async () => {
    const invoke = vi.fn().mockResolvedValue(
      JSON.stringify({
        title: "The Keeper",
        logline: "A keeper answers a light that answers back.",
        genre: "Horror",
        tone: "dread",
        theme: "grief",
        characters: [
          {
            id: "c1",
            name: "Ada",
            appearance: "a keeper in oilskins",
            personality: "steady",
            goal: "keep the light",
            fear: "the dark",
            contradiction: "she guards what frightens her",
          },
        ],
        world: {
          locations: [{ id: "l1", name: "lamp room", description: "glass and brass" }],
          visualStyle: "cold",
        },
        acts: [{ id: "a1", purpose: "setup", sceneIds: ["scene-1"] }],
        scenes: [
          {
            purpose: "the light answers",
            conflict: "it should not",
            locationId: "l1",
            characters: ["c1"],
            shots: [
              {
                visualDescription: "the lamp turning",
                motionDescription: "slow orbit",
                cameraDescription: "orbit",
                characters: ["c1"],
                locationId: "l1",
              },
              {
                visualDescription: "Ada at the glass",
                motionDescription: "push in",
                cameraDescription: "push-in",
                characters: ["c1"],
                locationId: "l1",
              },
              {
                visualDescription: "the sea below",
                motionDescription: "tilt down",
                cameraDescription: "tilt",
                characters: [],
                locationId: "l1",
              },
            ],
          },
        ],
      }),
    );
    const ir = await generateStoryIr(BRIEF, invoke);
    expect(invoke).toHaveBeenCalledOnce();
    expect(ir.targetDurationSeconds).toBe(12);
    expect(validateStoryIr(ir, { movieGrade: true })).toEqual([]);
  });
});
