/**
 * Zero-provider E-003B suite preflight.
 *
 * Usage: npx tsx scripts/e003b-preflight.ts <suite.json>
 */
import { readFileSync } from "node:fs";
import {
  assertRunnableE003B,
  plannedExecutions,
  suiteDigest,
  type E003BSuite,
} from "../src/oqca/benchmarks/e003b.ts";

const path = process.argv[2];
if (!path) throw new Error("usage: npx tsx scripts/e003b-preflight.ts <suite.json>");
const suite = JSON.parse(readFileSync(path, "utf8")) as E003BSuite;
assertRunnableE003B(suite);
console.log(JSON.stringify({
  suiteId: suite.suiteId,
  digest: suiteDigest(suite),
  tasks: suite.tasks.length,
  executions: plannedExecutions(suite),
  providerCalls: 0,
  externalSpendUsd: 0,
}, null, 2));
