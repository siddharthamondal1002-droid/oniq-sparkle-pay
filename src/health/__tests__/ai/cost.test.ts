/**
 * NOTHING CAN SPEND BEFORE IT CAN PRICE. Every allowlisted model has a price
 * row, the synthetic one costs nothing, and the estimate is the four-chars-
 * per-token rule every ONIQ budget uses.
 */
import { describe, expect, it } from "vitest";
import {
  PRICE_PER_1M,
  contextText,
  costEstimateUsd,
  estimateContextTokens,
  estimateTokens,
  priceRowFor,
} from "../../../../supabase/functions/_shared/health/ai/cost";
import { MODEL_ALLOWLIST, type AiContext } from "../../ai/types";

describe("the allowlist and the price table agree", () => {
  it("every allowlisted model has a price row, dated and sourced", () => {
    for (const models of Object.values(MODEL_ALLOWLIST)) {
      for (const m of models) {
        expect(priceRowFor(m), m).not.toBeNull();
        expect(PRICE_PER_1M[m].source).toMatch(/20\d\d-\d\d-\d\d/);
      }
    }
  });

  it("the synthetic model bills nothing and an unknown model throws", () => {
    expect(
      costEstimateUsd("synthetic-v1", { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(0);
    expect(() => costEstimateUsd("gemini-3.1-flash", { inputTokens: 1, outputTokens: 1 })).toThrow(
      /unpriced_model/,
    );
    expect(priceRowFor(undefined)).toBeNull();
    expect(priceRowFor("__proto__")).toBeNull();
  });
});

describe("estimates", () => {
  it("counts four characters per token, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("counts the context the provider would see, with aliases and never ids", () => {
    const context: AiContext = {
      task: "summarize_timeline",
      language: "en",
      records: [
        {
          ref: "r1",
          kind: "lab",
          display: "HbA1c",
          valueNum: 6.1,
          valueUnit: "%",
          valueText: null,
          effectiveDay: "2026-03-14",
          dateLabel: "14 Mar 2026",
          source: "user_entry",
        },
      ],
      documents: [],
      question: "what is my hba1c",
    };
    const text = contextText(context);
    expect(text).toContain("HbA1c");
    expect(text).toContain("14 Mar 2026");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(estimateContextTokens(context)).toBe(estimateTokens(text));
  });
});
