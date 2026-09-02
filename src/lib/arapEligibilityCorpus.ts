/**
 * Step 11A — measure the EXISTING ARAP eligibility envelope on a corpus.
 *
 * OBSERVATIONAL ONLY, and structurally so. This module imports exactly two
 * decision functions — `computeEligibilityMetrics` and `arapCharacterEligible`
 * from arapProvider.ts — plus `poseWarpEligible` from motionCost.ts, the
 * bbox normalizer, and the evidence contract. It calls the decision functions
 * unchanged. It holds no threshold, registers no provider, touches no plan,
 * and produces nothing a shot could consume: its output is a report. Nothing
 * in the routing code imports it, and the tests pin that it cannot become an
 * input to routing.
 *
 * NOT MEASURED IS NOT INELIGIBLE. A record whose status is MISSING,
 * UNAUTHORIZED or MALFORMED — or whose artifacts the normalizer or the metric
 * function refuse — is counted apart from eligible and rejected. It can never
 * be read as either. Zero is a legitimate measurement here, so it can never
 * double as "not measured".
 *
 * WHAT `poseWarpGate` IS AND IS NOT. motionCost.ts already carries the
 * upstream L3 gate (framing, occlusion, character count, resolution). Only
 * the inputs the evidence actually carries are given to it; the rest are
 * unknown, and the existing gate FAILS CLOSED on an unknown framing. That
 * answer is recorded verbatim, labelled with which inputs were known. It is
 * the honest output of the existing gate given the evidence — not a
 * reinterpretation, and not a finding about the stills.
 */
import { normalizeBbox } from "./arapBbox";
import type { EvidencePackage, EvidenceRecord, EvidenceStatus } from "./arapEvidence";
import {
  ARAP_ELIGIBILITY,
  arapCharacterEligible,
  computeEligibilityMetrics,
  type AutorigArtifacts,
} from "./arapProvider";
import { poseWarpEligible, type PoseWarpEligibilityInput } from "./motionCost";

export const MEASUREMENT_SCHEMA = "oniq.arap-eligibility-measurement/2" as const;

// ── OUTPUT: one row per evidence record ──────────────────────────────────────

export type Verdict =
  | { measured: true; eligible: boolean; reasons: string[] }
  | { measured: false; eligible: false; status: EvidenceStatus; reason: string };

export type MeasurementRow = {
  corpusId: string;
  stillId: string;
  jobId: string | null;
  sceneId: string | null;
  shotId: string | null;
  sourceFile: string | null;
  sourceSha256: string | null;
  candidate: number | null;
  primary: boolean;
  evidenceKind: "artifacts" | "precomputed" | null;
  image: {
    original: { width: number; height: number } | null;
    working: { width: number; height: number } | null;
  };
  /** Canonical working-frame [l, t, r, b], or null when not normalizable. */
  bbox: number[] | null;
  bboxFrom: { format: string; frame: string; converted: boolean } | null;
  bboxFillPct: number | null;
  coreJoints: Record<string, { x: number; y: number }>;
  jointsOutsideMask: string[];
  coreJointsOutsideMask: string[];
  confidence: EvidenceRecord["confidence"];
  extra: Record<string, unknown>;
  verdict: Verdict;
  /** The EXISTING upstream L3 gate, given only the inputs the evidence had. */
  poseWarpGate: { inputsKnown: string[]; eligible: boolean; reasons: string[] } | null;
  provenance: EvidenceRecord["provenance"];
};

const CORE = ARAP_ELIGIBILITY.coreJoints;
const isCoreJoint = (name: string) => CORE.some((c) => name.includes(c));

function coreJointsOf(joints: AutorigArtifacts["joints"]) {
  const out: Record<string, { x: number; y: number }> = {};
  for (const [name, p] of Object.entries(joints))
    if (isCoreJoint(name)) out[name] = { x: p.x, y: p.y };
  return out;
}

function upstreamGate(inputs: Partial<PoseWarpEligibilityInput> | undefined) {
  if (!inputs) return null;
  const known = Object.entries(inputs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k]) => k)
    .sort();
  if (known.length === 0) return null;
  const clean: Partial<PoseWarpEligibilityInput> = {};
  for (const k of known)
    (clean as Record<string, unknown>)[k] = (inputs as Record<string, unknown>)[k];
  const g = poseWarpEligible(clean);
  return { inputsKnown: known, eligible: g.eligible, reasons: g.reasons };
}

function notMeasured(status: EvidenceStatus, reason: string): Verdict {
  return { measured: false, eligible: false, status, reason };
}

/** Measure ONE evidence record with the production functions, unchanged. */
export function measureEvidence(r: EvidenceRecord): MeasurementRow {
  const base = {
    corpusId: r.source.corpusId,
    stillId: r.source.stillId,
    jobId: r.source.jobId ?? null,
    sceneId: r.source.sceneId ?? null,
    shotId: r.source.shotId ?? null,
    sourceFile: r.source.file ?? null,
    sourceSha256: r.source.sha256 ?? null,
    candidate: r.candidate ?? null,
    primary: r.primary ?? false,
    evidenceKind: r.evidence?.kind ?? null,
    image: { original: r.image?.original ?? null, working: r.image?.working ?? null },
    confidence: r.confidence,
    extra: r.extra ?? {},
    poseWarpGate: upstreamGate(r.poseWarpInputs),
    provenance: r.provenance,
  };
  const empty = {
    bbox: null,
    bboxFrom: null,
    bboxFillPct: null,
    coreJoints: {},
    jointsOutsideMask: [],
    coreJointsOutsideMask: [],
  };

  if (r.status !== "AVAILABLE") {
    return { ...base, ...empty, verdict: notMeasured(r.status, r.reason ?? r.status) };
  }
  if (!r.evidence) {
    return {
      ...base,
      ...empty,
      verdict: notMeasured("MALFORMED", "status AVAILABLE but no evidence"),
    };
  }

  // Recorded numbers from an earlier run: the gate applies directly.
  if (r.evidence.kind === "precomputed") {
    const { bboxFillPct, jointsOutsideMask } = r.evidence;
    if (
      !Number.isFinite(bboxFillPct) ||
      bboxFillPct < 0 ||
      bboxFillPct > 100 ||
      !Array.isArray(jointsOutsideMask)
    ) {
      return {
        ...base,
        ...empty,
        verdict: notMeasured("MALFORMED", "precomputed metrics out of range or missing"),
      };
    }
    const d = arapCharacterEligible({ bboxFillPct, jointsOutsideMask });
    return {
      ...base,
      ...empty,
      bboxFillPct,
      jointsOutsideMask,
      coreJointsOutsideMask: jointsOutsideMask.filter(isCoreJoint),
      verdict: { measured: true, eligible: d.eligible, reasons: d.reasons },
    };
  }

  // Raw artifacts: normalize the bbox first, then the existing metric.
  const working = r.image?.working;
  if (!working) {
    return {
      ...base,
      ...empty,
      verdict: notMeasured("MALFORMED", "artifacts without working image dimensions"),
    };
  }
  const nb = normalizeBbox(
    r.evidence.bbox,
    { working, original: r.image?.original },
    r.evidence.bboxFormat,
  );
  if (!nb.ok) {
    return {
      ...base,
      ...empty,
      coreJoints: coreJointsOf(r.evidence.joints),
      verdict: notMeasured("MALFORMED", `bbox: ${nb.reason}`),
    };
  }
  const artifacts: AutorigArtifacts = {
    bbox: nb.bbox.values,
    mask: r.evidence.mask,
    joints: r.evidence.joints,
  };
  const metrics = computeEligibilityMetrics(artifacts);
  const bboxOut = {
    bbox: [...nb.bbox.values],
    bboxFrom: nb.bbox.from,
    coreJoints: coreJointsOf(r.evidence.joints),
  };
  if (!metrics.ok) {
    return {
      ...base,
      ...empty,
      ...bboxOut,
      verdict: notMeasured("MALFORMED", `metric refused: ${metrics.reason}`),
    };
  }
  const d = arapCharacterEligible(metrics);
  return {
    ...base,
    ...bboxOut,
    bboxFillPct: metrics.bboxFillPct,
    jointsOutsideMask: metrics.jointsOutsideMask,
    coreJointsOutsideMask: metrics.jointsOutsideMask.filter(isCoreJoint),
    verdict: { measured: true, eligible: d.eligible, reasons: d.reasons },
  };
}

// ── AGGREGATES ───────────────────────────────────────────────────────────────

export type Distribution = {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  histogram: Record<string, number>;
};

function distribution(values: number[], bucket: (v: number) => string): Distribution {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const histogram: Record<string, number> = {};
  for (const x of v) histogram[bucket(x)] = (histogram[bucket(x)] ?? 0) + 1;
  if (v.length === 0) return { n: 0, min: null, max: null, mean: null, median: null, histogram };
  const mid = Math.floor(v.length / 2);
  // Four decimals: these land in committed reports, and floating-point noise
  // (60.199999999999996) is a diff nobody should have to review.
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  return {
    n: v.length,
    min: v[0],
    max: v[v.length - 1],
    mean: r4(v.reduce((a, b) => a + b, 0) / v.length),
    median: r4(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2),
    histogram,
  };
}

const fillBucket = (v: number) => {
  const lo = Math.min(90, Math.floor(v / 10) * 10);
  return `${lo}-${lo + 10}%`;
};

export type Aggregates = {
  corpusId: string;
  totalStills: number;
  totalRecords: number;
  primaryCandidates: number;
  measured: number;
  notMeasured: number;
  /** NOT MEASURED, by the status that made it so. Never folded into rejected. */
  notMeasuredByStatus: Record<EvidenceStatus, number>;
  notMeasuredReasons: Record<string, number>;
  eligible: number;
  rejected: number;
  eligibleRateOfMeasured: number | null;
  eligibleRateOfAll: number | null;
  rejectedRateOfMeasured: number | null;
  rejectionReasons: Record<"merged_blob" | "core_joints_off_silhouette", number>;
  bboxFillPct: Distribution;
  jointsOutsideMaskCount: Distribution;
  jointsOutsideMaskByJoint: Record<string, number>;
  detectionsPerStill: Distribution;
  multiCharacterStills: number;
  poseWarpGate: {
    rowsWithInputs: number;
    inputsSeen: Record<string, number>;
    reasons: Record<string, number>;
    eligible: number;
  };
  attributable: {
    multipleCharacters: number;
    tooSmallToRig: number;
    mergedSilhouette: number;
    coreJointsOffSilhouette: number;
    noHumanoidDetected: number;
    noSkeleton: number;
    maskFailed: number;
    unauthorized: number;
    malformed: number;
  };
};

export function aggregate(rows: MeasurementRow[]): Aggregates {
  const corpusId = rows[0]?.corpusId ?? "empty";
  const stills = new Set(rows.map((r) => r.stillId));
  const measured = rows.filter((r) => r.verdict.measured);
  const eligible = measured.filter((r) => r.verdict.eligible);
  const rejected = measured.filter((r) => !r.verdict.eligible);
  const notMeasured = rows.filter((r) => !r.verdict.measured);

  const rejectionReasons = { merged_blob: 0, core_joints_off_silhouette: 0 };
  for (const r of rejected) {
    if (!r.verdict.measured) continue;
    for (const reason of r.verdict.reasons) {
      if (reason.startsWith("silhouette is a merged blob")) rejectionReasons.merged_blob += 1;
      else if (reason.startsWith("core joints off the silhouette"))
        rejectionReasons.core_joints_off_silhouette += 1;
    }
  }

  const notMeasuredByStatus: Record<EvidenceStatus, number> = {
    AVAILABLE: 0,
    MISSING: 0,
    UNAUTHORIZED: 0,
    MALFORMED: 0,
  };
  const notMeasuredReasons: Record<string, number> = {};
  for (const r of notMeasured) {
    if (r.verdict.measured) continue;
    notMeasuredByStatus[r.verdict.status] += 1;
    notMeasuredReasons[r.verdict.reason] = (notMeasuredReasons[r.verdict.reason] ?? 0) + 1;
  }

  const byJoint: Record<string, number> = {};
  for (const r of measured) for (const j of r.jointsOutsideMask) byJoint[j] = (byJoint[j] ?? 0) + 1;

  const detByStill = new Map<string, number>();
  for (const r of rows) {
    const d = r.confidence?.detections ?? 0;
    detByStill.set(r.stillId, Math.max(detByStill.get(r.stillId) ?? 0, d));
  }
  const dets = [...detByStill.values()];

  const gateReasons: Record<string, number> = {};
  const inputsSeen: Record<string, number> = {};
  let gateEligible = 0;
  let rowsWithInputs = 0;
  for (const r of rows) {
    if (!r.poseWarpGate) continue;
    rowsWithInputs += 1;
    if (r.poseWarpGate.eligible) gateEligible += 1;
    for (const k of r.poseWarpGate.inputsKnown) inputsSeen[k] = (inputsSeen[k] ?? 0) + 1;
    for (const reason of r.poseWarpGate.reasons)
      gateReasons[reason] = (gateReasons[reason] ?? 0) + 1;
  }

  const count = (pred: (r: MeasurementRow) => boolean) => rows.filter(pred).length;
  const rate = (n: number, d: number) => (d === 0 ? null : n / d);
  const reasonCount = (needle: string) =>
    Object.entries(notMeasuredReasons)
      .filter(([k]) => k.includes(needle))
      .reduce((a, [, v]) => a + v, 0);

  return {
    corpusId,
    totalStills: stills.size,
    totalRecords: rows.length,
    primaryCandidates: count((r) => r.primary),
    measured: measured.length,
    notMeasured: notMeasured.length,
    notMeasuredByStatus,
    notMeasuredReasons,
    eligible: eligible.length,
    rejected: rejected.length,
    eligibleRateOfMeasured: rate(eligible.length, measured.length),
    eligibleRateOfAll: rate(eligible.length, rows.length),
    rejectedRateOfMeasured: rate(rejected.length, measured.length),
    rejectionReasons,
    bboxFillPct: distribution(
      measured.map((r) => r.bboxFillPct as number),
      fillBucket,
    ),
    jointsOutsideMaskCount: distribution(
      measured.map((r) => r.jointsOutsideMask.length),
      (v) => String(v),
    ),
    jointsOutsideMaskByJoint: byJoint,
    detectionsPerStill: distribution(dets, (v) => String(v)),
    multiCharacterStills: dets.filter((d) => d > 1).length,
    poseWarpGate: { rowsWithInputs, inputsSeen, reasons: gateReasons, eligible: gateEligible },
    attributable: {
      multipleCharacters: count(
        (r) => r.poseWarpGate?.reasons.includes("multiple characters") ?? false,
      ),
      tooSmallToRig: count(
        (r) => r.poseWarpGate?.reasons.some((x) => x.startsWith("resolution ")) ?? false,
      ),
      mergedSilhouette: rejectionReasons.merged_blob,
      coreJointsOffSilhouette: rejectionReasons.core_joints_off_silhouette,
      noHumanoidDetected: reasonCount("NO_HUMANOID_DETECTED"),
      noSkeleton: reasonCount("NO_SKELETON"),
      maskFailed: reasonCount("U2NETP_MASK_FAILED"),
      unauthorized: notMeasuredByStatus.UNAUTHORIZED,
      malformed: notMeasuredByStatus.MALFORMED,
    },
  };
}

export type CorpusReport = {
  schema: typeof MEASUREMENT_SCHEMA;
  corpusId: string;
  label: string;
  /** What this report is evidence OF, stated so the number cannot outrun it. */
  scope: string;
  thresholds: { maxBboxFillPct: number; coreJoints: readonly string[] };
  provenance: EvidencePackage["provenance"];
  rows: MeasurementRow[];
  aggregates: Aggregates;
  missingEvidence?: string;
};

export function buildReport(pkg: EvidencePackage, scope: string): CorpusReport {
  const rows = pkg.records.map(measureEvidence);
  const aggregates = aggregate(rows);
  return {
    schema: MEASUREMENT_SCHEMA,
    corpusId: pkg.corpusId,
    label: pkg.label,
    scope,
    // Echoed from the ONE definition, so the report states which policy it
    // was measured against — and a reader can see no other was used.
    thresholds: {
      maxBboxFillPct: ARAP_ELIGIBILITY.maxBboxFillPct,
      coreJoints: ARAP_ELIGIBILITY.coreJoints,
    },
    provenance: pkg.provenance,
    rows,
    aggregates: { ...aggregates, corpusId: pkg.corpusId },
    ...(pkg.records.length === 0 || pkg.missingEvidence
      ? { missingEvidence: pkg.missingEvidence ?? "EMPTY_CORPUS" }
      : {}),
  };
}
