import { withProviderSpendGuard, type ServiceRpc } from "./financialLedger.ts";
import { TEXT_DIRECT_STANDARD } from "./modelRegistry.ts";
import { actualUsd, boundedInputTokens, estimateUsd, measuredTokens } from "./oqcaRuntime/pricing.ts";
import type {
  BenchmarkModel,
  BenchmarkModelReply,
  BenchmarkModelRequest,
  BenchmarkToolSpec,
} from "./agiBenchmarkRunner.ts";

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const PROVIDER = "google-direct";

function geminiTools(tools: readonly BenchmarkToolSpec[]): unknown[] | undefined {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(tool.schema.map((x) => [x, { type: "string" }])),
          required: [...tool.schema],
        },
      })),
    },
  ];
}

function contents(req: BenchmarkModelRequest): unknown[] {
  return req.transcript.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.role === "tool" ? `TOOL OBSERVATION:\n${m.content}` : m.content }],
  }));
}

function parseReply(body: any): Omit<BenchmarkModelReply, "costUsd"> {
  const cand = Array.isArray(body?.candidates) ? body.candidates[0] : null;
  const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  let text = "";
  let tool: BenchmarkModelReply["tool"] = null;
  for (const p of parts) {
    if (typeof p?.text === "string") text += p.text;
    if (p?.functionCall && typeof p.functionCall.name === "string") {
      const raw = p.functionCall.args && typeof p.functionCall.args === "object" ? p.functionCall.args : {};
      tool = {
        name: p.functionCall.name,
        args: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)])),
      };
    }
  }
  const usage = body?.usageMetadata ?? {};
  const inputTokens = Number(usage.promptTokenCount ?? 0);
  const total = Number(usage.totalTokenCount ?? 0);
  const candidates = Number(usage.candidatesTokenCount ?? 0);
  const outputTokens = Math.max(candidates, Number.isFinite(total - inputTokens) ? total - inputTokens : 0);
  if (!cand || (text.length === 0 && tool === null)) {
    return {
      ok: false,
      text: "",
      tool: null,
      inputTokens,
      outputTokens,
      model: TEXT_DIRECT_STANDARD.id,
      reason: `empty-or-unfamiliar-gemini-response:${String(cand?.finishReason ?? "none")}`,
    };
  }
  return {
    ok: true,
    text,
    tool,
    inputTokens,
    outputTokens,
    model: TEXT_DIRECT_STANDARD.id,
  };
}

function estimate(req: BenchmarkModelRequest): number | null {
  const serializedTools = JSON.stringify(req.tools);
  const serializedTranscript = JSON.stringify(req.transcript);
  const input = boundedInputTokens(req.system + serializedTranscript + serializedTools);
  return estimateUsd(TEXT_DIRECT_STANDARD.id, input, req.maxOutputTokens);
}

export function makeE003BGeminiModel(opts: {
  readonly runId: string;
  readonly rpc: ServiceRpc | null;
}): BenchmarkModel {
  let callNo = 0;
  return async (req) => {
    callNo++;
    const key = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!key) {
      return {
        ok: false,
        text: "",
        tool: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        model: TEXT_DIRECT_STANDARD.id,
        reason: "gemini-not-configured",
      };
    }
    const quote = estimate(req);
    if (
      quote === null ||
      !Number.isFinite(quote) ||
      quote <= 0 ||
      !Number.isFinite(req.maxCostUsd) ||
      req.maxCostUsd <= 0 ||
      quote > req.maxCostUsd
    ) {
      return {
        ok: false,
        text: "",
        tool: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        model: TEXT_DIRECT_STANDARD.id,
        reason:
          quote === null
            ? "unpriced-benchmark-model"
            : quote > req.maxCostUsd
              ? "remaining-execution-budget-insufficient"
              : "invalid-benchmark-budget",
      };
    }

    const requestId = `${opts.runId.slice(0, 36)}-${req.arm === "direct" ? "d" : "a"}-${callNo}`;
    const worstInput =
      boundedInputTokens(req.system + JSON.stringify(req.transcript) + JSON.stringify(req.tools));
    const guarded = await withProviderSpendGuard(
      opts.rpc,
      {
        requestId,
        capability: "TEXT",
        provider: PROVIDER,
        model: TEXT_DIRECT_STANDARD.id,
        unit: "tokens",
        units: worstInput + req.maxOutputTokens,
        estimatedUsd: quote,
        jobId: `${opts.runId.slice(0, 40)}-${req.arm === "direct" ? "direct" : "agent"}`,
        detail: { experiment: "E-003B", taskId: req.taskId, arm: req.arm, callNo },
      },
      async () => {
        const body: Record<string, unknown> = {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: contents(req),
          generationConfig: {
            // Exact experiment ceiling. Unlike the general ONIQ helper, this benchmark
            // must not add thinking headroom outside the preregistered envelope.
            maxOutputTokens: req.maxOutputTokens,
            temperature: 0,
          },
        };
        const tools = geminiTools(req.tools);
        if (tools) body.tools = tools;

        const url = `${GOOGLE_BASE}/${TEXT_DIRECT_STANDARD.id}:generateContent?key=${encodeURIComponent(key)}`;
        let response: Response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (e) {
          const reply: BenchmarkModelReply = {
            ok: false,
            text: "",
            tool: null,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: quote,
            model: TEXT_DIRECT_STANDARD.id,
            reason: `gemini-network:${String(e).slice(0, 120)}`,
          };
          return { value: reply, outcome: "FAILED" as const };
        }
        const raw = await response.text().catch(() => "");
        if (!response.ok) {
          const reply: BenchmarkModelReply = {
            ok: false,
            text: "",
            tool: null,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: quote,
            model: TEXT_DIRECT_STANDARD.id,
            reason: `gemini-http-${response.status}`,
          };
          return { value: reply, outcome: "FAILED" as const };
        }
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          const reply: BenchmarkModelReply = {
            ok: false,
            text: "",
            tool: null,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: quote,
            model: TEXT_DIRECT_STANDARD.id,
            reason: "gemini-unparseable",
          };
          return { value: reply, outcome: "FAILED" as const };
        }
        const base = parseReply(parsed);
        const usage = {
          input_tokens: base.inputTokens,
          output_tokens: base.outputTokens,
          server_tool_use: { web_search_requests: 0 },
        };
        const measured = actualUsd(TEXT_DIRECT_STANDARD.id, usage as never);
        const reply: BenchmarkModelReply = {
          ...base,
          costUsd: measured ?? quote,
        };
        const tokens = measuredTokens(usage as never);
        return {
          value: reply,
          actualUsd: measured ?? undefined,
          unitsActual: tokens.inputTokens + tokens.outputTokens,
          outcome: base.ok ? ("ACCEPTED" as const) : ("FAILED" as const),
          detail: { experiment: "E-003B", taskId: req.taskId, arm: req.arm, callNo },
        };
      },
    );

    if (!guarded.admitted) {
      return {
        ok: false,
        text: "",
        tool: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        model: TEXT_DIRECT_STANDARD.id,
        reason: `spend-ledger-refused:${guarded.reason}`,
      };
    }
    return {
      ...guarded.value,
      costUsd: guarded.actualUsd ?? guarded.reservedUsd,
    };
  };
}
