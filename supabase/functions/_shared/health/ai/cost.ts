/**
 * ONIQ HEALTH AI — cost instrumentation.
 *
 * A price row exists for exactly the models the allowlist names, and the
 * policy engine refuses `unpriced_model` BEFORE a receipt is written or a
 * provider runs — the September bill this repo could not explain was a model
 * no line named, and the one module built to prevent that must not be able
 * to spend before it can price. `cost.test.ts` asserts every allowlisted
 * model has a row. Phase 3 adds a real model's row from the pricing page,
 * with its date and its source label.
 *
 * THERE ARE NO DEFAULT CAPS HERE. The per-person and house caps are read
 * from the `health_config` row, and a missing or zero cap refuses
 * (`caps_unset`): how many requests a day and at what price is the owner's
 * decision under CLAUDE.md's first rule, not a constant an agent picked.
 */
import type { AiContext, AiUsage } from "./types.ts";

export type PriceRow = { input: number; output: number; source: string };

export const PRICE_PER_1M: Record<string, PriceRow> = {
  "synthetic-v1": {
    input: 0,
    output: 0,
    source: "synthetic provider: nothing is billed, 2026-09-08",
  },
  // Vertex AI, global endpoint, <= 200K input — docs/health/01-research.md
  // "Gemini on Vertex AI [PAGE]". Text input only (audio is $0.50 and this
  // provider sends none). The metered Google project, not Lovable credits.
  "gemini-3.1-flash-lite": {
    input: 0.25,
    output: 1.5,
    source:
      "[PAGE] cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing, global endpoint, read 2026-09-08",
  },
};

export function priceRowFor(model: unknown): PriceRow | null {
  if (typeof model !== "string") return null;
  return Object.prototype.hasOwnProperty.call(PRICE_PER_1M, model) ? PRICE_PER_1M[model] : null;
}

/** Four characters per token is the estimate every ONIQ budget already uses. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** The context as one string, for counting only — never sent anywhere as a prompt. */
export function contextText(context: AiContext): string {
  const parts: string[] = [];
  for (const r of context.records) {
    parts.push(
      [r.kind, r.display, r.valueNum ?? "", r.valueUnit ?? "", r.valueText ?? "", r.dateLabel]
        .join(" ")
        .trim(),
    );
  }
  for (const d of context.documents) {
    parts.push([d.kind, d.title, d.capturedDay, d.text ?? ""].join(" ").trim());
  }
  if (context.question) parts.push(context.question);
  return parts.join("\n");
}

export function estimateContextTokens(context: AiContext): number {
  return estimateTokens(contextText(context));
}

/** Throws for a model with no row; the gate makes that unreachable at runtime. */
export function costEstimateUsd(model: string, usage: AiUsage): number {
  const row = priceRowFor(model);
  if (!row) throw new Error("unpriced_model");
  const usd =
    (usage.inputTokens / 1_000_000) * row.input + (usage.outputTokens / 1_000_000) * row.output;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
