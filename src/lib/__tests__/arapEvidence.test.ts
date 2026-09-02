/**
 * The evidence contract and the adapter from the in-image driver's records.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ARAP_EVIDENCE_SCHEMA, evidenceFromDriverRecord } from "../arapEvidence";

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "remotion/fixtures/arap-eligibility/synthetic-record.json"),
    "utf8",
  ),
);

describe("adapter: driver record → evidence record", () => {
  it("a record with artifacts becomes AVAILABLE with an explicit, declared bbox", () => {
    const e = evidenceFromDriverRecord(fixture);
    expect(e.schema).toBe(ARAP_EVIDENCE_SCHEMA);
    expect(e.status).toBe("AVAILABLE");
    expect(e.evidence?.kind).toBe("artifacts");
    if (e.evidence?.kind !== "artifacts") return;
    // The writer declares its representation; the adapter carries that declaration.
    expect(e.evidence.bbox).toEqual({
      format: "ltrb",
      frame: "working",
      values: [100, 200, 200, 300],
    });
    expect(e.confidence).toMatchObject({
      detector: 0.991,
      detections: 1,
      keypointMean: 0.87,
      keypointMin: 0.61,
    });
    expect(e.poseWarpInputs).toEqual({ characterCount: 1, longSidePx: 1000 });
    expect(e.provenance.instrument).toMatch(/measure_eligibility\.py/);
  });

  it("a missing-evidence record becomes MISSING with the pipeline's exact reason", () => {
    const e = evidenceFromDriverRecord({
      still_id: "s",
      candidate: null,
      primary: false,
      image: { original: { width: 10, height: 10 }, working: { width: 10, height: 10 } },
      missing_evidence: "NO_HUMANOID_DETECTED",
      evidence: { det_count: 0 },
    });
    expect(e.status).toBe("MISSING");
    expect(e.reason).toBe("NO_HUMANOID_DETECTED");
    expect(e.evidence).toBeUndefined();
  });

  it("artifacts without a mask or joints are MALFORMED, not AVAILABLE", () => {
    const e = evidenceFromDriverRecord({
      still_id: "s",
      artifacts: { bbox: [0, 0, 1, 1], bbox_format: "ltrb", joints: {} } as never,
    });
    expect(e.status).toBe("MALFORMED");
    expect(e.reason).toMatch(/missing mask/);
  });

  it("a bare-array bbox WITHOUT a declared format is passed through for the normalizer to refuse", () => {
    const rec = JSON.parse(JSON.stringify(fixture));
    delete rec.artifacts.bbox_format;
    const e = evidenceFromDriverRecord(rec);
    expect(e.status).toBe("AVAILABLE"); // the adapter tags; the normalizer judges
    if (e.evidence?.kind !== "artifacts") return;
    expect(Array.isArray(e.evidence.bbox)).toBe(true);
    expect(e.evidence.bboxFormat).toBeUndefined();
  });
});
