/**
 * OQCA v1.1 — the benchmark manifest. Brief section 9.
 *
 * "The benchmark runner must load this manifest rather than hard-code
 * experimental assumptions." So everything a reader would want to argue with —
 * the hypothesis, the NULL hypothesis, which baselines run, which adversarial
 * controls run, which seeds, which metrics — lives in a JSON file under
 * `src/oqca/benchmarks/<family>/<id>.json` and is read at run time.
 *
 * WHAT STAYS IN CODE, AND WHY THAT IS NOT CHEATING. The trial GENERATOR is a
 * function: a manifest names it and supplies its parameters, but the function
 * itself cannot be JSON. What matters is that the manifest owns every
 * experimental CHOICE and the code owns only the mechanics — so changing "which
 * baselines does this compare against" is a data edit that no test has to be
 * rewritten for, and adding a generator is a deliberate code change with a
 * registry entry that `manifest.test.ts` checks resolves.
 *
 * The JSON is snake_case because that is the machine-readable contract the
 * brief specifies; `parseManifest` is the single place it becomes camelCase.
 */

export const MANIFEST_VERSION = "1.1";

export type BaselineId = "bayes_uninformed" | "bayes_informed" | "vector_context";
export type TreatmentId = "oqca_phase" | "oqca_no_phase";
export type MetricId = "accuracy" | "confidence" | "untouched_drift";

export const BASELINE_IDS: readonly BaselineId[] = [
  "bayes_uninformed",
  "bayes_informed",
  "vector_context",
];
export const TREATMENT_IDS: readonly TreatmentId[] = ["oqca_phase", "oqca_no_phase"];
export const METRIC_IDS: readonly MetricId[] = ["accuracy", "confidence", "untouched_drift"];

export type BenchmarkManifest = {
  readonly id: string;
  readonly version: string;
  readonly family: string;
  /** What this experiment would show if the treatment helps. */
  readonly hypothesis: string;
  /** What it shows if it does not. Stated so a null result is a RESULT. */
  readonly nullHypothesis: string;
  readonly baselines: readonly BaselineId[];
  readonly treatment: TreatmentId;
  /** Adversarial control ids from `adversarial.ts`. */
  readonly controls: readonly string[];
  readonly seeds: readonly number[];
  readonly metrics: readonly MetricId[];
  readonly generator: string;
  readonly parameters: Readonly<Record<string, number>>;
  /**
   * Brief section 6: "explanation of what information each model receives".
   * Required, non-empty — the single most load-bearing field in the file,
   * because every honest reading of an OQCA win turns on it.
   */
  readonly informationNote: string;
  /** What behaviour is expected BEFORE the run. Written down so it can be wrong. */
  readonly expectedBehaviour: string;
};

export class ManifestError extends Error {
  constructor(id: string, problem: string) {
    super(`OQCA manifest ${id}: ${problem}`);
    this.name = "ManifestError";
  }
}

function str(raw: Record<string, unknown>, key: string, id: string): string {
  const v = raw[key];
  if (typeof v !== "string" || v.trim() === "")
    throw new ManifestError(id, `${key} must be a non-empty string`);
  return v;
}

function strArray(raw: Record<string, unknown>, key: string, id: string): string[] {
  const v = raw[key];
  if (!Array.isArray(v)) throw new ManifestError(id, `${key} must be an array`);
  for (const x of v)
    if (typeof x !== "string") throw new ManifestError(id, `${key} must hold strings`);
  return v as string[];
}

export function parseManifest(raw: unknown): BenchmarkManifest {
  if (!raw || typeof raw !== "object") throw new ManifestError("<unknown>", "not an object");
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : "<unknown>";

  const version = str(r, "version", id);
  if (version !== MANIFEST_VERSION) {
    throw new ManifestError(id, `version ${version} != ${MANIFEST_VERSION}`);
  }

  const baselines = strArray(r, "baselines", id);
  for (const b of baselines) {
    if (!BASELINE_IDS.includes(b as BaselineId))
      throw new ManifestError(id, `unknown baseline ${b}`);
  }
  if (baselines.length === 0) {
    // Brief section 14: EVERY experiment has a matched classical control.
    throw new ManifestError(id, "at least one baseline is required");
  }

  const treatment = str(r, "treatment", id);
  if (!TREATMENT_IDS.includes(treatment as TreatmentId)) {
    throw new ManifestError(id, `unknown treatment ${treatment}`);
  }

  const metrics = strArray(r, "metrics", id);
  for (const m of metrics) {
    if (!METRIC_IDS.includes(m as MetricId)) throw new ManifestError(id, `unknown metric ${m}`);
  }
  if (metrics.length === 0) throw new ManifestError(id, "at least one metric is required");

  const seedsRaw = r.seeds;
  if (!Array.isArray(seedsRaw) || seedsRaw.length === 0) {
    throw new ManifestError(id, "seeds must be a non-empty array");
  }
  const seeds = seedsRaw.map((s) => {
    if (typeof s !== "number" || !Number.isInteger(s)) {
      throw new ManifestError(id, "seeds must be integers");
    }
    return s;
  });
  if (new Set(seeds).size !== seeds.length) throw new ManifestError(id, "seeds must be distinct");

  const paramsRaw = (r.parameters ?? {}) as Record<string, unknown>;
  const parameters: Record<string, number> = {};
  for (const [k, v] of Object.entries(paramsRaw)) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new ManifestError(id, `parameter ${k} must be a finite number`);
    }
    parameters[k] = v;
  }

  return {
    id: str(r, "id", id),
    version,
    family: str(r, "family", id),
    hypothesis: str(r, "hypothesis", id),
    nullHypothesis: str(r, "null_hypothesis", id),
    baselines: baselines as BaselineId[],
    treatment: treatment as TreatmentId,
    controls: strArray(r, "controls", id),
    seeds,
    metrics: metrics as MetricId[],
    generator: str(r, "generator", id),
    parameters,
    informationNote: str(r, "information_note", id),
    expectedBehaviour: str(r, "expected_behaviour", id),
  };
}
