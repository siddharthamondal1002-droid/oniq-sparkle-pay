/**
 * Step 11B, steps 6–9 — failure classes, the named denominator, the
 * comparison that never merges, and a state machine that never skips a state
 * or promotes the offline reference. Plus the guards that pin this module,
 * like the engine under it, structurally outside routing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARAP_FAILURE_CLASSES,
  DECISION_RULE,
  DENOMINATOR,
  GATEWAY_STATES,
  NOT_MEASURED,
  UPSTREAM_BLOCKERS,
  buildRealCorpusReport,
  classifyRow,
  compareWithOffline,
  decideGatewayState,
  wilsonInterval,
  type RealCorpusReport,
} from "../arapCorpusDecision";
import { buildReport, measureEvidence, type CorpusReport } from "../arapEligibilityCorpus";
import { ARAP_EVIDENCE_SCHEMA, type EvidencePackage, type EvidenceRecord } from "../arapEvidence";
import { verifyEvidencePackage } from "../arapEvidenceVerify";
import { ARAP_ELIGIBILITY, ARAP_MOTION_GRAMMAR } from "../arapProvider";
import { OTHER, kOfN, rawPackage, rawRecord } from "./arapGatewayFixtures";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const OFFLINE_EVIDENCE =
  "remotion/fixtures/arap-eligibility/offline-cast-sheet-reference.evidence.json";
const OFFLINE_REPORT =
  "remotion/fixtures/arap-eligibility/offline-cast-sheet-reference.report.json";
const offlineReport = JSON.parse(read(OFFLINE_REPORT)) as CorpusReport;

function realOf(records: unknown[], over: Parameters<typeof rawPackage>[1] = {}): RealCorpusReport {
  const raw = rawPackage(records, over);
  return buildRealCorpusReport(verifyEvidencePackage(raw), raw, "test");
}

/** A verified record through the engine — the row the classifier sees. */
function rowOf(over: Parameters<typeof rawRecord>[0] = {}) {
  const v = verifyEvidencePackage(rawPackage([rawRecord(over)]));
  return measureEvidence(v.records[0]!);
}

function evidenceRow(rec: Partial<EvidenceRecord>) {
  return measureEvidence({
    schema: ARAP_EVIDENCE_SCHEMA,
    status: "MISSING",
    source: { corpusId: "t", stillId: "s" },
    provenance: { instrument: "test" },
    ...rec,
  } as EvidenceRecord);
}

// ── structurally outside routing, like the engine ────────────────────────────

describe("the 11B modules are cut off from routing, and the policy literals are unchanged", () => {
  const verify = read("src/lib/arapEvidenceVerify.ts");
  const decision = read("src/lib/arapCorpusDecision.ts");
  const cli = read("scripts/arap-real-corpus-decision.ts");
  const imports = (src: string) =>
    [...src.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]).sort();

  it("cannot enable, register, reorder, or plan", () => {
    for (const src of [verify, decision, cli]) {
      for (const s of [
        "allowPoseWarp",
        "planShotMotion",
        "makeArapL3Provider",
        "selectProviderOrder",
        "selectMotionLevel",
        "resolveShotMotion",
        "summarizeShotMotion",
      ]) {
        expect(src).not.toContain(s);
      }
      expect(src).not.toMatch(/\bMotionProvider\b/);
    }
  });
  it("imports only the evidence contract, the bbox normalizer, the verifier and the engine", () => {
    expect(imports(verify)).toEqual(["./arapBbox", "./arapEvidence"]);
    expect(imports(decision)).toEqual([
      "./arapEligibilityCorpus",
      "./arapEvidence",
      "./arapEvidenceVerify",
    ]);
    expect(imports(cli).filter((i) => i.startsWith("../src"))).toEqual([
      "../src/lib/arapCorpusDecision",
      "../src/lib/arapEligibilityCorpus",
      "../src/lib/arapEvidence",
      "../src/lib/arapEvidenceVerify",
    ]);
    for (const f of [
      "src/lib/motionRuntime.ts",
      "src/lib/motionCost.ts",
      "src/lib/motionProvider.ts",
      "src/lib/arapProvider.ts",
    ]) {
      expect(read(f), f).not.toMatch(/arapEvidenceVerify|arapCorpusDecision|arapEligibilityCorpus/);
    }
  });
  it("carries no threshold of its own; the ARAP envelope and the grammar are what they were", () => {
    expect(verify).not.toMatch(/\b65\b/);
    expect(decision).not.toMatch(/\b65\b/);
    expect(ARAP_ELIGIBILITY).toEqual({
      maxBboxFillPct: 65,
      coreJoints: ["shoulder", "hip", "knee", "foot"],
    });
    expect(Object.keys(ARAP_MOTION_GRAMMAR)).toEqual(["WALKING"]);
    expect(read("src/lib/motionRuntime.ts")).toContain("allowPoseWarp: false");
    expect(read("src/lib/motionRuntime.ts")).not.toContain("allowPoseWarp: true");
  });
  it("the decision rule is named provisional, and is not an ARAP threshold", () => {
    expect(DECISION_RULE.standing).toMatch(/PROVISIONAL/);
    expect(DECISION_RULE.minMeasured).toBe(6);
    expect(DECISION_RULE.majority).toBe(0.5);
    expect(Object.keys(DECISION_RULE)).not.toContain("maxBboxFillPct");
  });
});

describe("the workflow's decision step is read as data", () => {
  const wf = read(".github/workflows/arap-eligibility-measure.yml");
  const code = wf
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  it("decides only from a corpus that carries the owner's manifest, and can still do nothing else", () => {
    expect(code).toContain("if [ -f corpus/corpus-manifest.json ]");
    expect(code).toContain(
      "scripts/arap-real-corpus-decision.ts --driver-out out --corpus-manifest corpus/corpus-manifest.json",
    );
    expect(code).toContain("REAL_GATEWAY_CORPUS_PENDING");
    expect(code).not.toContain("docker push");
    expect(code).not.toContain("docker build");
    expect(code).not.toContain("allowPoseWarp");
    expect(code).not.toMatch(/\brender\b/);
    expect(code).toContain("packages: read");
    expect(code).not.toContain("packages: write");
  });
});

// ── STEP 6: failure classes ──────────────────────────────────────────────────

describe("failure classes are evidence-supported, or UNKNOWN", () => {
  it("an eligible row has no class; the two gate rejections map to their classes", () => {
    expect(classifyRow(rowOf({ fill: 50 }))).toEqual({
      arap: [],
      evidence: null,
      upstream: ["framing_unknown"],
    });
    expect(classifyRow(rowOf({ fill: 80 })).arap).toEqual(["bbox_fill_exceeded"]);
    expect(classifyRow(rowOf({ joints: { left_foot: { x: 35, y: 95 } } })).arap).toEqual([
      "core_joint_outside_mask",
    ]);
    expect(classifyRow(rowOf({ fill: 80, joints: { left_foot: { x: 35, y: 95 } } })).arap).toEqual([
      "bbox_fill_exceeded",
      "core_joint_outside_mask",
    ]);
  });
  it("NOT MEASURED rows classify by what the driver or the verifier established", () => {
    const missing = (reason: string) =>
      classifyRow(evidenceRow({ status: "MISSING", reason })).evidence;
    expect(missing("NO_HUMANOID_DETECTED")).toBe("detector_failure");
    expect(missing("NO_SKELETON")).toBe("pose_failure");
    expect(missing("U2NETP_MASK_FAILED")).toBe("missing_mask");
    expect(missing("UNREADABLE_IMAGE")).toBe("missing");
    expect(missing("NOT_IN_DRIVER_OUTPUT — listed, absent")).toBe("missing");
    expect(missing("EMPTY_CROP")).toBe("UNKNOWN_EVIDENCE_FAILURE");
    expect(
      classifyRow(evidenceRow({ status: "UNAUTHORIZED", reason: "outside scope" })).evidence,
    ).toBe("unauthorized");
    expect(classifyRow(rowOf({ bbox: null })).evidence).toBe("malformed_bbox");
    expect(classifyRow(rowOf({ mask: undefined })).evidence).toBe("missing_mask");
    expect(classifyRow(rowOf({ confidence: undefined })).evidence).toBe("malformed_evidence");
    expect(classifyRow(rowOf({ owner: OTHER })).evidence).toBe("unauthorized");
  });
  it("upstream blockers come from the existing gate's own strings; an unknown framing is not a framing finding", () => {
    const up = (poseWarpInputs: unknown) => classifyRow(rowOf({ poseWarpInputs })).upstream;
    expect(up({ characterCount: 2 })).toEqual(["multiple_character", "framing_unknown"]);
    expect(up({ longSidePx: 100 })).toEqual(["insufficient_resolution", "framing_unknown"]);
    expect(up({ occluded: true, framing: "full" })).toEqual(["occlusion"]);
    expect(up({ nonFrontal: true, framing: "full" })).toEqual(["framing"]);
    expect(up({ framing: "close-up" })).toEqual(["framing"]);
    expect(up({ stylized: false, framing: "full" })).toEqual(["photoreal"]);
    expect(up({ armsAgainstTorso: true, framing: "full" })).toEqual(["arms_against_torso"]);
    expect(up({ framing: "full" })).toEqual([]);
    expect(up(undefined)).toEqual([]);
  });
  it("every class name is one the report can carry", () => {
    expect(ARAP_FAILURE_CLASSES).toContain("UNKNOWN_EVIDENCE_FAILURE");
    expect(UPSTREAM_BLOCKERS).toContain("UNKNOWN_EVIDENCE_FAILURE");
  });
});

// ── STEP 7: the report and its denominator ───────────────────────────────────

describe("the real-corpus report", () => {
  const report = realOf([
    rawRecord({ id: "a1", fill: 50 }),
    rawRecord({ id: "a2", fill: 50 }),
    rawRecord({ id: "a3", fill: 80 }),
    rawRecord({ id: "a4", joints: { left_foot: { x: 35, y: 95 } } }),
    rawRecord({ id: "u1", owner: OTHER }),
    rawRecord({ id: "u2", owner: OTHER, fill: 50 }),
    rawRecord({ id: "m1", status: "MISSING", reason: "NO_HUMANOID_DETECTED", evidence: undefined }),
    rawRecord({ id: "x1", bbox: null }),
  ]);
  it("counts supplied, valid, measured and the three ways of not being measured — and they add up", () => {
    expect(report.counts).toEqual({
      supplied: 8,
      valid: 4,
      measured: 4,
      notMeasured: { missing: 1, unauthorized: 2, malformed: 1 },
      eligible: 2,
      rejected: 2,
    });
  });
  it("names its denominator and divides by it alone", () => {
    expect(report.denominator).toBe("MEASURED_VALID_RECORDS");
    expect(DENOMINATOR).toBe("MEASURED_VALID_RECORDS");
    expect(report.eligibleRate).toBe(2 / 4);
    expect(report.eligibleRate).not.toBe(2 / 8);
    expect(Object.keys(report).some((k) => /OfAll|OfSupplied|Discovered/i.test(k))).toBe(false);
    expect(JSON.stringify(report)).not.toContain("eligibleRateOfAll");
    expect(report.eligibleRateInterval95).toEqual(wilsonInterval(2, 4, 1.959964));
  });
  it("distributes rejections and failure classes, and records the upstream gate apart", () => {
    expect(report.rejectionDistribution).toEqual({
      bbox_fill_exceeded: 1,
      core_joint_outside_mask: 1,
    });
    expect(report.failureClasses).toEqual({
      bbox_fill_exceeded: 1,
      core_joint_outside_mask: 1,
      unauthorized: 2,
      detector_failure: 1,
      malformed_bbox: 1,
    });
    expect(report.upstreamBlockers).toEqual({ framing_unknown: 4 });
    expect(report.bboxFillPct).toMatchObject({ n: 4, min: 50, max: 80 });
    expect(report.jointsOutsideMask.byJoint).toEqual({ left_foot: 1 });
    expect(report.primaryOnly).toEqual({ measured: 4, eligible: 2, eligibleRate: 0.5 });
  });
  it("lists every still with its status, and never a verdict for one that was not measured", () => {
    expect(report.perStill).toHaveLength(8);
    const by = Object.fromEntries(report.perStill.map((p) => [p.stillId, p]));
    expect(by.a1).toMatchObject({
      measured: true,
      eligible: true,
      status: "AVAILABLE",
      classes: [],
    });
    expect(by.a3).toMatchObject({
      measured: true,
      eligible: false,
      classes: ["bbox_fill_exceeded"],
    });
    expect(by.u1).toMatchObject({
      measured: false,
      eligible: null,
      status: "UNAUTHORIZED",
      classes: ["unauthorized"],
    });
    expect(by.m1).toMatchObject({
      measured: false,
      eligible: null,
      status: "MISSING",
      classes: ["detector_failure"],
    });
    expect(by.x1).toMatchObject({
      measured: false,
      eligible: null,
      status: "MALFORMED",
      classes: ["malformed_bbox"],
    });
  });
  it("says what the number cannot: unauthorised and unmeasured records are caveats, not failures", () => {
    expect(report.caveats.some((c) => /2 record\(s\) UNAUTHORIZED/.test(c))).toBe(true);
    expect(report.caveats.some((c) => /never counted as ineligible/.test(c))).toBe(true);
    expect(report.population).toBe("gateway");
    expect(report.evidencePackageVersion).toBe(ARAP_EVIDENCE_SCHEMA);
    expect(report.thresholds).toEqual({
      maxBboxFillPct: ARAP_ELIGIBILITY.maxBboxFillPct,
      coreJoints: ARAP_ELIGIBILITY.coreJoints,
    });
    expect(report.verification.checksFailed.authorization).toBe(2);
    expect(report.verification.checksFailed.bbox).toBe(1);
  });
});

describe("Wilson interval", () => {
  it("matches hand-computed values and is null without a denominator", () => {
    const z = 1.959964;
    expect(wilsonInterval(6, 6, z)).toEqual({ lo: 0.6097, hi: 1 });
    expect(wilsonInterval(0, 6, z)).toEqual({ lo: 0, hi: 0.3903 });
    expect(wilsonInterval(14, 18, z)?.lo).toBeCloseTo(0.5479, 3);
    expect(wilsonInterval(13, 18, z)?.lo).toBeCloseTo(0.4913, 3);
    expect(wilsonInterval(0, 0, z)).toBeNull();
    expect(wilsonInterval(7, 6, z)).toBeNull();
  });
});

// ── STEP 8: comparison ───────────────────────────────────────────────────────

describe("comparison keeps the populations apart", () => {
  it("with no gateway report, production eligibility is NOT MEASURED and the offline n is not the gateway n", () => {
    const c = compareWithOffline(offlineReport, null);
    expect(c.populationsMerged).toBe(false);
    expect(c.offline).toMatchObject({
      label: "OFFLINE_CAST_SHEET_REFERENCE",
      n: 6,
      eligible: 3,
      rejected: 3,
      eligibleRate: 0.5,
      standing: "PROVISIONAL_REFERENCE",
    });
    expect(c.gateway).toMatchObject({
      n: 0,
      eligible: 0,
      eligibleRate: NOT_MEASURED,
      standing: "NOT_MEASURED",
    });
    expect(c.productionEligibility).toBe("NOT MEASURED");
  });
  it("with a gateway report, the two stand side by side and nothing is summed", () => {
    const c = compareWithOffline(offlineReport, realOf(kOfN(4, 9)));
    expect(c.offline.n).toBe(6);
    expect(c.gateway).toMatchObject({ n: 9, eligible: 4, rejected: 5, standing: "MEASURED" });
    expect(c.gateway.eligibleRate).toBeCloseTo(4 / 9);
    expect(c.productionEligibility).toBeCloseTo(4 / 9);
    expect(JSON.stringify(c)).not.toContain('"n":15');
  });
  it("an offline-population report offered as the gateway side is refused", () => {
    const raw = JSON.parse(read(OFFLINE_EVIDENCE));
    const asReal = buildRealCorpusReport(
      verifyEvidencePackage(raw),
      raw,
      "offline through the 11B builder",
    );
    const c = compareWithOffline(offlineReport, asReal);
    expect(c.gateway.eligibleRate).toBe(NOT_MEASURED);
    expect(c.productionEligibility).toBe(NOT_MEASURED);
  });
});

// ── STEP 9: the state machine ────────────────────────────────────────────────

describe("the decision gate ends in exactly one state and never skips one", () => {
  const terminal = (d: ReturnType<typeof decideGatewayState>) => {
    expect(GATEWAY_STATES).toContain(d.state);
    expect(d.state).not.toBe("REAL_GATEWAY_CORPUS_MEASURED");
    expect(d.path[d.path.length - 1]).toBe(d.state);
    if (d.state !== "REAL_GATEWAY_CORPUS_PENDING") {
      expect(d.path).toEqual(["REAL_GATEWAY_CORPUS_MEASURED", d.state]);
    } else expect(d.path).toEqual(["REAL_GATEWAY_CORPUS_PENDING"]);
    expect(d.denominator).toBe("MEASURED_VALID_RECORDS");
    return d;
  };

  it("no package: REAL_GATEWAY_CORPUS_PENDING, with no measurement of any kind", () => {
    const d = terminal(decideGatewayState(null));
    expect(d.state).toBe("REAL_GATEWAY_CORPUS_PENDING");
    expect(d).toMatchObject({ measured: 0, eligible: 0, eligibleRate: null, interval95: null });
    expect(d.reasons).toEqual(["no gateway evidence package was supplied"]);
  });
  it("the OFFLINE_CAST_SHEET_REFERENCE can never be promoted: six measured, three eligible, and still PENDING", () => {
    const raw = JSON.parse(read(OFFLINE_EVIDENCE));
    const asReal = buildRealCorpusReport(verifyEvidencePackage(raw), raw, "offline");
    expect(asReal.counts.measured).toBe(6);
    const d = terminal(decideGatewayState(asReal));
    expect(d.state).toBe("REAL_GATEWAY_CORPUS_PENDING");
    expect(d.reasons[0]).toMatch(/population "offline-reference" is not gateway/);
    expect(d.reasons[0]).toMatch(/cannot be promoted to REAL_GATEWAY_CORPUS_MEASURED/);
    expect(d.measured).toBe(0);
  });
  it("a gateway package nobody authorised measures nothing and stays PENDING", () => {
    const d = terminal(decideGatewayState(realOf(kOfN(6, 6), { authorization: undefined })));
    expect(d.state).toBe("REAL_GATEWAY_CORPUS_PENDING");
    expect(d.reasons[0]).toMatch(/failed verification: package carries no authorization record/);
    const other = terminal(
      decideGatewayState(
        realOf(
          kOfN(6, 6).map((r) => ({
            ...r,
            source: { ...(r.source as object), ownerUserId: OTHER },
          })),
        ),
      ),
    );
    expect(other.state).toBe("REAL_GATEWAY_CORPUS_PENDING");
    expect(other.reasons[0]).toMatch(
      /no authorised valid record was measured \(supplied 6: missing 0, unauthorized 6, malformed 0\)/,
    );
  });
  it("too few measured records: MEASURED, then REAL_CORPUS_INSUFFICIENT, and no architecture decision", () => {
    const d = terminal(decideGatewayState(realOf(kOfN(3, 3))));
    expect(d.state).toBe("REAL_CORPUS_INSUFFICIENT");
    expect(d.measured).toBe(3);
    expect(d.reasons[0]).toMatch(/3 measured record\(s\) is below the 6/);
    expect(terminal(decideGatewayState(realOf(kOfN(5, 5)))).state).toBe("REAL_CORPUS_INSUFFICIENT");
  });
  it("reads the interval, not the point estimate: at n=6 only a unanimous result decides A or C", () => {
    expect(terminal(decideGatewayState(realOf(kOfN(6, 6)))).state).toBe(
      "ARAP_ELIGIBILITY_GATE_SUPPORTED",
    );
    expect(terminal(decideGatewayState(realOf(kOfN(5, 6)))).state).toBe(
      "ARAP_AS_SELECTIVE_PROVIDER",
    );
    expect(terminal(decideGatewayState(realOf(kOfN(3, 6)))).state).toBe(
      "ARAP_AS_SELECTIVE_PROVIDER",
    );
    expect(terminal(decideGatewayState(realOf(kOfN(1, 6)))).state).toBe(
      "ARAP_AS_SELECTIVE_PROVIDER",
    );
    expect(terminal(decideGatewayState(realOf(kOfN(0, 6)))).state).toBe(
      "GATEWAY_INPUT_CONSTRAINT_REQUIRED",
    );
  });
  it("at n=18 (the owner's current gateway stills) A needs 14, C allows 4, B is everything between", () => {
    expect(terminal(decideGatewayState(realOf(kOfN(14, 18)))).state).toBe(
      "ARAP_ELIGIBILITY_GATE_SUPPORTED",
    );
    expect(terminal(decideGatewayState(realOf(kOfN(13, 18)))).state).toBe(
      "ARAP_AS_SELECTIVE_PROVIDER",
    );
    expect(terminal(decideGatewayState(realOf(kOfN(5, 18)))).state).toBe(
      "ARAP_AS_SELECTIVE_PROVIDER",
    );
    expect(terminal(decideGatewayState(realOf(kOfN(4, 18)))).state).toBe(
      "GATEWAY_INPUT_CONSTRAINT_REQUIRED",
    );
    const d = decideGatewayState(realOf(kOfN(4, 18)));
    expect(d.reasons[0]).toMatch(/the envelope is not loosened/);
    expect(d.failureClasses).toEqual({ bbox_fill_exceeded: 14 });
  });
  it("unauthorised records shrink n and never lower the rate: 6 of 6 authorised, 27 refused, is still CASE A with a caveat", () => {
    const records = [
      ...kOfN(6, 6),
      ...Array.from({ length: 27 }, (_, i) => rawRecord({ id: `o${i}`, owner: OTHER, fill: 80 })),
    ];
    const d = terminal(decideGatewayState(realOf(records)));
    expect(d.state).toBe("ARAP_ELIGIBILITY_GATE_SUPPORTED");
    expect(d.measured).toBe(6);
    expect(d.eligible).toBe(6);
    expect(d.caveats.some((c) => /27 record\(s\) UNAUTHORIZED/.test(c))).toBe(true);
  });
});

// ── the 11A fixture is untouched by its population tag ───────────────────────

describe("the committed offline reference", () => {
  it("declares its population and still produces the committed report byte for byte", () => {
    const p = JSON.parse(read(OFFLINE_EVIDENCE)) as EvidencePackage;
    expect(p.population).toBe("offline-reference");
    expect("authorization" in p).toBe(false);
    expect(buildReport(p, p.provenance.note ?? p.label)).toEqual(offlineReport);
  });
});

// ── the CLI, end to end ──────────────────────────────────────────────────────

describe("the decision CLI", () => {
  const script = "scripts/arap-real-corpus-decision.ts";
  const run = (...args: string[]) =>
    execFileSync("npx", ["tsx", script, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 180_000,
    });

  it("with nothing supplied prints REAL_GATEWAY_CORPUS_PENDING and writes nothing", () => {
    const out = run();
    expect(out).toContain("STATE: REAL_GATEWAY_CORPUS_PENDING");
    expect(out).toContain("production eligibility     NOT MEASURED");
    expect(out).toContain("(no package supplied: nothing written)");
  }, 200_000);
  it("with the offline reference prints PENDING and leaves no real-gateway file", () => {
    const dir = mkdtempSync(join(tmpdir(), "arap-11b-"));
    const out = run("--package", OFFLINE_EVIDENCE, "--out-dir", dir);
    expect(out).toContain("STATE: REAL_GATEWAY_CORPUS_PENDING");
    expect(out).toContain("cannot be promoted");
    expect(readdirSync(dir)).toEqual([]);
  }, 200_000);
  it("with a synthetic gateway package writes the two named files and one terminal state", () => {
    const dir = mkdtempSync(join(tmpdir(), "arap-11b-"));
    const file = join(dir, "synthetic.evidence.json");
    writeFileSync(
      file,
      JSON.stringify(rawPackage(kOfN(6, 6), { label: "SYNTHETIC-NOT-A-GATEWAY-STILL" })),
    );
    const out = run("--package", file, "--out-dir", dir);
    expect(out).toContain("STATE: ARAP_ELIGIBILITY_GATE_SUPPORTED");
    expect(existsSync(join(dir, "real-gateway-eligibility-reference.evidence.json"))).toBe(true);
    const written = JSON.parse(
      readFileSync(join(dir, "real-gateway-eligibility-reference.report.json"), "utf8"),
    );
    expect(written.decision.path).toEqual([
      "REAL_GATEWAY_CORPUS_MEASURED",
      "ARAP_ELIGIBILITY_GATE_SUPPORTED",
    ]);
    expect(written.report.denominator).toBe("MEASURED_VALID_RECORDS");
    expect(written.comparison.populationsMerged).toBe(false);
    expect(written.comparison.offline.n).toBe(6);
  }, 200_000);
});
