/**
 * The production renderer against a SYNCHRONOUS still engine.
 *
 * The resume pair (start, then poll until done) was built on 2026-09-01 for a
 * cold GPU that takes minutes while an edge function has seconds. The gateway
 * restored the same day answers in one request — so the two changes meet in
 * `drawStill`, and if they meet badly the failure is expensive in a way tests
 * are the only cheap way to find:
 *
 *   * polling an engine that already handed over the frame earns a 400 per
 *     shot, or — if a future edit makes `poll` redraw instead of refusing —
 *     a second billed image per shot, for nothing;
 *   * in-house MOTION animates a still by re-deriving its BUCKET KEY, and a
 *     gateway still was never written to a bucket. Sent anyway, story-motion
 *     claims a GPU job and then fails its download.
 *
 * This reads the renderer story-worker.yml actually runs.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const RENDERER = readFileSync(
  new URL("../../../remotion/scripts/story-worker.mjs", import.meta.url),
  "utf-8",
);

const drawStill = RENDERER.slice(
  RENDERER.indexOf("async function drawStill("),
  RENDERER.indexOf("let lastVoiceAt"),
);

const generateClip = RENDERER.slice(
  RENDERER.indexOf("async function generateClip("),
  RENDERER.indexOf("Temporal-aliveness score"),
);

describe("a frame that arrives on the first call is not polled for", () => {
  it("returns immediately when start already carried the image", () => {
    expect(drawStill).toContain("if (started.done && started.data) return started;");
  });

  it("checks before entering the wait loop, not inside it", () => {
    const shortCircuit = drawStill.indexOf("started.done && started.data");
    const loop = drawStill.indexOf("for (;;)");
    expect(shortCircuit).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(-1);
    expect(shortCircuit).toBeLessThan(loop);
  });

  it("keys off the frame arriving, not off which provider sent it", () => {
    // A third engine that answers synchronously must work without an edit
    // here — and a provider name is the wrong thing to branch on anyway.
    expect(drawStill).not.toContain("provider === 'gateway'");
    expect(drawStill).not.toContain('provider === "gateway"');
  });
});

describe("in-house motion is never sent after a still that was never stored", () => {
  it("refuses the pairing before any GPU job is claimed", () => {
    expect(generateClip).toContain("route.engine === 'in-house' && !stillKey");
    const guard = generateClip.indexOf("!stillKey");
    const motionCall = generateClip.indexOf("'story-motion'");
    expect(guard).toBeGreaterThan(-1);
    expect(motionCall).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(motionCall);
  });

  it("throws rather than silently switching to Veo", () => {
    // Which engine animates is an owner setting. A worker that changed
    // provider because a still lacked a key would be choosing where the money
    // goes — the 2026-08-09 failure, in a new place.
    const guardBlock = generateClip.slice(
      generateClip.indexOf("route.engine === 'in-house' && !stillKey"),
      generateClip.indexOf("if (route.engine === 'in-house') {"),
    );
    expect(guardBlock).toContain("throw new Error(");
    expect(guardBlock).not.toContain("story-clip");
  });

  it("passes the real key through from the still that was drawn", () => {
    expect(RENDERER).toContain("still?.key ?? null,");
  });

  it("says what to set, in a message short enough to survive the log's slice", () => {
    // MEASURED 2026-09-02 on job 64874747. The caller records a clip failure as
    // `String(err.message).slice(0, 140)`. The first version of this message ran
    // to 142 characters, so every one of the nine log lines ended
    // `IN_HOUSE_MOTION=o` — the slice ate the `ff` off the single word that
    // tells a reader what to change. A fix instruction that is itself truncated
    // is not an instruction, and the length is therefore the thing to pin: the
    // wording may be rewritten, but it may not grow past what the log keeps.
    const guard = generateClip.slice(
      generateClip.indexOf("route.engine === 'in-house' && !stillKey"),
      generateClip.indexOf("if (route.engine === 'in-house') {"),
    );
    // Comment lines go FIRST. The prose around this guard is full of
    // apostrophes ("story-motion's", "it's"), and a naive quote match splices
    // them into the message and measures the wrong string.
    const thrown = guard
      .slice(guard.indexOf("throw new Error("))
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    const message = [...thrown.matchAll(/'([^']*)'/g)].map((m) => m[1]).join("");
    expect(message.length).toBeGreaterThan(40);
    expect(message.length).toBeLessThanOrEqual(140);
    // And the operator's two escape hatches both survive intact — `off`
    // included, which is the character the old message lost.
    expect(message).toContain("IN_HOUSE_MOTION=off");
    expect(message).toContain("STILL_PROVIDER=in_house");
  });
});

describe("an absent character reference says WHY, not just false", () => {
  const audit = RENDERER.slice(
    RENDERER.indexOf("const refAudit = {"),
    RENDERER.indexOf("actorref ${i + 1}"),
  );

  it("distinguishes 'nobody asked' from 'asked and missed'", () => {
    // The two are identical in flags and opposite in meaning. Job 64874747
    // logged four `false`s on all nine shots and read as a broken anchor; it
    // carried actor_refs=false and a null cast_json, so there was simply no
    // character to anchor. Establishing that took a real investigation the log
    // should have made unnecessary.
    expect(audit).toContain("JOB_ATTACHED_NO_CHARACTER");
    expect(audit).toContain("NO_OWNER_ASSET_MATCHED_THIS_SHOT");
    expect(audit).toContain("job.actor_refs === true");
  });

  it("reports the job's flag without gating casting on it", () => {
    // Narrowing WHEN casting runs would be a behaviour change hiding inside a
    // logging fix. Casting is a local text match and spends nothing, so the
    // flag is reported and never used as a condition.
    expect(audit).not.toMatch(/if\s*\(\s*job\.actor_refs/);
    expect(audit).not.toMatch(/ACTOR_REFS\s*&&\s*job\.actor_refs/);
  });

  it("only explains itself when there is nothing to explain away", () => {
    // The reason rides on the absence. A shot that DID resolve an actor keeps
    // reporting the ids and byte counts it always did, unpolluted.
    expect(audit).toMatch(/if \(!pick\) \{/);
  });
});
