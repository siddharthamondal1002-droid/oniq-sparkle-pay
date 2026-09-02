/**
 * Step 11A is measurement, and these tests exist to prove it can be nothing
 * else. The sixteen production-safety guards the owner asked for are each
 * named; the rest pin the arithmetic, the offline n=6 reference, and the
 * cross-language seam.
 *
 * Nothing here builds, downloads or renders. Evidence is synthetic, produced
 * in the writer's exact shape, plus one fixture produced by the REAL Python
 * writer — so the shape the image emits and the shape this code reads are
 * pinned to each other by a file, not by two people remembering the same
 * thing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARAP_EVIDENCE_SCHEMA,
  evidenceFromDriverRecord,
  type EvidencePackage,
  type EvidenceRecord,
} from "../arapEvidence";
import { aggregate, buildReport, measureEvidence } from "../arapEligibilityCorpus";
import {
  ARAP_ELIGIBILITY,
  ARAP_MOTION_GRAMMAR,
  arapCharacterEligible,
  computeEligibilityMetrics,
  makeArapL3Provider,
  type AutorigArtifacts,
} from "../arapProvider";
import { LEVELS, selectMotionLevel } from "../motionCost";
import { selectProviderOrder, VEO_META, type MotionProvider } from "../motionProvider";
import { planShotMotion, resolveShotMotion, summarizeShotMotion } from "../motionRuntime";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── synthetic evidence ───────────────────────────────────────────────────────

function mask(w: number, h: number, fillPct: number) {
  const data = new Array<number>(w * h).fill(0);
  const on = Math.round((fillPct / 100) * w * h);
  for (let i = 0; i < on; i += 1) data[i] = 1;
  return { width: w, height: h, data };
}

const JOINTS = {
  root: { x: 50, y: 30 },
  hip: { x: 50, y: 30 },
  torso: { x: 50, y: 12 },
  neck: { x: 50, y: 4 },
  right_shoulder: { x: 70, y: 10 },
  right_elbow: { x: 80, y: 30 },
  right_hand: { x: 85, y: 30 },
  left_shoulder: { x: 30, y: 10 },
  left_elbow: { x: 20, y: 30 },
  left_hand: { x: 15, y: 30 },
  right_hip: { x: 65, y: 25 },
  right_knee: { x: 65, y: 10 },
  right_foot: { x: 65, y: 10 },
  left_hip: { x: 35, y: 25 },
  left_knee: { x: 35, y: 10 },
  left_foot: { x: 35, y: 10 },
};

type Over = {
  id?: string;
  fill?: number;
  joints?: Partial<typeof JOINTS>;
  detCount?: number;
  candidate?: number;
  primary?: boolean;
  working?: { width: number; height: number };
  bbox?: unknown;
};

function available(over: Over = {}): EvidenceRecord {
  return {
    schema: ARAP_EVIDENCE_SCHEMA,
    status: "AVAILABLE",
    source: { corpusId: "t", stillId: over.id ?? "still" },
    provenance: { instrument: "test" },
    image: {
      original: { width: 1080, height: 1920 },
      working: over.working ?? { width: 562, height: 1000 },
    },
    candidate: over.candidate ?? 0,
    primary: over.primary ?? true,
    evidence: {
      kind: "artifacts",
      // `in`, not `??`: a caller passing bbox: null means "a null bbox", and
      // `??` would silently swap in the valid default — which is exactly how
      // guard 14's null case passed for the wrong reason the first time.
      bbox: ("bbox" in over ? over.bbox : { format: "ltrb", values: [0, 0, 100, 100] }) as never,
      mask: mask(100, 100, over.fill ?? 50),
      joints: { ...JOINTS, ...over.joints },
    },
    confidence: {
      detector: 0.99,
      detections: over.detCount ?? 1,
      keypointMean: 0.87,
      keypointMin: 0.6,
    },
    poseWarpInputs: {
      characterCount: over.detCount ?? 1,
      longSidePx: Math.max(...Object.values(over.working ?? { width: 562, height: 1000 })),
    },
  };
}

function status(
  s: "MISSING" | "UNAUTHORIZED" | "MALFORMED",
  reason: string,
  detCount = 0,
): EvidenceRecord {
  return {
    schema: ARAP_EVIDENCE_SCHEMA,
    status: s,
    source: { corpusId: "t", stillId: `${s}-${reason}` },
    provenance: { instrument: "test" },
    candidate: null,
    primary: false,
    confidence: { detections: detCount },
    reason,
  };
}

function pkg(records: EvidenceRecord[], corpusId = "t"): EvidencePackage {
  return {
    schema: ARAP_EVIDENCE_SCHEMA,
    corpusId,
    label: corpusId,
    provenance: { instrument: "test" },
    records,
  };
}

const REACHING = {
  still: "A lamplighter reaches up to the gaslamp with his taper.",
  narration: "Arthur climbed the little ladder as he had every night for thirty years.",
  motion: "He raises the taper to the mantle.",
};

// ── GUARDS 1–6: structurally cut off from routing ────────────────────────────

describe("guards 1–6 — the measurement path is cut off from every routing entry point", () => {
  const engine = read("src/lib/arapEligibilityCorpus.ts");
  const evidence = read("src/lib/arapEvidence.ts");
  const bbox = read("src/lib/arapBbox.ts");

  it("1. cannot enable pose-warp: no planner, no policy, no literal", () => {
    for (const src of [engine, evidence, bbox]) {
      expect(src).not.toContain("allowPoseWarp");
      expect(src).not.toContain("planShotMotion");
    }
  });
  it("2. cannot register a MotionProvider", () => {
    for (const src of [engine, evidence, bbox]) {
      expect(src).not.toContain("makeArapL3Provider");
      expect(src).not.toMatch(/\bMotionProvider\b/);
    }
  });
  it("3. cannot alter provider ordering", () => {
    for (const src of [engine, evidence, bbox]) expect(src).not.toContain("selectProviderOrder");
    // And the ordering itself is what it was: ARAP injected with no runner is dropped.
    const arap = makeArapL3Provider(null);
    const veo: MotionProvider = {
      meta: VEO_META,
      available: () => true,
      generate: async () => ({ ok: false, reason: "n/a", provider: "veo", class: "permanent" }),
    };
    const order = selectProviderOrder("WALKING", [arap, veo], { allowPremium: true });
    expect(order.map((p) => p.meta.name)).toEqual([VEO_META.name]);
  });
  it("4. cannot alter selectMotionLevel", () => {
    for (const src of [engine, evidence, bbox]) expect(src).not.toContain("selectMotionLevel");
  });
  it("5. cannot alter planShotMotion, 6. cannot alter resolveShotMotion", () => {
    for (const src of [engine, evidence, bbox]) {
      expect(src).not.toContain("resolveShotMotion");
      expect(src).not.toContain("summarizeShotMotion");
    }
    // Import graph: the engine imports only these, and nothing routing imports it.
    const imports = [...engine.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)]
      .map((m) => m[1])
      .sort();
    expect(imports).toEqual(["./arapBbox", "./arapEvidence", "./arapProvider", "./motionCost"]);
    const mc = engine.match(/import \{([^}]*)\} from "\.\/motionCost"/)?.[1] ?? "";
    expect(
      mc
        .split(",")
        .map((s) => s.trim().replace(/^type /, ""))
        .filter(Boolean)
        .sort(),
    ).toEqual(["PoseWarpEligibilityInput", "poseWarpEligible"]);
    for (const f of [
      "src/lib/motionRuntime.ts",
      "src/lib/motionCost.ts",
      "src/lib/motionProvider.ts",
      "src/lib/arapProvider.ts",
    ]) {
      expect(read(f), f).not.toMatch(/arapEligibilityCorpus|arapEvidence|arapBbox/);
    }
  });
});

describe("the workflow that runs the measurement is read as data, and cannot do more than measure", () => {
  const wf = read(".github/workflows/arap-eligibility-measure.yml");
  const code = wf
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  it("cannot push, cannot enable, cannot render, cannot build", () => {
    expect(code).not.toContain("docker push");
    expect(code).not.toContain("allowPoseWarp");
    expect(code).not.toMatch(/\brender\b/);
    expect(code).not.toContain("docker build");
  });
  it("is read-only on the registry and measures the validated digest with a mounted driver", () => {
    expect(code).toContain("packages: read");
    expect(code).not.toContain("packages: write");
    expect(code).toContain("['validation']['image_build']['digest']");
    expect(code).toContain("/measure:ro");
  });
});

// ── GUARDS 7–9: the policy literals ──────────────────────────────────────────

describe("guards 7–9 — the policy literals are exactly what they were", () => {
  it("7. allowPoseWarp remains false at the planner", () => {
    const src = read("src/lib/motionRuntime.ts");
    expect(src).toContain("poseWarpEligible: false");
    expect(src).toContain("allowPoseWarp: false");
    expect(src).not.toContain("allowPoseWarp: true");
  });
  it("8. the ARAP threshold remains 65% with the same core joints", () => {
    expect(ARAP_ELIGIBILITY).toEqual({
      maxBboxFillPct: 65,
      coreJoints: ["shoulder", "hip", "knee", "foot"],
    });
    // The engine carries no number of its own.
    expect(read("src/lib/arapEligibilityCorpus.ts")).not.toMatch(/\b65\b/);
  });
  it("9. WALKING remains the only grammar entry", () => {
    expect(Object.keys(ARAP_MOTION_GRAMMAR)).toEqual(["WALKING"]);
  });
});

// ── GUARDS 10–11: routing behaviour unchanged ────────────────────────────────

describe("guards 10–11 — known-rig and unknown-character routing are unchanged", () => {
  it("10. a measured rig takes the free specialist tier and never buys a clip in select mode", () => {
    const plan = planShotMotion(REACHING, { hasMeasuredRig: true, clipStage: "select" });
    expect(plan.level).toBe(2);
    expect(plan.attemptClip).toBe(false);
    expect(resolveShotMotion(plan, { clipAttached: false, clipError: null, hasRig: true })).toEqual(
      {
        status: "GENERATED",
        source: "rig",
        provider: "measured-rig",
        fallbackReason: null,
      },
    );
  });
  it("11. an unknown character lands on still + camera, reported honestly", () => {
    const plan = planShotMotion(REACHING, { hasMeasuredRig: false, clipStage: "off" });
    expect(plan.level).toBe(1);
    expect(plan.reason).toMatch(/no animator available/);
    const out = resolveShotMotion(plan, { clipAttached: false, clipError: null, hasRig: false });
    expect(out).toMatchObject({ status: "FALLBACK", source: "none" });
    expect(out.fallbackReason).toMatch(/owner-gated/);
  });
  it("an ELIGIBLE measurement changes nothing the planner sees, and no source becomes pose-warp", () => {
    expect(measureEvidence(available({ fill: 50 })).verdict).toEqual({
      measured: true,
      eligible: true,
      reasons: [],
    });
    const before = planShotMotion(REACHING, { hasMeasuredRig: false, clipStage: "select" });
    const after = planShotMotion(REACHING, { hasMeasuredRig: false, clipStage: "select" });
    expect(after).toEqual(before);
    const out = resolveShotMotion(after, { clipAttached: false, clipError: null, hasRig: false });
    expect(out.source).not.toBe("pose-warp");
    expect(summarizeShotMotion([out]).poseWarpSourced).toBe(0);
    const d = selectMotionLevel(
      REACHING,
      { hasMeasuredRig: false, poseWarpEligible: true },
      { allowPoseWarp: false, allowDiffusion: false, allowPremium: false },
    );
    expect(d.escalation).not.toContain(3);
    expect(LEVELS[3]).toBeDefined();
  });
});

// ── GUARDS 12–15: evidence fails closed ──────────────────────────────────────

describe("guards 12–15 — evidence that is missing, unauthorised or malformed is NOT MEASURED, never ineligible", () => {
  it("12. missing evidence fails closed", () => {
    for (const reason of [
      "NO_HUMANOID_DETECTED",
      "NO_SKELETON",
      "U2NETP_MASK_FAILED",
      "EMPTY_CROP",
      "UNREADABLE_IMAGE",
    ]) {
      const row = measureEvidence(status("MISSING", reason));
      expect(row.verdict).toEqual({ measured: false, eligible: false, status: "MISSING", reason });
      expect(row.bboxFillPct).toBeNull();
    }
  });
  it("13. UNAUTHORIZED evidence is NOT treated as ineligible — it is not counted on either side", () => {
    const rows = [
      available({ id: "a" }),
      status("UNAUTHORIZED", "export not authorised for user bb483798"),
    ].map(measureEvidence);
    const a = aggregate(rows);
    expect(a).toMatchObject({ measured: 1, notMeasured: 1, eligible: 1, rejected: 0 });
    expect(a.notMeasuredByStatus.UNAUTHORIZED).toBe(1);
    expect(a.attributable.unauthorized).toBe(1);
    expect(a.eligibleRateOfMeasured).toBe(1); // the unauthorised record did not dilute the rate
    expect(a.eligibleRateOfAll).toBe(0.5); // but it is visible in the all-records rate
  });
  it("14. a malformed bbox fails closed with the normalizer's reason", () => {
    for (const bbox of [
      null,
      [0, 0, 100, 100],
      { x: 0, y: 0, width: -5, height: 10 },
      { format: "ltrb", values: [50, 50, 10, 60] },
      { left: 0, top: 0, width: 5, height: 5 },
    ]) {
      const row = measureEvidence(available({ bbox }));
      expect(row.verdict.measured).toBe(false);
      expect(row.verdict.eligible).toBe(false);
      expect((row.verdict as { status: string }).status).toBe("MALFORMED");
      expect((row.verdict as { reason: string }).reason).toMatch(/^bbox: /);
    }
  });
  it("artifacts the metric function refuses are MALFORMED, not a perfect score", () => {
    const bad = available();
    if (bad.evidence?.kind === "artifacts")
      bad.evidence.mask = { width: 100, height: 100, data: [] };
    const row = measureEvidence(bad);
    expect(row.verdict).toMatchObject({ measured: false, eligible: false, status: "MALFORMED" });
    expect((row.verdict as { reason: string }).reason).toMatch(/metric refused/);
  });
  it("precomputed metrics out of range are MALFORMED", () => {
    const r = available();
    r.evidence = { kind: "precomputed", bboxFillPct: 140, jointsOutsideMask: [] };
    expect(measureEvidence(r).verdict).toMatchObject({ measured: false, status: "MALFORMED" });
  });
  it("15. bbox normalization is deterministic through the engine", () => {
    const rec = available({ bbox: { x: 10.4, y: 20.6, width: 89.5, height: 79 } });
    const a = measureEvidence(rec);
    const b = measureEvidence(JSON.parse(JSON.stringify(rec)));
    expect(a).toEqual(b);
    expect(a.bbox).toEqual([10, 21, 100, 100]);
    expect(a.bboxFrom).toEqual({ format: "xywh", frame: "working", converted: true });
  });
  it("an empty corpus says so and reports zero eligible with null rates", () => {
    const r = buildReport(pkg([], "empty"), "empty");
    expect(r.missingEvidence).toBe("EMPTY_CORPUS");
    expect(r.aggregates.eligible).toBe(0);
    expect(r.aggregates.eligibleRateOfMeasured).toBeNull();
  });
});

// ── GUARD 16: delegation (the existing synthetic tests keep passing) ─────────

describe("guard 16 — measurement delegates to the existing functions, unchanged", () => {
  it("a row's verdict is exactly arapCharacterEligible(computeEligibilityMetrics(artifacts))", () => {
    for (const rec of [
      available({ fill: 50 }),
      available({ fill: 80 }),
      available({ joints: { left_foot: { x: 35, y: 95 } } }),
    ]) {
      const row = measureEvidence(rec);
      if (rec.evidence?.kind !== "artifacts") throw new Error("fixture");
      const metrics = computeEligibilityMetrics({
        ...rec.evidence,
        bbox: [0, 0, 100, 100],
      } as AutorigArtifacts);
      expect(metrics.ok).toBe(true);
      if (!metrics.ok) return;
      const direct = arapCharacterEligible(metrics);
      expect(row.verdict).toEqual({
        measured: true,
        eligible: direct.eligible,
        reasons: direct.reasons,
      });
      expect(row.bboxFillPct).toBe(metrics.bboxFillPct);
      expect(row.jointsOutsideMask).toEqual(metrics.jointsOutsideMask);
    }
  });
  it("an elbow off the silhouette is reported and does not reject — the metric's documented property", () => {
    const row = measureEvidence(available({ joints: { left_elbow: { x: 20, y: 95 } } }));
    expect(row.jointsOutsideMask).toEqual(["left_elbow"]);
    expect(row.coreJointsOutsideMask).toEqual([]);
    expect(row.verdict).toEqual({ measured: true, eligible: true, reasons: [] });
  });
});

// ── aggregation arithmetic ───────────────────────────────────────────────────

describe("aggregates", () => {
  const a = aggregate(
    [
      available({ id: "s01", fill: 50 }),
      available({ id: "s02", fill: 80 }),
      available({
        id: "s03",
        joints: { left_foot: { x: 35, y: 95 }, right_knee: { x: 65, y: 95 } },
      }),
      available({ id: "s04", fill: 45, detCount: 2 }),
      available({ id: "s04", fill: 70, detCount: 2, candidate: 1, primary: false }),
      status("MISSING", "NO_HUMANOID_DETECTED"),
      status("MISSING", "U2NETP_MASK_FAILED", 1),
      status("UNAUTHORIZED", "not exported"),
    ].map(measureEvidence),
  );
  it("counts stills, records, primaries, and the three ways of not being measured", () => {
    expect(a).toMatchObject({
      totalStills: 7,
      totalRecords: 8,
      primaryCandidates: 4,
      measured: 5,
      notMeasured: 3,
    });
    expect(a.notMeasuredByStatus).toEqual({
      AVAILABLE: 0,
      MISSING: 2,
      UNAUTHORIZED: 1,
      MALFORMED: 0,
    });
  });
  it("splits eligible / rejected with rates over MEASURED, and over all", () => {
    expect(a.eligible).toBe(2);
    expect(a.rejected).toBe(3);
    expect(a.eligibleRateOfMeasured).toBeCloseTo(2 / 5);
    expect(a.eligibleRateOfAll).toBeCloseTo(2 / 8);
  });
  it("attributes by the fixed strings the gates emit", () => {
    expect(a.rejectionReasons).toEqual({ merged_blob: 2, core_joints_off_silhouette: 1 });
    expect(a.jointsOutsideMaskByJoint).toEqual({ left_foot: 1, right_knee: 1 });
    expect(a.jointsOutsideMaskCount.histogram).toEqual({ "0": 4, "2": 1 });
    expect(a.bboxFillPct).toMatchObject({ n: 5, min: 45, max: 80 });
    expect(a.multiCharacterStills).toBe(1);
    expect(a.attributable).toMatchObject({
      multipleCharacters: 2,
      mergedSilhouette: 2,
      coreJointsOffSilhouette: 1,
      noHumanoidDetected: 1,
      maskFailed: 1,
      unauthorized: 1,
      malformed: 0,
    });
  });
  it("records the existing upstream gate's answer with the inputs it actually had", () => {
    expect(a.poseWarpGate.rowsWithInputs).toBe(5);
    expect(a.poseWarpGate.inputsSeen).toEqual({ characterCount: 5, longSidePx: 5 });
    expect(a.poseWarpGate.reasons['framing "unknown" is not full-body']).toBe(5);
    expect(a.poseWarpGate.reasons["multiple characters"]).toBe(2);
    expect(a.poseWarpGate.eligible).toBe(0);
  });
});

// ── OFFLINE n=6 reference ────────────────────────────────────────────────────

describe("OFFLINE_CAST_SHEET_REFERENCE — the recorded n=6 corpus through the engine", () => {
  const p = JSON.parse(
    read("remotion/fixtures/arap-eligibility/offline-cast-sheet-reference.evidence.json"),
  ) as EvidencePackage;
  const report = buildReport(p, p.provenance.note ?? p.label);

  it("is labelled, provisional, and explicit that it is not gateway traffic", () => {
    expect(p.label).toBe("OFFLINE_CAST_SHEET_REFERENCE");
    expect(p.records).toHaveLength(6);
    expect(p.provenance.note).toMatch(/PROVISIONAL/);
    expect(p.provenance.note).toMatch(/not representative of gateway traffic/);
    expect(p.provenance.note).toMatch(/no production eligibility rate/);
    for (const r of p.records) expect(r.evidence?.kind).toBe("precomputed");
  });
  it("reproduces the verdicts the repo's own corpus test pins — 3 eligible, 3 rejected", () => {
    const by = Object.fromEntries(report.rows.map((r) => [r.stillId, r.verdict]));
    expect(by.aladdin_hand).toEqual({ measured: true, eligible: true, reasons: [] });
    expect(by.aladdin_auto).toEqual({ measured: true, eligible: true, reasons: [] });
    expect(by.morgiana).toEqual({ measured: true, eligible: true, reasons: [] });
    expect(by.mother.eligible).toBe(false);
    expect(by.lampJinni.eligible).toBe(false);
    expect(by.fisherman.eligible).toBe(false);
    expect(report.aggregates).toMatchObject({
      measured: 6,
      notMeasured: 0,
      eligible: 3,
      rejected: 3,
    });
    expect(report.aggregates.rejectionReasons).toEqual({
      merged_blob: 2,
      core_joints_off_silhouette: 1,
    });
    expect(report.aggregates.bboxFillPct).toMatchObject({ n: 6, min: 51.7, max: 74.8 });
  });
});

// ── the cross-language seam ──────────────────────────────────────────────────

describe("the Python writer and the TypeScript reader agree on the shape", () => {
  const rec = JSON.parse(read("remotion/fixtures/arap-eligibility/synthetic-record.json"));
  it("the writer declares its bbox representation, and the engine measures it", () => {
    expect(rec.artifacts.bbox).toEqual([100, 200, 200, 300]);
    expect(rec.artifacts.bbox_format).toBe("ltrb");
    const row = measureEvidence(evidenceFromDriverRecord(rec));
    expect(row.verdict).toEqual({ measured: true, eligible: true, reasons: [] });
    expect(row.bbox).toEqual([100, 200, 200, 300]);
    expect(row.bboxFillPct).toBe(50);
    expect(row.confidence).toMatchObject({ detector: 0.991, keypointMean: 0.87 });
    expect(Object.keys(row.coreJoints).sort()).toEqual([
      "hip",
      "left_foot",
      "left_hip",
      "left_knee",
      "left_shoulder",
      "right_foot",
      "right_hip",
      "right_knee",
      "right_shoulder",
    ]);
  });
  it("the old {x, y, width, height} shape is read explicitly, never mistaken for a tuple", () => {
    const legacy = JSON.parse(JSON.stringify(rec));
    legacy.artifacts.bbox = { x: 100, y: 200, width: 100, height: 100 };
    delete legacy.artifacts.bbox_format;
    const row = measureEvidence(evidenceFromDriverRecord(legacy));
    expect(row.verdict.measured).toBe(true);
    expect(row.bbox).toEqual([100, 200, 200, 300]);
    expect(row.bboxFrom).toEqual({ format: "xywh", frame: "working", converted: true });
  });
});
