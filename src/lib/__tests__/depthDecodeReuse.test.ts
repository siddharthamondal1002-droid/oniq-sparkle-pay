/**
 * PERF (Story Worker finding 8a) — the depth stage must decode each still ONCE
 * and share the RGBA across the near and mid planes, not re-decode per plane.
 *
 * Proven equivalent by an isolated fixture benchmark (real 1080x1920 still):
 * byte-identical plane PNGs (0 differing samples), ~40ms/shot and ~59MB peak
 * RSS saved. These source assertions keep the wiring from regressing back to a
 * per-plane decode. The worker/depth code runs on sharp (native, not in this
 * node test env), so — as with the repo's other worker guards — the shape is
 * pinned in source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const depth = readFileSync(join(ROOT, "remotion/scripts/depth.mjs"), "utf8");
const worker = readFileSync(join(ROOT, "remotion/scripts/story-worker.mjs"), "utf8");

describe("depth still-decode reuse (finding 8a)", () => {
  it("depth.mjs exposes a single-decode helper", () => {
    expect(depth).toMatch(/export async function decodeStillRgba\(stillPath\)/);
    // The helper does the one metadata + one RGBA decode.
    expect(depth).toMatch(/removeAlpha\(\)\.ensureAlpha\(\)\.raw\(\)\.toBuffer\(\)/);
  });

  it("cutNearPlane accepts a shared pre-decoded still and does not re-decode it", () => {
    expect(depth).toMatch(/export async function cutNearPlane\([^)]*decoded = null\)/s);
    // Uses the shared buffer for the composite...
    expect(depth).toMatch(/sharp\(still\.rgba,\s*\{\s*raw:/);
    // ...and there is exactly ONE full-res RGBA decode in the whole module
    // (inside decodeStillRgba) — cutNearPlane must not decode the still again.
    const decodes = depth.match(/removeAlpha\(\)\.ensureAlpha\(\)\.raw\(\)\.toBuffer\(\)/g) ?? [];
    expect(decodes.length).toBe(1);
  });

  it("the worker decodes the still once and shares it across both planes", () => {
    expect(worker).toMatch(/decodeStillRgba/);
    expect(worker).toMatch(/const decodedStill = await decodeStillRgba\(stillFile\)/);
    // Both cutNearPlane calls receive the shared decode.
    const shared = worker.match(/decodedStill,\s*\n\s*\)/g) ?? [];
    expect(shared.length).toBe(2);
  });
});
