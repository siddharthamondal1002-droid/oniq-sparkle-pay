// EXPLICIT STAGE GATES — no implicit cascade (mega loop, 2026-08-27).
//
// The terminal architecture: "create story" stops at the story, "build
// character" stops at the asset, and only the studio's own paid Generate tap
// enters rendering. These tests hold the wiring to that by reading the
// source the way storyReaper and gpuVideoFlow pin theirs: the guarantee
// lives in what a file CANNOT call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// Comments in these files EXPLAIN the gates and may name what must be
// absent; the pins scan executable text only.
const WRITER = stripComments(read("src/components/stories/StoryWriter.tsx"));
const BUILDER = stripComments(read("src/components/stories/CharacterBuilder.tsx"));
const STUDIO = stripComments(read("src/components/stories/StoryStudio.tsx"));
const PLOT_FN = stripComments(read("supabase/functions/story-plot/index.ts"));
const STILL_FN = stripComments(read("supabase/functions/story-still/index.ts"));

describe("Generate Story → stops at Story", () => {
  it("the writer calls story-plot and nothing that spends beyond it", () => {
    expect(WRITER).toContain('invoke("story-plot"');
    for (const paid of [
      "claim_story_seconds",
      "story-still",
      "story-voice",
      "story-clip",
      "story_jobs",
      "gpu-video",
      "runpod",
      "set_story_cast",
    ]) {
      expect(WRITER, paid).not.toContain(paid);
    }
  });

  it("story-plot itself writes no rows and dispatches nothing", () => {
    for (const term of [".insert(", ".upload(", "createClient", "story_jobs", "dispatch"]) {
      expect(PLOT_FN, term).not.toContain(term);
    }
  });

  it("using a draft only prefills the studio — the film still needs its own tap", () => {
    expect(WRITER).toContain("onUseDraft");
    // The studio hands the draft to its own prompt state; the claim stays
    // where it always was, behind the studio's explicit Generate.
    expect(STUDIO).toMatch(/onUseDraft=\{[\s\S]{0,200}setPrompt\(/);
  });
});

describe("Build Character → stops at Character", () => {
  it("the builder calls story-still, the actor bucket and the actor RPC — nothing else", () => {
    expect(BUILDER).toContain('invoke("story-still"');
    expect(BUILDER).toContain('"story-actors"');
    expect(BUILDER).toContain('"save_story_actor"');
    for (const paid of [
      "claim_story_seconds",
      "story-plot",
      "story-voice",
      "story-clip",
      "story_jobs",
      "gpu-video",
      "runpod",
      "audio",
    ]) {
      expect(BUILDER, paid).not.toContain(paid);
    }
  });

  it("story-still itself stores nothing — bytes go only to the explicit caller", () => {
    for (const term of [".insert(", ".upload(", "createClient", "story_jobs"]) {
      expect(STILL_FN, term).not.toContain(term);
    }
  });

  it("a refused frame is shown, never retried", () => {
    // One invoke call site, and no retry vocabulary in executable text.
    expect(BUILDER.match(/invoke\("story-still"/g)).toHaveLength(1);
    expect(BUILDER).not.toMatch(/retry|backoff/i);
  });
});

describe("the stages stay independently callable", () => {
  it("story generation and character build do not import each other", () => {
    expect(WRITER).not.toContain("CharacterBuilder");
    expect(BUILDER).not.toContain("StoryWriter");
  });

  it("rendering keeps exactly one entry: the studio's own claim call", () => {
    expect(STUDIO.match(/rpc\("claim_story_seconds"/g)).toHaveLength(1);
    // Neither new panel adds a second one anywhere in the stories tree.
    expect(WRITER).not.toContain("claim_story_seconds");
    expect(BUILDER).not.toContain("claim_story_seconds");
  });

  it("the studio mounts both panels — capabilities, not a chain", () => {
    expect(STUDIO).toContain("<CharacterBuilder cast={cast} />");
    expect(STUDIO).toContain("<StoryWriter");
  });
});
