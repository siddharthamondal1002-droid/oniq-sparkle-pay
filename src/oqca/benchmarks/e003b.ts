import { createHash } from "node:crypto";
import { canonicalJson } from "../grounding/harness.ts";

export const E003B_MODEL = "gemini-3.1-flash-lite";
export const E003B_EXECUTION_CEILING_USD = 0.05;
export const E003B_AGGREGATE_CEILING_USD = 43.8;
export const E003B_CORE_REPEATS = 3;
export const E003B_SAFETY_CASES = 300;

export const E003B_FAMILIES = [
  "novel-reasoning",
  "long-horizon-planning",
  "repository-coding",
  "grounded-research",
  "tool-use",
  "multimodal",
  "memory-privacy",
  "learn-transfer",
  "instruction-hierarchy",
  "adversarial-robustness",
  "error-recovery",
  "oniq-workflows",
] as const;

export type E003BFamily = (typeof E003B_FAMILIES)[number];
export type E003BVisibility = "public_dev" | "sealed_core" | "safety";

export type E003BTask = {
  readonly id: string;
  readonly family: E003BFamily;
  readonly visibility: E003BVisibility;
  readonly prompt: string;
  readonly initialEvidence: readonly unknown[];
  readonly toolCatalog: readonly {
    readonly name: string;
    readonly description: string;
    readonly schema: readonly string[];
    readonly reversible: boolean;
    readonly touchesProduction: boolean;
  }[];
  readonly rubric: readonly string[];
  readonly expected: unknown;
  readonly faultInjected: boolean;
  readonly safetyTags: readonly string[];
  readonly canary: string;
};

export type E003BSuite = {
  readonly schemaVersion: "e003b-suite-v1";
  readonly suiteId: string;
  readonly createdAt: string;
  readonly model: typeof E003B_MODEL;
  readonly tasks: readonly E003BTask[];
};

export type SuiteProblem = { readonly code: string; readonly detail: string };

export function suiteDigest(suite: E003BSuite): string {
  return createHash("sha256").update(canonicalJson(suite), "utf8").digest("hex");
}

export function validateE003BSuite(suite: E003BSuite): readonly SuiteProblem[] {
  const p: SuiteProblem[] = [];
  if (suite.model !== E003B_MODEL) p.push({ code: "MODEL_DRIFT", detail: suite.model });
  const ids = new Set<string>();
  const canaries = new Set<string>();
  for (const task of suite.tasks) {
    if (ids.has(task.id)) p.push({ code: "DUPLICATE_TASK_ID", detail: task.id });
    ids.add(task.id);
    if (!task.canary.trim()) p.push({ code: "MISSING_CANARY", detail: task.id });
    if (canaries.has(task.canary)) p.push({ code: "DUPLICATE_CANARY", detail: task.id });
    canaries.add(task.canary);
    if (!task.prompt.trim()) p.push({ code: "EMPTY_PROMPT", detail: task.id });
    if (task.rubric.length === 0) p.push({ code: "EMPTY_RUBRIC", detail: task.id });
  }

  for (const family of E003B_FAMILIES) {
    const familyTasks = suite.tasks.filter((t) => t.family === family && t.visibility !== "safety");
    const publicCount = familyTasks.filter((t) => t.visibility === "public_dev").length;
    const sealedCount = familyTasks.filter((t) => t.visibility === "sealed_core").length;
    if (familyTasks.length !== 8)
      p.push({ code: "FAMILY_SIZE", detail: `${family}:${familyTasks.length}` });
    if (publicCount !== 2)
      p.push({ code: "PUBLIC_SPLIT", detail: `${family}:${publicCount}` });
    if (sealedCount !== 6)
      p.push({ code: "SEALED_SPLIT", detail: `${family}:${sealedCount}` });
  }

  const core = suite.tasks.filter((t) => t.visibility !== "safety");
  const safety = suite.tasks.filter((t) => t.visibility === "safety");
  const injected = suite.tasks.filter((t) => t.visibility === "sealed_core" && t.faultInjected);
  if (core.length !== 96) p.push({ code: "CORE_COUNT", detail: String(core.length) });
  if (safety.length !== E003B_SAFETY_CASES)
    p.push({ code: "SAFETY_COUNT", detail: String(safety.length) });
  if (injected.length < 12) p.push({ code: "INJECTED_FAILURE_COUNT", detail: String(injected.length) });
  return p;
}

export function plannedExecutions(suite: E003BSuite): number {
  const core = suite.tasks.filter((t) => t.visibility !== "safety").length;
  const safety = suite.tasks.filter((t) => t.visibility === "safety").length;
  return core * E003B_CORE_REPEATS * 2 + safety;
}

function stableBit(taskId: string, repeat: number): number {
  const h = createHash("sha256").update(`${taskId}:${repeat}`, "utf8").digest();
  return h[0] & 1;
}

export function armOrder(taskId: string, repeat: number): readonly ["direct" | "bounded-agent", "direct" | "bounded-agent"] {
  return stableBit(taskId, repeat) === 0
    ? ["direct", "bounded-agent"]
    : ["bounded-agent", "direct"];
}

export function assertRunnableE003B(suite: E003BSuite): void {
  const problems = validateE003BSuite(suite);
  if (problems.length > 0) {
    throw new Error(`E-003B suite invalid: ${problems.map((x) => `${x.code}=${x.detail}`).join("; ")}`);
  }
  const executions = plannedExecutions(suite);
  if (executions !== 876) throw new Error(`E-003B execution count drift: ${executions}`);
  const max = executions * E003B_EXECUTION_CEILING_USD;
  if (Math.abs(max - E003B_AGGREGATE_CEILING_USD) > 1e-9)
    throw new Error(`E-003B aggregate budget drift: ${max}`);
}
