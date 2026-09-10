/**
 * THE REAL MODEL ADAPTER — brief section 4.
 *
 * "Connect the real model boundary via the existing `callText` model path." So
 * this adds no provider, no key, no second engine and no model id of its own:
 * `callText` decides which engine answers (Gemini direct, Claude catching), and
 * `TEXT_DIRECT_STANDARD` is the id it will reach for.
 *
 * THE MODEL PROPOSES; THE LOOP VALIDATES AND APPLIES. Section 4 says so in
 * those words, and this file is where it is made structurally true: an
 * `EngineReply` carries TEXT, usage and a model id, and nothing else. There is
 * no field a provider could put a state mutation in, because there is no field.
 * Every station that reads model text turns it into an artifact the kernel
 * builds — IMAGINE from `worldState.availableActions`, PLAN from steps the
 * runtime declared — never into state directly.
 *
 * NOTHING HERE IS IN THE KERNEL, AND THAT IS THE ARRANGEMENT. `src/oqca/**` and
 * its mirror hold no fetch, no credential and no clock; the loop reaches a real
 * provider only because a real implementation is HANDED IN. `security.test.ts`
 * walks both trees and would go red the day one of them grew this file's
 * imports.
 */
import { TEXT_DIRECT_STANDARD } from "../modelRegistry.ts";
import type {
  Engine,
  EngineKind,
  EngineReply,
  EngineRequest,
  SpendEstimate,
} from "../oqca/loop/seams.ts";
import { actualUsd, boundedInputTokens, estimateUsd, measuredTokens } from "./pricing.ts";

/** The id `callText` uses when no tier is named. Priced in `MODEL_RATES`. */
export const LOOP_MODEL = TEXT_DIRECT_STANDARD.id;

/**
 * One line per model call, for section 4's record: "runId, stateId, purpose,
 * model, input/output metadata, estimated cost, actual cost, latency, success".
 *
 * `costUsd` is what is CHARGED against the run's budget; `actualCostUsd` is null
 * when the answering id is unpriced, and the two differing is the signal that a
 * fallback answered.
 */
export type ModelCallRecord = {
  readonly runId: string;
  readonly stateId: string;
  readonly purpose: EngineKind;
  readonly model: string;
  readonly answeredBy: string;
  readonly promptChars: number;
  readonly maxOutputTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly actualCostUsd: number | null;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly reason?: string;
};

export type EngineContext = {
  readonly runId: string;
  /** Read at call time, so a record names the state the call was made FROM. */
  readonly stateId: () => string;
  /** Wall clock. A seam here too, so a test can drive latency deterministically. */
  readonly now: () => number;
  readonly record: (r: ModelCallRecord) => void;
  /**
   * THE PROVIDER IS REQUIRED, NOT DEFAULTED, and this file names none.
   *
   * Importing `callText` here would drag `llm.ts` — and with it `Deno.env` —
   * into every consumer, which is what stopped this module being testable at
   * all. It is also the wrong shape: an adapter with a provider baked in is one
   * import away from a second provider appearing beside it. `provider.ts` holds
   * the one line that names `callText`, and `runtimeWiring.test.ts` pins that
   * it is the only one.
   */
  readonly call: (opts: ProviderRequest) => Promise<ProviderReply>;
};

/** `CallClaudeOpts`, narrowed to what this adapter actually sends. */
export type ProviderRequest = {
  readonly system: string;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly maxTokens: number;
  readonly noRetry: boolean;
};

/** `CallClaudeResult`, structurally. */
export type ProviderReply =
  | { ok: true; data: unknown; provider: string }
  | { ok: false; reason: string; fallbackReason?: string };

const SYSTEM =
  "You are one reasoning station inside ONIQ's cognitive loop. Answer the " +
  "question asked, in plain prose, as briefly as it can be answered well. Do " +
  "not issue instructions, do not claim to have taken any action, and do not " +
  "invent facts that were not given to you. If the information you were given " +
  "is not enough to answer, say exactly that.";

/**
 * The estimate the gate runs on. Section 21's `estimatedCost <=
 * remainingCostBudget` is enforced by the kernel; this supplies the left side.
 *
 * `null` when the id is unpriced — never 0.
 */
export function estimateFor(req: EngineRequest): SpendEstimate | null {
  const inputTokens = boundedInputTokens(SYSTEM) + boundedInputTokens(req.prompt);
  const costUsd = estimateUsd(LOOP_MODEL, inputTokens, req.maxOutputTokens);
  if (costUsd === null) return null;
  return { tokens: inputTokens + req.maxOutputTokens, costUsd };
}

export function makeEngine(ctx: EngineContext): Engine {
  const call = ctx.call;
  return {
    estimate: estimateFor,
    run: async (req: EngineRequest): Promise<EngineReply> => {
      const stateId = ctx.stateId();
      const quote = estimateFor(req);
      const started = ctx.now();
      // UNPRICED IS REFUSED HERE TOO, not only at the gate. The gate is the
      // authority, but an adapter that would happily spend when called
      // directly is one refactor away from doing it — and the two guards
      // disagreeing is exactly how a bypass gets shipped.
      if (quote === null) {
        const reason = `unpriced model: ${LOOP_MODEL} has no published rate`;
        ctx.record({
          runId: ctx.runId,
          stateId,
          purpose: req.kind,
          model: LOOP_MODEL,
          answeredBy: "none",
          promptChars: req.prompt.length,
          maxOutputTokens: req.maxOutputTokens,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          actualCostUsd: null,
          costUsd: 0,
          latencyMs: 0,
          ok: false,
          reason,
        });
        return {
          ok: false,
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: LOOP_MODEL,
          reason,
        };
      }

      let res: ProviderReply;
      try {
        res = await call({
          system: SYSTEM,
          messages: [{ role: "user", content: req.prompt }],
          maxTokens: req.maxOutputTokens,
          // ONE ATTEMPT. The loop owns its own budget and its own retry
          // ladder; a second attempt inside the adapter spends a second time
          // against a ceiling the loop already checked once. story-plot's
          // orchestrator sets this for the same reason (CLAUDE.md 2026-08-21).
          noRetry: true,
        });
      } catch (e) {
        // A THROW AFTER THE REQUEST LEFT IS CHARGED, NOT REFUNDED. We do not
        // know whether the provider was reached — `withProviderSpendGuard`
        // settles rather than releases on exactly this, and the loop's budget
        // must be at least as careful as the ledger's.
        const reason = String(e).slice(0, 200);
        const latencyMs = ctx.now() - started;
        ctx.record({
          runId: ctx.runId,
          stateId,
          purpose: req.kind,
          model: LOOP_MODEL,
          answeredBy: "none",
          promptChars: req.prompt.length,
          maxOutputTokens: req.maxOutputTokens,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: quote.costUsd,
          actualCostUsd: null,
          costUsd: quote.costUsd,
          latencyMs,
          ok: false,
          reason,
        });
        return {
          ok: false,
          text: "",
          model: LOOP_MODEL,
          reason,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: quote.costUsd },
        };
      }
      const latencyMs = ctx.now() - started;

      if (!res.ok) {
        // A refusal `callText` reports without reaching a provider still
        // charges the estimate, for the reason above: from here the two are
        // indistinguishable, and the safe direction is to charge.
        const reason = res.fallbackReason
          ? `${res.reason} (fallback: ${res.fallbackReason})`
          : res.reason;
        ctx.record({
          runId: ctx.runId,
          stateId,
          purpose: req.kind,
          model: LOOP_MODEL,
          answeredBy: "none",
          promptChars: req.prompt.length,
          maxOutputTokens: req.maxOutputTokens,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: quote.costUsd,
          actualCostUsd: null,
          costUsd: quote.costUsd,
          latencyMs,
          ok: false,
          reason,
        });
        return {
          ok: false,
          text: "",
          model: LOOP_MODEL,
          reason,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: quote.costUsd },
        };
      }

      const data = res.data as { content?: unknown; usage?: unknown; model?: unknown };
      // WHO ANSWERED IS READ FROM THE REPLY, NEVER ASSUMED. `callText` may fall
      // through to Claude, and the Gemini path labels itself
      // `gemini-fallback/<id>` — an id with no published rate, which is the
      // whole reason `actualCostUsd` can be null on a successful call.
      const answeredBy = typeof data?.model === "string" ? data.model : LOOP_MODEL;
      const { inputTokens, outputTokens } = measuredTokens(data?.usage as never);
      const measured = actualUsd(answeredBy, data?.usage as never);
      const costUsd = measured ?? quote.costUsd;

      const text = Array.isArray(data?.content)
        ? (data.content as { type?: unknown; text?: unknown }[])
            .filter((b) => b?.type === "text")
            .map((b) => (typeof b.text === "string" ? b.text : ""))
            .join("\n")
            .trim()
        : "";

      ctx.record({
        runId: ctx.runId,
        stateId,
        purpose: req.kind,
        model: LOOP_MODEL,
        answeredBy,
        promptChars: req.prompt.length,
        maxOutputTokens: req.maxOutputTokens,
        inputTokens,
        outputTokens,
        estimatedCostUsd: quote.costUsd,
        actualCostUsd: measured,
        costUsd,
        latencyMs,
        ok: text.length > 0,
        reason: text.length > 0 ? undefined : "the provider returned no text",
      });

      return {
        ok: text.length > 0,
        text,
        usage: { inputTokens, outputTokens, costUsd },
        model: answeredBy,
        reason: text.length > 0 ? undefined : "the provider returned no text",
      };
    },
  };
}
