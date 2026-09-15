/**
 * Deterministic, offline grounding scorer. It evaluates supplied structured
 * responses and never imports a provider or calls a model.
 *
 * npx tsx scripts/oqca-grounding-bench.ts \
 *   --suite src/oqca/grounding/fixtures/sealed.synthetic.json \
 *   --run src/oqca/grounding/fixtures/responses.synthetic.json \
 *   --thresholds src/oqca/grounding/fixtures/thresholds.json \
 *   --output grounding-result.json
 */
import { writeFileSync } from "node:fs";
import {
  loadGroundingRun,
  loadGroundingSuite,
  loadGroundingThresholds,
} from "../src/oqca/grounding/loader.ts";
import { runGroundingBenchmark } from "../src/oqca/grounding/runner.ts";

function args(argv: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`expected --name value arguments, received ${name ?? "<end>"}`);
    }
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

const options = args(process.argv.slice(2));
for (const required of ["suite", "run", "thresholds"]) {
  if (!options[required]) throw new Error(`missing --${required}`);
}

const result = runGroundingBenchmark(
  loadGroundingSuite(options.suite),
  loadGroundingRun(options.run),
  loadGroundingThresholds(options.thresholds),
);
const output = `${JSON.stringify(result, null, 2)}\n`;
if (options.output) writeFileSync(options.output, output, "utf8");
else process.stdout.write(output);
process.exitCode = result.passed ? 0 : 1;
