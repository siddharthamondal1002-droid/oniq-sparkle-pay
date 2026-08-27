// StoryModel.generate() and the Director's dispatch descriptors.
//
// Owner directive 2026-08-27 (finalize the ready layer): the Director asks
// for a story and gets a VALIDATED one or an error, and it never learns
// that a model — let alone a provider — exists.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DispatchBlocked,
  NARRATOR_VOICE,
  imagePromptFor,
  motionPromptFor,
  requestFor,
  spokenTextFor,
  voiceForShot,
} from "../../../supabase/functions/_shared/directorDispatch.ts";
import { buildGraph } from "../../../supabase/functions/_shared/directorGraph.ts";
import {
  LocalModelUnavailable,
  StoryInvalid,
  generateStory,
  storyModelAvailable,
} from "../../../supabase/functions/_shared/storyModel.ts";
import type { StoryIr } from "../../../supabase/functions/_shared/storyIr.ts";

function modelReply(over: Record<string, unknown> = {}) {
  return JSON.stringify({
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
        clothing: "oilskins",
        personality: "steady",
        goal: "keep the light",
        fear: "the dark",
        contradiction: "she guards what frightens her",
        voiceId: "v-ada",
      },
    ],
    world: {
      locations: [{ id: "l1", name: "lamp room", description: "glass and brass" }],
      visualStyle: "cold available light",
      timePeriod: "1912",
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
            narration: "It turned.",
          },
          {
            visualDescription: "Ada at the glass",
            motionDescription: "push in",
            cameraDescription: "push-in",
            characters: ["c1"],
            locationId: "l1",
            dialogue: { speaker: "c1", line: "Who is out there?" },
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
    ...over,
  });
}

const REQUEST = { idea: "a lighthouse keeper", seconds: 12, grade: "movie" as const, seed: "s1" };

describe("StoryModel returns a validated story, or refuses", () => {
  it("runs DNA -> model -> repair -> validation and hands back an IR", async () => {
    const invoke = vi.fn().mockResolvedValue(modelReply());
    const { ir, brief, problems } = await generateStory(REQUEST, invoke);
    expect(problems).toEqual([]);
    expect(ir.title).toBe("The Keeper");
    expect(ir.dnaSources.length).toBeGreaterThanOrEqual(3); // recombined
    expect(brief.policy.generation_rule).toMatch(/do not reproduce/i);
  });

  it("THROWS an invalid story rather than returning one — zero jobs, zero spend", async () => {
    const broken = modelReply({
      scenes: [
        {
          purpose: "p",
          conflict: "c",
          locationId: "l1",
          characters: [],
          shots: [
            {
              visualDescription: "",
              motionDescription: "",
              cameraDescription: "c",
              characters: ["ghost"],
              locationId: "l1",
            },
          ],
        },
      ],
    });
    const invoke = vi.fn().mockResolvedValue(broken);
    await expect(generateStory(REQUEST, invoke)).rejects.toThrow(StoryInvalid);
  });

  it("with no local model it fails at the door — it does not outsource", async () => {
    await expect(generateStory(REQUEST)).rejects.toThrow(LocalModelUnavailable);
    expect(await storyModelAvailable()).toBe(false);
    expect(await storyModelAvailable(vi.fn().mockResolvedValue("pong"))).toBe(true);
    expect(await storyModelAvailable(vi.fn().mockRejectedValue(new Error("cold")))).toBe(false);
  });

  it("the user's own characters are theirs — the model may add, never redefine", async () => {
    const invoke = vi.fn().mockResolvedValue(modelReply());
    const { ir } = await generateStory(
      { ...REQUEST, characters: [{ name: "Ada", description: "a keeper in a red coat" }] },
      invoke,
    );
    expect(ir.characters.find((c) => c.name === "Ada")!.appearance).toBe("a keeper in a red coat");
  });

  it("names no provider anywhere in the abstraction", () => {
    const src = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/storyModel.ts"),
      "utf8",
    ).toLowerCase();
    for (const p of ["anthropic", "openai", "gemini", "googleapis", "lovable", "https://"]) {
      expect(src, p).not.toContain(p);
    }
  });
});

describe("dispatch resolves the bibles into every request", () => {
  let ir: StoryIr;
  beforeAll(async () => {
    ({ ir } = await generateStory(REQUEST, vi.fn().mockResolvedValue(modelReply())));
  });

  it("the still prompt carries who and where, not just the frame", () => {
    const shot = ir.scenes[0].shots[0];
    const prompt = imagePromptFor(ir, shot);
    expect(prompt).toContain("the lamp turning");
    expect(prompt).toContain("Ada"); // resolved from the character bible
    expect(prompt).toContain("lamp room"); // resolved from the world bible
    expect(prompt).toContain("cold available light");
  });

  it("the motion prompt is motion and camera only — never the frame again", () => {
    const shot = ir.scenes[0].shots[0];
    const prompt = motionPromptFor(shot);
    expect(prompt).toContain("slow orbit");
    expect(prompt).toContain("orbit");
    expect(prompt).not.toContain("the lamp turning");
  });

  it("a repair changes the motion prompt rather than repeating it", () => {
    const shot = ir.scenes[0].shots[0];
    const repaired = motionPromptFor(shot, "The subject performs the action visibly.");
    expect(repaired).not.toBe(motionPromptFor(shot));
    expect(repaired).toContain("performs the action visibly");
  });

  it("a character speaks in their own voice; narration uses the narrator", () => {
    expect(voiceForShot(ir, ir.scenes[0].shots[1])).toBe("v-ada");
    expect(voiceForShot(ir, ir.scenes[0].shots[0])).toBe(NARRATOR_VOICE);
    expect(spokenTextFor(ir.scenes[0].shots[1])).toBe("Who is out there?");
  });

  it("video animates the still the image job actually wrote", () => {
    const graph = buildGraph(ir, { filmId: "f1", grade: "movie" });
    const video = graph.jobs.find((j) => j.kind === "video")!;
    const req = requestFor(video, {
      ir,
      outputs: { [video.needs[0]]: "story/still/abc.png" },
      noWatermark: false,
    });
    expect(req.kind).toBe("video");
    if (req.kind === "video") {
      expect(req.inputKey).toBe("story/still/abc.png");
      expect(req.noWatermark).toBe(false); // server-derived, never guessed
    }
  });

  it("a job whose input is not on disk is BLOCKED, never dispatched on a guess", () => {
    const graph = buildGraph(ir, { filmId: "f1", grade: "movie" });
    const video = graph.jobs.find((j) => j.kind === "video")!;
    expect(() => requestFor(video, { ir, outputs: {}, noWatermark: false })).toThrow(
      DispatchBlocked,
    );
  });

  it("assembly refuses to run on fewer than two finished shots", () => {
    const graph = buildGraph(ir, { filmId: "f1", grade: "movie" });
    const assembly = graph.jobs.find((j) => j.kind === "assembly")!;
    expect(() => requestFor(assembly, { ir, outputs: {}, noWatermark: false })).toThrow(
      DispatchBlocked,
    );
  });
});
