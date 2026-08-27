// ONIQ generates its own media — pinned (owner directive 2026-08-27).
//
// "Remove the dependency on outsourced generation services from the
// production video/movie pipeline." These pins hold the parts of that
// directive that are DONE, each against the file that actually decides
// it in production — a workflow env, a worker branch, a contract — so a
// later edit cannot quietly hand a stage back to a cloud provider.
//
// A stage still outsourced is NOT pinned here: this file states what is
// in-house, never what is intended.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const STORY_WORKFLOW = read(".github/workflows/story-worker.yml");
const STORY_WORKER = read("remotion/scripts/story-worker.mjs");
const LOCAL_TTS = read("remotion/scripts/localTts.mjs");

describe("voice is ONIQ's own", () => {
  it("every production film speaks with the in-house engine, not a cloud bucket", () => {
    // 'only' is checked before the first line is spoken, so a film never
    // starts on a provider it would have to fall back from.
    expect(STORY_WORKFLOW).toMatch(/STORY_LOCAL_TTS:\s*only/);
    expect(STORY_WORKER).toContain(
      "process.env.STORY_LOCAL_TTS === 'only' ? 'local' : 'cloud'",
    );
  });

  it("the in-house voice is pinned by hash, not fetched by name", () => {
    // What was measured is what runs, or nothing runs.
    expect(LOCAL_TTS).toContain("sha256:");
    expect(LOCAL_TTS).toMatch(/PIPER_ASSETS/);
  });

  it("the in-house voice carries a cast, so characters stay distinct", () => {
    // A one-voice engine would silently flatten every character into the
    // narrator the moment the cloud path stopped being the default.
    expect(LOCAL_TTS).toMatch(/libritts/i);
    expect(STORY_WORKER).toContain("synthLocal");
    expect(STORY_WORKER).toContain("speakerFor");
  });
});
