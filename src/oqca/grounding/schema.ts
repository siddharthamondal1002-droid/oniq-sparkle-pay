import { createHash } from "node:crypto";
import {
  GROUNDING_SCHEMA_VERSION,
  type GroundingArm,
  type GroundingCase,
  type GroundingRun,
  type GroundingSuite,
  type GroundingThresholds,
  type PromptInjection,
} from "./types.ts";

export class GroundingSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroundingSchemaError";
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GroundingSchemaError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GroundingSchemaError(`${path} must be a non-empty string`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new GroundingSchemaError(`${path} must be boolean`);
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new GroundingSchemaError(`${path} must be an array`);
  return value;
}

function rate(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new GroundingSchemaError(`${path} must be a finite number in [0, 1]`);
  }
  return value;
}

function delta(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -1 || value > 1) {
    throw new GroundingSchemaError(`${path} must be a finite number in [-1, 1]`);
  }
  return value;
}

function digest(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    throw new GroundingSchemaError(`${path} must be 64 lowercase hex characters`);
  }
  return parsed;
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new GroundingSchemaError(`${path} contains duplicate ids`);
  }
}

function onlyKeys(raw: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extras = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new GroundingSchemaError(`${path} contains unknown fields: ${extras.sort().join(", ")}`);
  }
}

function schemaVersion(value: unknown, path: string): typeof GROUNDING_SCHEMA_VERSION {
  if (value !== GROUNDING_SCHEMA_VERSION) {
    throw new GroundingSchemaError(`${path} must be ${GROUNDING_SCHEMA_VERSION}`);
  }
  return value;
}

function parseCase(value: unknown, path: string): GroundingCase {
  const raw = object(value, path);
  onlyKeys(
    raw,
    [
      "id",
      "question",
      "answerable",
      "promptInjection",
      "sources",
      "claimCatalog",
      "requiredClaimIds",
    ],
    path,
  );
  const sources = array(raw.sources, `${path}.sources`).map((source, index) => {
    const item = object(source, `${path}.sources[${index}]`);
    onlyKeys(item, ["id", "text"], `${path}.sources[${index}]`);
    return {
      id: string(item.id, `${path}.sources[${index}].id`),
      text: string(item.text, `${path}.sources[${index}].text`),
    };
  });
  if (sources.length === 0) throw new GroundingSchemaError(`${path}.sources must not be empty`);
  unique(
    sources.map((source) => source.id),
    `${path}.sources`,
  );

  const sourceIds = new Set(sources.map((source) => source.id));
  const claimCatalog = array(raw.claimCatalog, `${path}.claimCatalog`).map((claim, index) => {
    const item = object(claim, `${path}.claimCatalog[${index}]`);
    onlyKeys(item, ["id", "statement", "supportedBy"], `${path}.claimCatalog[${index}]`);
    const supportedBy = array(
      item.supportedBy,
      `${path}.claimCatalog[${index}].supportedBy`,
    ).map((id, sourceIndex) =>
      string(id, `${path}.claimCatalog[${index}].supportedBy[${sourceIndex}]`),
    );
    if (supportedBy.length === 0) {
      throw new GroundingSchemaError(
        `${path}.claimCatalog[${index}].supportedBy must not be empty`,
      );
    }
    unique(supportedBy, `${path}.claimCatalog[${index}].supportedBy`);
    for (const sourceId of supportedBy) {
      if (!sourceIds.has(sourceId)) {
        throw new GroundingSchemaError(
          `${path}.claimCatalog[${index}] references unknown source ${sourceId}`,
        );
      }
    }
    return {
      id: string(item.id, `${path}.claimCatalog[${index}].id`),
      statement: string(item.statement, `${path}.claimCatalog[${index}].statement`),
      supportedBy,
    };
  });
  unique(
    claimCatalog.map((claim) => claim.id),
    `${path}.claimCatalog`,
  );

  const answerable = bool(raw.answerable, `${path}.answerable`);
  const requiredClaimIds = array(raw.requiredClaimIds, `${path}.requiredClaimIds`).map(
    (id, index) => string(id, `${path}.requiredClaimIds[${index}]`),
  );
  unique(requiredClaimIds, `${path}.requiredClaimIds`);
  const catalogIds = new Set(claimCatalog.map((claim) => claim.id));
  for (const claimId of requiredClaimIds) {
    if (!catalogIds.has(claimId)) {
      throw new GroundingSchemaError(
        `${path}.requiredClaimIds references unknown claim ${claimId}`,
      );
    }
  }
  if (answerable && requiredClaimIds.length === 0) {
    throw new GroundingSchemaError(`${path} is answerable but has no required claims`);
  }
  if (!answerable && (claimCatalog.length > 0 || requiredClaimIds.length > 0)) {
    throw new GroundingSchemaError(`${path} is unanswerable but declares supported claims`);
  }

  let promptInjection: PromptInjection | null = null;
  if (raw.promptInjection !== null) {
    const injection = object(raw.promptInjection, `${path}.promptInjection`);
    onlyKeys(injection, ["attackType", "forbiddenClaimIds"], `${path}.promptInjection`);
    const forbiddenClaimIds = array(
      injection.forbiddenClaimIds,
      `${path}.promptInjection.forbiddenClaimIds`,
    ).map((id, index) =>
      string(id, `${path}.promptInjection.forbiddenClaimIds[${index}]`),
    );
    if (forbiddenClaimIds.length === 0) {
      throw new GroundingSchemaError(`${path}.promptInjection.forbiddenClaimIds must not be empty`);
    }
    unique(forbiddenClaimIds, `${path}.promptInjection.forbiddenClaimIds`);
    for (const claimId of forbiddenClaimIds) {
      if (catalogIds.has(claimId)) {
        throw new GroundingSchemaError(`${path} marks supported claim ${claimId} as forbidden`);
      }
    }
    promptInjection = {
      attackType: string(injection.attackType, `${path}.promptInjection.attackType`),
      forbiddenClaimIds,
    };
  }
  return {
    id: string(raw.id, `${path}.id`),
    question: string(raw.question, `${path}.question`),
    answerable,
    promptInjection,
    sources,
    claimCatalog,
    requiredClaimIds,
  };
}

/** Stable JSON: object keys sort recursively, while meaningful array order is retained. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new GroundingSchemaError("cannot canonicalize undefined");
  return encoded;
}

export function suiteDigest(suite: Omit<GroundingSuite, "seal"> | GroundingSuite): string {
  const { seal: _seal, ...payload } = suite as GroundingSuite;
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

export function jsonDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function parseSuite(value: unknown, verifySeal = true): GroundingSuite {
  const raw = object(value, "suite");
  onlyKeys(raw, ["schemaVersion", "id", "description", "cases", "seal"], "suite");
  const cases = array(raw.cases, "suite.cases").map((item, index) =>
    parseCase(item, `suite.cases[${index}]`),
  );
  if (cases.length === 0) throw new GroundingSchemaError("suite.cases must not be empty");
  unique(
    cases.map((item) => item.id),
    "suite.cases",
  );
  if (!cases.some((item) => item.answerable)) {
    throw new GroundingSchemaError("suite must contain an answerable case");
  }
  if (!cases.some((item) => !item.answerable)) {
    throw new GroundingSchemaError("suite must contain an unanswerable case");
  }
  if (!cases.some((item) => item.promptInjection !== null)) {
    throw new GroundingSchemaError("suite must contain a prompt-injection case");
  }
  const seal = object(raw.seal, "suite.seal");
  onlyKeys(seal, ["algorithm", "digest"], "suite.seal");
  if (seal.algorithm !== "sha256") {
    throw new GroundingSchemaError("suite.seal.algorithm must be sha256");
  }
  const sealedDigest = digest(seal.digest, "suite.seal.digest");
  const suite: GroundingSuite = {
    schemaVersion: schemaVersion(raw.schemaVersion, "suite.schemaVersion"),
    id: string(raw.id, "suite.id"),
    description: string(raw.description, "suite.description"),
    cases,
    seal: { algorithm: "sha256", digest: sealedDigest },
  };
  const actual = suiteDigest(suite);
  if (verifySeal && actual !== sealedDigest) {
    throw new GroundingSchemaError(
      `suite seal mismatch: expected ${sealedDigest}, computed ${actual}`,
    );
  }
  return suite;
}

function parseArm(value: unknown, path: string): GroundingArm {
  const raw = object(value, path);
  onlyKeys(raw, ["id", "responses"], path);
  const responses = array(raw.responses, `${path}.responses`).map((response, index) => {
    const itemPath = `${path}.responses[${index}]`;
    const item = object(response, itemPath);
    onlyKeys(item, ["caseId", "abstained", "claims"], itemPath);
    const claims = array(item.claims, `${itemPath}.claims`).map((claim, claimIndex) => {
      const claimPath = `${itemPath}.claims[${claimIndex}]`;
      const claimRaw = object(claim, claimPath);
      onlyKeys(claimRaw, ["claimId", "text", "citations"], claimPath);
      const citations = array(claimRaw.citations, `${claimPath}.citations`).map((citation, i) =>
        string(citation, `${claimPath}.citations[${i}]`),
      );
      unique(citations, `${claimPath}.citations`);
      return {
        claimId: string(claimRaw.claimId, `${claimPath}.claimId`),
        text: string(claimRaw.text, `${claimPath}.text`),
        citations,
      };
    });
    unique(
      claims.map((claim) => claim.claimId),
      `${itemPath}.claims`,
    );
    const abstained = bool(item.abstained, `${itemPath}.abstained`);
    if (abstained && claims.length > 0) {
      throw new GroundingSchemaError(`${itemPath} cannot abstain and emit claims`);
    }
    if (!abstained && claims.length === 0) {
      throw new GroundingSchemaError(`${itemPath} must emit a claim or abstain`);
    }
    return { caseId: string(item.caseId, `${itemPath}.caseId`), abstained, claims };
  });
  unique(
    responses.map((response) => response.caseId),
    `${path}.responses`,
  );
  return { id: string(raw.id, `${path}.id`), responses };
}

export function parseRun(value: unknown): GroundingRun {
  const raw = object(value, "run");
  onlyKeys(
    raw,
    ["schemaVersion", "suiteId", "suiteSha256", "annotation", "baseline", "treatment"],
    "run",
  );
  const annotation = object(raw.annotation, "run.annotation");
  onlyKeys(annotation, ["protocolId", "blinded"], "run.annotation");
  return {
    schemaVersion: schemaVersion(raw.schemaVersion, "run.schemaVersion"),
    suiteId: string(raw.suiteId, "run.suiteId"),
    suiteSha256: digest(raw.suiteSha256, "run.suiteSha256"),
    annotation: {
      protocolId: string(annotation.protocolId, "run.annotation.protocolId"),
      blinded: bool(annotation.blinded, "run.annotation.blinded"),
    },
    baseline: parseArm(raw.baseline, "run.baseline"),
    treatment: parseArm(raw.treatment, "run.treatment"),
  };
}

export function parseThresholds(value: unknown): GroundingThresholds {
  const raw = object(value, "thresholds");
  onlyKeys(
    raw,
    ["schemaVersion", "treatment", "minimumImprovementVsBaseline"],
    "thresholds",
  );
  const treatment = object(raw.treatment, "thresholds.treatment");
  onlyKeys(
    treatment,
    [
      "minimumCitationCompleteness",
      "maximumUnsupportedClaimRate",
      "minimumAbstentionAccuracy",
      "maximumAnswerabilityLoss",
      "minimumPromptInjectionPassRate",
    ],
    "thresholds.treatment",
  );
  const improvement = object(
    raw.minimumImprovementVsBaseline,
    "thresholds.minimumImprovementVsBaseline",
  );
  onlyKeys(
    improvement,
    [
      "citationCompleteness",
      "unsupportedClaimRate",
      "abstentionAccuracy",
      "answerabilityLoss",
      "promptInjectionPassRate",
    ],
    "thresholds.minimumImprovementVsBaseline",
  );
  return {
    schemaVersion: schemaVersion(raw.schemaVersion, "thresholds.schemaVersion"),
    treatment: {
      minimumCitationCompleteness: rate(
        treatment.minimumCitationCompleteness,
        "thresholds.treatment.minimumCitationCompleteness",
      ),
      maximumUnsupportedClaimRate: rate(
        treatment.maximumUnsupportedClaimRate,
        "thresholds.treatment.maximumUnsupportedClaimRate",
      ),
      minimumAbstentionAccuracy: rate(
        treatment.minimumAbstentionAccuracy,
        "thresholds.treatment.minimumAbstentionAccuracy",
      ),
      maximumAnswerabilityLoss: rate(
        treatment.maximumAnswerabilityLoss,
        "thresholds.treatment.maximumAnswerabilityLoss",
      ),
      minimumPromptInjectionPassRate: rate(
        treatment.minimumPromptInjectionPassRate,
        "thresholds.treatment.minimumPromptInjectionPassRate",
      ),
    },
    minimumImprovementVsBaseline: {
      citationCompleteness: delta(
        improvement.citationCompleteness,
        "thresholds.minimumImprovementVsBaseline.citationCompleteness",
      ),
      unsupportedClaimRate: delta(
        improvement.unsupportedClaimRate,
        "thresholds.minimumImprovementVsBaseline.unsupportedClaimRate",
      ),
      abstentionAccuracy: delta(
        improvement.abstentionAccuracy,
        "thresholds.minimumImprovementVsBaseline.abstentionAccuracy",
      ),
      answerabilityLoss: delta(
        improvement.answerabilityLoss,
        "thresholds.minimumImprovementVsBaseline.answerabilityLoss",
      ),
      promptInjectionPassRate: delta(
        improvement.promptInjectionPassRate,
        "thresholds.minimumImprovementVsBaseline.promptInjectionPassRate",
      ),
    },
  };
}
