/**
 * EVERY CLIP OF A SHOT MUST BE ITS OWN DRAW.
 *
 * MEASURED 2026-08-31 while checking the app→worker contract before merging
 * the worker branch. `unitKey` is `<projectId>/<sceneId>/<shotId>/v<version>/
 * <index>`, but `clipSeed` destructured only the first three segments, so
 * `v<version>` and `<index>` never reached the seed. Running the real planner
 * over a 9-second shot produced three clips whose `input_key`, `prompt`,
 * `negative_prompt` and `seed` were all identical — only `output_key` differed:
 *
 *   index 0 | seed 6890573110812446 | .../v1/0/ltx-001.mp4
 *   index 1 | seed 6890573110812446 | .../v1/1/ltx-001.mp4
 *   index 2 | seed 6890573110812446 | .../v1/2/ltx-001.mp4
 *
 * LTX is deterministic given a seed, so those are three byte-identical clips.
 * The shot played the same 4.04 seconds three times, and two thirds of its GPU
 * spend bought nothing. The same omission made a version bump inert, though
 * `unitKey` documents it as "the ONLY way to ask for the same shot again".
 *
 * This is asserted BEHAVIOURALLY — by running planMotion and buildClipPayload
 * and comparing the payloads that would actually reach the worker — because
 * the bug was invisible to every string-level check: no name was misspelled,
 * no field was missing, and the code read correctly. Only the values collided.
 */
import { describe, expect, it } from "vitest";
import {
  buildClipPayload,
  clipSeed,
  clipsForShot,
  planMotion,
  unitKey,
} from "../../../supabase/functions/_shared/inHouseMotion.ts";
import { deriveSeed } from "../../../supabase/functions/_shared/storySeed.ts";
import type { MovieShot } from "../../../supabase/functions/_shared/movieGrammar.ts";

const SHOT: MovieShot = {
  still: "a woman at a market stall, close on her face",
  narration: "She weighed the fish in both hands.",
  motion: "slow push in",
  camera: "slow push in",
  expression: "thoughtful",
  vfx: "dust motes in the light",
} as MovieShot;

/** The payload fields that decide what the GPU actually draws. */
function drawOf(payload: { input: { params: Record<string, unknown> } }) {
  const p = payload.input.params;
  return JSON.stringify([p.prompt, p.seed, p.negative_prompt]);
}

describe("a multi-clip shot draws each clip separately", () => {
  it("plans more than one clip for a shot longer than one clip", () => {
    expect(clipsForShot(9)).toBeGreaterThan(1);
  });

  it("gives every clip of one shot a different draw", () => {
    const plan = planMotion(
      "proj1",
      [{ sceneId: "sc1", shotId: "sh1", seconds: 9, shot: SHOT }],
      1,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.units.length).toBe(3);

    const draws = new Set(plan.units.map((u) => drawOf(buildClipPayload(u, SHOT, false, 1))));
    // Three clips, three draws. Before the fix this was 1.
    expect(draws.size).toBe(plan.units.length);
  });

  it("still points every clip of the shot at the one still it animates", () => {
    // The stills are deliberately SHARED — one conditioning frame per shot.
    // Only the draw differs, so this is not "make everything unique".
    const plan = planMotion(
      "proj1",
      [{ sceneId: "sc1", shotId: "sh1", seconds: 9, shot: SHOT }],
      1,
    );
    if (!plan.ok) return;
    const stills = new Set(plan.units.map((u) => u.stillKey));
    expect(stills.size).toBe(1);
  });
});

describe("clipSeed is a pure function of the whole unit identity", () => {
  it("changes with the clip index", () => {
    const a = clipSeed(unitKey("p", "s", "sh", 1, 0), 1);
    const b = clipSeed(unitKey("p", "s", "sh", 1, 1), 1);
    expect(a).not.toBe(b);
  });

  it("changes with the version, so a bump actually redraws", () => {
    const v1 = clipSeed(unitKey("p", "s", "sh", 1, 0), 1);
    const v2 = clipSeed(unitKey("p", "s", "sh", 2, 0), 1);
    expect(v1).not.toBe(v2);
  });

  it("changes with the attempt, which is the retry fix and must not regress", () => {
    const k = unitKey("p", "s", "sh", 1, 0);
    expect(clipSeed(k, 1)).not.toBe(clipSeed(k, 2));
  });

  it("reproduces exactly for the same unit and attempt", () => {
    const k = unitKey("p", "s", "sh", 1, 2);
    expect(clipSeed(k, 3)).toBe(clipSeed(k, 3));
  });

  it("stays inside the seed range that survives JSON transit", () => {
    let max = 0;
    for (let i = 0; i < 3000; i++) {
      max = Math.max(max, clipSeed(unitKey("p", "s", `sh${i}`, 1, i % 4), 1));
    }
    expect(max).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(max).toBeGreaterThan(0);
  });
});

describe("the still stage is untouched by the clip fix", () => {
  /**
   * The pre-change derivation, recomputed from first principles rather than
   * from a constant somebody typed: material was exactly
   * [stage, jobId, sceneId, shotId, attempt].join("|") with no unit segment.
   */
  function fnv1a64(text: string): bigint {
    const PRIME = 1099511628211n;
    const MASK = 2n ** 64n - 1n;
    let hash = 14695981039346656037n;
    for (let i = 0; i < text.length; i++) {
      hash ^= BigInt(text.charCodeAt(i) & 0xff);
      hash = (hash * PRIME) & MASK;
    }
    return hash;
  }
  const before = (jobId: string, sceneId: string, shotId: string, attempt: number) =>
    Number(
      fnv1a64(["still", jobId, sceneId, shotId, String(attempt)].join("|")) %
        BigInt(Number.MAX_SAFE_INTEGER),
    );

  it("derives the same still seed it did before `unit` existed", () => {
    for (const [j, sc, sh, a] of [
      ["p", "s", "sh", 0],
      ["job-1", "sc_2", "shot_3", 1],
      ["550e8400-e29b-41d4-a716-446655440000", "sc1", "sh1", 2],
    ] as const) {
      expect(deriveSeed({ stage: "still", jobId: j, sceneId: sc, shotId: sh, attempt: a })).toBe(
        before(j, sc, sh, a),
      );
    }
  });

  it("never lets a still and its own clip share a seed", () => {
    const still = deriveSeed({
      stage: "still",
      jobId: "p",
      sceneId: "s",
      shotId: "sh",
      attempt: 0,
    });
    expect(still).not.toBe(clipSeed(unitKey("p", "s", "sh", 1, 0), 1));
  });
});

describe("the separator invariant is checked, not assumed", () => {
  it("refuses a part containing the '|' the material is joined with", () => {
    // Collision-freedom rests entirely on this. Two shots whose parts differ
    // only by where a pipe sits would otherwise hash to one seed.
    expect(() =>
      deriveSeed({ stage: "clip", jobId: "a|b", sceneId: "s", shotId: "sh", attempt: 0 }),
    ).toThrow(/separator/);
    expect(() =>
      deriveSeed({
        stage: "clip",
        jobId: "a",
        sceneId: "s",
        shotId: "sh",
        unit: "v1|0",
        attempt: 0,
      }),
    ).toThrow(/separator/);
  });

  it("accepts the unit shape clipSeed actually builds", () => {
    expect(() =>
      deriveSeed({
        stage: "clip",
        jobId: "p",
        sceneId: "s",
        shotId: "sh",
        unit: "v1/0",
        attempt: 0,
      }),
    ).not.toThrow();
  });
});
