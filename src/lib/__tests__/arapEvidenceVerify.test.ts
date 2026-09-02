/**
 * Step 11B, step 2 — the verifier. Every check the brief lists, each failing
 * closed into NOT MEASURED, and authorization checked before anything else.
 * All evidence here is synthetic; the one real file is the committed offline
 * reference, which must verify unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { measureEvidence } from "../arapEligibilityCorpus";
import { ARAP_EVIDENCE_SCHEMA } from "../arapEvidence";
import {
  POSE_WARP_INPUT_FIELDS,
  verifiedPackage,
  verifyEvidencePackage,
} from "../arapEvidenceVerify";
import { AUTH_OWNER_ONLY, OTHER, OWNER, mask, rawPackage, rawRecord } from "./arapGatewayFixtures";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const statusesOf = (pkg: unknown) => verifyEvidencePackage(pkg).findings.map((f) => f.status);
const only = (pkg: unknown) => {
  const v = verifyEvidencePackage(pkg);
  expect(v.findings).toHaveLength(1);
  return v.findings[0]!;
};

describe("a well-formed gateway package", () => {
  it("keeps AVAILABLE records AVAILABLE and counts every status", () => {
    const v = verifyEvidencePackage(
      rawPackage([
        rawRecord({ id: "a" }),
        rawRecord({ id: "b", fill: 80 }),
        rawRecord({
          id: "m",
          status: "MISSING",
          reason: "NO_HUMANOID_DETECTED",
          evidence: undefined,
        }),
      ]),
    );
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
    expect(v.population).toBe("gateway");
    expect(v.authorization).toEqual(AUTH_OWNER_ONLY);
    expect(v.findings.map((f) => f.status)).toEqual(["AVAILABLE", "AVAILABLE", "MISSING"]);
    expect(v.counts).toEqual({
      AVAILABLE: 2,
      MISSING: 1,
      UNAUTHORIZED: 0,
      MALFORMED: 0,
      supplied: 3,
    });
    const a = v.findings[0]!;
    expect(a.reasons).toEqual([]);
    for (const c of [
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
    ] as const) {
      expect(a.checks[c], c).toBe("ok");
    }
  });
  it("reports which upstream-gate inputs each record carries and which it lacks", () => {
    const f = only(rawPackage([rawRecord()]));
    expect(f.poseWarpInputs.known).toEqual(["characterCount", "longSidePx"]);
    expect(f.poseWarpInputs.missing).toEqual(
      POSE_WARP_INPUT_FIELDS.filter((x) => x !== "characterCount" && x !== "longSidePx"),
    );
  });
});

describe("schema version, provenance, identity", () => {
  it("a wrong package schema fails the package and every record", () => {
    const v = verifyEvidencePackage(
      rawPackage([rawRecord(), rawRecord({ id: "b" })], { schema: "oniq.arap-evidence/0" }),
    );
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toMatch(
      /package schema oniq.arap-evidence\/0 is not oniq.arap-evidence\/1/,
    );
    expect(statusesOf(rawPackage([rawRecord()], { schema: "x" }))).toEqual(["MALFORMED"]);
    expect(v.findings.every((f) => f.checks.schema === "fail")).toBe(true);
  });
  it("a wrong record schema, an unknown status, a missing stillId, a missing provenance — each MALFORMED", () => {
    expect(only(rawPackage([rawRecord({ schema: "oniq.arap-evidence/2" })])).status).toBe(
      "MALFORMED",
    );
    expect(only(rawPackage([rawRecord({ status: "ELIGIBLE" })])).status).toBe("MALFORMED");
    const noId = rawRecord();
    (noId.source as Record<string, unknown>).stillId = "";
    expect(only(rawPackage([noId])).checks.stillId).toBe("fail");
    expect(only(rawPackage([noId])).status).toBe("MALFORMED");
    const noProv = only(rawPackage([rawRecord({ provenance: { note: "no instrument" } })]));
    expect(noProv.status).toBe("MALFORMED");
    expect(noProv.reasons).toContain("provenance.instrument missing");
  });
  it("a record that is not an object is MALFORMED and still counted", () => {
    const v = verifyEvidencePackage(rawPackage([42, null, "x"]));
    expect(v.counts.MALFORMED).toBe(3);
    expect(v.counts.supplied).toBe(3);
    expect(v.records.map((r) => r.source.stillId)).toEqual(["record[0]", "record[1]", "record[2]"]);
  });
  it("a package that is not an object, or whose records are not an array, verifies to nothing", () => {
    expect(verifyEvidencePackage("nope")).toMatchObject({
      ok: false,
      records: [],
      problems: ["package is not an object"],
    });
    const v = verifyEvidencePackage(rawPackage([]));
    expect(v.ok).toBe(true);
    const bad = rawPackage([]);
    bad.records = { not: "an array" };
    expect(verifyEvidencePackage(bad).problems).toContain("package records is not an array");
  });
});

describe("authorization — checked first, on a gateway package", () => {
  it("no authorization block: every record UNAUTHORIZED, whatever it claimed", () => {
    const v = verifyEvidencePackage(
      rawPackage(
        [
          rawRecord(),
          rawRecord({ id: "m", status: "MISSING", reason: "NO_SKELETON", evidence: undefined }),
          rawRecord({ id: "x", bbox: null }),
        ],
        { authorization: undefined },
      ),
    );
    expect(v.ok).toBe(false);
    expect(v.problems).toContain("package carries no authorization record");
    expect(v.findings.map((f) => f.status)).toEqual([
      "UNAUTHORIZED",
      "UNAUTHORIZED",
      "UNAUTHORIZED",
    ]);
    // Unauthorised evidence is never inspected: the null bbox was not even looked at.
    expect(v.findings[2]!.checks.bbox).toBe("n/a");
    expect(v.findings[2]!.reasons).toEqual(["package carries no authorization record"]);
  });
  it("owner-only: the owner's still is AVAILABLE; another user's, and one with no owner, are UNAUTHORIZED", () => {
    const v = verifyEvidencePackage(
      rawPackage([
        rawRecord({ id: "mine" }),
        rawRecord({ id: "theirs", owner: OTHER }),
        rawRecord({ id: "whose", owner: null }),
      ]),
    );
    expect(v.findings.map((f) => f.status)).toEqual(["AVAILABLE", "UNAUTHORIZED", "UNAUTHORIZED"]);
    expect(v.findings[1]!.reasons[0]).toMatch(/outside scope owner-only/);
    expect(v.findings[2]!.reasons[0]).toMatch(/no ownerUserId/);
    expect(v.records[1]!.status).toBe("UNAUTHORIZED");
    expect(v.records[1]!.reason).toMatch(/outside scope owner-only/);
  });
  it("listed-users admits the list and nobody else; all-users admits everything, owner or not", () => {
    const listed = {
      grantedBy: "owner",
      grantedAt: "2026-09-02",
      scope: "listed-users",
      userIds: [OTHER],
    };
    expect(
      statusesOf(
        rawPackage(
          [rawRecord({ owner: OTHER }), rawRecord({ owner: OWNER }), rawRecord({ owner: null })],
          { authorization: listed },
        ),
      ),
    ).toEqual(["AVAILABLE", "UNAUTHORIZED", "UNAUTHORIZED"]);
    const all = {
      grantedBy: "owner",
      grantedAt: "2026-09-02",
      scope: "all-users",
      note: "explicit data-use decision",
    };
    expect(
      statusesOf(
        rawPackage(
          [rawRecord({ owner: OTHER }), rawRecord({ owner: OWNER }), rawRecord({ owner: null })],
          { authorization: all },
        ),
      ),
    ).toEqual(["AVAILABLE", "AVAILABLE", "AVAILABLE"]);
  });
  it("a malformed authorization is a package problem and authorises nothing", () => {
    for (const auth of [
      { grantedBy: "owner", grantedAt: "2026-09-02", scope: "everyone" },
      { grantedBy: "owner", grantedAt: "2026-09-02", scope: "owner-only" },
      { grantedBy: "owner", grantedAt: "yesterday", scope: "all-users" },
      { grantedAt: "2026-09-02", scope: "all-users" },
      { grantedBy: "owner", grantedAt: "2026-09-02", scope: "listed-users", userIds: [] },
      "owner said yes",
    ]) {
      const v = verifyEvidencePackage(rawPackage([rawRecord()], { authorization: auth }));
      expect(v.ok, JSON.stringify(auth)).toBe(false);
      expect(v.authorization).toBeNull();
      expect(v.findings[0]!.status).toBe("UNAUTHORIZED");
    }
  });
  it("a record the export itself marked UNAUTHORIZED stays so, with its reason", () => {
    const f = only(
      rawPackage([
        rawRecord({
          status: "UNAUTHORIZED",
          reason: "export not authorised for user bb483798",
          evidence: undefined,
        }),
      ]),
    );
    expect(f.status).toBe("UNAUTHORIZED");
    expect(f.reasons).toEqual(["export not authorised for user bb483798"]);
  });
});

describe("populations that are not gateway traffic", () => {
  it("need no authorization, and a present-but-broken one is still a problem", () => {
    for (const population of ["offline-reference", "instrument-selftest", undefined]) {
      const v = verifyEvidencePackage(
        rawPackage([rawRecord({ owner: null })], { population, authorization: undefined }),
      );
      expect(v.ok, String(population)).toBe(true);
      expect(v.population).toBe(population ?? "undeclared");
      expect(v.findings[0]!.status).toBe("AVAILABLE");
      expect(v.findings[0]!.checks.authorization).toBe("n/a");
    }
    const broken = verifyEvidencePackage(
      rawPackage([rawRecord()], {
        population: "offline-reference",
        authorization: { scope: "nope" },
      }),
    );
    expect(broken.ok).toBe(false);
    expect(broken.findings[0]!.status).toBe("AVAILABLE");
  });
  it("an unknown population is a problem, never silently read as gateway", () => {
    const v = verifyEvidencePackage(rawPackage([rawRecord()], { population: "production" }));
    expect(v.ok).toBe(false);
    expect(v.population).toBe("unknown");
    expect(v.problems[0]).toMatch(/population production is not one of/);
  });
  it("the committed OFFLINE_CAST_SHEET_REFERENCE verifies to six AVAILABLE records, unchanged", () => {
    const raw = JSON.parse(
      read("remotion/fixtures/arap-eligibility/offline-cast-sheet-reference.evidence.json"),
    );
    const v = verifyEvidencePackage(raw);
    expect(v.ok).toBe(true);
    expect(v.population).toBe("offline-reference");
    expect(v.counts).toEqual({
      AVAILABLE: 6,
      MISSING: 0,
      UNAUTHORIZED: 0,
      MALFORMED: 0,
      supplied: 6,
    });
    expect(verifiedPackage(v, raw).records).toEqual(raw.records);
  });
});

describe("shape checks on evidence that claims AVAILABLE — each fails closed to MALFORMED", () => {
  it("dimensions: no working frame, a zero side, a fractional side, a broken original", () => {
    for (const over of [
      { working: undefined },
      { working: { width: 0, height: 10 } },
      { working: { width: 562.5, height: 1000 } },
      { original: { width: -1, height: 10 } },
    ]) {
      const f = only(rawPackage([rawRecord(over)]));
      expect(f.status, JSON.stringify(over)).toBe("MALFORMED");
      expect(f.checks.dimensions).toBe("fail");
    }
  });
  it("bbox: every refusal carries the normalizer's own reason", () => {
    for (const bbox of [
      null,
      [0, 0, 100, 100],
      { x: 0, y: 0, width: -5, height: 10 },
      { format: "ltrb", values: [50, 50, 10, 60] },
      { left: 0, top: 0, width: 5, height: 5 },
      { format: "xywh", values: [0, 0, Number.NaN, 10] },
      { format: "ltrb", values: [0, 0, 900, 100] },
    ]) {
      const f = only(rawPackage([rawRecord({ bbox })]));
      expect(f.status, JSON.stringify(bbox)).toBe("MALFORMED");
      expect(
        f.reasons.some((r) => r.startsWith("bbox: ")),
        JSON.stringify(bbox),
      ).toBe(true);
    }
    // An original-frame bbox with no original dimensions cannot be scaled, and is not guessed.
    const unscalable = only(
      rawPackage([
        rawRecord({
          bbox: { format: "ltrb", frame: "original", values: [0, 0, 100, 100] },
          original: undefined,
        }),
      ]),
    );
    expect(unscalable.status).toBe("MALFORMED");
    expect(unscalable.reasons[0]).toMatch(/^bbox: /);
    // An original-frame bbox WITH original dims scales, and passes.
    const ok = only(
      rawPackage([
        rawRecord({ bbox: { format: "ltrb", frame: "original", values: [0, 0, 192, 192] } }),
      ]),
    );
    expect(ok.status).toBe("AVAILABLE");
  });
  it("mask: wrong length, non-binary values, missing", () => {
    expect(
      only(rawPackage([rawRecord({ mask: { width: 100, height: 100, data: [0, 1] } })])).reasons[0],
    ).toMatch(/mask data length 2 is not 100×100/);
    const nb = mask(100, 100, 50);
    nb.data[7] = 2;
    expect(only(rawPackage([rawRecord({ mask: nb })])).reasons[0]).toMatch(
      /mask data\[7\] is not 0 or 1/,
    );
    expect(only(rawPackage([rawRecord({ mask: undefined })])).checks.mask).toBe("fail");
  });
  it("joints: empty, or a non-finite coordinate", () => {
    const ev = rawRecord().evidence as Record<string, unknown>;
    expect(only(rawPackage([rawRecord({ evidence: { ...ev, joints: {} } })])).reasons).toContain(
      "joints missing or empty",
    );
    expect(
      only(
        rawPackage([rawRecord({ joints: { left_foot: { x: Number.POSITIVE_INFINITY, y: 1 } } })]),
      ).reasons[0],
    ).toMatch(/joint left_foot has non-finite/);
  });
  it("detector confidence: missing, out of range, or zero detections; joint confidence: null is fine, 3 is not", () => {
    expect(only(rawPackage([rawRecord({ confidence: undefined })])).checks.detectorConfidence).toBe(
      "fail",
    );
    expect(
      only(rawPackage([rawRecord({ confidence: { detector: 1.2, detections: 1 } })])).reasons[0],
    ).toMatch(/detector must be a number in \[0, 1\]/);
    expect(
      only(rawPackage([rawRecord({ confidence: { detector: 0.9, detections: 0 } })])).reasons[0],
    ).toMatch(/detections must be a positive integer/);
    expect(
      only(
        rawPackage([
          rawRecord({
            confidence: { detector: 0.9, detections: 1, keypointMean: null, keypointMin: null },
          }),
        ]),
      ).status,
    ).toBe("AVAILABLE");
    const f = only(
      rawPackage([
        rawRecord({
          confidence: { detector: 0.9, detections: 1, keypointMean: 3, keypointMin: 0.2 },
        }),
      ]),
    );
    expect(f.status).toBe("MALFORMED");
    expect(f.checks.jointConfidence).toBe("fail");
  });
  it("precomputed: fill out of range, joint names that are not strings, a detector of 2; nulls are fine", () => {
    const pre = (evidence: unknown, confidence?: unknown) =>
      only(
        rawPackage([
          rawRecord({
            evidence,
            ...(confidence === undefined ? { confidence: undefined } : { confidence }),
          }),
        ]),
      );
    expect(
      pre({ kind: "precomputed", bboxFillPct: 140, jointsOutsideMask: [] }).reasons[0],
    ).toMatch(/bboxFillPct/);
    expect(
      pre({ kind: "precomputed", bboxFillPct: 50, jointsOutsideMask: [1, 2] }).reasons[0],
    ).toMatch(/jointsOutsideMask/);
    expect(
      pre({ kind: "precomputed", bboxFillPct: 50, jointsOutsideMask: ["left_elbow"] }).status,
    ).toBe("AVAILABLE");
    expect(
      pre(
        { kind: "precomputed", bboxFillPct: 50, jointsOutsideMask: [] },
        { detector: null, detections: 1, keypointMean: null, keypointMin: null },
      ).status,
    ).toBe("AVAILABLE");
    expect(
      pre(
        { kind: "precomputed", bboxFillPct: 50, jointsOutsideMask: [] },
        { detector: 2, detections: 1 },
      ).status,
    ).toBe("MALFORMED");
    expect(pre({ kind: "hearsay", bboxFillPct: 50 }).reasons[0]).toMatch(/evidence.kind hearsay/);
    expect(pre(undefined).reasons).toContain("status AVAILABLE but no evidence");
  });
  it("poseWarpInputs: a wrong type, or a key the upstream gate does not have — MALFORMED; null values are absent", () => {
    expect(
      only(rawPackage([rawRecord({ poseWarpInputs: { characterCount: "two" } })])).reasons[0],
    ).toMatch(/characterCount/);
    expect(
      only(rawPackage([rawRecord({ poseWarpInputs: { occluded: "yes" } })])).reasons[0],
    ).toMatch(/occluded is not a boolean/);
    expect(
      only(rawPackage([rawRecord({ poseWarpInputs: { eligible: true } })])).reasons[0],
    ).toMatch(/eligible is not an input/);
    const f = only(
      rawPackage([rawRecord({ poseWarpInputs: { framing: null, characterCount: 1 } })]),
    );
    expect(f.status).toBe("AVAILABLE");
    expect(f.poseWarpInputs.known).toEqual(["characterCount"]);
    expect(
      only(rawPackage([rawRecord({ poseWarpInputs: undefined })])).poseWarpInputs.missing,
    ).toHaveLength(7);
  });
});

describe("declared non-AVAILABLE statuses", () => {
  it("MISSING without a reason stays MISSING, with the omission noted", () => {
    const f = only(rawPackage([rawRecord({ status: "MISSING", evidence: undefined })]));
    expect(f.status).toBe("MISSING");
    expect(f.reasons).toEqual(["declared MISSING without a reason"]);
  });
  it("NOT MEASURED is never ineligible: every verified non-AVAILABLE record leaves the engine unmeasured", () => {
    const v = verifyEvidencePackage(
      rawPackage([
        rawRecord({ id: "u", owner: OTHER }),
        rawRecord({
          id: "m",
          status: "MISSING",
          reason: "NO_HUMANOID_DETECTED",
          evidence: undefined,
        }),
        rawRecord({ id: "x", bbox: null }),
        rawRecord({ id: "d", schema: "wrong" }),
      ]),
    );
    for (const r of v.records) {
      const row = measureEvidence(r);
      expect(row.verdict.measured, r.source.stillId).toBe(false);
      expect(row.verdict.eligible, r.source.stillId).toBe(false);
      expect(row.bboxFillPct).toBeNull();
    }
  });
});

describe("purity", () => {
  it("does not mutate its input and verifies the same input the same way", () => {
    const raw = rawPackage([
      rawRecord(),
      rawRecord({ id: "b", owner: OTHER }),
      rawRecord({ id: "c", bbox: null }),
    ]);
    const before = JSON.stringify(raw);
    const a = verifyEvidencePackage(raw);
    const b = verifyEvidencePackage(JSON.parse(before));
    expect(JSON.stringify(raw)).toBe(before);
    expect(a).toEqual(b);
  });
  it("verifiedPackage carries population and authorization forward, and drops an undeclared one", () => {
    const raw = rawPackage([rawRecord()]);
    const p = verifiedPackage(verifyEvidencePackage(raw), raw);
    expect(p).toMatchObject({
      schema: ARAP_EVIDENCE_SCHEMA,
      population: "gateway",
      authorization: AUTH_OWNER_ONLY,
      corpusId: "gw",
    });
    const plain = rawPackage([rawRecord({ owner: null })], {
      population: undefined,
      authorization: undefined,
    });
    const q = verifiedPackage(verifyEvidencePackage(plain), plain);
    expect("population" in q).toBe(false);
    expect("authorization" in q).toBe(false);
  });
});
