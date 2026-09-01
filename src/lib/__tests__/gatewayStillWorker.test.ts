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
});
