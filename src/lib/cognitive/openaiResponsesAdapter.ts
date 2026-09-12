/**
 * THE OPENAI RESPONSES ADAPTER — written, and NEVER EXERCISED. §6.
 *
 * STATUS: the MODEL ID is PROVEN; this adapter's CODE PATH is not.
 *
 * THE ID IS VERIFIED BY POST — 2026-09-12, the rule this repo has held since
 * the Google mapping. `OPENAI_API_KEY` was added to the Supabase secret store
 * and both candidate ids answered a real POST to /v1/responses:
 *
 *     GET  /v1/models                      200   130 ids, gpt-6-astra listed
 *     POST /v1/responses  gpt-6-astra      200   completed, "ok", 13 in / 5 out
 *     POST /v1/responses  gpt-5.6-luna     200   completed, "ok", 13 in / 5 out
 *
 * That is a POST and not a catalogue entry, which is the distinction that
 * matters: llm.ts carries the measured table where a listed model advertising
 * the right method 404'd on every real call for months.
 *
 * WHAT IS STILL UNPROVEN, stated as unproven: no request has ever been sent by
 * THIS FILE. The verification above ran as a short script in the Lovable
 * sandbox, so `openaiResponsesAdapter` and `readResponse` have still only been
 * exercised against shapes written here. The first real call through this code
 * is the measurement.
 *
 * AND THE TWO ENVIRONMENTS ARE DIFFERENT MACHINES, which is worth stating
 * because the report conflated them. api.openai.com answers HTTP 000 from the
 * DEV CONTAINER (proxy CONNECT 403, with api.anthropic.com 401 and Google 403
 * as controls on the same runner); the Lovable sandbox reaches it fine. Both
 * measurements are true of where they were taken, and neither overturns the
 * other — so tests here still run on Mock and Replay, by necessity.
 *
 * PRICE IS NOT KNOWN. `usage` comes back (13 in / 5 out above), so metering
 * works the moment rates exist — but no per-token rate for these ids has been
 * measured, and ONIQ's spend ledger refuses an unpriced model BY NAME. Wiring
 * this into a paying path needs rates first.
 *
 * WHY THIS FILE IS NOT IN `src/oqca/`. It was, and `security.test.ts` went red
 * on four assertions at once — fetch, an https URL, a credential name and an
 * auth header. The guard was RIGHT: the kernel tree's whole guarantee is that
 * it provably cannot reach anything, and that guarantee is enforced by PATH.
 * So the seam (`modelAdapter.ts`) stays inside the kernel and every
 * implementation that touches a socket or a key lives out here, the same split
 * `_shared/oqcaRuntime/` already uses on the server side. The boundary is
 * asserted in `kernelSlice.test.ts` so it cannot drift back.
 *
 * THE MODEL ID IS CONFIGURATION, NEVER A CONSTANT. It appears here only as
 * the fallback of a caller-supplied value, and an unavailable model fails
 * LOUDLY — `modelUnavailable` names the id it tried, because a refusal that
 * hides which model was asked for is how a wrong id survives for months.
 */
import {
  type ModelAdapter,
  type ModelRequest,
  type ModelResult,
  type OfferedTool,
  type ToolWish,
} from "../../oqca/cognitive/modelAdapter.ts";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** The id asked for when the caller names none. VERIFIED by POST 2026-09-12. */
export const DEFAULT_FRONTIER_MODEL = "gpt-6-astra";

export type OpenAIAdapterConfig = {
  readonly apiKey: string;
  readonly model?: string;
  /** Injected, so this module never reaches the network on its own. */
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs?: number;
};

/**
 * 200 CHARACTERS CUT THE ANSWER IN HALF. The first real run's 400 named the
 * pattern but the slice landed mid-JSON on `"param"` — the field that says
 * WHICH tool was rejected — so the message stopped one word before the part a
 * reader needs. 600 is `vertexError.ts`'s MAX, chosen there for the same
 * reason and worth matching rather than picking a second number.
 */
export const MAX_ERROR_DETAIL = 600;

export function modelUnavailable(model: string, status: number, body: string): string {
  return `frontier model ${model} unavailable: HTTP ${status} ${body.slice(0, MAX_ERROR_DETAIL)}`;
}

/**
 * The request body, exported so a test can assert its SHAPE without a
 * credential or a socket. That shape is the only thing about this adapter
 * currently checkable, and the tests say so at the assertion.
 */
export function responsesBody(model: string, req: ModelRequest): Record<string, unknown> {
  const tools = req.toolsOffered ?? [];
  return {
    model,
    instructions: req.instructions,
    input: req.input,
    reasoning: { effort: req.effort ?? "medium" },
    ...(tools.length > 0 ? { tools: tools.map(functionTool) } : {}),
  };
}

/**
 * One offered tool as the Responses API wants it.
 *
 * `strict: true` REQUIRES that every declared property also appear in
 * `required` and that `additionalProperties` is false. `ToolSpec.schema` is a
 * flat list of argument names the tool reads, all of which it needs, so the
 * two agree by construction — and a tool that takes none produces an empty
 * object schema, which is valid and is what the three argument-free benchmark
 * tools want.
 *
 * Every argument is typed `string` because `ToolWish.args` is
 * `Record<string, string>` and `argsFrom` below coerces to it. Declaring a
 * number here would let the model send one that the wish type cannot carry.
 */
function functionTool(t: OfferedTool): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const arg of t.schema) properties[arg] = { type: "string" };
  return {
    type: "function",
    name: t.name,
    description: t.description,
    parameters: {
      type: "object",
      properties,
      required: [...t.schema],
      additionalProperties: false,
    },
    strict: true,
  };
}

function argsFrom(raw: unknown): Record<string, string> {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  } catch {
    return {};
  }
}

/**
 * Read a Responses-API reply. UNPROVEN against a real body — the shape is
 * from public documentation, not from bytes this repo has seen — so it
 * REFUSES on an unfamiliar shape rather than returning an empty proposal a
 * caller would read as "the model had nothing to say".
 */
export function readResponse(model: string, parsed: unknown): ModelResult {
  const root = (parsed ?? {}) as {
    output_text?: unknown;
    output?: unknown;
    usage?: unknown;
  };
  const usage = (root.usage ?? {}) as { input_tokens?: unknown; output_tokens?: unknown };
  let text: string | null = typeof root.output_text === "string" ? root.output_text : null;
  let tool: ToolWish | null = null;

  if (Array.isArray(root.output)) {
    for (const item of root.output as readonly unknown[]) {
      const o = (item ?? {}) as {
        type?: unknown;
        name?: unknown;
        arguments?: unknown;
        content?: unknown;
      };
      if (o.type === "function_call" && typeof o.name === "string") {
        tool = { name: o.name, args: argsFrom(o.arguments) };
      }
      if (text === null && Array.isArray(o.content)) {
        for (const c of o.content as readonly unknown[]) {
          const cc = (c ?? {}) as { text?: unknown };
          if (typeof cc.text === "string") text = cc.text;
        }
      }
    }
  }

  if (text === null && tool === null) {
    return { ok: false, reason: `unfamiliar response shape from ${model}` };
  }
  return {
    ok: true,
    proposal: {
      text: text ?? "",
      wantsTool: tool,
      model,
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    },
  };
}

export function openaiResponsesAdapter(cfg: OpenAIAdapterConfig): ModelAdapter {
  const model = cfg.model ?? DEFAULT_FRONTIER_MODEL;
  return {
    id: `openai:${model}`,
    reason: async (req: ModelRequest): Promise<ModelResult> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 60_000);
      try {
        const res = await cfg.fetchImpl(OPENAI_RESPONSES_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(responsesBody(model, req)),
          signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, reason: modelUnavailable(model, res.status, text) };
        return readResponse(model, JSON.parse(text) as unknown);
      } catch (err) {
        return { ok: false, reason: `frontier model ${model} call failed: ${String(err)}` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
