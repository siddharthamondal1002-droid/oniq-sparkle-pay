import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, runGroundingBenchmark, verifySeal } from "./harness.ts";
import { parseSealedFixture } from "./schema.ts";

const fixturePath = "src/oqca/benchmarks/grounding/synthetic-held-out.v1.json";

function fixture() {
  return parseSealedFixture(JSON.parse(readFileSync(fixturePath, "utf8")));
}

describe("held-out grounding benchmark", () => {
  it("verifies the sealed suite and produces deterministic results", () => {
    const first = runGroundingBenchmark(fixture());
    const second = runGroundingBenchmark(fixture());

    expect(first).toEqual(second);
    expect(first.seal_verified).toBe(true);
    expect(first.passed).toBe(true);
  });

  it("scores treatment and baseline at claim level", () => {
    const result = runGroundingBenchmark(fixture());

    expect(result.treatment.claim_citation_completeness).toBe(1);
    expect(result.treatment.unsupported_claim_rate).toBe(0);
    expect(result.treatment.abstention_accuracy).toBe(1);
    expect(result.treatment.answerability_loss).toBe(0);
    expect(result.treatment.prompt_injection_resistance).toBe(1);
    expect(result.baseline.claim_citation_completeness).toBe(0.25);
    expect(result.baseline.unsupported_claim_rate).toBe(0.75);
    expect(result.baseline.abstention_accuracy).toBe(0.4);
    expect(result.baseline.answerability_loss).toBeCloseTo(1 / 3);
    expect(result.baseline.prompt_injection_resistance).toBe(0);
  });

  it("keeps citation presence separate from claim support", () => {
    const parsed = fixture();
    const response = structuredClone(parsed.arms.baseline);
    (response.unanswerable.claims[0] as { citations: string[] }).citations = ["atlas-note"];
    const changed = { ...parsed, arms: { ...parsed.arms, baseline: response } };
    const metrics = runGroundingBenchmark(changed).baseline;

    expect(metrics.claim_citation_completeness).toBe(0.5);
    expect(metrics.unsupported_claim_rate).toBe(0.75);
  });

  it("rejects any change to sealed cases, rubrics, or thresholds", () => {
    const parsed = fixture();
    const tampered = structuredClone(parsed);
    (tampered.suite.cases[0] as { question: string }).question = "Tampered question";

    expect(() => verifySeal(tampered)).toThrow(/seal mismatch/);
  });

  it("allows responses to be attached after the suite is sealed", () => {
    const parsed = fixture();
    const changedResponse = structuredClone(parsed);
    (changedResponse.arms.baseline.unanswerable.claims[0] as { text: string }).text =
      "Different recorded output.";

    expect(verifySeal(changedResponse)).toBe(parsed.seal.digest);
  });

  it("allows stricter threshold overrides without changing the seal", () => {
    const result = runGroundingBenchmark(fixture(), {
      min_citation_completeness_delta: 0.9,
    });

    expect(result.seal_verified).toBe(true);
    expect(result.threshold_checks.citation_completeness_delta).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("canonicalizes object keys while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: [{ y: 2, x: 3 }] })).toBe(
      '{"a":[{"x":3,"y":2}],"z":1}',
    );
  });

  it("rejects an answerable case without supported claims", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    raw.suite.cases[0].supported_claims = {};

    expect(() => parseSealedFixture(raw)).toThrow(/answerable must match/);
  });

  it("rejects blank non-abstaining answers", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    raw.arms.treatment["answerable-single"].claims = [];

    expect(() => parseSealedFixture(raw)).toThrow(/must contain a claim/);
  });

  it("revalidates typed fixtures at the run boundary", () => {
    const parsed = structuredClone(fixture());
    (parsed.arms.treatment["answerable-single"] as { claims: unknown[] }).claims = [];

    expect(() => runGroundingBenchmark(parsed)).toThrow(/must contain a claim/);
  });

  it("rejects duplicate emitted claim ids", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const claim = raw.arms.treatment["answerable-single"].claims[0];
    raw.arms.treatment["answerable-single"].claims.push(claim);

    expect(() => parseSealedFixture(raw)).toThrow(/duplicate claim_id/);
  });

  it("does not accept false text under a supported claim id", () => {
    const parsed = fixture();
    const response = structuredClone(parsed.arms.treatment);
    (response["answerable-single"].claims[0] as { text: string }).text = "The door is red.";

    const changed = { ...parsed, arms: { ...parsed.arms, treatment: response } };
    expect(runGroundingBenchmark(changed).treatment.unsupported_claim_rate).toBe(0.25);
  });

  it("scores prototype-named claim ids as unsupported without throwing", () => {
    const parsed = fixture();
    const response = structuredClone(parsed.arms.treatment);
    (response["answerable-single"].claims[0] as { claim_id: string }).claim_id = "toString";

    const changed = { ...parsed, arms: { ...parsed.arms, treatment: response } };
    expect(runGroundingBenchmark(changed).treatment.unsupported_claim_rate).toBe(0.25);
  });

  it("rejects unknown fields instead of dropping them before seal verification", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    raw.suite.unsealed_assumption = true;

    expect(() => parseSealedFixture(raw)).toThrow(/suite keys must be exactly/);
  });

  it("requires non-vacuous answerable, unanswerable, and injection populations", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    raw.suite.cases = raw.suite.cases.filter((testCase: { answerable: boolean }) =>
      testCase.answerable,
    );
    for (const arm of [raw.arms.treatment, raw.arms.baseline]) {
      for (const id of ["unanswerable", "injection-unanswerable"]) delete arm[id];
    }

    expect(() => parseSealedFixture(raw)).toThrow(/must include an unanswerable case/);
  });
});
