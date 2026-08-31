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
const STORY_STILL = read("supabase/functions/story-still/index.ts");

describe("voice is ONIQ's own", () => {
  it("every production film speaks with the in-house engine, not a cloud bucket", () => {
    // 'only' is checked before the first line is spoken, so a film never
    // starts on a provider it would have to fall back from.
    expect(STORY_WORKFLOW).toMatch(/STORY_LOCAL_TTS:\s*only/);
    expect(STORY_WORKER).toContain("process.env.STORY_LOCAL_TTS === 'only' ? 'local' : 'cloud'");
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

describe("stills are ONIQ's own", () => {
  it("story-still draws on ONIQ's engine and names no image provider", () => {
    expect(STORY_STILL).toContain("generateStill(");
    for (const provider of [
      "gateway.lovable.dev",
      "googleapis",
      "generativelanguage",
      "gemini-2.5-flash-image",
      "openai.com",
      "replicate",
    ]) {
      expect(STORY_STILL.toLowerCase(), provider).not.toContain(provider.toLowerCase());
    }
  });

  it("the engine is submitted, not a gateway — and the key it needs is ONIQ's", () => {
    expect(STORY_STILL).toContain('Deno.env.get("RUNPOD_ENDPOINT_ID")');
    expect(STORY_STILL).not.toContain("LOVABLE_API_KEY");
  });

  it("a failed still fails clearly rather than reaching for a provider", () => {
    // The directive's sharpest rule: no silent outsourcing on failure.
    const at = STORY_STILL.indexOf("story-still in-house engine");
    expect(at).toBeGreaterThan(-1);
    const catchBlock = STORY_STILL.slice(at - 400, at + 400);
    expect(catchBlock).toContain("502");
    // The whole file may not open a socket to anywhere but ONIQ's endpoint.
    const urls = STORY_STILL.match(/https?:\/\/[^"'`\s]+/g) ?? [];
    for (const url of urls) {
      expect(url, url).toMatch(/^https:\/\/(api\.runpod\.ai|\$\{)|auth\/v1\/user/);
    }
  });

  it("reference conditioning refuses honestly instead of drawing an unconditioned frame", () => {
    expect(STORY_STILL).toMatch(/does not condition on a reference yet[\s\S]{0,400}422/);
  });

  it("the refusal names the CAPABILITY, so nobody can mistake it for a verdict on the prompt", () => {
    // MEASURED 2026-08-31. The refusal used to be a bare 422, and the ask
    // ladder reads a bare 422 as "the CONTENT was refused, step down" — so a
    // shot whose character reference had resolved SUCCESSFULLY was demoted to
    // rung 2, `a place with no people in it`. A capability the engine lacks
    // was charged against the shot's subject matter, and the person the shot
    // was about was redrawn as an empty landscape.
    const refusal = STORY_STILL.slice(
      STORY_STILL.indexOf("does not condition on a reference yet"),
      STORY_STILL.indexOf("does not condition on a reference yet") + 500,
    );
    expect(refusal).toContain("CAPABILITY_MARKER");
    expect(refusal).toMatch(/promptRefused:\s*false/);
    // A FIELD, not a sentence. The previous signal was English prose, and
    // matching on prose is how the confusion survived.
    expect(STORY_STILL).toContain('from "../_shared/referenceOutcome.ts"');
  });
});
