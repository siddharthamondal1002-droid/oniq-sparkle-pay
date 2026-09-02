/**
 * Step 11B, step 2 — VERIFY an evidence package before anything is measured.
 *
 * The measurement engine (arapEligibilityCorpus.ts) trusts a record's declared
 * status. That is right for records the in-image driver wrote and wrong for a
 * package that arrives from outside: an export can declare AVAILABLE on a
 * record with no mask, or carry a still nobody authorised. So every package
 * passes through here first, and the statuses that leave are the verifier's,
 * not the export's.
 *
 * Every check fails CLOSED into one of the three NOT MEASURED statuses:
 *   UNAUTHORIZED — the package carries no authorization, or the record's owner
 *                  is outside the scope it grants. Checked FIRST, so an
 *                  unauthorised still is never inspected further.
 *   MALFORMED    — a record that claims AVAILABLE and fails any shape check.
 *   MISSING      — what the export itself declared missing.
 * None of these is ineligible. That distinction is the whole point.
 *
 * Nothing is repaired. A bbox that reads two ways, a mask whose length is not
 * width × height, a confidence of 1.2, an unknown pose-warp input key — each is
 * refused with its reason, because a silent fix here would be the one place a
 * production number could be invented.
 */
import { normalizeBbox } from "./arapBbox";
import {
  ARAP_EVIDENCE_SCHEMA,
  EVIDENCE_POPULATIONS,
  type EvidenceAuthorization,
  type EvidencePackage,
  type EvidencePopulation,
  type EvidenceRecord,
  type EvidenceStatus,
} from "./arapEvidence";

export const CHECKS = [
  "schema",
  "stillId",
  "provenance",
  "authorization",
  "evidence",
  "dimensions",
  "bbox",
  "mask",
  "joints",
  "jointConfidence",
  "detectorConfidence",
  "poseWarpInputs",
] as const;
export type CheckName = (typeof CHECKS)[number];
export type CheckResult = "ok" | "fail" | "n/a";

/** The existing upstream gate's inputs (motionCost.PoseWarpEligibilityInput), by name. */
export const POSE_WARP_INPUT_FIELDS = [
  "framing",
  "characterCount",
  "occluded",
  "stylized",
  "nonFrontal",
  "longSidePx",
  "armsAgainstTorso",
] as const;

export type DeclaredPopulation = EvidencePopulation | "undeclared" | "unknown";

export type RecordFinding = {
  index: number;
  stillId: string;
  candidate: number | null;
  claimedStatus: string;
  status: EvidenceStatus;
  /** Why the status is what it is. Empty for AVAILABLE. */
  reasons: string[];
  checks: Record<CheckName, CheckResult>;
  poseWarpInputs: { known: string[]; missing: string[] };
};

export type PackageVerification = {
  /** Package-level shape acceptable. Records may still be anything but AVAILABLE. */
  ok: boolean;
  schema: string | null;
  population: DeclaredPopulation;
  corpusId: string | null;
  label: string | null;
  authorization: EvidenceAuthorization | null;
  problems: string[];
  /** Records with the VERIFIED status applied, one per supplied entry, in order. */
  records: EvidenceRecord[];
  findings: RecordFinding[];
  counts: Record<EvidenceStatus, number> & { supplied: number };
};

const STATUSES: readonly string[] = ["AVAILABLE", "MISSING", "UNAUTHORIZED", "MALFORMED"];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const unit = (v: unknown): v is number => fin(v) && v >= 0 && v <= 1;
const posInt = (v: unknown): v is number => fin(v) && Number.isInteger(v) && v > 0;
const nonNegInt = (v: unknown): v is number => fin(v) && Number.isInteger(v) && v >= 0;
const dimsOk = (d: unknown): d is { width: number; height: number } =>
  isObj(d) && posInt(d.width) && posInt(d.height);

function readAuthorization(
  a: unknown,
): { ok: true; value: EvidenceAuthorization } | { ok: false; reason: string } {
  if (a === undefined) return { ok: false, reason: "package carries no authorization record" };
  if (!isObj(a)) return { ok: false, reason: "authorization is not an object" };
  if (!isStr(a.grantedBy)) return { ok: false, reason: "authorization.grantedBy missing" };
  if (!isStr(a.grantedAt) || Number.isNaN(Date.parse(a.grantedAt))) {
    return { ok: false, reason: "authorization.grantedAt is not a date" };
  }
  const scope = a.scope;
  if (scope === "owner-only") {
    if (!isStr(a.ownerUserId)) {
      return { ok: false, reason: "authorization scope owner-only names no ownerUserId" };
    }
  } else if (scope === "listed-users") {
    if (!Array.isArray(a.userIds) || a.userIds.length === 0 || !a.userIds.every(isStr)) {
      return { ok: false, reason: "authorization scope listed-users lists no userIds" };
    }
  } else if (scope !== "all-users") {
    return {
      ok: false,
      reason: `authorization.scope ${String(scope)} is not owner-only, listed-users or all-users`,
    };
  }
  return {
    ok: true,
    value: {
      grantedBy: a.grantedBy,
      grantedAt: a.grantedAt,
      scope: scope as EvidenceAuthorization["scope"],
      ...(isStr(a.ownerUserId) ? { ownerUserId: a.ownerUserId } : {}),
      ...(Array.isArray(a.userIds) ? { userIds: a.userIds as string[] } : {}),
      ...(isStr(a.note) ? { note: a.note } : {}),
    },
  };
}

type Ctx = {
  schemaOk: boolean;
  corpusId: string;
  population: DeclaredPopulation;
  authorization: EvidenceAuthorization | null;
  authorizationProblem: string | null;
};

function blankChecks(): Record<CheckName, CheckResult> {
  const out = {} as Record<CheckName, CheckResult>;
  for (const c of CHECKS) out[c] = "n/a";
  return out;
}

/** Which of the upstream gate's inputs the record carries, with type checks. */
function readPoseWarpInputs(
  p: unknown,
  fail: (why: string) => void,
): { known: string[]; missing: string[] } {
  const known: string[] = [];
  if (p !== undefined) {
    if (!isObj(p)) fail("poseWarpInputs is not an object");
    else {
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined || v === null) continue;
        switch (k) {
          case "framing":
            if (!isStr(v)) fail("poseWarpInputs.framing is not a string");
            break;
          case "characterCount":
            if (!nonNegInt(v)) fail("poseWarpInputs.characterCount is not a non-negative integer");
            break;
          case "longSidePx":
            if (!fin(v) || v <= 0) fail("poseWarpInputs.longSidePx is not a positive number");
            break;
          case "occluded":
          case "stylized":
          case "nonFrontal":
          case "armsAgainstTorso":
            if (typeof v !== "boolean") fail(`poseWarpInputs.${k} is not a boolean`);
            break;
          default:
            fail(`poseWarpInputs.${k} is not an input the upstream gate has`);
            continue;
        }
        known.push(k);
      }
    }
  }
  known.sort();
  return { known, missing: POSE_WARP_INPUT_FIELDS.filter((f) => !known.includes(f)) };
}

function checkArtifacts(
  rec: Record<string, unknown>,
  ev: Record<string, unknown>,
  checks: Record<CheckName, CheckResult>,
  fail: (c: CheckName, why: string) => void,
  pass: (c: CheckName) => void,
) {
  const img = isObj(rec.image) ? rec.image : null;
  const working = img && dimsOk(img.working) ? img.working : null;
  const original = img && dimsOk(img.original) ? img.original : undefined;
  const originalBroken = img !== null && img.original !== undefined && !original;
  if (!working) fail("dimensions", "image.working must carry positive integer width and height");
  else if (originalBroken) {
    fail("dimensions", "image.original is present but not positive integer width and height");
  } else pass("dimensions");

  if (checks.dimensions === "ok" && working) {
    const declared =
      ev.bboxFormat === "ltrb" || ev.bboxFormat === "xywh" ? ev.bboxFormat : undefined;
    const nb = normalizeBbox(ev.bbox as never, { working, original }, declared);
    if (!nb.ok) fail("bbox", `bbox: ${nb.reason}`);
    else pass("bbox");
  }

  const m = ev.mask;
  // JSON hands the mask over as a plain array; the writer flattens it row-major.
  if (!isObj(m) || !posInt(m.width) || !posInt(m.height) || !Array.isArray(m.data)) {
    fail("mask", "mask must carry positive integer width and height and a data array");
  } else {
    const data = m.data as unknown[];
    if (data.length !== m.width * m.height) {
      fail("mask", `mask data length ${String(data.length)} is not ${m.width}×${m.height}`);
    } else {
      let bad = -1;
      for (let i = 0; i < data.length; i += 1) {
        const v = data[i];
        if (v !== 0 && v !== 1) {
          bad = i;
          break;
        }
      }
      if (bad >= 0) fail("mask", `mask data[${bad}] is not 0 or 1`);
      else pass("mask");
    }
  }

  const j = ev.joints;
  if (!isObj(j) || Object.keys(j).length === 0) fail("joints", "joints missing or empty");
  else {
    const off = Object.entries(j).find(([, p]) => !isObj(p) || !fin(p.x) || !fin(p.y));
    if (off) fail("joints", `joint ${off[0]} has non-finite coordinates`);
    else pass("joints");
  }

  const c = isObj(rec.confidence) ? rec.confidence : null;
  if (!c || !unit(c.detector)) {
    fail("detectorConfidence", "confidence.detector must be a number in [0, 1]");
  } else if (!posInt(c.detections)) {
    fail("detectorConfidence", "confidence.detections must be a positive integer");
  } else pass("detectorConfidence");
  if (c) checkJointConfidence(c, fail, pass);
}

function checkJointConfidence(
  c: Record<string, unknown>,
  fail: (c: CheckName, why: string) => void,
  pass: (c: CheckName) => void,
) {
  for (const k of ["keypointMean", "keypointMin"]) {
    const v = c[k];
    if (v !== undefined && v !== null && !unit(v)) {
      fail("jointConfidence", `confidence.${k} must be null or a number in [0, 1]`);
      return;
    }
  }
  pass("jointConfidence");
}

function checkPrecomputed(
  rec: Record<string, unknown>,
  ev: Record<string, unknown>,
  fail: (c: CheckName, why: string) => void,
  pass: (c: CheckName) => void,
) {
  if (!fin(ev.bboxFillPct) || ev.bboxFillPct < 0 || ev.bboxFillPct > 100) {
    fail("evidence", "precomputed bboxFillPct must be a number in [0, 100]");
  } else if (
    !Array.isArray(ev.jointsOutsideMask) ||
    !ev.jointsOutsideMask.every((x) => typeof x === "string")
  ) {
    fail("evidence", "precomputed jointsOutsideMask must be an array of joint names");
  } else pass("evidence");

  const c = isObj(rec.confidence) ? rec.confidence : null;
  if (!c) return;
  const d = c.detector;
  if (d !== undefined && d !== null && !unit(d)) {
    fail("detectorConfidence", "confidence.detector must be null or a number in [0, 1]");
  } else if (c.detections !== undefined && c.detections !== null && !posInt(c.detections)) {
    fail("detectorConfidence", "confidence.detections must be null or a positive integer");
  } else pass("detectorConfidence");
  checkJointConfidence(c, fail, pass);
}

function verifyRecord(
  raw: unknown,
  index: number,
  ctx: Ctx,
): { finding: RecordFinding; record: EvidenceRecord } {
  const checks = blankChecks();
  const reasons: string[] = [];
  const fail = (c: CheckName, why: string) => {
    checks[c] = "fail";
    reasons.push(why);
  };
  const pass = (c: CheckName) => {
    if (checks[c] !== "fail") checks[c] = "ok";
  };
  const placeholder = (
    status: EvidenceStatus,
    stillId: string,
    reason: string,
  ): EvidenceRecord => ({
    schema: ARAP_EVIDENCE_SCHEMA,
    status,
    source: { corpusId: ctx.corpusId, stillId },
    provenance: { instrument: "arapEvidenceVerify.ts" },
    candidate: null,
    primary: false,
    reason,
  });

  if (!isObj(raw)) {
    const reason = "record is not an object";
    return {
      finding: {
        index,
        stillId: `record[${index}]`,
        candidate: null,
        claimedStatus: "undeclared",
        status: "MALFORMED",
        reasons: [reason],
        checks: { ...checks, schema: "fail" },
        poseWarpInputs: { known: [], missing: [...POSE_WARP_INPUT_FIELDS] },
      },
      record: placeholder("MALFORMED", `record[${index}]`, reason),
    };
  }
  const rec = raw;
  const claimed = typeof rec.status === "string" ? rec.status : "undeclared";
  const source = isObj(rec.source) ? rec.source : null;
  const stillId = source && isStr(source.stillId) ? source.stillId : null;
  const candidate = fin(rec.candidate) ? rec.candidate : null;

  if (!ctx.schemaOk) fail("schema", `package schema is not ${ARAP_EVIDENCE_SCHEMA}`);
  else if (rec.schema !== ARAP_EVIDENCE_SCHEMA) {
    fail("schema", `record schema ${String(rec.schema)} is not ${ARAP_EVIDENCE_SCHEMA}`);
  } else if (!STATUSES.includes(claimed)) {
    fail("schema", `status ${claimed} is not AVAILABLE, MISSING, UNAUTHORIZED or MALFORMED`);
  } else pass("schema");

  if (!stillId) fail("stillId", "source.stillId missing or empty");
  else pass("stillId");

  if (!isObj(rec.provenance) || !isStr(rec.provenance.instrument)) {
    fail("provenance", "provenance.instrument missing");
  } else pass("provenance");

  // AUTHORIZATION FIRST, gateway packages only. An unauthorised still is
  // refused here and never inspected further.
  let unauthorized: string | null = null;
  if (ctx.population === "gateway") {
    const auth = ctx.authorization;
    if (!auth) unauthorized = ctx.authorizationProblem ?? "package carries no authorization record";
    else {
      const owner = source && isStr(source.ownerUserId) ? source.ownerUserId : null;
      if (auth.scope === "owner-only") {
        if (!owner) unauthorized = "record carries no ownerUserId; scope is owner-only";
        else if (owner !== auth.ownerUserId) {
          unauthorized = `record owner ${owner} is outside scope owner-only`;
        }
      } else if (auth.scope === "listed-users") {
        if (!owner) unauthorized = "record carries no ownerUserId; scope is listed-users";
        else if (!(auth.userIds ?? []).includes(owner)) {
          unauthorized = `record owner ${owner} is not a listed user`;
        }
      }
    }
    if (unauthorized) fail("authorization", unauthorized);
    else pass("authorization");
  }

  const poseWarpInputs = readPoseWarpInputs(rec.poseWarpInputs, (why) =>
    fail("poseWarpInputs", why),
  );
  if (checks.poseWarpInputs !== "fail" && rec.poseWarpInputs !== undefined) pass("poseWarpInputs");

  let status: EvidenceStatus;
  let reason: string | undefined;
  const declaredReason = isStr(rec.reason) ? rec.reason : undefined;
  if (claimed === "UNAUTHORIZED" || unauthorized) {
    status = "UNAUTHORIZED";
    reason = unauthorized ?? declaredReason ?? "declared UNAUTHORIZED by the export";
    if (!unauthorized) reasons.push(reason);
  } else if (claimed === "MISSING" || claimed === "MALFORMED") {
    status = claimed;
    reason = declaredReason ?? `declared ${claimed} without a reason`;
    if (!declaredReason) reasons.push(reason);
  } else if (claimed === "AVAILABLE" && reasons.length === 0) {
    const ev = rec.evidence;
    if (!isObj(ev)) fail("evidence", "status AVAILABLE but no evidence");
    else if (ev.kind === "artifacts") {
      pass("evidence");
      checkArtifacts(rec, ev, checks, fail, pass);
    } else if (ev.kind === "precomputed") checkPrecomputed(rec, ev, fail, pass);
    else fail("evidence", `evidence.kind ${String(ev.kind)} is not artifacts or precomputed`);
    status = reasons.length === 0 ? "AVAILABLE" : "MALFORMED";
    reason = reasons.length === 0 ? undefined : reasons.join("; ");
  } else {
    status = "MALFORMED";
    if (claimed !== "AVAILABLE" && reasons.length === 0) reasons.push(`status ${claimed} unknown`);
    reason = reasons.join("; ");
  }

  const id = stillId ?? `record[${index}]`;
  let record: EvidenceRecord;
  if (status === "AVAILABLE") record = rec as unknown as EvidenceRecord;
  else if (status === "UNAUTHORIZED") {
    // Identity, status and reason. Nothing that was refused travels further —
    // not the mask, not the joints, not the gate inputs, not the confidences.
    record = {
      ...placeholder("UNAUTHORIZED", id, reason ?? "UNAUTHORIZED"),
      ...(source ? { source: source as unknown as EvidenceRecord["source"] } : {}),
      candidate,
      primary: rec.primary === true,
    };
  } else if (stillId && isObj(rec.source) && isObj(rec.provenance)) {
    record = { ...rec, status, reason } as unknown as EvidenceRecord;
  } else record = placeholder(status, id, reason ?? status);
  return {
    finding: {
      index,
      stillId: id,
      candidate,
      claimedStatus: claimed,
      status,
      reasons,
      checks,
      poseWarpInputs,
    },
    record,
  };
}

/** Verify one package. Pure: the input is never mutated, and the same input always verifies the same way. */
export function verifyEvidencePackage(input: unknown): PackageVerification {
  const problems: string[] = [];
  const counts = { AVAILABLE: 0, MISSING: 0, UNAUTHORIZED: 0, MALFORMED: 0, supplied: 0 };
  if (!isObj(input)) {
    return {
      ok: false,
      schema: null,
      population: "undeclared",
      corpusId: null,
      label: null,
      authorization: null,
      problems: ["package is not an object"],
      records: [],
      findings: [],
      counts,
    };
  }
  const schema = typeof input.schema === "string" ? input.schema : null;
  const schemaOk = schema === ARAP_EVIDENCE_SCHEMA;
  if (!schemaOk)
    problems.push(`package schema ${String(input.schema)} is not ${ARAP_EVIDENCE_SCHEMA}`);
  const corpusId = isStr(input.corpusId) ? input.corpusId : null;
  if (!corpusId) problems.push("package corpusId missing");
  const label = isStr(input.label) ? input.label : corpusId;
  if (!isObj(input.provenance) || !isStr(input.provenance.instrument)) {
    problems.push("package provenance.instrument missing");
  }

  let population: DeclaredPopulation;
  if (input.population === undefined) population = "undeclared";
  else if ((EVIDENCE_POPULATIONS as readonly unknown[]).includes(input.population)) {
    population = input.population as EvidencePopulation;
  } else {
    population = "unknown";
    problems.push(
      `package population ${String(input.population)} is not one of ${EVIDENCE_POPULATIONS.join(", ")}`,
    );
  }

  const auth = readAuthorization(input.authorization);
  let authorization: EvidenceAuthorization | null = null;
  let authorizationProblem: string | null = null;
  if (auth.ok) authorization = auth.value;
  else {
    authorizationProblem = auth.reason;
    // Required on a gateway package; elsewhere only a PRESENT-but-broken one is a problem.
    if (population === "gateway" || input.authorization !== undefined) problems.push(auth.reason);
  }

  let rawRecords: unknown[] = [];
  if (Array.isArray(input.records)) rawRecords = input.records;
  else problems.push("package records is not an array");

  const ctx: Ctx = {
    schemaOk,
    corpusId: corpusId ?? "unknown",
    population,
    authorization,
    authorizationProblem,
  };
  const findings: RecordFinding[] = [];
  const records: EvidenceRecord[] = [];
  rawRecords.forEach((raw, i) => {
    const { finding, record } = verifyRecord(raw, i, ctx);
    findings.push(finding);
    records.push(record);
    counts[finding.status] += 1;
    counts.supplied += 1;
  });

  return {
    ok: problems.length === 0,
    schema,
    population,
    corpusId,
    label,
    authorization,
    problems,
    records,
    findings,
    counts,
  };
}

/** The package as verified — what the engine measures, and what the .evidence.json records. */
export function verifiedPackage(v: PackageVerification, original: unknown): EvidencePackage {
  const src = isObj(original) ? original : {};
  const provenance =
    isObj(src.provenance) && isStr(src.provenance.instrument)
      ? (src.provenance as EvidencePackage["provenance"])
      : { instrument: "unverified package", note: v.problems.join("; ") || undefined };
  return {
    schema: ARAP_EVIDENCE_SCHEMA,
    corpusId: v.corpusId ?? "unknown",
    label: v.label ?? v.corpusId ?? "unknown",
    provenance,
    records: v.records,
    ...(v.population === "undeclared" || v.population === "unknown"
      ? {}
      : { population: v.population }),
    ...(v.authorization ? { authorization: v.authorization } : {}),
    ...(isStr(src.missingEvidence) ? { missingEvidence: src.missingEvidence } : {}),
  };
}
