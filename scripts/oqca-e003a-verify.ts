/**
 * Verify a custodian-signed E-003 artifact chain without executing any model or tool.
 *
 * node scripts/oqca-e003a-verify.ts --runner file --evaluator file --output file
 *   --trusted-keys file
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  verifyExperimentChain,
  type SignedArtifact,
  type TrustedKey,
} from "../src/oqca/benchmarks/e003a/integrity.ts";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return resolve(value);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const runner = readJson<SignedArtifact>(option("--runner"));
const evaluator = readJson<SignedArtifact>(option("--evaluator"));
const output = readJson<SignedArtifact>(option("--output"));
const trustedKeys = readJson<readonly TrustedKey[]>(option("--trusted-keys"));

verifyExperimentChain(runner, evaluator, output, trustedKeys);
process.stdout.write(
  `${JSON.stringify({
    verified: true,
    repository_sha: runner.binding.repository_sha,
    task_manifest_sha256: runner.binding.task_manifest_sha256,
    output_bundle_sha256: runner.binding.output_bundle_sha256,
  })}\n`,
);
