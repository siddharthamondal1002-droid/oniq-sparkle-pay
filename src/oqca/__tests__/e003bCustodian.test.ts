import { describe, expect, it } from "vitest";
import { _test } from "../../../supabase/functions/_shared/agiBenchmarkCustodian.ts";

describe("E-003B custodian leakage guard", () => {
  it("accepts runner-visible task material", () => {
    expect(
      _test.containsForbiddenKey({
        leaseId: "l1",
        task: {
          id: "t1",
          prompt: "task",
          initialEvidence: [],
          toolCatalog: [],
        },
        taskHash: "abc",
      }),
    ).toBeNull();
  });

  it.each([
    ["expected", { expected: "42" }],
    ["expectedAnswer", { nested: { expectedAnswer: "42" } }],
    ["answerKey", [{ ok: true }, { answerKey: "42" }]],
    ["rubric", { rubric: ["secret"] }],
    ["canary", { task: { canary: "secret" } }],
    ["hiddenThresholds", { hiddenThresholds: { x: 1 } }],
    ["evaluatorPrompt", { nested: { evaluatorPrompt: "judge secret" } }],
  ])("rejects hidden field %s", (_name, value) => {
    expect(_test.containsForbiddenKey(value)).not.toBeNull();
  });
});
