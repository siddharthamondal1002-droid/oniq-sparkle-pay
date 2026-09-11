/**
 * The voice-failure message must describe what actually happened, and the
 * in-house voice must survive one bad socket.
 *
 * WHAT HAPPENED. 2026-09-11, job 25bd27fd ("A girl finds a door in the roots
 * of a banyan tree"): the piper tarball died on `curl: (35) Recv failure:
 * Connection reset by peer`, and the film failed with
 *
 *     in-house tts unavailable and cloud voice exhausted
 *
 * The second half was false. story-worker.yml sets STORY_LOCAL_TTS=only, so
 * the engine starts local and the cloud voice is never asked anything. The
 * message sent the investigation at Google quota while the real cause sat one
 * line above it in the runner log.
 *
 * COMMENTS ARE STRIPPED FIRST. Both source files now QUOTE the retired string
 * while explaining why it was wrong, so every assertion below would match the
 * explanation rather than the code. Thirteenth time in this repo; see CLAUDE.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../test/sourceText.ts";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const WORKER = stripComments(read("remotion/scripts/story-worker.mjs"));
const LOCAL_TTS = stripComments(read("remotion/scripts/localTts.mjs"));
const WORKFLOW = read(".github/workflows/story-worker.yml");

/**
 * READ BY ANCHOR, NEVER BY OFFSET. An earlier test in this repo sliced a
 * fixed 400 characters and reported a disagreement that did not exist the
 * moment a comment moved the thing it was looking for. Every read below
 * starts at a distinctive string and ends at the next step header.
 *
 * js-yaml would be structurally nicer and is NOT used: it ships no type
 * declarations, so importing it fails `tsc` with TS7016, and adding
 * @types/js-yaml means editing package.json — which Lovable owns, and which
 * costs a round trip for a test helper. The cost of this choice, stated: these
 * assertions do not prove the YAML parses. GitHub rejects a malformed workflow
 * on its own, and the file was parsed once by hand when this was written.
 */
// BOUND TO END OF LINE. Without the trailing newline this is a PREFIX match,
// and mutation M7 walked straight through it: renaming the step
// "cached in-house voice DISABLED" still matched "cached in-house voice" and
// all ten assertions stayed green while the cache was gone.
const stepAt = (name: string) => WORKFLOW.indexOf(`      - name: ${name}\n`);

const blockOf = (name: string) => {
  const start = stepAt(name);
  if (start < 0) return "";
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.indexOf("\n      - name:");
  return next === -1 ? rest : rest.slice(0, next);
};

const valueIn = (block: string, key: string) =>
  new RegExp(`^\\s*${key}:[ \\t]*(.+)$`, "m").exec(block)?.[1].trim();

describe("a film never blames a provider it did not ask", () => {
  it("does not throw the retired sentence anywhere in executable code", () => {
    expect(WORKER).not.toContain("cloud voice exhausted");
  });

  it("builds the message from what actually happened", () => {
    expect(WORKER).toMatch(/function voiceUnavailable\(\)/);
    // The reason must reach the message, not only a console.log nobody reads.
    expect(WORKER).toMatch(/localTtsFailure\s*=\s*String\(err\?\.message \?\? err\)/);
    expect(WORKER).toMatch(/const why = localTtsFailure \?\? ['"]reason not recorded['"]/);
  });

  it("says the cloud was not tried when STORY_LOCAL_TTS is 'only'", () => {
    expect(WORKER).toMatch(/mode === ['"]only['"]/);
    expect(WORKER).toMatch(/was not tried/);
  });

  it("uses the helper at BOTH throw sites, narration and dialogue", () => {
    const uses = WORKER.match(/throw new Error\(voiceUnavailable\(\)\)/g) ?? [];
    expect(uses).toHaveLength(2);
  });
});

describe("the in-house voice survives one bad socket", () => {
  it("retries a connection reset, which plain --retry does not", () => {
    expect(LOCAL_TTS).toContain("--retry-all-errors");
    expect(LOCAL_TTS).toContain("--connect-timeout");
  });

  it("is cached, so the common path does not download at all", () => {
    expect(stepAt("cached in-house voice")).toBeGreaterThan(-1);
    expect(blockOf("cached in-house voice")).toMatch(/uses:\s*actions\/cache@/);
  });

  it("caches BEFORE the render step, or the cache does nothing", () => {
    expect(stepAt("cached in-house voice")).toBeLessThan(stepAt("render one job"));
  });

  it("points the worker at the very path it cached", () => {
    // These two agreeing is the whole mechanism. If they drift the cache
    // still restores, the worker still downloads, and nothing reports it.
    const cached = valueIn(blockOf("cached in-house voice"), "path");
    const used = valueIn(blockOf("render one job"), "STORY_TTS_CACHE");
    expect(cached).toBeTruthy();
    expect(used).toBe(cached);
  });

  it("keys the cache on the asset manifest, so a new sha256 cannot hit", () => {
    expect(valueIn(blockOf("cached in-house voice"), "key")).toContain(
      "remotion/scripts/localTts.mjs",
    );
  });

  it("has NO restore-keys — a prefix match would serve the old assets", () => {
    expect(blockOf("cached in-house voice")).not.toContain("restore-keys");
  });
});
