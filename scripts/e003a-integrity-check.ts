/**
 * E-003A zero-spend integrity qualification.
 *
 * This is a tool entrypoint so the integrity module is exercised outside tests.
 * It performs no network, model, database, production, or paid action.
 *
 * Run: npx tsx scripts/e003a-integrity-check.ts
 */
import {
  seal,
  verifyIntegrity,
  type EvaluatorManifest,
  type IntegrityInput,
  type RunnerManifest,
} from "../src/oqca/benchmarks/e003aIntegrity.ts";

const runner: RunnerManifest = {
  schemaVersion: "e003a-runner-v1",
  suiteHash: "e003a-suite-v1",
  promptHash: "e003a-prompt-v1",
  toolSurfaceHash: "e003a-tools-v1",
  adapterSha: "e003a-adapter-v1",
  environmentHash: "e003a-environment-v1",
  budget: {
    ceilingUsd: 0.05,
    maxInputTokens: 64_000,
    maxOutputTokens: 16_000,
    maxModelCalls: 8,
    maxToolCalls: 6,
    maxRetries: 2,
  },
  approvalId: "owner-2026-09-19",
};

const evaluator: EvaluatorManifest = {
  schemaVersion: "e003a-evaluator-v1",
  rubricHash: "e003a-rubric-v1",
  thresholdsHash: "e003a-thresholds-v1",
  evaluatorVersion: "e003a-v1",
  sealedExpectationsHash: "e003a-expectations-v1",
};

function control(): IntegrityInput {
  const r = seal(runner);
  const e = seal(evaluator);
  return {
    runner: r,
    evaluator: e,
    evaluatorAccessibleToRunner: false,
    approvalNonce: "e003a-owner-approval-1",
    previouslyConsumedApprovalNonces: [],
    budget: { ceilingUsd: 0.05, spentBeforeUsd: 0, spentAfterUsd: 0 },
    sideEffects: [],
    trace: {
      runId: "e003a-control",
      taskId: "integrity",
      arm: "bounded-agent",
      runnerDigest: r.digest,
      evaluatorDigest: e.digest,
    },
    expectedTrace: {
      runId: "e003a-control",
      taskId: "integrity",
      arm: "bounded-agent",
    },
  };
}

const base = control();
const clean = verifyIntegrity(base);
if (!clean.ok) throw new Error(`E-003A clean control failed: ${clean.failures.join(", ")}`);

const mutations: readonly [string, IntegrityInput, string][] = [
  [
    "runner seal tamper",
    { ...base, runner: { ...base.runner, payload: { ...base.runner.payload, promptHash: "tampered" } } },
    "RUNNER_SEAL_TAMPER",
  ],
  [
    "evaluator leakage",
    { ...base, evaluatorAccessibleToRunner: true },
    "EVALUATOR_LEAKAGE",
  ],
  [
    "approval replay",
    { ...base, previouslyConsumedApprovalNonces: [base.approvalNonce] },
    "APPROVAL_REPLAY",
  ],
  [
    "budget reset",
    { ...base, budget: { ceilingUsd: 0.05, spentBeforeUsd: 0.02, spentAfterUsd: 0.01 } },
    "BUDGET_RESET",
  ],
  [
    "duplicate side effect",
    { ...base, sideEffects: [{ idempotencyKey: "x" }, { idempotencyKey: "x" }] },
    "DUPLICATE_SIDE_EFFECT",
  ],
  [
    "trace mismatch",
    { ...base, trace: { ...base.trace, taskId: "wrong" } },
    "TRACE_MISMATCH",
  ],
];

for (const [name, input, expected] of mutations) {
  const got = verifyIntegrity(input);
  if (got.ok || !got.failures.includes(expected as never)) {
    throw new Error(`E-003A mutation escaped: ${name}; got ${got.failures.join(", ")}`);
  }
}

console.log(
  `E-003A integrity qualification PASS: clean control accepted; ${mutations.length} mutations rejected; external spend $0`,
);
