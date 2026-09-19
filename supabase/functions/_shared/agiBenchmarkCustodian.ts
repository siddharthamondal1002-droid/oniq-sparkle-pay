import type {
  BenchmarkTask,
  BenchmarkToolResult,
  BenchmarkToolWish,
} from "./agiBenchmarkRunner.ts";

const FORBIDDEN_KEYS = new Set([
  "expected",
  "expectedAnswer",
  "answerKey",
  "rubric",
  "canary",
  "hiddenThresholds",
  "evaluatorPrompt",
]);

export type CustodianStatus = {
  readonly suiteId: string;
  readonly suiteDigest: string;
  readonly frozen: boolean;
  readonly publicDev: number;
  readonly sealedCore: number;
  readonly safety: number;
  readonly injectedFailures: number;
  readonly evaluatedModel: string;
  readonly evaluatorVersion: string;
};

export type TaskLease = {
  readonly leaseId: string;
  readonly task: BenchmarkTask;
  readonly visibility: "public_dev" | "sealed_core" | "safety";
  readonly family: string;
  readonly taskHash: string;
  readonly expiresAt: string;
};

export type EvaluationRequest = {
  readonly leaseId: string;
  readonly runId: string;
  readonly visibility: "public_dev" | "sealed_core" | "safety";
  readonly arm: "direct" | "bounded-agent";
  readonly repeat: number;
  readonly traceHash: string;
  readonly answer: string;
  readonly pAnswerable: number | null;
  readonly transcript: readonly unknown[];
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly retries: number;
  readonly duplicateSideEffect: boolean;
  readonly ceilingBreach: boolean;
  readonly failure: string | null;
};

export type EvaluationResult = {
  readonly evaluationId: string;
  readonly taskId: string;
  readonly passed: boolean;
  readonly safetyFailure: boolean;
  readonly criteria: Readonly<Record<string, boolean | number | string | null>>;
  readonly evaluatorVersion: string;
  readonly agreement?: number | null;
  readonly signature: string;
};

function containsForbiddenKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = containsForbiddenKey(item);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return key;
    const hit = containsForbiddenKey(child);
    if (hit) return hit;
  }
  return null;
}

function config(): { baseUrl: string } | null {
  const baseUrl = Deno.env.get("AGI_BENCHMARK_CUSTODIAN_URL")?.replace(/\/$/, "") ?? "";
  if (!baseUrl || !/^https:\/\//.test(baseUrl)) return null;
  return { baseUrl };
}

async function request<T>(
  operatorToken: string,
  path: string,
  body: Record<string, unknown> = {},
  opts: { rejectHidden?: boolean } = {},
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, reason: "custodian-not-configured" };
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${operatorToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, reason: `custodian-network:${String(e).slice(0, 100)}` };
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, reason: `custodian-http-${res.status}` };
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, reason: "custodian-unparseable" };
  }
  if (opts.rejectHidden) {
    const hidden = containsForbiddenKey(parsed);
    if (hidden) return { ok: false, reason: `custodian-leak:${hidden}` };
  }
  return { ok: true, value: parsed as T };
}

export async function custodianStatus(operatorToken: string) {
  return request<CustodianStatus>(operatorToken, "/status");
}

export async function leaseTask(operatorToken: string, input: {
  runId: string;
  visibility: "public_dev" | "sealed_core" | "safety";
  family?: string;
  taskId?: string;
  repeat?: number;
  arm?: "direct" | "bounded-agent";
}) {
  return request<TaskLease>(
    operatorToken,
    input.visibility === "safety" ? "/safety-next" : "/next-task",
    input,
    {
    rejectHidden: true,
    },
  );
}

export async function executeCustodianTool(operatorToken: string, input: {
  leaseId: string;
  runId: string;
  wish: BenchmarkToolWish;
  idempotencyKey: string;
}) {
  return request<BenchmarkToolResult>(operatorToken, "/tool", input, { rejectHidden: true });
}

export async function evaluateWithCustodian(operatorToken: string, input: EvaluationRequest) {
  return request<EvaluationResult>(
    operatorToken,
    input.visibility === "safety" ? "/safety-evaluate" : "/evaluate",
    input,
    { rejectHidden: true },
  );
}

export const _test = { containsForbiddenKey };
