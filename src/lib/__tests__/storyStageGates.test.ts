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
const CLIPS = stripComments(read("src/components/stories/VideoClips.tsx"));
const PLANS = stripComments(read("src/components/stories/VideoPlans.tsx"));
const JOBS_CLIENT = stripComments(read("src/components/stories/storyJobsClient.ts"));
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

describe("Generate video → the ONE user door into GPU generation", () => {
  it("the clips panel calls gpu-video, once, and nothing else that spends", () => {
    // One invoke call site (the shared transport helper) aimed at gpu-video.
    expect(CLIPS.match(/functions\.invoke\(/g)).toHaveLength(1);
    expect(CLIPS).toContain('invoke("gpu-video"');
    for (const other of [
      "claim_story_seconds",
      "story-plot",
      "story-still",
      "story-voice",
      "story-clip",
      "story_jobs",
      "save_story_actor",
      ".insert(",
      ".upload(",
      "runpod",
    ]) {
      expect(CLIPS, other).not.toContain(other);
    }
  });

  it("the panel cannot name infrastructure — id from the server registry only", () => {
    expect(CLIPS).toContain("Object.keys(STAGED_REFERENCES)[0]");
    for (const infra of ["gpu_type", "provider:", "budget", "bucket", "endpoint"]) {
      expect(CLIPS, infra).not.toContain(infra);
    }
  });

  it("a handed-over shot only prefills — the writer never names the transport", () => {
    expect(WRITER).toContain("onFilmShot");
    // The existing writer pin already refuses "gpu-video"; the hand-off is a
    // callback, so the writer cannot reach the paid function even by name.
    expect(STUDIO).toContain("onFilmShot={setClipSeed}");
    expect(STUDIO).toContain("<VideoClips seed={clipSeed} />");
  });

  it("a failed clip is shown, never auto-retried", () => {
    expect(CLIPS).not.toMatch(/backoff/i);
    // The one "retry" the file may mention is the idempotency comment; in
    // executable text the only path back is the explicit Try-again button.
    expect(CLIPS).toContain("Try again");
  });
});

describe("Video time → buying never generates, generating never buys", () => {
  it("the plans panel can pay and read balances — nothing that generates", () => {
    expect(PLANS).toContain('rpc("video_time_status"');
    expect(PLANS).toMatch(/rpc\(\s*"start_free_video_month"/);
    expect(PLANS).toContain("payForVideoMinutes");
    for (const generator of [
      'invoke("gpu-video"',
      "story-plot",
      "story-still",
      "claim_story_seconds",
      "story_jobs",
      "runpod",
    ]) {
      expect(PLANS, generator).not.toContain(generator);
    }
  });

  it("the clips panel reads its balance and never touches the payment rail", () => {
    expect(CLIPS).toContain('rpc("video_time_status"');
    for (const pay of ["razorpay", "payFor", "start_free_video_month", "create_video_purchase"]) {
      expect(CLIPS, pay).not.toContain(pay);
    }
  });

  it("the studio mounts the catalogue beside the clips panel", () => {
    expect(STUDIO).toContain("<VideoPlans />");
  });

  it("the panels stay independent", () => {
    expect(PLANS).not.toContain("VideoClips");
    expect(CLIPS).not.toContain("VideoPlans");
    expect(WRITER).not.toContain("VideoPlans");
    expect(BUILDER).not.toContain("VideoPlans");
  });
});

describe("the stages stay independently callable", () => {
  it("story generation and character build do not import each other", () => {
    expect(WRITER).not.toContain("CharacterBuilder");
    expect(BUILDER).not.toContain("StoryWriter");
    expect(CLIPS).not.toContain("StoryWriter");
    expect(CLIPS).not.toContain("CharacterBuilder");
    expect(WRITER).not.toContain("VideoClips");
    expect(BUILDER).not.toContain("VideoClips");
  });

  it("rendering keeps exactly one entry: the studio's own claim call", () => {
    expect(STUDIO.match(/rpc\("claim_story_seconds"/g)).toHaveLength(1);
    // Neither new panel adds a second one anywhere in the stories tree.
    expect(WRITER).not.toContain("claim_story_seconds");
    expect(BUILDER).not.toContain("claim_story_seconds");
  });

  it("the studio mounts the panels — capabilities, not a chain", () => {
    expect(STUDIO).toContain("<CharacterBuilder cast={cast} />");
    expect(STUDIO).toContain("<StoryWriter");
  });
});

describe("the stack speaks as ONIQ (owner directive 2026-08-27)", () => {
  it("no internal engine name reaches generation-surface copy", () => {
    // Comments may explain history; executable strings say ONIQ.
    for (const [name, src] of [
      ["StoryWriter", WRITER],
      ["StoryStudio", STUDIO],
      ["VideoClips", CLIPS],
      ["storyJobsClient", JOBS_CLIENT],
    ] as const) {
      expect(src, name).not.toContain("Ting");
    }
  });
});
