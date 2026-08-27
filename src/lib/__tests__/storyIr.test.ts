// Story IR, the budget and the validator — the gate before GPU money.
//
// Owner directive 2026-08-27 (local story intelligence): an invalid story
// must never reach image or video generation. Every case here is one that
// would otherwise surface much later with the money already spent.
import { describe, expect, it } from "vitest";
import {
  DURATION_TOLERANCE,
  SHOT_SECONDS,
  budgetFor,
  validateStoryIr,
  type StoryIr,
} from "../../../supabase/functions/_shared/storyIr.ts";

function goodIr(over: Partial<StoryIr> = {}): StoryIr {
  return {
    title: "The Unanswered Call",
    logline: "A woman answers a phone that should not ring.",
    genre: "Horror",
    tone: "dread",
    theme: "grief",
    targetDurationSeconds: 12,
    characters: [
      {
        id: "c1",
        name: "Mara",
        appearance: "a woman in a rain-soaked coat",
        personality: "stubborn",
        goal: "hear the voice again",
        fear: "that it is really him",
        contradiction: "she wants the truth and cannot survive it",
        relationships: [{ to: "c2", as: "brother" }],
      },
      {
        id: "c2",
        name: "Ilya",
        appearance: "a man half-lit in a doorway",
        personality: "quiet",
        goal: "be believed",
        fear: "being forgotten",
        contradiction: "he warns her by frightening her",
      },
    ],
    world: {
      locations: [{ id: "l1", name: "the kitchen", description: "a narrow kitchen at night" }],
      visualStyle: "handheld, available light",
    },
    acts: [{ id: "a1", purpose: "setup", sceneIds: ["s1"] }],
    scenes: [
      {
        id: "s1",
        purpose: "the call arrives",
        conflict: "she should not answer",
        locationId: "l1",
        characters: ["c1"],
        shots: [
          {
            id: "s1-1",
            visualDescription: "a phone lit on a kitchen counter",
            motionDescription: "slow push in as the screen brightens",
            cameraDescription: "slow push-in",
            characters: ["c1"],
            locationId: "l1",
            durationSeconds: 4,
            narration: "It rang at the hour he died.",
          },
          {
            id: "s1-2",
            visualDescription: "Mara reaches for the phone",
            motionDescription: "her hand enters frame and hesitates",
            cameraDescription: "static",
            characters: ["c1"],
            locationId: "l1",
            durationSeconds: 4,
            dialogue: { speaker: "c1", line: "Ilya?" },
          },
          {
            id: "s1-3",
            visualDescription: "the doorway behind her, empty",
            motionDescription: "focus racks from her to the doorway",
            cameraDescription: "rack focus",
            characters: [],
            locationId: "l1",
            durationSeconds: 4,
          },
        ],
      },
    ],
    dnaSources: ["ONIQ-0001", "ONIQ-0002", "ONIQ-0003"],
    ...over,
  };
}

describe("the budget is planned before the story, not after", () => {
  it("turns a target duration into a scene and shot budget", () => {
    const b = budgetFor(300);
    expect(b.shots).toBe(300 / SHOT_SECONDS);
    expect(b.scenes * b.shotsPerScene).toBeGreaterThanOrEqual(b.shots);
    expect(b.wordsPerShot).toBeGreaterThan(0);
  });

  it("scales across every duration the catalogue sells", () => {
    for (const seconds of [60, 180, 300, 600, 1800]) {
      const b = budgetFor(seconds);
      expect(b.shots * SHOT_SECONDS).toBeCloseTo(seconds, -1);
      expect(b.shotsPerScene).toBeGreaterThanOrEqual(2);
      expect(b.shotsPerScene).toBeLessThanOrEqual(8);
    }
  });
});

describe("a valid story passes", () => {
  it("finds nothing wrong with a well-formed film", () => {
    expect(validateStoryIr(goodIr())).toEqual([]);
    expect(validateStoryIr(goodIr(), { movieGrade: true })).toEqual([]);
  });
});

describe("an invalid story never reaches the GPU", () => {
  const codes = (ir: StoryIr, movieGrade = false) =>
    validateStoryIr(ir, { movieGrade }).map((p) => p.code);

  it("catches a shot naming a character nobody defined", () => {
    const ir = goodIr();
    ir.scenes[0].shots[0].characters = ["ghost"];
    expect(codes(ir)).toContain("orphan-character");
  });

  it("catches a speaker who does not exist", () => {
    const ir = goodIr();
    ir.scenes[0].shots[1].dialogue = { speaker: "nobody", line: "hello" };
    expect(codes(ir)).toContain("orphan-speaker");
  });

  it("accepts a speaker given by name as well as by id", () => {
    const ir = goodIr();
    ir.scenes[0].shots[1].dialogue = { speaker: "Mara", line: "Ilya?" };
    expect(codes(ir)).not.toContain("orphan-speaker");
  });

  it("catches a shot with nothing to draw", () => {
    const ir = goodIr();
    ir.scenes[0].shots[0].visualDescription = "  ";
    expect(codes(ir)).toContain("shot-no-visual");
  });

  it("catches a movie-grade shot with no motion, and only in movie grade", () => {
    const ir = goodIr();
    ir.scenes[0].shots[2].motionDescription = "";
    expect(codes(ir, true)).toContain("shot-no-motion");
    expect(codes(ir, false)).not.toContain("shot-no-motion");
  });

  it("catches a film that is not the length that was sold", () => {
    const ir = goodIr({ targetDurationSeconds: 300 });
    expect(codes(ir)).toContain("duration-drift");
    // ...and tolerates honest rounding within the stated tolerance.
    const near = goodIr({ targetDurationSeconds: Math.round(12 * (1 + DURATION_TOLERANCE / 2)) });
    expect(codes(near)).not.toContain("duration-drift");
  });

  it("catches more words than a shot can speak", () => {
    const ir = goodIr();
    ir.scenes[0].shots[0].narration = "word ".repeat(40);
    expect(codes(ir)).toContain("shot-overspoken");
  });

  it("catches orphan locations, scenes and relationships", () => {
    const ir = goodIr();
    ir.scenes[0].locationId = "nowhere";
    ir.acts[0].sceneIds = ["s9"];
    ir.characters[0].relationships = [{ to: "c9", as: "sister" }];
    const c = codes(ir);
    expect(c).toContain("orphan-location");
    expect(c).toContain("orphan-scene");
    expect(c).toContain("orphan-relationship");
  });

  it("catches duplicate ids, empty dialogue and a scene with no shots", () => {
    const ir = goodIr();
    ir.scenes[0].shots[1].id = "s1-1";
    ir.scenes[0].shots[1].dialogue = { speaker: "c1", line: "" };
    const c = codes(ir);
    expect(c).toContain("duplicate-shot");
    expect(c).toContain("empty-dialogue");

    const empty = goodIr();
    empty.scenes[0].shots = [];
    expect(codes(empty)).toContain("scene-no-shots");
  });

  it("reports EVERY problem at once, so a story is regenerated once", () => {
    const ir = goodIr();
    ir.title = "";
    ir.scenes[0].shots[0].visualDescription = "";
    ir.scenes[0].shots[1].dialogue = { speaker: "nobody", line: "x" };
    expect(validateStoryIr(ir).length).toBeGreaterThanOrEqual(3);
  });

  it("a story with no scenes stops immediately rather than cascading", () => {
    const c = codes(goodIr({ scenes: [] }));
    expect(c).toContain("no-scenes");
    expect(c).not.toContain("no-shots");
  });
});
