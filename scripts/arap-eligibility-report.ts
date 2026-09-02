/**
 * Step 11A — turn evidence into the measurement report.
 *
 *   npx tsx scripts/arap-eligibility-report.ts <driver_out_dir> [report.json]
 *   npx tsx scripts/arap-eligibility-report.ts --package <evidence.json> [report.json]
 *
 * The first form reads what the in-image driver wrote (manifest.json +
 * records/*.json) and wraps each record in the evidence contract. The second
 * reads a ready-made evidence package — the offline cast-sheet reference, or
 * an authorised production export. Either way the production eligibility
 * functions run unchanged (src/lib/arapEligibilityCorpus.ts) and one JSON
 * report is written. No other side effect.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildReport } from "../src/lib/arapEligibilityCorpus";
import {
  ARAP_EVIDENCE_SCHEMA,
  evidenceFromDriverRecord,
  type EvidencePackage,
} from "../src/lib/arapEvidence";

const argv = process.argv.slice(2);
let pkg: EvidencePackage;
let reportPath: string;
let scope: string;

if (argv[0] === "--package") {
  const file = argv[1];
  if (!file || !existsSync(file)) {
    console.error("usage: arap-eligibility-report.ts --package <evidence.json> [report.json]");
    process.exit(2);
  }
  pkg = JSON.parse(readFileSync(file, "utf8")) as EvidencePackage;
  if (pkg.schema !== ARAP_EVIDENCE_SCHEMA) {
    console.error(`package schema ${String(pkg.schema)} is not ${ARAP_EVIDENCE_SCHEMA}`);
    process.exit(1);
  }
  reportPath = argv[2] ?? file.replace(/\.evidence\.json$|\.json$/, "") + ".report.json";
  scope = pkg.provenance.note ?? pkg.label;
} else {
  const outDir = argv[0];
  if (!outDir) {
    console.error("usage: arap-eligibility-report.ts <driver_out_dir> [report.json]");
    process.exit(2);
  }
  reportPath = argv[1] ?? join(outDir, "report.json");
  const manifestPath = join(outDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`no manifest at ${manifestPath} — the driver did not run, or wrote nowhere`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    corpus_id: string;
    missing_evidence?: string;
    instrument?: string;
    measured_at_unix?: number;
  };
  const recordsDir = join(outDir, "records");
  const records = existsSync(recordsDir)
    ? readdirSync(recordsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => evidenceFromDriverRecord(JSON.parse(readFileSync(join(recordsDir, f), "utf8"))))
    : [];
  pkg = {
    schema: ARAP_EVIDENCE_SCHEMA,
    corpusId: manifest.corpus_id,
    label: manifest.corpus_id,
    provenance: {
      instrument: manifest.instrument ?? "runtime/arap-cpu/measure/measure_eligibility.py",
      measuredAt: manifest.measured_at_unix
        ? new Date(manifest.measured_at_unix * 1000).toISOString()
        : undefined,
    },
    records,
    ...(manifest.missing_evidence ? { missingEvidence: manifest.missing_evidence } : {}),
  };
  scope =
    manifest.corpus_id === "instrument-selftest"
      ? "instrument self-test on the drawing shipped inside the validated image — NOT gateway stills"
      : `driver output for corpus ${manifest.corpus_id}`;
}

const report = buildReport(pkg, scope);
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

const a = report.aggregates;
const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const line = (k: string, v: unknown) =>
  console.log(`  ${k.padEnd(28)} ${typeof v === "string" ? v : JSON.stringify(v)}`);
console.log("=".repeat(70));
console.log(`  ARAP ELIGIBILITY MEASUREMENT — ${report.label}`);
console.log("=".repeat(70));
line("scope", report.scope);
line(
  "thresholds (unchanged)",
  `bbox fill <= ${report.thresholds.maxBboxFillPct}%, core ${report.thresholds.coreJoints.join("/")}`,
);
line("stills / records", `${a.totalStills} / ${a.totalRecords} (primary ${a.primaryCandidates})`);
line(
  "measured / NOT measured",
  `${a.measured} / ${a.notMeasured}  ${JSON.stringify(a.notMeasuredByStatus)}`,
);
line(
  "eligible",
  `${a.eligible}  (${pct(a.eligibleRateOfMeasured)} of measured, ${pct(a.eligibleRateOfAll)} of all)`,
);
line("rejected", `${a.rejected}  (${pct(a.rejectedRateOfMeasured)} of measured)`);
line("rejection reasons", a.rejectionReasons);
line("not-measured reasons", a.notMeasuredReasons);
line("bboxFillPct", a.bboxFillPct);
line("jointsOutsideMask (count)", a.jointsOutsideMaskCount.histogram);
line("jointsOutsideMask (joint)", a.jointsOutsideMaskByJoint);
line(
  "detections per still",
  `${JSON.stringify(a.detectionsPerStill.histogram)}  multi-character stills ${a.multiCharacterStills}`,
);
line("upstream gate", a.poseWarpGate);
line("attributable", a.attributable);
if (report.missingEvidence) line("MISSING EVIDENCE", report.missingEvidence);
console.log("=".repeat(70));
console.log(`WROTE ${reportPath}`);
