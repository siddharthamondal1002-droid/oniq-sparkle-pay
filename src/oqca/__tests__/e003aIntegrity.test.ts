import { describe, expect, it } from "vitest";
import {
  seal,
  verifyIntegrity,
  type EvaluatorManifest,
  type IntegrityInput,
  type RunnerManifest,
} from "../benchmarks/e003aIntegrity.ts";

const runner: RunnerManifest = {
  schemaVersion: "e003a-runner-v1",
  suiteHash: "suite",
  promptHash: "prompt",
  toolSurfaceHash: "tools",
  adapterSha: "adapter",
  environmentHash: "environment",
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
  rubricHash: "rubric",
  thresholdsHash: "thresholds",
  evaluatorVersion: "v1",
  sealedExpectationsHash: "expectations",
};

function valid(): IntegrityInput {
  const r = seal(runner);
  const e = seal(evaluator);
  return {
    runner: r,
    evaluator: e,
    evaluatorAccessibleToRunner: false,
    approvalNonce: "approval-nonce-1",
    previouslyConsumedApprovalNonces: [],
    budget: { ceilingUsd: 0.05, spentBeforeUsd: 0.01, spentAfterUsd: 0.02 },
    sideEffects: [{ idempotencyKey: "effect-1" }, { idempotencyKey: "effect-2" }],
    trace: {
      runId: "run-1",
      taskId: "task-1",
      arm: "bounded-agent",
      runnerDigest: r.digest,
      evaluatorDigest: e.digest,
    },
    expectedTrace: { runId: "run-1", taskId: "task-1", arm: "bounded-agent" },
  };
}

describe("E-003A integrity mutations", () => {
  it("accepts the sealed control", () => {
    expect(verifyIntegrity(valid())).toEqual({ ok: true, failures: [] });
  });

  it("kills runner seal tampering", () => {
    const x = valid();
    const got = verifyIntegrity({
      ...x,
      runner: { ...x.runner, payload: { ...x.runner.payload, promptHash: "tampered" } },
    });
    expect(got.failures).toContain("RUNNER_SEAL_TAMPER");
  });

  it("kills evaluator seal tampering", () => {
    const x = valid();
    const got = verifyIntegrity({
      ...x,
      evaluator: {
        ...x.evaluator,
        payload: { ...x.evaluator.payload, rubricHash: "tampered" },
      },
    });
    expect(got.failures).toContain("EVALUATOR_SEAL_TAMPER");
  });

  it("kills evaluator leakage", () => {
    expect(
      verifyIntegrity({ ...valid(), evaluatorAccessibleToRunner: true }).failures,
    ).toContain("EVALUATOR_LEAKAGE");
  });

  it("kills approval replay", () => {
    const x = valid();
    expect(
      verifyIntegrity({
        ...x,
        previouslyConsumedApprovalNonces: [x.approvalNonce],
      }).failures,
    ).toContain("APPROVAL_REPLAY");
  });

  it("kills budget reset, ceiling mutation, and breach", () => {
    expect(
      verifyIntegrity({
        ...valid(),
        budget: { ceilingUsd: 0.05, spentBeforeUsd: 0.03, spentAfterUsd: 0.01 },
      }).failures,
    ).toContain("BUDGET_RESET");

    expect(
      verifyIntegrity({
        ...valid(),
        budget: { ceilingUsd: 0.06, spentBeforeUsd: 0.01, spentAfterUsd: 0.02 },
      }).failures,
    ).toContain("BUDGET_CEILING_MISMATCH");

    expect(
      verifyIntegrity({
        ...valid(),
        budget: { ceilingUsd: 0.05, spentBeforeUsd: 0.04, spentAfterUsd: 0.051 },
      }).failures,
    ).toContain("BUDGET_BREACH");
  });

  it("kills duplicate side effects", () => {
    expect(
      verifyIntegrity({
        ...valid(),
        sideEffects: [{ idempotencyKey: "same" }, { idempotencyKey: "same" }],
      }).failures,
    ).toContain("DUPLICATE_SIDE_EFFECT");
  });

  it("kills trace identity and manifest mismatches", () => {
    const x = valid();
    expect(
      verifyIntegrity({
        ...x,
        trace: { ...x.trace, taskId: "wrong-task" },
      }).failures,
    ).toContain("TRACE_MISMATCH");

    expect(
      verifyIntegrity({
        ...x,
        trace: { ...x.trace, runnerDigest: "wrong-digest" },
      }).failures,
    ).toContain("TRACE_MISMATCH");
  });
});
