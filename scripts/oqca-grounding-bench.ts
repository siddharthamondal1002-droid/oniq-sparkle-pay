/**
 * Deterministic, offline held-out grounding benchmark.
 *
 * node scripts/oqca-grounding-bench.ts [--fixture path] [--thresholds path]
 *   [--output path] [--verify-only]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runGroundingBenchmark, verifySeal } from "../src/oqca/grounding/harness.ts";
import { loadSealedFixture, loadThresholdOverrides } from "../src/oqca/grounding/loader.ts";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return value;
}

const fixturePath = resolve(
  option("--fixture") ?? "src/oqca/benchmarks/grounding/synthetic-held-out.v1.json",
);
const fixture = loadSealedFixture(fixturePath);

if (process.argv.includes("--verify-only")) {
  console.log(
    JSON.stringify({
      suite_id: fixture.suite.suite_id,
      sha256: verifySeal(fixture),
      verified: true,
    }),
  );
} else {
  const thresholdsPath = option("--thresholds");
  const result = runGroundingBenchmark(
    fixture,
    thresholdsPath ? loadThresholdOverrides(resolve(thresholdsPath)) : {},
  );
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const outputPath = option("--output");
  if (outputPath) {
    const absolute = resolve(outputPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, json, "utf8");
  } else {
    process.stdout.write(json);
  }
  if (!result.passed) process.exitCode = 1;
}
