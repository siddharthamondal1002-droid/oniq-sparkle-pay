/**
 * OQCA v1.1 — run every benchmark manifest and print the report.
 *
 *   npx tsx scripts/oqca-bench.ts
 *
 * Reads `src/oqca/benchmarks/<family>/*.json`, runs each over its declared
 * seeds against its declared baselines, runs its declared adversarial controls,
 * and prints statistics. No network, no model, no cost. The output is the
 * evidence `docs/oqca/OQCA_V1_1_REPORT.md` quotes.
 */
import { loadAllManifests, listFamilies } from "../src/oqca/bench/loader";
import { formatResult, runBenchmark } from "../src/oqca/bench/runner";

const manifests = loadAllManifests();
console.log(`families: ${listFamilies().join(", ")}`);
console.log(`manifests: ${manifests.length}\n`);
let invalid = 0;
for (const m of manifests) {
  const r = runBenchmark(m);
  if (!r.controlsHeld) invalid++;
  console.log(formatResult(r));
  console.log("");
}
console.log(invalid === 0 ? "all runs valid" : `${invalid} INVALID run(s)`);
