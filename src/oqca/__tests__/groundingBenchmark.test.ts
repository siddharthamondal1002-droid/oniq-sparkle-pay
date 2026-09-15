import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GroundingSchemaError,
  parseRun,
  parseSuite,
  parseThresholds,
  suiteDigest,
} from "@/oqca/grounding/schema";
import { runGroundingBenchmark } from "@/oqca/grounding/runner";

const ROOT = "src/oqca/grounding/fixtures";
const json = (name: string): unknown => JSON.parse(readFileSync(`${ROOT}/${name}`, "utf8"));
const load = () => ({
  suite: parseSuite(json("sealed.synthetic.json")),
  run: parseRun(json("responses.synthetic.json")),
  thresholds: parseThresholds(json("thresholds.json")),
});

describe("held-out grounding benchmark", () => {
  it("verifies the seal before scoring and binds responses to that digest", () => {
    const { suite, run, thresholds } = load();
    expect(suiteDigest(suite)).toBe(suite.seal.digest);
    expect(run.suiteSha256).toBe(suite.seal.digest);
    expect(() => runGroundingBenchmark(suite, run, thresholds)).not.toThrow();
  });

  it("fails closed when sealed evaluation content changes", () => {
    const raw = json("sealed.synthetic.json") as Record<string, unknown>;
    expect(() => parseSuite({ ...raw, description: "tampered" })).toThrow(/seal mismatch/);
  });

  it("scores paired treatment and baseline arms with explicit metric direction", () => {
    const { suite, run, thresholds } = load();
    const result = runGroundingBenchmark(suite, run, thresholds);

    expect(result.treatment.metrics).toEqual({
      citationCompleteness: 1,
      unsupportedClaimRate: 0,
      abstentionAccuracy: 1,
      answerabilityLoss: 0,
      promptInjectionPassRate: 1,
    });
    expect(result.baseline.metrics.citationCompleteness).toBe(0.5);
    expect(result.baseline.metrics.unsupportedClaimRate).toBe(0.6);
    expect(result.baseline.metrics.abstentionAccuracy).toBe(0.5);
    expect(result.baseline.metrics.answerabilityLoss).toBe(0.5);
    expect(result.baseline.metrics.promptInjectionPassRate).toBe(0);
    expect(result.treatmentMinusBaseline.unsupportedClaimRate).toBe(-0.6);
    expect(result.treatmentImprovement.unsupportedClaimRate).toBe(0.6);
    expect(result.treatmentImprovement.answerabilityLoss).toBe(0.5);
    expect(result.inputs.runSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.inputs.thresholdsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.thresholds).toEqual(thresholds);
    expect(result.passed).toBe(true);
  });

  it("is byte-for-byte deterministic and returns machine-readable checks", () => {
    const { suite, run, thresholds } = load();
    const first = JSON.stringify(runGroundingBenchmark(suite, run, thresholds));
    const second = JSON.stringify(runGroundingBenchmark(suite, run, thresholds));
    expect(first).toBe(second);
    const parsed = JSON.parse(first);
    expect(parsed.thresholdChecks).toHaveLength(10);
    expect(parsed.thresholdChecks.every((item: { passed: boolean }) => item.passed)).toBe(true);
  });

  it("makes thresholds configurable and reports a failed gate without hiding scores", () => {
    const { suite, run, thresholds } = load();
    const stricter = {
      ...thresholds,
      minimumImprovementVsBaseline: {
        ...thresholds.minimumImprovementVsBaseline,
        answerabilityLoss: 0.6,
      },
    };
    const result = runGroundingBenchmark(suite, run, stricter);
    expect(result.passed).toBe(false);
    expect(
      result.thresholdChecks.find((item) => item.id === "improvement.answerabilityLoss"),
    ).toEqual(expect.objectContaining({ actual: 0.5, threshold: 0.6, passed: false }));
  });

  it("does not trust unknown claim ids or citations to unrelated sources", () => {
    const { suite, run, thresholds } = load();
    const responses = run.treatment.responses.map((response) =>
      response.caseId === "transit-answerable"
        ? {
            ...response,
            claims: [
              {
                claimId: "c-001",
                text: "The shuttle leaves at 08:10.",
                citations: ["unknown-source"],
              },
              { claimId: "x-999", text: "An invented claim.", citations: ["notice-a"] },
            ],
          }
        : response,
    );
    const result = runGroundingBenchmark(
      suite,
      { ...run, treatment: { ...run.treatment, responses } },
      thresholds,
    );
    expect(result.treatment.metrics.citationCompleteness).toBe(0.5);
    expect(result.treatment.counts.unsupportedClaims).toBe(1);
    expect(result.treatment.counts.invalidCitations).toBe(2);
    expect(result.passed).toBe(false);
  });

  it("penalizes an extra invalid citation even when a valid citation is present", () => {
    const { suite, run, thresholds } = load();
    const responses = run.treatment.responses.map((response) =>
      response.caseId === "injection-answerable"
        ? {
            ...response,
            claims: response.claims.map((claim) => ({
              ...claim,
              citations: ["notice-c", "notice-a"],
            })),
          }
        : response,
    );
    const result = runGroundingBenchmark(
      suite,
      { ...run, treatment: { ...run.treatment, responses } },
      thresholds,
    );
    expect(result.treatment.metrics.citationCompleteness).toBeCloseTo(2 / 3);
    expect(result.treatment.counts.invalidCitations).toBe(1);
    expect(
      result.treatment.cases.find((item) => item.caseId === "injection-answerable")
        ?.promptInjectionPass,
    ).toBe(false);
  });

  it("counts missing required claims as answerability loss", () => {
    const { suite, run, thresholds } = load();
    const responses = run.treatment.responses.map((response) =>
      response.caseId === "transit-answerable"
        ? { ...response, claims: response.claims.slice(0, 1) }
        : response,
    );
    const result = runGroundingBenchmark(
      suite,
      { ...run, treatment: { ...run.treatment, responses } },
      thresholds,
    );
    expect(result.treatment.metrics.answerabilityLoss).toBe(0.5);
    expect(
      result.treatment.cases.find((item) => item.caseId === "transit-answerable")
        ?.answerComplete,
    ).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("rejects incomplete, duplicate, and internally contradictory submissions", () => {
    const raw = json("responses.synthetic.json") as {
      baseline: { responses: unknown[] };
      treatment: { responses: Array<Record<string, unknown>> };
    } & Record<string, unknown>;
    expect(() =>
      parseRun({
        ...raw,
        treatment: { ...raw.treatment, responses: raw.treatment.responses.slice(1) },
      }),
    ).not.toThrow();
    const incomplete = parseRun({
      ...raw,
      treatment: { ...raw.treatment, responses: raw.treatment.responses.slice(1) },
    });
    const { suite, thresholds } = load();
    expect(() => runGroundingBenchmark(suite, incomplete, thresholds)).toThrow(/missing responses/);
    expect(() =>
      parseRun({
        ...raw,
        treatment: {
          ...raw.treatment,
          responses: [raw.treatment.responses[0], raw.treatment.responses[0]],
        },
      }),
    ).toThrow(/duplicate ids/);
    expect(() =>
      parseRun({
        ...raw,
        treatment: {
          ...raw.treatment,
          responses: [
            {
              caseId: "transit-answerable",
              abstained: true,
              claims: [
                {
                  claimId: "c-001",
                  text: "The shuttle leaves at 08:10.",
                  citations: ["notice-a"],
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/cannot abstain and emit claims/);
    expect(() =>
      parseRun({
        ...raw,
        treatment: {
          ...raw.treatment,
          responses: [{ caseId: "transit-answerable", abstained: false, claims: [] }],
        },
      }),
    ).toThrow(/emit a claim or abstain/);
  });

  it("rejects unknown suite fields instead of leaving them outside the seal", () => {
    const raw = json("sealed.synthetic.json") as Record<string, unknown>;
    expect(() => parseSuite({ ...raw, unsealedPolicy: "ignore" })).toThrow(/unknown fields/);
  });

  it("rejects malformed rates and mismatched run seals", () => {
    const rawThresholds = json("thresholds.json") as Record<string, unknown>;
    const treatment = rawThresholds.treatment as Record<string, unknown>;
    expect(() =>
      parseThresholds({
        ...rawThresholds,
        treatment: { ...treatment, maximumUnsupportedClaimRate: 1.01 },
      }),
    ).toThrow(/\[0, 1\]/);
    expect(() =>
      parseThresholds({
        ...rawThresholds,
        minimumImprovementVsBaseline: {
          ...(rawThresholds.minimumImprovementVsBaseline as Record<string, unknown>),
          unsupportedClaimRate: -0.05,
        },
      }),
    ).not.toThrow();

    const { suite, run, thresholds } = load();
    expect(() =>
      runGroundingBenchmark(
        suite,
        { ...run, suiteSha256: "f".repeat(64) },
        thresholds,
      ),
    ).toThrow(GroundingSchemaError);
  });
});
