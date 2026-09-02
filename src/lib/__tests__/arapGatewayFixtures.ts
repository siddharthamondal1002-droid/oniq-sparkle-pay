/**
 * Builders for SYNTHETIC gateway-shaped evidence, shared by the 11B tests.
 * Everything here is invented in the writer's exact shape so the verifier and
 * the decision gate can be exercised — none of it is a gateway still, and the
 * ids say so. Nothing in this file is ever written to a committed fixture.
 */
import { ARAP_EVIDENCE_SCHEMA, type EvidenceAuthorization } from "../arapEvidence";

export const OWNER = "d3b58345-owner-0000-0000-000000000000";
export const OTHER = "bb483798-other-0000-0000-000000000000";

export const AUTH_OWNER_ONLY: EvidenceAuthorization = {
  grantedBy: "owner",
  grantedAt: "2026-09-02",
  scope: "owner-only",
  ownerUserId: OWNER,
};

export function mask(w: number, h: number, fillPct: number) {
  const data = new Array<number>(w * h).fill(0);
  const on = Math.round((fillPct / 100) * w * h);
  for (let i = 0; i < on; i += 1) data[i] = 1;
  return { width: w, height: h, data };
}

export const JOINTS = {
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

export type RawOver = {
  id?: string;
  /** null = no ownerUserId on the record at all. */
  owner?: string | null;
  jobId?: string;
  fill?: number;
  bbox?: unknown;
  working?: unknown;
  original?: unknown;
  joints?: Record<string, unknown>;
  mask?: unknown;
  confidence?: unknown;
  poseWarpInputs?: unknown;
  status?: string;
  reason?: string;
  evidence?: unknown;
  schema?: unknown;
  provenance?: unknown;
  candidate?: number | null;
  primary?: boolean;
};

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * A raw record as JSON.parse would hand it over — every field overridable,
 * including to garbage, because that is what the verifier exists to refuse.
 * Passing a key with `undefined` OMITS it.
 */
export function rawRecord(over: RawOver = {}): Record<string, unknown> {
  const image: Record<string, unknown> = {
    original: has(over, "original") ? over.original : { width: 1080, height: 1920 },
    working: has(over, "working") ? over.working : { width: 562, height: 1000 },
  };
  for (const k of ["original", "working"]) if (image[k] === undefined) delete image[k];
  const rec: Record<string, unknown> = {
    schema: has(over, "schema") ? over.schema : ARAP_EVIDENCE_SCHEMA,
    status: over.status ?? "AVAILABLE",
    source: {
      corpusId: "gw",
      stillId: over.id ?? "still",
      ...(over.owner === null ? {} : { ownerUserId: over.owner ?? OWNER }),
      ...(over.jobId ? { jobId: over.jobId } : {}),
    },
    provenance: has(over, "provenance") ? over.provenance : { instrument: "test" },
    image,
    candidate: has(over, "candidate") ? over.candidate : 0,
    primary: over.primary ?? true,
    evidence: has(over, "evidence")
      ? over.evidence
      : {
          kind: "artifacts",
          bbox: has(over, "bbox") ? over.bbox : { format: "ltrb", values: [0, 0, 100, 100] },
          mask: has(over, "mask") ? over.mask : mask(100, 100, over.fill ?? 50),
          joints: { ...JOINTS, ...over.joints },
        },
    confidence: has(over, "confidence")
      ? over.confidence
      : { detector: 0.99, detections: 1, keypointMean: 0.87, keypointMin: 0.6 },
    poseWarpInputs: has(over, "poseWarpInputs")
      ? over.poseWarpInputs
      : { characterCount: 1, longSidePx: 1000 },
    ...(over.reason ? { reason: over.reason } : {}),
  };
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return rec;
}

export type PkgOver = {
  population?: unknown;
  authorization?: unknown;
  schema?: unknown;
  corpusId?: unknown;
  label?: unknown;
  provenance?: unknown;
};

/** A raw package, gateway + owner-only by default. A key passed as `undefined` is omitted. */
export function rawPackage(records: unknown[], over: PkgOver = {}): Record<string, unknown> {
  const pkg: Record<string, unknown> = {
    schema: has(over, "schema") ? over.schema : ARAP_EVIDENCE_SCHEMA,
    corpusId: has(over, "corpusId") ? over.corpusId : "gw",
    label: has(over, "label") ? over.label : "gateway-synthetic",
    provenance: has(over, "provenance") ? over.provenance : { instrument: "test" },
    population: has(over, "population") ? over.population : "gateway",
    authorization: has(over, "authorization") ? over.authorization : AUTH_OWNER_ONLY,
    records,
  };
  for (const k of Object.keys(pkg)) if (pkg[k] === undefined) delete pkg[k];
  return pkg;
}

/** k eligible of n, all the owner's: fill 50 passes the gate, fill 80 is a merged blob. */
export function kOfN(k: number, n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) =>
    rawRecord({ id: `s${String(i + 1).padStart(2, "0")}`, fill: i < k ? 50 : 80 }),
  );
}
