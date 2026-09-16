/**
 * A regression absence is a claim, so it requires a completed experiment.
 * BLOCKED and INCONCLUSIVE mean the question was not measured.
 */
export type RegressionAssessment = {
  readonly answer: "yes" | "no" | "unestablished";
  readonly evidence: readonly string[];
};

export function assessRegression(
  verdict: string | null,
  regressions: readonly string[],
): RegressionAssessment {
  if (regressions.length > 0) {
    return { answer: "yes", evidence: [`regressed metrics: ${regressions.join(", ")}`] };
  }
  if (verdict === "REGRESSED") {
    return { answer: "yes", evidence: ["experiment verdict REGRESSED"] };
  }
  if (verdict === null || verdict === "INCONCLUSIVE" || verdict === "BLOCKED") {
    return { answer: "unestablished", evidence: [] };
  }
  return {
    answer: "no",
    evidence: [`experiment verdict ${verdict}; no regression recorded`],
  };
}
