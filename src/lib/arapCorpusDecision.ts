/**
 * Step 11B, steps 6–9 — classify failures, report the real corpus with a NAMED
 * denominator, compare it with the offline reference without merging them,
 * and end in exactly one state.
 *
 * OBSERVATIONAL, like the engine it sits on. This module imports the Step 11A
 * engine and the verifier, and nothing that routes a shot. It cannot enable
 * pose-warp, register a provider, or change a threshold: the ARAP gate is
 * echoed from the engine's report, never restated here.
 *
 * THE DENOMINATOR IS MEASURED_VALID_RECORDS. A record that was MISSING,
 * UNAUTHORIZED or MALFORMED was NOT MEASURED; it appears in its own count and
 * in no rate. eligible / everything-supplied is never computed, because it
 * would read an unauthorised still as a failed one.
 *
 * FAILURE CLASSES ARE EVIDENCE-SUPPORTED. Each class maps to a string one of
 * the existing gates actually emitted or to a status the verifier actually
 * assigned. What the evidence cannot establish is UNKNOWN_EVIDENCE_FAILURE —
 * never a guessed cause.
 *
 * THE STATE MACHINE NEVER SKIPS A STATE and never promotes another
 * population: only a package declared `gateway` can reach
 * REAL_GATEWAY_CORPUS_MEASURED; the offline cast-sheet reference, however it
 * scores, leaves the gateway state where it was.
 */
import {
  buildReport,
  type CorpusReport,
  type Distribution,
  type MeasurementRow,
} from "./arapEligibilityCorpus";
import type { EvidenceAuthorization, EvidenceStatus } from "./arapEvidence";
import {
  CHECKS,
  verifiedPackage,
  type CheckName,
  type DeclaredPopulation,
  type PackageVerification,
} from "./arapEvidenceVerify";

// ── STEP 6: failure classes ──────────────────────────────────────────────────

export const ARAP_FAILURE_CLASSES = [
  // measured, and rejected by the existing gate
  "bbox_fill_exceeded",
  "core_joint_outside_mask",
  // NOT MEASURED, by what the verifier or the driver established
  "detector_failure",
  "pose_failure",
  "missing_mask",
  "malformed_bbox",
  "malformed_evidence",
  "unauthorized",
  "missing",
  "UNKNOWN_EVIDENCE_FAILURE",
] as const;
export type FailureClass = (typeof ARAP_FAILURE_CLASSES)[number];

/** Reasons the EXISTING upstream gate (motionCost.poseWarpEligible) emits, by class. */
export const UPSTREAM_BLOCKERS = [
  "framing",
  "framing_unknown",
  "occlusion",
  "multiple_character",
  "insufficient_resolution",
  "photoreal",
  "arms_against_torso",
  "UNKNOWN_EVIDENCE_FAILURE",
] as const;
export type UpstreamBlocker = (typeof UPSTREAM_BLOCKERS)[number];

export type RowClassification = {
  /** Rejection classes of a MEASURED row. Empty when eligible or not measured. */
  arap: FailureClass[];
  /** Why a row was NOT MEASURED. Null when it was. */
  evidence: FailureClass | null;
  /** The upstream gate's answer, classified — recorded, never applied. */
  upstream: UpstreamBlocker[];
};

function classifyArapReason(reason: string): FailureClass {
  if (reason.startsWith("silhouette is a merged blob")) return "bbox_fill_exceeded";
  if (reason.startsWith("core joints off the silhouette")) return "core_joint_outside_mask";
  return "UNKNOWN_EVIDENCE_FAILURE";
}

function classifyNotMeasured(status: EvidenceStatus, reason: string): FailureClass {
  if (status === "UNAUTHORIZED") return "unauthorized";
  if (status === "MISSING") {
    if (reason.includes("NO_HUMANOID_DETECTED")) return "detector_failure";
    if (reason.includes("NO_SKELETON")) return "pose_failure";
    if (reason.includes("U2NETP_MASK_FAILED")) return "missing_mask";
    if (reason.includes("UNREADABLE_IMAGE")) return "missing";
    // EMPTY_CROP: the detector produced a box and the crop had no area. The
    // evidence does not say which stage is at fault, so neither do we.
    if (reason.includes("EMPTY_CROP")) return "UNKNOWN_EVIDENCE_FAILURE";
    return "missing";
  }
  if (status === "MALFORMED") {
    if (/\bbbox\b/i.test(reason)) return "malformed_bbox";
    if (/\bmask\b/i.test(reason)) return "missing_mask";
    return "malformed_evidence";
  }
  return "UNKNOWN_EVIDENCE_FAILURE";
}

function classifyUpstreamReason(reason: string): UpstreamBlocker {
  if (reason === "multiple characters") return "multiple_character";
  if (reason.startsWith("resolution ")) return "insufficient_resolution";
  if (reason.startsWith("occluded")) return "occlusion";
  if (reason === "non-frontal framing") return "framing";
  // `framing "unknown" is not full-body` is the gate failing CLOSED on evidence
  // it was not given. That is a fact about the evidence, not about the still.
  if (reason.startsWith('framing "unknown"')) return "framing_unknown";
  if (reason.startsWith("framing ")) return "framing";
  if (reason.startsWith("photoreal")) return "photoreal";
  if (reason.startsWith("arms flush against torso")) return "arms_against_torso";
  return "UNKNOWN_EVIDENCE_FAILURE";
}

export function classifyRow(row: MeasurementRow): RowClassification {
  const upstream = (row.poseWarpGate?.reasons ?? []).map(classifyUpstreamReason);
  if (row.verdict.measured) {
    return {
      arap: row.verdict.eligible ? [] : row.verdict.reasons.map(classifyArapReason),
      evidence: null,
      upstream,
    };
  }
  return {
    arap: [],
    evidence: classifyNotMeasured(row.verdict.status, row.verdict.reason),
    upstream,
  };
}

// ── STEP 7: the real-corpus report ───────────────────────────────────────────

export const REAL_CORPUS_REPORT_SCHEMA = "oniq.arap-real-corpus-report/1" as const;
export const DENOMINATOR = "MEASURED_VALID_RECORDS" as const;

export type Interval = { lo: number; hi: number };

/**
 * Wilson score interval for a binomial proportion. Chosen over the normal
 * approximation because the corpus is small and the rate may sit at 0 or 1,
 * where the normal interval is nonsense. Deterministic; four decimals.
 */
export function wilsonInterval(k: number, n: number, z: number): Interval | null {
  if (n <= 0 || k < 0 || k > n) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  return { lo: r4(Math.max(0, centre - half)), hi: r4(Math.min(1, centre + half)) };
}

export type PerStill = {
  stillId: string;
  candidate: number | null;
  primary: boolean;
  jobId: string | null;
  sceneId: string | null;
  shotId: string | null;
  status: EvidenceStatus;
  measured: boolean;
  eligible: boolean | null;
  bboxFillPct: number | null;
  jointsOutsideMask: string[];
  coreJointsOutsideMask: string[];
  reasons: string[];
  classes: FailureClass[];
  upstream: UpstreamBlocker[];
  confidence: MeasurementRow["confidence"];
};

export type RealCorpusReport = {
  schema: typeof REAL_CORPUS_REPORT_SCHEMA;
  evidencePackageVersion: string;
  measurementSchema: CorpusReport["schema"];
  population: DeclaredPopulation;
  corpusId: string;
  label: string;
  scope: string;
  provenance: CorpusReport["provenance"];
  authorization: EvidenceAuthorization | null;
  thresholds: CorpusReport["thresholds"];
  verification: {
    ok: boolean;
    problems: string[];
    checksFailed: Record<CheckName, number>;
    poseWarpInputsMissing: Record<string, number>;
  };
  counts: {
    supplied: number;
    valid: number;
    measured: number;
    notMeasured: { missing: number; unauthorized: number; malformed: number };
    eligible: number;
    rejected: number;
  };
  denominator: typeof DENOMINATOR;
  eligibleRate: number | null;
  eligibleRateInterval95: Interval | null;
  /** One record per still — the detector's first (highest-scored) candidate. */
  primaryOnly: { measured: number; eligible: number; eligibleRate: number | null };
  bboxFillPct: Distribution;
  jointsOutsideMask: { count: Distribution; byJoint: Record<string, number> };
  rejectionDistribution: Record<"bbox_fill_exceeded" | "core_joint_outside_mask", number>;
  failureClasses: Record<string, number>;
  upstreamBlockers: Record<string, number>;
  detectionsPerStill: Distribution;
  multiCharacterStills: number;
  perStill: PerStill[];
  caveats: string[];
};

const Z95 = 1.959964;

const tally = (keys: string[]) => {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
};

export function buildRealCorpusReport(
  v: PackageVerification,
  original: unknown,
  scope: string,
): RealCorpusReport {
  const pkg = verifiedPackage(v, original);
  const base = buildReport(pkg, scope);
  const rows = base.rows;
  const a = base.aggregates;

  const supplied = v.counts.supplied;
  const measured = a.measured;
  const notMeasured = {
    missing: a.notMeasuredByStatus.MISSING,
    unauthorized: a.notMeasuredByStatus.UNAUTHORIZED,
    malformed: a.notMeasuredByStatus.MALFORMED,
  };
  const accounted =
    measured + notMeasured.missing + notMeasured.unauthorized + notMeasured.malformed;
  if (accounted !== supplied || rows.length !== supplied) {
    throw new Error(
      `count invariant broken: supplied ${supplied}, rows ${rows.length}, accounted ${accounted}`,
    );
  }

  const classes = rows.map(classifyRow);
  const failureClasses = tally(classes.flatMap((c) => (c.evidence ? [c.evidence] : c.arap)));
  // Over MEASURED rows: of the characters the envelope could judge, how many
  // the existing upstream gate would also stop, and why.
  const upstreamBlockers = tally(
    classes.flatMap((c, i) => (rows[i]?.verdict.measured ? c.upstream : [])),
  );
  const perStill: PerStill[] = rows.map((r, i) => {
    const c = classes[i] ?? { arap: [], evidence: null, upstream: [] };
    return {
      stillId: r.stillId,
      candidate: r.candidate,
      primary: r.primary,
      jobId: r.jobId,
      sceneId: r.sceneId,
      shotId: r.shotId,
      status: r.verdict.measured ? "AVAILABLE" : r.verdict.status,
      measured: r.verdict.measured,
      eligible: r.verdict.measured ? r.verdict.eligible : null,
      bboxFillPct: r.bboxFillPct,
      jointsOutsideMask: r.jointsOutsideMask,
      coreJointsOutsideMask: r.coreJointsOutsideMask,
      reasons: r.verdict.measured ? r.verdict.reasons : [r.verdict.reason],
      classes: c.evidence ? [c.evidence] : c.arap,
      upstream: c.upstream,
      confidence: r.confidence,
    };
  });

  const primaryRows = rows.filter((r) => r.primary && r.verdict.measured);
  const primaryEligible = primaryRows.filter((r) => r.verdict.eligible).length;

  const checksFailed = {} as Record<CheckName, number>;
  for (const c of CHECKS) checksFailed[c] = v.findings.filter((f) => f.checks[c] === "fail").length;
  const poseWarpInputsMissing = tally(v.findings.flatMap((f) => f.poseWarpInputs.missing));

  const caveats: string[] = [];
  if (v.population !== "gateway") {
    caveats.push(
      `population "${v.population}" is not gateway traffic; this report cannot be promoted to a gateway measurement`,
    );
  }
  if (notMeasured.unauthorized > 0) {
    caveats.push(
      `${notMeasured.unauthorized} record(s) UNAUTHORIZED and not measured; every rate describes the authorised subset only`,
    );
  }
  if (notMeasured.missing + notMeasured.malformed > 0) {
    caveats.push(
      `${notMeasured.missing + notMeasured.malformed} record(s) MISSING or MALFORMED: NOT MEASURED, never counted as ineligible`,
    );
  }
  if (!v.ok) caveats.push(`package verification problems: ${v.problems.join("; ")}`);

  return {
    schema: REAL_CORPUS_REPORT_SCHEMA,
    evidencePackageVersion: pkg.schema,
    measurementSchema: base.schema,
    population: v.population,
    corpusId: pkg.corpusId,
    label: pkg.label,
    scope,
    provenance: base.provenance,
    authorization: v.authorization,
    thresholds: base.thresholds,
    verification: { ok: v.ok, problems: v.problems, checksFailed, poseWarpInputsMissing },
    counts: {
      supplied,
      valid: v.counts.AVAILABLE,
      measured,
      notMeasured,
      eligible: a.eligible,
      rejected: a.rejected,
    },
    denominator: DENOMINATOR,
    eligibleRate: a.eligibleRateOfMeasured,
    eligibleRateInterval95: wilsonInterval(a.eligible, measured, Z95),
    primaryOnly: {
      measured: primaryRows.length,
      eligible: primaryEligible,
      eligibleRate: primaryRows.length === 0 ? null : primaryEligible / primaryRows.length,
    },
    bboxFillPct: a.bboxFillPct,
    jointsOutsideMask: { count: a.jointsOutsideMaskCount, byJoint: a.jointsOutsideMaskByJoint },
    rejectionDistribution: {
      bbox_fill_exceeded: a.rejectionReasons.merged_blob,
      core_joint_outside_mask: a.rejectionReasons.core_joints_off_silhouette,
    },
    failureClasses,
    upstreamBlockers,
    detectionsPerStill: a.detectionsPerStill,
    multiCharacterStills: a.multiCharacterStills,
    perStill,
    caveats,
  };
}

// ── STEP 8: comparison, populations kept apart ───────────────────────────────

export const COMPARISON_SCHEMA = "oniq.arap-corpus-comparison/1" as const;
export const NOT_MEASURED = "NOT MEASURED" as const;

export type PopulationSummary = {
  label: string | null;
  population: string;
  n: number;
  eligible: number;
  rejected: number;
  eligibleRate: number | typeof NOT_MEASURED;
  interval95: Interval | null;
  standing: "PROVISIONAL_REFERENCE" | "MEASURED" | "NOT_MEASURED";
};

export type CorpusComparison = {
  schema: typeof COMPARISON_SCHEMA;
  populationsMerged: false;
  offline: PopulationSummary;
  gateway: PopulationSummary;
  productionEligibility: number | typeof NOT_MEASURED;
  note: string;
};

export function compareWithOffline(
  offline: CorpusReport,
  real: RealCorpusReport | null,
): CorpusComparison {
  const o = offline.aggregates;
  const gatewayReal = real && real.population === "gateway" ? real : null;
  const gateway: PopulationSummary = gatewayReal
    ? {
        label: gatewayReal.label,
        population: "gateway",
        n: gatewayReal.counts.measured,
        eligible: gatewayReal.counts.eligible,
        rejected: gatewayReal.counts.rejected,
        eligibleRate: gatewayReal.eligibleRate ?? NOT_MEASURED,
        interval95: gatewayReal.eligibleRateInterval95,
        standing: gatewayReal.counts.measured > 0 ? "MEASURED" : "NOT_MEASURED",
      }
    : {
        label: null,
        population: "gateway",
        n: 0,
        eligible: 0,
        rejected: 0,
        eligibleRate: NOT_MEASURED,
        interval95: null,
        standing: "NOT_MEASURED",
      };
  return {
    schema: COMPARISON_SCHEMA,
    populationsMerged: false,
    offline: {
      label: offline.label,
      population: "offline-reference",
      n: o.measured,
      eligible: o.eligible,
      rejected: o.rejected,
      eligibleRate: o.eligibleRateOfMeasured ?? NOT_MEASURED,
      interval95: wilsonInterval(o.eligible, o.measured, Z95),
      standing: "PROVISIONAL_REFERENCE",
    },
    gateway,
    productionEligibility: gateway.eligibleRate,
    note: "Two populations, reported side by side and never summed. The offline cast-sheet reference is provisional evidence the thresholds were derived from; only the gateway population can state a production eligibility rate, and only over MEASURED_VALID_RECORDS.",
  };
}

// ── STEP 9: the decision gate ────────────────────────────────────────────────

export const GATEWAY_STATES = [
  "REAL_GATEWAY_CORPUS_PENDING",
  "REAL_GATEWAY_CORPUS_MEASURED",
  "ARAP_ELIGIBILITY_SUPPORTED",
  "ARAP_AS_SELECTIVE_PROVIDER",
  "GATEWAY_INPUT_CONSTRAINT_REQUIRED",
  "REAL_CORPUS_INSUFFICIENT",
] as const;
export type GatewayState = (typeof GATEWAY_STATES)[number];
export type TerminalState = Exclude<GatewayState, "REAL_GATEWAY_CORPUS_MEASURED">;

/**
 * DECISION-RULE PARAMETERS — CONFIRMED by owner directive 2026-09-02 (Step
 * 11C), and not ARAP thresholds. The ARAP
 * envelope (the bbox-fill ceiling, the core joints) is untouched and lives in
 * arapProvider.ts; this module carries no copy of it. These decide only how a
 * measured rate is READ:
 *
 *   minMeasured  below this, no reading is attempted (REAL_CORPUS_INSUFFICIENT).
 *                Six is the size of the offline reference the owner accepted as
 *                a mechanics check, and the smallest n whose unanimous result
 *                clears the majority line at 95%.
 *   majority     the line between "frequently satisfies" and "most fail".
 *   z            95% two-sided.
 *
 * CASE A needs the interval's LOWER bound at or above the majority line; CASE C
 * needs the UPPER bound at or below it; everything between is CASE B. At n=6
 * only a unanimous result decides A or C; at n=18, A needs 14 and C allows 4.
 * Reading a point estimate instead would call 7/9 "strong" on nine stills.
 * Confirmed by the owner on 2026-09-02: the LOWER bound decides CASE A, the
 * point estimate is informational and never decides on its own, and MISSING,
 * UNAUTHORIZED and MALFORMED records are outside the denominator. Changing any
 * of these is an owner decision, recorded here with its date.
 */
export const DECISION_RULE = {
  minMeasured: 6,
  majority: 0.5,
  z: Z95,
  standing:
    "CONFIRMED — owner directive 2026-09-02 (Step 11C): lower Wilson bound decides, point estimate informational",
} as const;

export type GatewayDecision = {
  state: TerminalState;
  /** Every state passed through, in order. MEASURED always precedes a case state. */
  path: GatewayState[];
  measured: number;
  eligible: number;
  eligibleRate: number | null;
  interval95: Interval | null;
  denominator: typeof DENOMINATOR;
  rule: typeof DECISION_RULE;
  reasons: string[];
  caveats: string[];
  failureClasses: Record<string, number>;
  upstreamBlockers: Record<string, number>;
};

export function decideGatewayState(real: RealCorpusReport | null): GatewayDecision {
  const pending = (reasons: string[], r: RealCorpusReport | null): GatewayDecision => ({
    state: "REAL_GATEWAY_CORPUS_PENDING",
    path: ["REAL_GATEWAY_CORPUS_PENDING"],
    measured: r?.population === "gateway" ? r.counts.measured : 0,
    eligible: r?.population === "gateway" ? r.counts.eligible : 0,
    eligibleRate: null,
    interval95: null,
    denominator: DENOMINATOR,
    rule: DECISION_RULE,
    reasons,
    caveats: r?.caveats ?? [],
    failureClasses: r?.population === "gateway" ? r.failureClasses : {},
    upstreamBlockers: r?.population === "gateway" ? r.upstreamBlockers : {},
  });

  if (!real) return pending(["no gateway evidence package was supplied"], null);
  if (real.population !== "gateway") {
    return pending(
      [
        `package population "${real.population}" is not gateway; ${real.label} cannot be promoted to REAL_GATEWAY_CORPUS_MEASURED`,
      ],
      real,
    );
  }
  if (!real.verification.ok) {
    return pending(
      ["gateway package failed verification: " + real.verification.problems.join("; ")],
      real,
    );
  }
  const { measured, eligible } = real.counts;
  if (measured === 0) {
    const nm = real.counts.notMeasured;
    return pending(
      [
        `no authorised valid record was measured (supplied ${real.counts.supplied}: missing ${nm.missing}, unauthorized ${nm.unauthorized}, malformed ${nm.malformed})`,
      ],
      real,
    );
  }

  const path: GatewayState[] = ["REAL_GATEWAY_CORPUS_MEASURED"];
  const rate = eligible / measured;
  const interval = wilsonInterval(eligible, measured, DECISION_RULE.z);
  const common = {
    measured,
    eligible,
    eligibleRate: Math.round(rate * 1e4) / 1e4,
    interval95: interval,
    denominator: DENOMINATOR,
    rule: DECISION_RULE,
    caveats: real.caveats,
    failureClasses: real.failureClasses,
    upstreamBlockers: real.upstreamBlockers,
  };
  if (measured < DECISION_RULE.minMeasured || !interval) {
    return {
      state: "REAL_CORPUS_INSUFFICIENT",
      path: [...path, "REAL_CORPUS_INSUFFICIENT"],
      reasons: [
        `${measured} measured record(s) is below the ${DECISION_RULE.minMeasured} the decision rule needs; no architecture decision`,
      ],
      ...common,
    };
  }
  const m = DECISION_RULE.majority;
  const describe = `${eligible}/${measured} eligible over ${DENOMINATOR}, 95% interval [${interval.lo}, ${interval.hi}], majority line ${m}`;
  if (interval.lo >= m) {
    return {
      state: "ARAP_ELIGIBILITY_SUPPORTED",
      path: [...path, "ARAP_ELIGIBILITY_SUPPORTED"],
      reasons: [
        `lower bound ${interval.lo} ≥ ${m}: the gateway corpus frequently satisfies the existing envelope (${describe})`,
      ],
      ...common,
    };
  }
  if (interval.hi <= m || eligible === 0) {
    return {
      state: "GATEWAY_INPUT_CONSTRAINT_REQUIRED",
      path: [...path, "GATEWAY_INPUT_CONSTRAINT_REQUIRED"],
      reasons: [
        `upper bound ${interval.hi} ≤ ${m}: most gateway stills fail the existing envelope (${describe}); the envelope is not loosened — the question is whether the gateway can produce compatible inputs`,
      ],
      ...common,
    };
  }
  return {
    state: "ARAP_AS_SELECTIVE_PROVIDER",
    path: [...path, "ARAP_AS_SELECTIVE_PROVIDER"],
    reasons: [
      `interval straddles ${m}: a meaningful subset satisfies the existing envelope (${describe}); ARAP would be a selective provider with fail-closed fallback, never the path for every character`,
    ],
    ...common,
  };
}
