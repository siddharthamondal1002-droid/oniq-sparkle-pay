/**
 * Step 11C — the committed real-corpus reference: run 33652523296 over the
 * OWNER_AUTHORIZED_GATEWAY_CORPUS, measured inside the validated image.
 *
 * These tests pin the reference so it cannot drift: the counts, the named
 * denominator, the decision the confirmed rule produced, the identity of the
 * two eligible primaries, the nine keys that answered 404, and that the
 * decision and comparison re-derive byte for byte from the committed report
 * with the code as it stands. They also prove the scope held: no foreign id
 * appears anywhere in the reference, and every hash the run verified is the
 * hash the committed manifest declares.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compareWithOffline,
  decideGatewayState,
  type RealCorpusReport,
} from "../arapCorpusDecision";
import type { CorpusReport } from "../arapEligibilityCorpus";
import { ARAP_ELIGIBILITY } from "../arapProvider";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const REFERENCE =
  "remotion/fixtures/arap-eligibility/real-gateway-eligibility-reference.report.json";
const MANIFEST =
  "remotion/fixtures/arap-eligibility/corpus/OWNER_AUTHORIZED_GATEWAY_CORPUS.manifest.json";
const FETCHED =
  "remotion/fixtures/arap-eligibility/corpus/OWNER_AUTHORIZED_GATEWAY_CORPUS.fetched.json";
const OFFLINE = "remotion/fixtures/arap-eligibility/offline-cast-sheet-reference.report.json";
const FILM_PRESENT = "87c2b756-a832-48dc-b97b-7a3235ddee5c";
const FILM_ABSENT = "64874747-44af-4086-a58a-250d2e7eec08";

const ref = JSON.parse(read(REFERENCE)) as {
  report: RealCorpusReport;
  comparison: ReturnType<typeof compareWithOffline>;
  decision: ReturnType<typeof decideGatewayState>;
};

describe("the real-corpus reference — what run 33652523296 measured", () => {
  const r = ref.report;
  it("is the owner-authorised gateway population under an owner-only grant, verified clean", () => {
    expect(r.population).toBe("gateway");
    expect(r.corpusId).toBe("OWNER_AUTHORIZED_GATEWAY_CORPUS");
    expect(r.evidencePackageVersion).toBe("oniq.arap-evidence/1");
    expect(r.authorization).toMatchObject({ scope: "owner-only", grantedAt: "2026-09-02" });
    expect(r.verification).toMatchObject({ ok: true, problems: [] });
    expect(r.thresholds).toEqual({
      maxBboxFillPct: ARAP_ELIGIBILITY.maxBboxFillPct,
      coreJoints: ARAP_ELIGIBILITY.coreJoints,
    });
  });
  it("counts: 21 supplied, 9 measured over MEASURED_VALID_RECORDS, 12 not measured, none unauthorised or malformed", () => {
    expect(r.counts).toEqual({
      supplied: 21,
      valid: 9,
      measured: 9,
      notMeasured: { missing: 12, unauthorized: 0, malformed: 0 },
      eligible: 2,
      rejected: 7,
    });
    expect(r.denominator).toBe("MEASURED_VALID_RECORDS");
    expect(r.eligibleRate).toBeCloseTo(2 / 9, 6);
    expect(r.eligibleRateInterval95).toEqual({ lo: 0.0632, hi: 0.5474 });
    expect(r.primaryOnly).toMatchObject({ measured: 6, eligible: 2 });
  });
  it("names the two eligible primaries and the nine keys that answered 404, and nobody else's still", () => {
    const eligible = r.perStill.filter((p) => p.eligible).map((p) => p.stillId);
    expect(eligible).toEqual([`${FILM_PRESENT}-s-shot002`, `${FILM_PRESENT}-s-shot004`]);
    expect(r.perStill.filter((p) => p.eligible).every((p) => p.primary)).toBe(true);
    const absent = r.perStill.filter((p) => p.stillId.startsWith(FILM_ABSENT));
    expect(absent).toHaveLength(9);
    for (const p of absent) {
      expect(p).toMatchObject({ status: "MISSING", measured: false, eligible: null });
      expect(p.reasons[0]).toMatch(/NOT_IN_DRIVER_OUTPUT/);
    }
    expect(r.perStill.filter((p) => p.reasons[0] === "NO_HUMANOID_DETECTED")).toHaveLength(3);
    expect(read(REFERENCE)).not.toContain("bb483798");
  });
  it("rejections and failure classes are the gate's own", () => {
    expect(r.rejectionDistribution).toEqual({ bbox_fill_exceeded: 1, core_joint_outside_mask: 6 });
    expect(r.failureClasses).toEqual({
      detector_failure: 3,
      core_joint_outside_mask: 6,
      bbox_fill_exceeded: 1,
      missing: 9,
    });
    expect(r.upstreamBlockers).toEqual({ framing_unknown: 9, multiple_character: 6 });
    expect(r.multiCharacterStills).toBe(3);
    expect(r.bboxFillPct).toMatchObject({ n: 9 });
    expect(r.bboxFillPct.min).toBeCloseTo(9.419, 2);
    expect(r.bboxFillPct.max).toBeCloseTo(71.702, 2);
  });
  it("the decision re-derives from the committed report with the code as it stands", () => {
    expect(ref.decision.state).toBe("ARAP_AS_SELECTIVE_PROVIDER");
    expect(ref.decision.path).toEqual([
      "REAL_GATEWAY_CORPUS_MEASURED",
      "ARAP_AS_SELECTIVE_PROVIDER",
    ]);
    expect(decideGatewayState(r)).toEqual(ref.decision);
    const offline = JSON.parse(read(OFFLINE)) as CorpusReport;
    expect(compareWithOffline(offline, r)).toEqual(ref.comparison);
    expect(ref.comparison.populationsMerged).toBe(false);
    expect(ref.comparison.offline.n).toBe(6);
    expect(ref.comparison.gateway.n).toBe(9);
  });
});

describe("the corpus the run measured is the corpus the owner authorised", () => {
  const manifest = JSON.parse(read(MANIFEST)) as { stills: Record<string, { sha256?: string }> };
  const fetched = JSON.parse(read(FETCHED)) as {
    fetchedAt: string;
    readBaseHost: string;
    fetchSummary: { listed: number; fetched: number; missing: number; missingStems: string[] };
    stills: Record<
      string,
      {
        sha256?: string;
        sha256Verified?: boolean;
        fetched: boolean;
        width?: number;
        height?: number;
      }
    >;
  };
  it("nine fetched with the declared hash verified, nine missing at their derived keys, eighteen listed", () => {
    expect(fetched.fetchSummary).toMatchObject({ listed: 18, fetched: 9, missing: 9 });
    expect(fetched.fetchSummary.missingStems.every((s) => s.startsWith(FILM_ABSENT))).toBe(true);
    for (const [stem, s] of Object.entries(fetched.stills)) {
      if (s.fetched) {
        expect(s.sha256Verified, stem).toBe(true);
        expect(s.sha256, stem).toBe(manifest.stills[stem]?.sha256);
        expect([s.width, s.height]).toEqual([704, 480]);
      } else expect(manifest.stills[stem]?.sha256, stem).toBeUndefined();
    }
    expect(fetched.readBaseHost).toMatch(/^[a-z0-9-]+\.r2\.dev$/);
    expect(read(FETCHED)).not.toContain("bb483798");
  });
});
