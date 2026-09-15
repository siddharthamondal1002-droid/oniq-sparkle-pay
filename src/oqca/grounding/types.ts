export const GROUNDING_SCHEMA_VERSION = "1.0" as const;

export type GroundingSource = {
  readonly id: string;
  readonly text: string;
};

export type GroundingClaim = {
  readonly id: string;
  readonly statement: string;
  readonly supportedBy: readonly string[];
};

export type PromptInjection = {
  readonly attackType: string;
  readonly forbiddenClaimIds: readonly string[];
};

export type GroundingCase = {
  readonly id: string;
  readonly question: string;
  readonly answerable: boolean;
  readonly promptInjection: PromptInjection | null;
  readonly sources: readonly GroundingSource[];
  readonly claimCatalog: readonly GroundingClaim[];
  readonly requiredClaimIds: readonly string[];
};

export type GroundingSuite = {
  readonly schemaVersion: typeof GROUNDING_SCHEMA_VERSION;
  readonly id: string;
  readonly description: string;
  readonly cases: readonly GroundingCase[];
  readonly seal: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
};

export type EmittedClaim = {
  readonly claimId: string;
  /** Preserved for audit; claimId assignment remains an evaluator-owned annotation. */
  readonly text: string;
  readonly citations: readonly string[];
};

export type GroundingResponse = {
  readonly caseId: string;
  readonly abstained: boolean;
  readonly claims: readonly EmittedClaim[];
};

export type GroundingArm = {
  readonly id: string;
  readonly responses: readonly GroundingResponse[];
};

export type GroundingRun = {
  readonly schemaVersion: typeof GROUNDING_SCHEMA_VERSION;
  readonly suiteId: string;
  readonly suiteSha256: string;
  readonly annotation: {
    readonly protocolId: string;
    readonly blinded: boolean;
  };
  readonly baseline: GroundingArm;
  readonly treatment: GroundingArm;
};

export type GroundingMetrics = {
  readonly citationCompleteness: number;
  readonly unsupportedClaimRate: number;
  readonly abstentionAccuracy: number;
  readonly answerabilityLoss: number;
  readonly promptInjectionPassRate: number;
};

export type MetricThresholds = {
  readonly citationCompleteness: number;
  readonly unsupportedClaimRate: number;
  readonly abstentionAccuracy: number;
  readonly answerabilityLoss: number;
  readonly promptInjectionPassRate: number;
};

export type GroundingThresholds = {
  readonly schemaVersion: typeof GROUNDING_SCHEMA_VERSION;
  readonly treatment: {
    readonly minimumCitationCompleteness: number;
    readonly maximumUnsupportedClaimRate: number;
    readonly minimumAbstentionAccuracy: number;
    readonly maximumAnswerabilityLoss: number;
    readonly minimumPromptInjectionPassRate: number;
  };
  /** Positive values always mean that treatment is better, including for error rates. */
  readonly minimumImprovementVsBaseline: MetricThresholds;
};

export type CaseScore = {
  readonly caseId: string;
  readonly expectedAbstention: boolean;
  readonly abstained: boolean;
  readonly supportedClaims: number;
  readonly unsupportedClaims: number;
  readonly completelyCitedClaims: number;
  readonly invalidCitations: number;
  readonly requiredClaims: number;
  readonly coveredRequiredClaims: number;
  readonly answerComplete: boolean;
  readonly promptInjectionPass: boolean | null;
};

export type ArmScore = {
  readonly armId: string;
  readonly metrics: GroundingMetrics;
  readonly counts: {
    readonly cases: number;
    readonly answerableCases: number;
    readonly promptInjectionCases: number;
    readonly emittedClaims: number;
    readonly supportedClaims: number;
    readonly unsupportedClaims: number;
    readonly invalidCitations: number;
  };
  readonly cases: readonly CaseScore[];
};

export type ThresholdCheck = {
  readonly id: string;
  readonly actual: number;
  readonly operator: ">=" | "<=";
  readonly threshold: number;
  readonly passed: boolean;
};

export type GroundingResult = {
  readonly schemaVersion: typeof GROUNDING_SCHEMA_VERSION;
  readonly metricVersion: typeof GROUNDING_SCHEMA_VERSION;
  readonly suite: {
    readonly id: string;
    readonly sha256: string;
    readonly cases: number;
  };
  readonly inputs: {
    readonly runSha256: string;
    readonly thresholdsSha256: string;
  };
  readonly thresholds: GroundingThresholds;
  readonly baseline: ArmScore;
  readonly treatment: ArmScore;
  /** Raw treatment minus baseline values; error-rate improvements therefore appear negative. */
  readonly treatmentMinusBaseline: GroundingMetrics;
  /** Direction-normalized values; positive always means treatment is better. */
  readonly treatmentImprovement: GroundingMetrics;
  readonly thresholdChecks: readonly ThresholdCheck[];
  readonly passed: boolean;
};
