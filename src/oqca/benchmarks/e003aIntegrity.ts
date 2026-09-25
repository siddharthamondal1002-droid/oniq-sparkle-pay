import { createHash } from "node:crypto";
import { canonicalJson } from "../grounding/harness.ts";

export type ExperimentBudget = {
  readonly ceilingUsd: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxRetries: number;
};

export type RunnerManifest = {
  readonly schemaVersion: "e003a-runner-v1";
  readonly suiteHash: string;
  readonly promptHash: string;
  readonly toolSurfaceHash: string;
  readonly adapterSha: string;
  readonly environmentHash: string;
  readonly budget: ExperimentBudget;
  readonly approvalId: string;
};

export type EvaluatorManifest = {
  readonly schemaVersion: "e003a-evaluator-v1";
  readonly rubricHash: string;
  readonly thresholdsHash: string;
  readonly evaluatorVersion: string;
  readonly sealedExpectationsHash: string;
};

export type Sealed<T> = {
  readonly payload: T;
  readonly digest: string;
};

export type IntegrityTrace = {
  readonly runId: string;
  readonly taskId: string;
  readonly arm: "direct" | "bounded-agent";
  readonly runnerDigest: string;
  readonly evaluatorDigest: string;
};

export type IntegrityInput = {
  readonly runner: Sealed<RunnerManifest>;
  readonly evaluator: Sealed<EvaluatorManifest>;
  readonly evaluatorAccessibleToRunner: boolean;
  readonly approvalNonce: string;
  readonly previouslyConsumedApprovalNonces: readonly string[];
  readonly budget: {
    readonly ceilingUsd: number;
    readonly spentBeforeUsd: number;
    readonly spentAfterUsd: number;
  };
  readonly sideEffects: readonly { readonly idempotencyKey: string }[];
  readonly trace: IntegrityTrace;
  readonly expectedTrace: Pick<IntegrityTrace, "runId" | "taskId" | "arm">;
};

export type IntegrityFailure =
  | "RUNNER_SEAL_TAMPER"
  | "EVALUATOR_SEAL_TAMPER"
  | "EVALUATOR_LEAKAGE"
  | "APPROVAL_REPLAY"
  | "BUDGET_RESET"
  | "BUDGET_CEILING_MISMATCH"
  | "BUDGET_BREACH"
  | "DUPLICATE_SIDE_EFFECT"
  | "TRACE_MISMATCH";

export type IntegrityResult = {
  readonly ok: boolean;
  readonly failures: readonly IntegrityFailure[];
};

export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function seal<T>(payload: T): Sealed<T> {
  return { payload, digest: digest(payload) };
}

function hasDuplicateSideEffects(sideEffects: IntegrityInput["sideEffects"]): boolean {
  const seen = new Set<string>();
  for (const effect of sideEffects) {
    if (seen.has(effect.idempotencyKey)) return true;
    seen.add(effect.idempotencyKey);
  }
  return false;
}

export function verifyIntegrity(input: IntegrityInput): IntegrityResult {
  const failures: IntegrityFailure[] = [];

  if (digest(input.runner.payload) !== input.runner.digest) failures.push("RUNNER_SEAL_TAMPER");
  if (digest(input.evaluator.payload) !== input.evaluator.digest)
    failures.push("EVALUATOR_SEAL_TAMPER");

  if (input.evaluatorAccessibleToRunner) failures.push("EVALUATOR_LEAKAGE");
  if (input.previouslyConsumedApprovalNonces.includes(input.approvalNonce))
    failures.push("APPROVAL_REPLAY");

  if (input.budget.spentAfterUsd < input.budget.spentBeforeUsd) failures.push("BUDGET_RESET");
  if (input.budget.ceilingUsd !== input.runner.payload.budget.ceilingUsd)
    failures.push("BUDGET_CEILING_MISMATCH");
  if (input.budget.spentAfterUsd > input.budget.ceilingUsd) failures.push("BUDGET_BREACH");

  if (hasDuplicateSideEffects(input.sideEffects)) failures.push("DUPLICATE_SIDE_EFFECT");

  const traceIdentityMatches =
    input.trace.runId === input.expectedTrace.runId &&
    input.trace.taskId === input.expectedTrace.taskId &&
    input.trace.arm === input.expectedTrace.arm;
  const traceSealsMatch =
    input.trace.runnerDigest === input.runner.digest &&
    input.trace.evaluatorDigest === input.evaluator.digest;
  if (!traceIdentityMatches || !traceSealsMatch) failures.push("TRACE_MISMATCH");

  return { ok: failures.length === 0, failures };
}
