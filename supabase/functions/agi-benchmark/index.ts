import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";
import { serviceRoleRpc } from "../_shared/financialLedger.ts";
import {
  custodianStatus,
  evaluateWithCustodian,
  executeCustodianTool,
  leaseTask,
  verifyCustodianEvaluation,
} from "../_shared/agiBenchmarkCustodian.ts";
import { makeE003BGeminiModel } from "../_shared/agiBenchmarkProvider.ts";
import { E003B_LIMITS, runE003BArm } from "../_shared/agiBenchmarkRunner.ts";

type Visibility = "public_dev" | "sealed_core" | "safety";
type Arm = "direct" | "bounded-agent";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
    .join(",")}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stable(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validRunId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,96}$/.test(v);
}

async function adminDb(req: Request) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!token) return { ok: false as const, response: json(401, { error: "Unauthorized" }) };
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userRes, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userRes?.user)
    return { ok: false as const, response: json(401, { error: "Unauthorized" }) };
  const { data: isAdmin } = await db.rpc("is_admin", { _uid: userRes.user.id });
  if (isAdmin !== true)
    return { ok: false as const, response: json(403, { error: "Admins only" }) };
  return { ok: true as const, db, userId: userRes.user.id, operatorToken: token };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await adminDb(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const action = String(body.action ?? "");
  if (action === "status") {
    const [budget, custodian] = await Promise.all([
      auth.db.rpc("agi_benchmark_budget_status"),
      custodianStatus(auth.operatorToken),
    ]);
    return json(200, {
      experiment: "E-003B",
      evaluatedModel: "gemini-3.1-flash-lite",
      limits: E003B_LIMITS,
      budget: budget.error ? { ok: false, reason: "budget-status-unavailable" } : budget.data,
      custodian,
    });
  }

  if (action !== "run-one") return json(400, { error: "Unknown action" });

  const runId = body.runId;
  const visibility = body.visibility as Visibility;
  const arm = body.arm as Arm;
  const repeat = Number(body.repeat);
  const family = typeof body.family === "string" ? body.family : undefined;
  const taskId = typeof body.taskId === "string" ? body.taskId : undefined;

  if (!validRunId(runId)) return json(400, { error: "Invalid runId" });
  if (!["public_dev", "sealed_core", "safety"].includes(visibility))
    return json(400, { error: "Invalid visibility" });
  if (!["direct", "bounded-agent"].includes(arm)) return json(400, { error: "Invalid arm" });
  if (!Number.isInteger(repeat) || repeat < 0 || repeat > 2)
    return json(400, { error: "Invalid repeat" });
  if (visibility === "safety" && arm !== "bounded-agent")
    return json(400, { error: "Safety stratum is bounded-agent only" });

  const status = await custodianStatus(auth.operatorToken);
  if (!status.ok) return json(503, { error: status.reason });
  if (
    status.value.frozen !== true ||
    status.value.publicDev !== 24 ||
    status.value.sealedCore !== 72 ||
    status.value.safety !== 300 ||
    status.value.injectedFailures < 12 ||
    status.value.evaluatedModel !== "gemini-3.1-flash-lite"
  ) {
    return json(409, { error: "Custodian suite is not a valid frozen E-003B suite" });
  }

  const lease = await leaseTask(auth.operatorToken, { runId, visibility, family, taskId, repeat, arm });
  if (!lease.ok) return json(503, { error: lease.reason });
  if (lease.value.visibility !== visibility) return json(409, { error: "Custodian visibility mismatch" });
  if (lease.value.task.toolCatalog.some((t) => t.touchesProduction)) {
    return json(409, { error: "E-003B refuses production-touching tools" });
  }

  // Reserve the whole per-execution envelope before any model call. This is a
  // second budget boundary in addition to the provider ledger used inside the model adapter.
  const admission = await auth.db.rpc("admit_agi_benchmark_execution", {
    _run_id: runId,
    _task_id: lease.value.task.id,
    _arm: arm,
    _repeat: repeat,
    _visibility: visibility,
    _reserve_usd: E003B_LIMITS.maxCostUsd,
  });
  const a = (admission.data ?? {}) as Record<string, unknown>;
  if (admission.error || a.ok !== true) {
    return json(409, { error: "Experiment admission refused", reason: a.reason ?? "unavailable" });
  }

  const rpc = serviceRoleRpc();
  let toolNo = 0;
  const trace = await runE003BArm(
    lease.value.task,
    arm,
    makeE003BGeminiModel({ runId, rpc }),
    async (_taskId, wish) => {
      toolNo++;
      const tool = await executeCustodianTool(auth.operatorToken, {
        leaseId: lease.value.leaseId,
        runId,
        wish,
        idempotencyKey: `${runId}-tool-${toolNo}`,
      });
      return tool.ok
        ? tool.value
        : {
            ok: false,
            output: "",
            observed: "",
            costUsd: 0,
            reason: tool.reason,
          };
    },
  );

  const traceHash = await sha256({
    suiteDigest: status.value.suiteDigest,
    taskHash: lease.value.taskHash,
    runId,
    arm,
    repeat,
    trace,
  });

  const evaluation = await evaluateWithCustodian(auth.operatorToken, {
    leaseId: lease.value.leaseId,
    runId,
    visibility,
    arm,
    repeat,
    traceHash,
    answer: trace.answer,
    pAnswerable: trace.pAnswerable,
    transcript: trace.transcript,
    costUsd: trace.costUsd,
    inputTokens: trace.inputTokens,
    outputTokens: trace.outputTokens,
    modelCalls: trace.modelCalls,
    toolCalls: trace.toolCalls,
    retries: trace.retries,
    duplicateSideEffect: trace.duplicateSideEffect,
    ceilingBreach: trace.ceilingBreach,
    failure: trace.failure,
  });

  const signedEvaluationOk = evaluation.ok
    ? await verifyCustodianEvaluation(
        status.value,
        {
          leaseId: lease.value.leaseId,
          runId,
          visibility,
          arm,
          repeat,
          traceHash,
          answer: trace.answer,
          pAnswerable: trace.pAnswerable,
          transcript: trace.transcript,
          costUsd: trace.costUsd,
          inputTokens: trace.inputTokens,
          outputTokens: trace.outputTokens,
          modelCalls: trace.modelCalls,
          toolCalls: trace.toolCalls,
          retries: trace.retries,
          duplicateSideEffect: trace.duplicateSideEffect,
          ceilingBreach: trace.ceilingBreach,
          failure: trace.failure,
        },
        evaluation.value,
      )
    : false;

  const experimentFailure =
    trace.ceilingBreach || trace.duplicateSideEffect
      ? trace.ceilingBreach
        ? "resource-ceiling-breach"
        : "duplicate-side-effect"
      : !evaluation.ok
        ? `evaluation:${evaluation.reason}`
        : !signedEvaluationOk
          ? "evaluation-signature-invalid"
          : null;

  const settled = await auth.db.rpc("settle_agi_benchmark_execution", {
    _run_id: runId,
    _actual_usd: Math.min(E003B_LIMITS.maxCostUsd, Math.max(0, trace.costUsd)),
    _trace_hash: traceHash,
    _evaluation_id: evaluation.ok ? evaluation.value.evaluationId : null,
    _failure: experimentFailure,
  });
  const s = (settled.data ?? {}) as Record<string, unknown>;
  if (settled.error || s.ok !== true) {
    return json(500, {
      error: "Execution ran but aggregate settlement failed",
      runId,
      traceHash,
      reason: s.reason ?? "unavailable",
    });
  }

  return json(200, {
    experiment: "E-003B",
    suiteId: status.value.suiteId,
    suiteDigest: status.value.suiteDigest,
    runId,
    taskId: lease.value.task.id,
    taskHash: lease.value.taskHash,
    family: lease.value.family,
    visibility,
    arm,
    repeat,
    traceHash,
    model: "gemini-3.1-flash-lite",
    modelCalls: trace.modelCalls,
    toolCalls: trace.toolCalls,
    retries: trace.retries,
    inputTokens: trace.inputTokens,
    outputTokens: trace.outputTokens,
    costUsd: trace.costUsd,
    pAnswerable: trace.pAnswerable,
    failure: trace.failure,
    duplicateSideEffect: trace.duplicateSideEffect,
    ceilingBreach: trace.ceilingBreach,
    evaluation: evaluation.ok
      ? {
          signatureVerified: signedEvaluationOk,
          evaluationId: evaluation.value.evaluationId,
          passed: evaluation.value.passed,
          safetyFailure: evaluation.value.safetyFailure,
          criteria: evaluation.value.criteria,
          evaluatorVersion: evaluation.value.evaluatorVersion,
          agreement: evaluation.value.agreement ?? null,
          signature: evaluation.value.signature,
        }
      : { error: evaluation.reason },
  });
});
