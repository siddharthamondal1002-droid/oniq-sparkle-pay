/**
 * The ARAP evidence contract — versioned, machine-readable, and honest about
 * what it does not have.
 *
 * Every candidate the measurement engine sees arrives as one of these. The
 * `status` says whether there is anything to measure at all, and the engine
 * treats the three non-AVAILABLE statuses identically in one respect: they
 * are NOT MEASURED. A still whose bytes were never authorised for export, a
 * still the detector found nothing in, and a record whose bbox is nonsense
 * all leave the eligible/rejected tally untouched. None of them is
 * "ineligible" — ineligible is a verdict, and a verdict needs evidence.
 *
 * Two evidence KINDS are supported, because two exist:
 *   artifacts    — the auto-rig's raw outputs (mask + joints + bbox), the
 *                  shape measure_eligibility.py writes inside the image.
 *   precomputed  — bboxFillPct and jointsOutsideMask already measured by an
 *                  earlier run whose pixels are not available here. This is
 *                  how the 2026-08-22 six-character cast-sheet corpus is
 *                  carried: as its recorded numbers, with provenance, and
 *                  labelled so nobody mistakes it for a fresh measurement.
 */
import type { BboxEvidence } from "./arapBbox";
import type { PoseWarpEligibilityInput } from "./motionCost";

export const ARAP_EVIDENCE_SCHEMA = "oniq.arap-evidence/1" as const;

export type EvidenceStatus = "AVAILABLE" | "MISSING" | "UNAUTHORIZED" | "MALFORMED";

export type ImageDims = { width: number; height: number };

export type EvidenceSource = {
  corpusId: string;
  stillId: string;
  /** Job / scene / shot, only where the export was permitted to carry them. */
  jobId?: string;
  sceneId?: string;
  shotId?: string;
  file?: string;
  sha256?: string;
  /** The user the still belongs to (11B). Checked against the package's authorization. */
  ownerUserId?: string;
};

export type EvidenceProvenance = {
  /** What produced this record — a script path, a document, a run id. */
  instrument: string;
  measuredAt?: string;
  note?: string;
};

// ── 11B: WHO THE EVIDENCE BELONGS TO, AND WHO SAID IT MAY BE MEASURED ────────
//
// Additive within oniq.arap-evidence/1. Absent on the offline reference and on
// the instrument self-test; REQUIRED on a gateway package, where the verifier
// (arapEvidenceVerify.ts) turns every record outside the granted scope into
// UNAUTHORIZED before anything is measured. Names and ids only — a credential
// never appears in an evidence package.

export const EVIDENCE_POPULATIONS = [
  "gateway",
  "offline-reference",
  "instrument-selftest",
] as const;
export type EvidencePopulation = (typeof EVIDENCE_POPULATIONS)[number];

export type EvidenceAuthorization = {
  /** Who granted the data use — a role or a name, the way an owner directive is recorded. */
  grantedBy: string;
  /** When, ISO-8601. */
  grantedAt: string;
  /**
   * owner-only:   only stills whose `source.ownerUserId` equals `ownerUserId`.
   * listed-users: only stills whose owner is in `userIds`.
   * all-users:    every still in the package — an explicit data-use decision.
   */
  scope: "owner-only" | "listed-users" | "all-users";
  ownerUserId?: string;
  userIds?: string[];
  note?: string;
};

export type ArtifactEvidence = {
  kind: "artifacts";
  bbox: BboxEvidence;
  /** The declared format of `bbox` when it is a bare array. */
  bboxFormat?: "ltrb" | "xywh";
  mask: { width: number; height: number; data: ArrayLike<number>; source?: string; ref?: string };
  joints: Record<string, { x: number; y: number }>;
};

export type PrecomputedEvidence = {
  kind: "precomputed";
  bboxFillPct: number;
  jointsOutsideMask: string[];
};

export type EvidenceRecord = {
  schema: typeof ARAP_EVIDENCE_SCHEMA;
  status: EvidenceStatus;
  source: EvidenceSource;
  provenance: EvidenceProvenance;
  /** Present for AVAILABLE; may be present (partially) for MALFORMED. */
  image?: { original?: ImageDims; working?: ImageDims };
  candidate?: number | null;
  primary?: boolean;
  evidence?: ArtifactEvidence | PrecomputedEvidence;
  confidence?: {
    detector?: number;
    detections?: number;
    keypointMean?: number | null;
    keypointMin?: number | null;
  };
  /** The existing upstream gate's inputs, where the export could supply them. */
  poseWarpInputs?: Partial<PoseWarpEligibilityInput>;
  /** Free evidence the pipeline emitted beside the artifacts (masks, timings). */
  extra?: Record<string, unknown>;
  /** Required for every status but AVAILABLE. */
  reason?: string;
};

export type EvidencePackage = {
  schema: typeof ARAP_EVIDENCE_SCHEMA;
  corpusId: string;
  label: string;
  provenance: EvidenceProvenance;
  records: EvidenceRecord[];
  /** Set when the package is a placeholder for evidence that could not be obtained. */
  missingEvidence?: string;
  /** 11B. Which population this is. Only `gateway` can ever reach REAL_GATEWAY_CORPUS_MEASURED. */
  population?: EvidencePopulation;
  /** 11B. Required for `gateway`; ignored elsewhere. */
  authorization?: EvidenceAuthorization;
};

// ── Adapter: the in-image driver's records/*.json → EvidenceRecord ───────────

type DriverRecord = {
  corpus_id?: string;
  still_id: string;
  candidate?: number | null;
  primary?: boolean;
  source_file?: string;
  source_sha256?: string;
  image?: { original?: ImageDims; working?: ImageDims };
  artifacts?: {
    bbox?: unknown;
    bbox_format?: string;
    bbox_frame?: string;
    mask?: { width: number; height: number; data: ArrayLike<number> };
    joints?: Record<string, { x: number; y: number }>;
  };
  evidence?: Record<string, unknown>;
  missing_evidence?: string;
};

const DRIVER = "runtime/arap-cpu/measure/measure_eligibility.py";

/**
 * Wrap what measure_eligibility.py wrote as a contract record. This tags —
 * it does not validate numbers; the normalizer does that, so the reasons a
 * record turns MALFORMED are stated in one place.
 */
export function evidenceFromDriverRecord(r: DriverRecord): EvidenceRecord {
  const source: EvidenceSource = {
    corpusId: r.corpus_id ?? "unknown",
    stillId: r.still_id,
    file: r.source_file,
    sha256: r.source_sha256,
  };
  const provenance: EvidenceProvenance = { instrument: DRIVER };
  const ev = (r.evidence ?? {}) as Record<string, unknown>;
  const confidence = {
    detector: typeof ev.det_score === "number" ? ev.det_score : undefined,
    detections: typeof ev.det_count === "number" ? ev.det_count : undefined,
    keypointMean: (ev.kpt_conf_mean as number | null | undefined) ?? undefined,
    keypointMin: (ev.kpt_conf_min as number | null | undefined) ?? undefined,
  };

  if (r.missing_evidence || !r.artifacts) {
    return {
      schema: ARAP_EVIDENCE_SCHEMA,
      status: "MISSING",
      source,
      provenance,
      image: r.image,
      candidate: r.candidate ?? null,
      primary: r.primary ?? false,
      confidence,
      extra: ev,
      reason: r.missing_evidence ?? "record carries no artifacts",
    };
  }

  const a = r.artifacts;
  if (!a.mask || !a.joints) {
    return {
      schema: ARAP_EVIDENCE_SCHEMA,
      status: "MALFORMED",
      source,
      provenance,
      image: r.image,
      candidate: r.candidate ?? null,
      primary: r.primary ?? false,
      confidence,
      extra: ev,
      reason: `artifacts missing ${!a.mask ? "mask" : "joints"}`,
    };
  }

  const bboxFormat =
    a.bbox_format === "ltrb" || a.bbox_format === "xywh" ? a.bbox_format : undefined;
  const frame = a.bbox_frame === "original" ? "original" : "working";
  // A bare array plus a declared format becomes the explicit form; anything
  // else is passed through untouched for the normalizer to accept or refuse.
  const bbox: BboxEvidence =
    Array.isArray(a.bbox) && bboxFormat
      ? { format: bboxFormat, frame, values: a.bbox as number[] }
      : (a.bbox as BboxEvidence);

  return {
    schema: ARAP_EVIDENCE_SCHEMA,
    status: "AVAILABLE",
    source,
    provenance,
    image: r.image,
    candidate: r.candidate ?? 0,
    primary: r.primary ?? true,
    evidence: {
      kind: "artifacts",
      bbox,
      bboxFormat,
      mask: { ...a.mask, source: typeof ev.mask_source === "string" ? ev.mask_source : undefined },
      joints: a.joints,
    },
    confidence,
    poseWarpInputs: {
      characterCount: confidence.detections,
      longSidePx: r.image?.working
        ? Math.max(r.image.working.width, r.image.working.height)
        : undefined,
    },
    extra: ev,
  };
}
