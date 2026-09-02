/**
 * Step 11B — verify, measure, classify, compare, decide. ONE state out.
 *
 *   npx tsx scripts/arap-real-corpus-decision.ts
 *       No package: prints the comparison with the gateway side NOT MEASURED
 *       and the state REAL_GATEWAY_CORPUS_PENDING. Writes nothing.
 *
 *   npx tsx scripts/arap-real-corpus-decision.ts --package <evidence.json> [--out-dir <dir>]
 *       A ready-made oniq.arap-evidence/1 package (an authorised export).
 *
 *   npx tsx scripts/arap-real-corpus-decision.ts --driver-out <dir> \
 *       [--corpus-manifest <corpus-manifest.json>] [--out-dir <dir>]
 *       What the in-image driver wrote, plus the owner's corpus manifest that
 *       says which population this is, who authorised it, and which still
 *       belongs to whom. Without the manifest the population is undeclared and
 *       the state stays PENDING — a driver run alone can never decide.
 *
 * The two real-corpus files are written ONLY for a package declared `gateway`:
 *   real-gateway-eligibility-reference.evidence.json   the package as verified
 *   real-gateway-eligibility-reference.report.json     report + comparison + decision
 * Anything else prints, and leaves no file that could be mistaken for one.
 *
 * Nothing here reads R2, holds a credential, or touches a shot.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  buildRealCorpusReport,
  compareWithOffline,
  decideGatewayState,
  type RealCorpusReport,
} from "../src/lib/arapCorpusDecision";
import type { CorpusReport } from "../src/lib/arapEligibilityCorpus";
import {
  ARAP_EVIDENCE_SCHEMA,
  evidenceFromDriverRecord,
  type EvidencePackage,
  type EvidenceRecord,
} from "../src/lib/arapEvidence";
import { verifyEvidencePackage } from "../src/lib/arapEvidenceVerify";

const OFFLINE_REPORT =
  "remotion/fixtures/arap-eligibility/offline-cast-sheet-reference.report.json";
const EVIDENCE_OUT = "real-gateway-eligibility-reference.evidence.json";
const REPORT_OUT = "real-gateway-eligibility-reference.report.json";
export const CORPUS_MANIFEST_SCHEMA = "oniq.arap-corpus-manifest/1";

type CorpusManifest = {
  schema: string;
  population: string;
  corpusId: string;
  label?: string;
  authorization?: unknown;
  provenance?: { instrument?: string; measuredAt?: string; note?: string };
  stills: Record<
    string,
    { ownerUserId?: string; jobId?: string; sceneId?: string; shotId?: string; sha256?: string }
  >;
};

function usage(code: number): never {
  console.error(
    "usage: arap-real-corpus-decision.ts [--package <evidence.json> | --driver-out <dir> [--corpus-manifest <json>]] [--out-dir <dir>] [--offline <report.json>]",
  );
  process.exit(code);
}

function args(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a?.startsWith("--")) usage(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) usage(2);
    out[a.slice(2)] = v;
    i += 1;
  }
  return out;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) {
    console.error(`not found: ${file}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Driver output → a package, with the owner's corpus manifest merged in where given. */
function packageFromDriver(outDir: string, manifestFile: string | undefined): unknown {
  const manifestPath = join(outDir, "manifest.json");
  const m = readJson(manifestPath) as {
    corpus_id: string;
    missing_evidence?: string;
    instrument?: string;
    measured_at_unix?: number;
    stills?: { still_id: string }[];
  };
  const recordsDir = join(outDir, "records");
  const records: EvidenceRecord[] = existsSync(recordsDir)
    ? readdirSync(recordsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => evidenceFromDriverRecord(readJson(join(recordsDir, f)) as never))
    : [];
  const pkg: EvidencePackage = {
    schema: ARAP_EVIDENCE_SCHEMA,
    corpusId: m.corpus_id,
    label: m.corpus_id,
    provenance: {
      instrument: m.instrument ?? "runtime/arap-cpu/measure/measure_eligibility.py",
      measuredAt: m.measured_at_unix
        ? new Date(m.measured_at_unix * 1000).toISOString()
        : undefined,
    },
    records,
    ...(m.missing_evidence ? { missingEvidence: m.missing_evidence } : {}),
  };
  if (!manifestFile) return pkg;

  const cm = readJson(manifestFile) as CorpusManifest;
  if (cm.schema !== CORPUS_MANIFEST_SCHEMA) {
    console.error(`corpus manifest schema ${String(cm.schema)} is not ${CORPUS_MANIFEST_SCHEMA}`);
    process.exit(1);
  }
  const stills = cm.stills ?? {};
  const seen = new Set<string>();
  for (const r of records) {
    const entry = stills[r.source.stillId];
    if (!entry) continue; // no manifest entry → no owner → the verifier refuses it under any scope but all-users
    seen.add(r.source.stillId);
    r.source = {
      ...r.source,
      ...(entry.ownerUserId ? { ownerUserId: entry.ownerUserId } : {}),
      ...(entry.jobId ? { jobId: entry.jobId } : {}),
      ...(entry.sceneId ? { sceneId: entry.sceneId } : {}),
      ...(entry.shotId ? { shotId: entry.shotId } : {}),
    };
    if (entry.sha256 && r.source.sha256 && entry.sha256 !== r.source.sha256) {
      // The bytes the driver measured are not the bytes the owner exported.
      r.status = "MALFORMED";
      r.reason = `sha256 mismatch: corpus manifest ${entry.sha256} vs driver ${r.source.sha256}`;
      delete r.evidence;
    }
  }
  // A still the owner listed that the driver never saw is MISSING, and counted.
  for (const [stem, entry] of Object.entries(stills)) {
    if (seen.has(stem)) continue;
    records.push({
      schema: ARAP_EVIDENCE_SCHEMA,
      status: "MISSING",
      source: {
        corpusId: cm.corpusId,
        stillId: stem,
        ...(entry.ownerUserId ? { ownerUserId: entry.ownerUserId } : {}),
        ...(entry.jobId ? { jobId: entry.jobId } : {}),
      },
      provenance: { instrument: "corpus manifest vs driver output" },
      candidate: null,
      primary: false,
      reason:
        "NOT_IN_DRIVER_OUTPUT — listed in the corpus manifest, absent from the corpus the driver saw",
    });
  }
  return {
    ...pkg,
    corpusId: cm.corpusId,
    label: cm.label ?? cm.corpusId,
    population: cm.population,
    ...(cm.authorization !== undefined ? { authorization: cm.authorization } : {}),
    provenance: {
      ...pkg.provenance,
      note: [cm.provenance?.note, `driver corpus_id ${m.corpus_id}`].filter(Boolean).join(" — "),
    },
  };
}

const opt = args(process.argv.slice(2));
if (opt.package && opt["driver-out"]) usage(2);
const offline = readJson(opt.offline ?? OFFLINE_REPORT) as CorpusReport;

let raw: unknown = null;
let defaultOut: string | null = null;
if (opt.package) {
  raw = readJson(opt.package);
  defaultOut = dirname(opt.package);
} else if (opt["driver-out"]) {
  raw = packageFromDriver(opt["driver-out"], opt["corpus-manifest"]);
  defaultOut = join(opt["driver-out"], "decision");
}

let real: RealCorpusReport | null = null;
if (raw !== null) {
  const v = verifyEvidencePackage(raw);
  const scope =
    v.population === "gateway"
      ? `gateway stills, authorised export ${v.label ?? v.corpusId ?? "?"}; every rate over ${"MEASURED_VALID_RECORDS"}`
      : `population ${v.population}: not gateway traffic`;
  real = buildRealCorpusReport(v, raw, scope);
}
const comparison = compareWithOffline(offline, real);
const decision = decideGatewayState(real);

const line = (k: string, v: unknown) =>
  console.log(`  ${k.padEnd(26)} ${typeof v === "string" ? v : JSON.stringify(v)}`);
const pct = (v: number | string | null) =>
  typeof v === "number" ? `${(v * 100).toFixed(1)}%` : (v ?? "n/a");
console.log("=".repeat(72));
console.log("  ARAP REAL GATEWAY CORPUS — verify, measure, classify, compare, decide");
console.log("=".repeat(72));
line(
  "offline reference",
  `${comparison.offline.label}  n=${comparison.offline.n}  eligible ${comparison.offline.eligible}  rate ${pct(comparison.offline.eligibleRate)}  (${comparison.offline.standing})`,
);
line(
  "gateway corpus",
  `${comparison.gateway.label ?? "none supplied"}  n=${comparison.gateway.n}  eligible ${comparison.gateway.eligible}  rate ${pct(comparison.gateway.eligibleRate)}  (${comparison.gateway.standing})`,
);
line("production eligibility", pct(comparison.productionEligibility));
line("populations merged", comparison.populationsMerged);
if (real) {
  line("population", real.population);
  line("evidence package", real.evidencePackageVersion);
  line("authorization", real.authorization ?? "none");
  line(
    "supplied / valid / measured",
    `${real.counts.supplied} / ${real.counts.valid} / ${real.counts.measured}`,
  );
  line("not measured", real.counts.notMeasured);
  line("eligible / rejected", `${real.counts.eligible} / ${real.counts.rejected}`);
  line("denominator", real.denominator);
  line("interval 95%", real.eligibleRateInterval95 ?? "n/a");
  line("primary-only", real.primaryOnly);
  line("bbox fill", real.bboxFillPct);
  line("rejection distribution", real.rejectionDistribution);
  line("failure classes", real.failureClasses);
  line("upstream blockers", real.upstreamBlockers);
  line(
    "verification",
    `${real.verification.ok ? "ok" : "PROBLEMS"} ${JSON.stringify(real.verification.problems)}`,
  );
  for (const c of real.caveats) line("caveat", c);
}
line(
  "decision rule",
  `min measured ${decision.rule.minMeasured}, majority ${decision.rule.majority}, Wilson 95% — ${decision.rule.standing}`,
);
line("path", decision.path.join(" → "));
for (const r of decision.reasons) line("because", r);
console.log("=".repeat(72));
console.log(`STATE: ${decision.state}`);

if (real && real.population === "gateway") {
  const outDir = opt["out-dir"] ?? defaultOut ?? ".";
  mkdirSync(outDir, { recursive: true });
  const v = verifyEvidencePackage(raw);
  const evidencePath = join(outDir, EVIDENCE_OUT);
  const reportPath = join(outDir, REPORT_OUT);
  writeFileSync(
    evidencePath,
    JSON.stringify(
      {
        ...(raw as Record<string, unknown>),
        records: v.records,
        verification: { ok: v.ok, problems: v.problems, counts: v.counts, findings: v.findings },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(reportPath, JSON.stringify({ report: real, comparison, decision }, null, 2) + "\n");
  console.log(`WROTE ${evidencePath}`);
  console.log(`WROTE ${reportPath}`);
} else if (real) {
  console.log(`(population ${real.population}: no real-gateway files written)`);
} else {
  console.log("(no package supplied: nothing written)");
}
