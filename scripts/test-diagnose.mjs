#!/usr/bin/env node
/**
 * Run the suite and, if anything fails, SAY WHAT FAILED.
 *
 * WHY THIS EXISTS. On 2026-08-24 a full run reported two failures and the next
 * run was green. The failing test identities were never captured, so the only
 * honest thing that could be said afterwards was "two tests failed, unknown
 * which" — twelve subsequent clean runs could not turn that into a diagnosis.
 * A transient failure you cannot name is a transient failure you cannot fix.
 *
 * So this wrapper always writes a machine-readable report and prints the
 * identities plus enough context to tell a real defect from machine load:
 * worker count, CPU count, wall clock, and the per-suite time total. Per-suite
 * time inflates sharply when workers are oversubscribed — measured on this
 * repository: ~5.5s of suite time at one worker, ~6.5s at four, ~14.1s at
 * eight on a four-core box. A suite that only fails in the 14s case is telling
 * you about the machine.
 *
 * IT DOES NOT RETRY, and it must never learn to. Passing on the second attempt
 * is the symptom, not the cure; a retry wrapper would have hidden the very
 * failure this script exists to name. The exit code is vitest's own.
 */
import { spawnSync } from "node:child_process";
import { cpus } from "node:os";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outDir = join(tmpdir(), "oniq-test-diagnose");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `run-${process.pid}.json`);

const passthrough = process.argv.slice(2);
const started = Date.now();
const res = spawnSync(
  "npx",
  [
    "vitest",
    "run",
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${outFile}`,
    ...passthrough,
  ],
  { stdio: "inherit", encoding: "utf8" },
);
const wallMs = Date.now() - started;

let report = null;
try {
  report = JSON.parse(readFileSync(outFile, "utf8"));
} catch {
  // A crashed run leaves no report. Say so rather than implying a clean pass.
  console.error(
    "\n[diagnose] no machine-readable report was produced — the run did not finish cleanly.",
  );
}

const line = (k, v) => console.error(`  ${String(k).padEnd(18)} ${v}`);
console.error("\n[diagnose] run context");
line("cpus", cpus().length);
line("wall", `${(wallMs / 1000).toFixed(1)}s`);
line("exit code", res.status);

if (report) {
  const suiteMs = (report.testResults ?? []).reduce(
    (n, s) => n + ((s.endTime ?? 0) - (s.startTime ?? 0)),
    0,
  );
  line("suites", (report.testResults ?? []).length);
  line("tests", `${report.numPassedTests ?? "?"} passed / ${report.numTotalTests ?? "?"}`);
  line("failed", report.numFailedTests ?? 0);
  // The contention signal. Compare against the wall clock: when this figure
  // climbs while wall time does not, the workers are fighting for CPU.
  line("sum-suite-ms", Math.round(suiteMs));

  const failures = (report.testResults ?? []).flatMap((s) =>
    (s.assertionResults ?? [])
      .filter((a) => a.status === "failed")
      .map((a) => ({ file: s.name, name: a.fullName, messages: a.failureMessages ?? [] })),
  );

  if (failures.length) {
    console.error("\n[diagnose] FAILED TEST IDENTITIES");
    for (const f of failures) {
      console.error(`\n  ${f.file}\n    ${f.name}`);
      for (const m of f.messages) {
        console.error(
          String(m)
            .split("\n")
            .slice(0, 12)
            .map((l) => `      ${l}`)
            .join("\n"),
        );
      }
    }
    console.error(`\n[diagnose] full report retained at ${outFile}`);
    process.exit(res.status ?? 1);
  }
}

// Nothing failed: do not leave reports lying around.
try {
  rmSync(outFile, { force: true });
} catch {
  /* the report is a diagnostic, not a deliverable — its removal is best-effort */
}
process.exit(res.status ?? 0);
