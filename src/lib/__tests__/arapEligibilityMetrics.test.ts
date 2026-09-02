/**
 * Measuring a rigged character — the numbers arapCharacterEligible decides on.
 *
 * Until now nothing produced them. `bboxFillPct` and `jointsOutsideMask`
 * appeared only in that gate's signature and its tests, because in the
 * six-character corpus run they were derived by hand — so the gate was real
 * and unreachable at the same time.
 *
 * Every fixture here is a synthetic mask built in this file. No model, no
 * runner, no render, no filesystem. That is the point: the measurement half
 * must be verifiable long before the CPU host exists.
 */
import { describe, expect, it } from "vitest";

import {
  ARAP_ELIGIBILITY,
  arapCharacterEligible,
  computeEligibilityMetrics,
  maskPixelAt,
  type AutorigArtifacts,
} from "../arapProvider";

/** A w x h mask whose first `fillPct` of rows are foreground. */
function mask(w: number, h: number, fillPct: number) {
  const data = new Uint8Array(w * h);
  const on = Math.round((fillPct / 100) * w * h);
  for (let i = 0; i < on; i += 1) data[i] = 1;
  return { width: w, height: h, data };
}

/**
 * Artifacts for a 100x100 character, joints placed in the foreground band.
 *
 * `over.joints` MERGES over the full skeleton rather than replacing it — the
 * first version of this helper spread `...over` last, so passing one joint
 * silently deleted the other nine. The elbow case then had no core joints at
 * all and failed for the wrong reason, and two core-joint cases PASSED for the
 * wrong reason (a lone off-mask foot rather than a full rig with one bad
 * joint). A fixture that quietly discards its own subject tests nothing.
 */
function artifacts(over: Partial<AutorigArtifacts> = {}, fillPct = 50): AutorigArtifacts {
  const { joints: overrides, ...rest } = over;
  return {
    bbox: [10, 20, 110, 120],
    mask: mask(100, 100, fillPct),
    ...rest,
    joints: {
      left_shoulder: { x: 30, y: 10 },
      right_shoulder: { x: 70, y: 10 },
      left_hip: { x: 35, y: 25 },
      right_hip: { x: 65, y: 25 },
      left_knee: { x: 35, y: 40 },
      right_knee: { x: 65, y: 40 },
      left_foot: { x: 35, y: 45 },
      right_foot: { x: 65, y: 45 },
      ...overrides,
    },
  };
}

describe("bboxFillPct is character-local, exactly as the envelope defines it", () => {
  it("is foreground over the TIGHT BBOX, never over the scene frame", () => {
    // The whole reason the 65% envelope measured on sheet crops transfers to a
    // character detected inside a gateway still: the mask IS the bbox crop.
    const got = computeEligibilityMetrics(artifacts({}, 50));
    expect(got.ok && got.bboxFillPct).toBeCloseTo(50, 6);
  });

  it("reads 100% for a fully merged silhouette", () => {
    // The classical AD threshold mask returned exactly this on all six ONIQ
    // painterly crops, which is why rembg u2netp is mandatory.
    const got = computeEligibilityMetrics(artifacts({}, 100));
    expect(got.ok && got.bboxFillPct).toBe(100);
  });

  it("straddles the 65% policy boundary in the direction the gate expects", () => {
    const under = computeEligibilityMetrics(artifacts({}, 64));
    const at = computeEligibilityMetrics(artifacts({}, 65));
    const over = computeEligibilityMetrics(artifacts({}, 66));
    expect(under.ok && arapCharacterEligible({ bboxFillPct: under.bboxFillPct, jointsOutsideMask: [] }).eligible).toBe(true);
    // 65 is the ceiling, not the first rejection — the gate is `> max`.
    expect(at.ok && arapCharacterEligible({ bboxFillPct: at.bboxFillPct, jointsOutsideMask: [] }).eligible).toBe(true);
    expect(over.ok && arapCharacterEligible({ bboxFillPct: over.bboxFillPct, jointsOutsideMask: [] }).eligible).toBe(false);
  });
});

describe("the pixel a joint falls in is decided, not accidental", () => {
  const m = mask(10, 10, 50); // rows 0-4 foreground

  it("floor: a joint exactly on an integer boundary belongs to the pixel right/below", () => {
    expect(maskPixelAt(m, 4.0, 4.0)).toBe(1); // last foreground row
    expect(maskPixelAt(m, 4.0, 5.0)).toBe(0); // first background row
    expect(maskPixelAt(m, 4.0, 4.999)).toBe(1);
  });

  it("one pixel outside the silhouette is outside", () => {
    expect(maskPixelAt(m, 0, 5)).toBe(0);
  });

  it("off the crop entirely is null, never a silent 0 or 1", () => {
    expect(maskPixelAt(m, -0.001, 0)).toBeNull();
    expect(maskPixelAt(m, 10, 0)).toBeNull();
    expect(maskPixelAt(m, 0, 10)).toBeNull();
    expect(maskPixelAt(m, Number.NaN, 0)).toBeNull();
  });
});

describe("core joints, and ENG-0088's actual meaning", () => {
  it("reports every joint outside — including the ones policy forgives", () => {
    // Measurement lists all of them; arapCharacterEligible filters to core.
    // That separation is what keeps a grazing elbow from failing a character.
    const got = computeEligibilityMetrics(
      artifacts({ joints: { left_elbow: { x: 5, y: 90 }, left_hand: { x: 6, y: 90 } } }),
    );
    expect(got.ok && got.jointsOutsideMask).toEqual(["left_elbow", "left_hand"]);
    const verdict = arapCharacterEligible({
      bboxFillPct: 50,
      jointsOutsideMask: got.ok ? got.jointsOutsideMask : [],
    });
    // Both clean aladdin rigs have one of these outside. Still eligible.
    expect(verdict.eligible).toBe(true);
  });

  it("one core joint off-silhouette is the degenerate-solve class", () => {
    const got = computeEligibilityMetrics(artifacts({ joints: { left_foot: { x: 35, y: 90 } } }));
    expect(got.ok && got.jointsOutsideMask).toContain("left_foot");
    const verdict = arapCharacterEligible({
      bboxFillPct: 50,
      jointsOutsideMask: got.ok ? got.jointsOutsideMask : [],
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("left_foot");
  });

  it("multiple core joints off-silhouette are all named", () => {
    // fisherman collapsed on left_shoulder + left_foot; magician on
    // right_knee + right_foot. An operator should see both, not the first.
    const got = computeEligibilityMetrics(
      artifacts({ joints: { left_shoulder: { x: 30, y: 95 }, left_foot: { x: 35, y: 96 } } }),
    );
    const verdict = arapCharacterEligible({
      bboxFillPct: 50,
      jointsOutsideMask: got.ok ? got.jointsOutsideMask : [],
    });
    expect(verdict.reasons.join(" ")).toContain("left_shoulder");
    expect(verdict.reasons.join(" ")).toContain("left_foot");
  });

  it("uses the existing core-joint list and invents none", () => {
    expect([...ARAP_ELIGIBILITY.coreJoints]).toEqual(["shoulder", "hip", "knee", "foot"]);
  });
});

describe("malformed artifacts fail closed — zero must never read as perfect", () => {
  // 0% fill and no joints outside is the MOST eligible possible measurement.
  // A broken run that returned it would look like the best character in the
  // corpus, so an unmeasurable input can never be expressed as numbers.
  const invalid: [string, AutorigArtifacts][] = [
    ["degenerate bbox", { ...artifacts(), bbox: [10, 20, 10, 120] }],
    ["non-finite bbox", { ...artifacts(), bbox: [Number.NaN, 20, 110, 120] }],
    ["mask smaller than bbox", { ...artifacts(), mask: mask(50, 50, 50) }],
    [
      "mask data length mismatch",
      { ...artifacts(), mask: { width: 100, height: 100, data: new Uint8Array(10) } },
    ],
    ["zero-size mask", { ...artifacts(), mask: { width: 0, height: 0, data: new Uint8Array(0) } }],
    ["no joints", { ...artifacts(), joints: {} }],
    ["no core joints", { ...artifacts(), joints: { left_elbow: { x: 5, y: 5 } } }],
    ["non-finite joint", artifacts({ joints: { left_foot: { x: Number.NaN, y: 5 } } })],
  ];

  for (const [name, a] of invalid) {
    it(`refuses: ${name}`, () => {
      const got = computeEligibilityMetrics(a);
      expect(got.ok).toBe(false);
      expect(got.ok === false && got.reason.length).toBeGreaterThan(0);
      // And emphatically NOT the perfect-looking measurement.
      expect(got).not.toHaveProperty("bboxFillPct");
    });
  }
});

describe("measurement holds no policy", () => {
  it("the metric function names no threshold", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const SRC = readFileSync(join(process.cwd(), "src/lib/arapProvider.ts"), "utf8");
    const fn = SRC.slice(
      SRC.indexOf("export function computeEligibilityMetrics"),
      SRC.indexOf("/**\n * The EXACT reference-runner argv"),
    );
    // It may READ coreJoints (to know what it must be able to verify), but it
    // may not compare against maxBboxFillPct or decide eligibility.
    expect(fn).not.toContain("maxBboxFillPct");
    expect(fn).not.toContain("eligible");
  });
});
