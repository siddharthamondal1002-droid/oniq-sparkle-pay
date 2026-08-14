import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emotionFor } from "@/lib/expressionGrammar";

const ROOT = join(__dirname, "../../..");
const MODULE_SRC = readFileSync(join(ROOT, "src/lib/expressionGrammar.ts"), "utf8");
const WORKER_SRC = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");
const FILM_SRC = readFileSync(join(ROOT, "remotion/src/story/StoryFilm.tsx"), "utf8");
const HEADS_SRC = readFileSync(join(ROOT, "remotion/src/rig/expressionHeads.ts"), "utf8");

/**
 * Rung 5's chooser: the scene picks the face, or nothing. These pin the
 * vocabulary, the precedence, the prose traps (each guarded individually
 * in the classifier), and the wiring into the worker and the composition.
 */
describe("emotionFor — the scene chooses the face", () => {
  it("hears each register in its plain words", () => {
    expect(emotionFor("The jinni rages at the broken seal")).toBe("anger");
    expect(emotionFor("She wept over the empty spindle")).toBe("sorrow");
    expect(emotionFor("He gasped at the cave of gold")).toBe("surprise");
    expect(emotionFor("Ali Baba smiled and opened the gate")).toBe("joy");
    expect(emotionFor("The boy marvelled at the floating lamp")).toBe("wonder");
    expect(emotionFor("The old porter sighed and set down his load")).toBe("weary");
  });

  it("speaks thesaurus, the vfx directive applied to feelings", () => {
    expect(emotionFor("Furious, the captain seethed behind the dune")).toBe("anger");
    expect(emotionFor("A lament rose from the mourners by the gate")).toBe("sorrow");
    expect(emotionFor("Aghast, she stood dumbfounded in the doorway")).toBe("surprise");
    expect(emotionFor("Merriment and laughter filled the courtyard")).toBe("joy");
    expect(emotionFor("Awestruck, the crowd fell silent")).toBe("wonder");
    expect(emotionFor("Haggard and drained, he leaned on the rail")).toBe("weary");
  });

  it("returns NOTHING for a scene that names no feeling", () => {
    expect(emotionFor("A quiet market street at dawn, stalls still shuttered")).toBeNull();
    expect(emotionFor("")).toBeNull();
  });

  it("runs precedence strong-and-specific first", () => {
    // An enraged jinni and a nervous laugh is an anger scene.
    expect(emotionFor("The jinni raged while the thief laughed nervously")).toBe("anger");
    // Grief outranks the gasp it causes.
    expect(emotionFor("She gasped, then wept into her scarf")).toBe("sorrow");
    // Tears OF JOY are joy — the one sorrow word joy may claim.
    expect(emotionFor("Tears of joy ran down his face")).toBe("joy");
  });

  it("does not fire on the prose traps, each guarded individually", () => {
    // A crystal is not a cry; tearing a letter is destruction, not grief.
    expect(emotionFor("A crystal chandelier hung above the hall")).toBeNull();
    expect(emotionFor("He tears the letter apart and feeds the fire")).toBeNull();
    // Physics and hairstyles are not surprise.
    expect(emotionFor("The shockwave rattled every shutter in the lane")).toBeNull();
    expect(emotionFor("An old man with a shock of white hair")).toBeNull();
    // Praise is not the face looking at it.
    expect(emotionFor("A wonderful garden stretched to the wall")).toBeNull();
    expect(emotionFor("An amazing sight, said the guide")).toBeNull();
    // Lamps get ground, faces grin; cheerless is not cheer.
    expect(emotionFor("Grinding the lamp against the whetstone")).toBeNull();
    expect(emotionFor("A cheerless cell under the palace")).toBeNull();
    // A beam of light is a noun; a fire that roared is furniture (roar is
    // deliberately absent from anger).
    expect(emotionFor("A beam of light crossed the cellar floor")).toBeNull();
    expect(emotionFor("The fire roared in the hearth")).toBeNull();
    // Drinking is not exhaustion; sight is not a sigh.
    expect(emotionFor("He drained the cup and called for another")).toBeNull();
    expect(emotionFor("The sight of the city filled the window")).toBeNull();
    // Words containing feeling-words are not feelings.
    expect(emotionFor("A dangerous road wound past the outrage of the storm")).toBeNull();
    expect(emotionFor("The gladiator saluted; the courtyard was silent")).toBeNull();
    expect(emotionFor("Incense smoke curled from the brazier")).toBeNull();
  });
});

describe("the wiring pins", () => {
  it("the module stays worker-importable — zero imports", () => {
    expect(MODULE_SRC).not.toMatch(/^import /m);
    expect(MODULE_SRC).not.toMatch(/^export .* from /m);
  });

  it("the worker asks the scene for its register and attaches it", () => {
    expect(
      /from '\.\.\/\.\.\/src\/lib\/expressionGrammar\.ts'/.test(WORKER_SRC),
      "story-worker.mjs must import expressionGrammar with the explicit .ts suffix",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("emotionFor("),
      "story-worker.mjs no longer calls emotionFor — rung 5 is unplugged",
    ).toBe(true);
    expect(
      WORKER_SRC.includes("expression ? { expression }"),
      "the manifest no longer attaches the expression to the character",
    ).toBe(true);
  });

  it("the composition resolves the emotion against the measured busts", () => {
    expect(
      FILM_SRC.includes("EXPRESSION_HEADS[shot.character.rig]?.[shot.character.expression]"),
      "StoryFilm.tsx no longer resolves expression heads — rung 5 renders nothing",
    ).toBe(true);
    expect(
      HEADS_SRC.includes("export const EXPRESSION_HEADS"),
      "expressionHeads.ts lost its table",
    ).toBe(true);
  });
});
