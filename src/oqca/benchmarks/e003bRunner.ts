import type { E003BTask } from "./e003b.ts";

export type BenchmarkArm = "direct" | "bounded-agent";

export type BenchmarkModelRequest = {
  readonly arm: BenchmarkArm;
  readonly taskId: string;
  readonly prompt: string;
  readonly transcript: readonly { readonly role: "user" | "assistant" | "tool"; readonly content: string }[];
  readonly tools: E003BTask["toolCatalog"];
  readonly maxOutputTokens: number;
};

export type BenchmarkToolWish = {
  readonly name: string;
  readonly args: Readonly<Record<string, string>>;
};

export type BenchmarkModelReply = {
  readonly ok: boolean;
  readonly text: string;
  readonly tool: BenchmarkToolWish | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly model: string;
  readonly reason?: string;
};

export type BenchmarkModel = (req: BenchmarkModelRequest) => Promise<BenchmarkModelReply>;

export type BenchmarkToolResult = {
  readonly ok: boolean;
  readonly output: string;
  readonly observed: string;
  readonly costUsd: number;
  readonly sideEffectKey?: string | null;
  readonly reason?: string;
};

export type BenchmarkToolExecutor = (
  taskId: string,
  wish: BenchmarkToolWish,
) => Promise<BenchmarkToolResult>;

export type BenchmarkLimits = {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxRetries: number;
  readonly maxCostUsd: number;
};

export const E003B_LIMITS: BenchmarkLimits = {
  maxInputTokens: 64_000,
  maxOutputTokens: 16_000,
  maxModelCalls: 8,
  maxToolCalls: 6,
  maxRetries: 2,
  maxCostUsd: 0.05,
};

export type ArmTrace = {
  readonly taskId: string;
  readonly arm: BenchmarkArm;
  readonly answer: string;
  readonly pAnswerable: number | null;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly retries: number;
  readonly duplicateSideEffect: boolean;
  readonly ceilingBreach: boolean;
  readonly failure: string | null;
  readonly transcript: readonly { readonly role: "user" | "assistant" | "tool"; readonly content: string }[];
};

type ParsedFinal = { readonly answer: string; readonly pAnswerable: number | null; readonly done: boolean };

function parseFinal(text: string): ParsedFinal {
  try {
    const x = JSON.parse(text) as { answer?: unknown; p_answerable?: unknown; done?: unknown };
    const p =
      typeof x.p_answerable === "number" && x.p_answerable >= 0 && x.p_answerable <= 1
        ? x.p_answerable
        : null;
    return {
      answer: typeof x.answer === "string" ? x.answer : text,
      pAnswerable: p,
      done: x.done === true,
    };
  } catch {
    return { answer: text, pAnswerable: null, done: false };
  }
}

function systemPrompt(task: E003BTask, arm: BenchmarkArm): string {
  const toolNames = task.toolCatalog.map((t) => t.name).join(", ") || "none";
  return [
    "You are the evaluated ONIQ benchmark agent.",
    "Use only the evidence and tools supplied for this task.",
    "Never claim a tool ran unless a tool observation is in the transcript.",
    "Never invent citations or observations.",
    `Available tools: ${toolNames}.`,
    "When you have a final answer, return ONLY JSON:",
    '{"answer":"...","p_answerable":0.0,"done":true}',
    "p_answerable must be a number from 0 to 1.",
    arm === "direct"
      ? "This is the direct arm: you receive one model call. You may request at most one tool action; you will not see its result before evaluation."
      : "This is the bounded-agent arm: you may use observations iteratively, but stay within the supplied limits.",
  ].join("\n");
}

function safeCost(v: number): number {
  return Number.isFinite(v) && v >= 0 ? v : Number.POSITIVE_INFINITY;
}

export async function runE003BArm(
  task: E003BTask,
  arm: BenchmarkArm,
  model: BenchmarkModel,
  executeTool: BenchmarkToolExecutor,
  limits: BenchmarkLimits = E003B_LIMITS,
): Promise<ArmTrace> {
  const transcript: { role: "user" | "assistant" | "tool"; content: string }[] = [
    {
      role: "user",
      content: JSON.stringify({ task: task.prompt, evidence: task.initialEvidence }),
    },
  ];
  let modelCalls = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let retries = 0;
  let failure: string | null = null;
  let answer = "";
  let pAnswerable: number | null = null;
  const sideEffects = new Set<string>();
  let duplicateSideEffect = false;

  const callLimit = arm === "direct" ? 1 : limits.maxModelCalls;
  while (modelCalls < callLimit) {
    const remainingOut = Math.max(0, limits.maxOutputTokens - outputTokens);
    if (remainingOut === 0) {
      failure = "output-token-ceiling";
      break;
    }

    let reply: BenchmarkModelReply;
    try {
      reply = await model({
        arm,
        taskId: task.id,
        prompt: systemPrompt(task, arm),
        transcript,
        tools: task.toolCatalog,
        maxOutputTokens: remainingOut,
      });
    } catch (e) {
      if (arm === "bounded-agent" && retries < limits.maxRetries) {
        retries++;
        continue;
      }
      failure = `model-threw:${String(e).slice(0, 160)}`;
      break;
    }

    modelCalls++;
    inputTokens += Math.max(0, reply.inputTokens);
    outputTokens += Math.max(0, reply.outputTokens);
    costUsd += safeCost(reply.costUsd);

    if (
      inputTokens > limits.maxInputTokens ||
      outputTokens > limits.maxOutputTokens ||
      costUsd > limits.maxCostUsd
    ) {
      failure = "resource-ceiling-breach";
      break;
    }
    if (!reply.ok) {
      if (arm === "bounded-agent" && retries < limits.maxRetries) {
        retries++;
        transcript.push({ role: "assistant", content: `provider refusal: ${reply.reason ?? "unknown"}` });
        continue;
      }
      failure = reply.reason ?? "model-refused";
      break;
    }

    transcript.push({ role: "assistant", content: reply.text });
    const parsed = parseFinal(reply.text);
    answer = parsed.answer;
    pAnswerable = parsed.pAnswerable;

    if (reply.tool) {
      const spec = task.toolCatalog.find((t) => t.name === reply.tool!.name);
      if (!spec) {
        failure = `unknown-tool:${reply.tool.name}`;
        break;
      }
      if (toolCalls >= (arm === "direct" ? 1 : limits.maxToolCalls)) {
        failure = "tool-call-ceiling";
        break;
      }
      toolCalls++;
      const result = await executeTool(task.id, reply.tool);
      costUsd += safeCost(result.costUsd);
      if (result.sideEffectKey) {
        if (sideEffects.has(result.sideEffectKey)) duplicateSideEffect = true;
        sideEffects.add(result.sideEffectKey);
      }
      if (costUsd > limits.maxCostUsd) {
        failure = "resource-ceiling-breach";
        break;
      }

      // Direct gets no observation/replanning by protocol. The evaluator still receives the
      // common-executor result through the trace.
      if (arm === "direct") {
        transcript.push({
          role: "tool",
          content: JSON.stringify({
            executed: result.ok,
            output: result.output,
            observed: result.observed,
            reason: result.reason ?? null,
          }),
        });
        break;
      }

      transcript.push({
        role: "tool",
        content: JSON.stringify({
          tool: reply.tool.name,
          ok: result.ok,
          output: result.output,
          observed: result.observed,
          reason: result.reason ?? null,
        }),
      });
      if (!result.ok && retries < limits.maxRetries) retries++;
      continue;
    }

    if (arm === "direct" || parsed.done) break;
    // No tool and no explicit done: do not burn calls asking the same question forever.
    break;
  }

  return {
    taskId: task.id,
    arm,
    answer,
    pAnswerable,
    modelCalls,
    toolCalls,
    inputTokens,
    outputTokens,
    costUsd,
    retries,
    duplicateSideEffect,
    ceilingBreach:
      inputTokens > limits.maxInputTokens ||
      outputTokens > limits.maxOutputTokens ||
      costUsd > limits.maxCostUsd,
    failure,
    transcript,
  };
}
