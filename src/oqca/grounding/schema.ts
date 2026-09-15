import { parseManifest, type BenchmarkManifest } from "../bench/manifest.ts";

export const GROUNDING_SCHEMA_VERSION = "1.0";

export type GroundingClaim = {
  readonly claim_id: string;
  readonly text: string;
  readonly citations: readonly string[];
};

export type GroundingResponse = {
  readonly abstained: boolean;
  readonly claims: readonly GroundingClaim[];
};

export type GroundingCase = {
  readonly id: string;
  readonly answerable: boolean;
  readonly prompt_injection: boolean;
  readonly question: string;
  readonly sources: readonly { readonly id: string; readonly text: string }[];
  readonly supported_claims: Readonly<
    Record<string, { readonly text: string; readonly source_ids: readonly string[] }>
  >;
};

export type GroundingThresholds = {
  readonly min_claim_citation_completeness: number;
  readonly max_unsupported_claim_rate: number;
  readonly min_abstention_accuracy: number;
  readonly max_answerability_loss: number;
  readonly min_prompt_injection_resistance: number;
  readonly min_citation_completeness_delta: number;
  readonly min_unsupported_claim_rate_reduction: number;
  readonly min_abstention_accuracy_delta: number;
  readonly min_answerability_loss_reduction: number;
  readonly min_prompt_injection_resistance_delta: number;
};

export type GroundingSuite = {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly description: string;
  readonly cases: readonly GroundingCase[];
  readonly thresholds: GroundingThresholds;
};

export type SealedGroundingFixture = {
  readonly id: BenchmarkManifest["id"];
  readonly version: BenchmarkManifest["version"];
  readonly family: BenchmarkManifest["family"];
  readonly hypothesis: BenchmarkManifest["hypothesis"];
  readonly null_hypothesis: BenchmarkManifest["nullHypothesis"];
  readonly baselines: BenchmarkManifest["baselines"];
  readonly treatment: BenchmarkManifest["treatment"];
  readonly controls: BenchmarkManifest["controls"];
  readonly seeds: BenchmarkManifest["seeds"];
  readonly metrics: BenchmarkManifest["metrics"];
  readonly generator: BenchmarkManifest["generator"];
  readonly parameters: BenchmarkManifest["parameters"];
  readonly information_note: BenchmarkManifest["informationNote"];
  readonly expected_behaviour: BenchmarkManifest["expectedBehaviour"];
  readonly suite: GroundingSuite;
  readonly arms: {
    readonly treatment: Readonly<Record<string, GroundingResponse>>;
    readonly baseline: Readonly<Record<string, GroundingResponse>>;
  };
  readonly seal: { readonly algorithm: "sha256"; readonly digest: string };
};

export class GroundingSchemaError extends Error {
  constructor(message: string) {
    super(`Grounding benchmark schema: ${message}`);
    this.name = "GroundingSchemaError";
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new GroundingSchemaError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(raw: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = [...keys].sort();
  const actual = Object.keys(raw).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new GroundingSchemaError(`${path} keys must be exactly: ${expected.join(", ")}`);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new GroundingSchemaError(`${path} must be a non-empty string`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new GroundingSchemaError(`${path} must be boolean`);
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new GroundingSchemaError(`${path} must be an array`);
  return value;
}

function rate(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new GroundingSchemaError(`${path} must be a finite number from 0 to 1`);
  return value;
}

function parseResponse(value: unknown, path: string): GroundingResponse {
  const r = record(value, path);
  exactKeys(r, ["abstained", "claims"], path);
  const claimIds = new Set<string>();
  const claims = array(r.claims, `${path}.claims`).map((claim, index) => {
    const c = record(claim, `${path}.claims[${index}]`);
    exactKeys(c, ["claim_id", "text", "citations"], `${path}.claims[${index}]`);
    const claimId = stringValue(c.claim_id, `${path}.claims[${index}].claim_id`);
    if (claimIds.has(claimId))
      throw new GroundingSchemaError(`${path} has duplicate claim_id ${claimId}`);
    claimIds.add(claimId);
    return {
      claim_id: claimId,
      text: stringValue(c.text, `${path}.claims[${index}].text`),
      citations: array(c.citations, `${path}.claims[${index}].citations`).map((citation, i) =>
        stringValue(citation, `${path}.claims[${index}].citations[${i}]`),
      ),
    };
  });
  const abstained = booleanValue(r.abstained, `${path}.abstained`);
  if (abstained && claims.length > 0)
    throw new GroundingSchemaError(`${path} cannot contain claims when abstained is true`);
  if (!abstained && claims.length === 0)
    throw new GroundingSchemaError(`${path} must contain a claim when abstained is false`);
  return {
    abstained,
    claims,
  };
}

const THRESHOLD_KEYS: readonly (keyof GroundingThresholds)[] = [
  "min_claim_citation_completeness",
  "max_unsupported_claim_rate",
  "min_abstention_accuracy",
  "max_answerability_loss",
  "min_prompt_injection_resistance",
  "min_citation_completeness_delta",
  "min_unsupported_claim_rate_reduction",
  "min_abstention_accuracy_delta",
  "min_answerability_loss_reduction",
  "min_prompt_injection_resistance_delta",
];

export function parseThresholds(value: unknown): GroundingThresholds {
  const r = record(value, "thresholds");
  exactKeys(r, THRESHOLD_KEYS, "thresholds");
  return Object.fromEntries(
    THRESHOLD_KEYS.map((key) => [key, rate(r[key], `thresholds.${key}`)]),
  ) as GroundingThresholds;
}

export function parseSealedFixture(value: unknown): SealedGroundingFixture {
  const root = record(value, "fixture");
  exactKeys(
    root,
    [
      "id",
      "version",
      "family",
      "hypothesis",
      "null_hypothesis",
      "baselines",
      "treatment",
      "controls",
      "seeds",
      "metrics",
      "generator",
      "parameters",
      "information_note",
      "expected_behaviour",
      "suite",
      "arms",
      "seal",
    ],
    "fixture",
  );
  const manifest = parseManifest(root);
  const rawSuite = record(root.suite, "suite");
  exactKeys(
    rawSuite,
    ["schema_version", "suite_id", "description", "cases", "thresholds"],
    "suite",
  );
  const schemaVersion = stringValue(rawSuite.schema_version, "suite.schema_version");
  if (schemaVersion !== GROUNDING_SCHEMA_VERSION)
    throw new GroundingSchemaError(`unsupported schema_version ${schemaVersion}`);

  const ids = new Set<string>();
  const cases = array(rawSuite.cases, "suite.cases").map((value, index) => {
    const path = `suite.cases[${index}]`;
    const c = record(value, path);
    exactKeys(
      c,
      ["id", "answerable", "prompt_injection", "question", "sources", "supported_claims"],
      path,
    );
    const id = stringValue(c.id, `${path}.id`);
    if (ids.has(id)) throw new GroundingSchemaError(`duplicate case id ${id}`);
    ids.add(id);
    const sources = array(c.sources, `${path}.sources`).map((source, sourceIndex) => {
      const s = record(source, `${path}.sources[${sourceIndex}]`);
      exactKeys(s, ["id", "text"], `${path}.sources[${sourceIndex}]`);
      return {
        id: stringValue(s.id, `${path}.sources[${sourceIndex}].id`),
        text: stringValue(s.text, `${path}.sources[${sourceIndex}].text`),
      };
    });
    const sourceIds = new Set(sources.map((source) => source.id));
    if (sourceIds.size !== sources.length)
      throw new GroundingSchemaError(`${path} has duplicate source ids`);
    const supported = record(c.supported_claims, `${path}.supported_claims`);
    const supported_claims = Object.fromEntries(
      Object.entries(supported).map(([claimId, rubricValue]) => {
        stringValue(claimId, `${path}.supported_claims key`);
        const rubric = record(rubricValue, `${path}.supported_claims.${claimId}`);
        exactKeys(rubric, ["text", "source_ids"], `${path}.supported_claims.${claimId}`);
        const allowed = array(
          rubric.source_ids,
          `${path}.supported_claims.${claimId}.source_ids`,
        ).map((citation, i) =>
          stringValue(citation, `${path}.supported_claims.${claimId}.source_ids[${i}]`),
        );
        if (allowed.length === 0 || allowed.some((citation) => !sourceIds.has(citation)))
          throw new GroundingSchemaError(
            `${path}.supported_claims.${claimId} must name available sources`,
          );
        return [
          claimId,
          {
            text: stringValue(rubric.text, `${path}.supported_claims.${claimId}.text`),
            source_ids: allowed,
          },
        ];
      }),
    );
    const answerable = booleanValue(c.answerable, `${path}.answerable`);
    if (answerable !== (Object.keys(supported_claims).length > 0))
      throw new GroundingSchemaError(
        `${path}.answerable must match whether supported_claims is non-empty`,
      );
    return {
      id,
      answerable,
      prompt_injection: booleanValue(c.prompt_injection, `${path}.prompt_injection`),
      question: stringValue(c.question, `${path}.question`),
      sources,
      supported_claims,
    };
  });
  if (cases.length === 0) throw new GroundingSchemaError("suite.cases must not be empty");
  if (!cases.some((testCase) => testCase.answerable))
    throw new GroundingSchemaError("suite.cases must include an answerable case");
  if (!cases.some((testCase) => !testCase.answerable))
    throw new GroundingSchemaError("suite.cases must include an unanswerable case");
  if (!cases.some((testCase) => testCase.prompt_injection))
    throw new GroundingSchemaError("suite.cases must include a prompt-injection case");

  const arms = record(root.arms, "arms");
  exactKeys(arms, ["treatment", "baseline"], "arms");
  const parseArm = (name: "treatment" | "baseline") => {
    const rawArm = record(arms[name], `arms.${name}`);
    const actual = Object.keys(rawArm).sort();
    const expected = [...ids].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new GroundingSchemaError(`arms.${name} must contain exactly every case id`);
    return Object.fromEntries(
      expected.map((id) => [id, parseResponse(rawArm[id], `arms.${name}.${id}`)]),
    );
  };
  const seal = record(root.seal, "seal");
  exactKeys(seal, ["algorithm", "digest"], "seal");
  if (seal.algorithm !== "sha256") throw new GroundingSchemaError("seal.algorithm must be sha256");
  const digest = stringValue(seal.digest, "seal.digest");
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new GroundingSchemaError("seal.digest must be 64 lowercase hex characters");

  return {
    id: manifest.id,
    version: manifest.version,
    family: manifest.family,
    hypothesis: manifest.hypothesis,
    null_hypothesis: manifest.nullHypothesis,
    baselines: manifest.baselines,
    treatment: manifest.treatment,
    controls: manifest.controls,
    seeds: manifest.seeds,
    metrics: manifest.metrics,
    generator: manifest.generator,
    parameters: manifest.parameters,
    information_note: manifest.informationNote,
    expected_behaviour: manifest.expectedBehaviour,
    suite: {
      schema_version: schemaVersion,
      suite_id: stringValue(rawSuite.suite_id, "suite.suite_id"),
      description: stringValue(rawSuite.description, "suite.description"),
      cases,
      thresholds: parseThresholds(rawSuite.thresholds),
    },
    arms: { treatment: parseArm("treatment"), baseline: parseArm("baseline") },
    seal: { algorithm: "sha256", digest },
  };
}
