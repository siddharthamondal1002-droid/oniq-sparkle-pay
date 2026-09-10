/**
 * EVIDENCE — the Knowledge Upgradation spec's §6, and its first instruction is
 * the one that shapes this whole file:
 *
 *   "Evidence should be a separate object, not a string field. It should
 *    include source identity, source version/hash, acquisition time, location,
 *    excerpt/reference, extraction method, verifier, and integrity metadata."
 *
 * `knowledge/model.ts` ALREADY HAS AN `Evidence`, and it is the string-provenance
 * shape the spec is arguing against: `provenance: string`. That type is not
 * wrong — it is the working shape `detectGaps` reads, it has been correct since
 * v1.1, and every station depends on it.
 *
 * SO THIS TYPE IS CALLED `SourceEvidence`, NOT `Evidence`. This repo has been
 * bitten twice by two different objects sharing a name in one subsystem —
 * `Observation` (loopState.ts:26 documents it) and `CognitiveState` — and the
 * second one cost a real defect. A richer evidence record is a DIFFERENT object
 * from the loop's working one, and `project.ts` is where one becomes the other.
 */

/** What kind of thing was read. Narrower than "source" — this is the ARTEFACT. */
export type SourceType =
  | "official_documentation"
  | "api_specification"
  | "package_registry"
  | "peer_reviewed_paper"
  | "preprint"
  | "repository_readme"
  | "repository_test"
  | "repository_example"
  | "release_notes"
  | "specification_document"
  | "measurement"
  | "derivation"
  | "human_assertion";

export const SOURCE_TYPES: readonly SourceType[] = [
  "official_documentation",
  "api_specification",
  "package_registry",
  "peer_reviewed_paper",
  "preprint",
  "repository_readme",
  "repository_test",
  "repository_example",
  "release_notes",
  "specification_document",
  "measurement",
  "derivation",
  "human_assertion",
];

/**
 * HOW THE CLAIM CAME OUT OF THE ARTEFACT, which is a separate question from
 * what the artefact was. §21: "Do not let an LLM alone decide factual truth.
 * Models may propose/extract; deterministic validators and evidence policies
 * must constrain promotion." That rule is unenforceable unless the record says
 * which extractor ran — so `model_extraction` is its own value and the
 * promotion policy is allowed to treat it differently.
 */
export type ExtractionMethod =
  | "direct_quotation"
  | "structured_field"
  | "deterministic_parse"
  | "model_extraction"
  | "human_authored"
  | "computed";

/**
 * HOW FAR THE CLAIM IS FROM SOMETHING ANYONE ACTUALLY OBSERVED.
 *
 * This is the health work's [PAGE] / [SNIPPET] / [TRAINING] labelling, made a
 * type instead of a convention. That labelling exists because
 * `01-research.md` had to distinguish a price read off a page from one
 * remembered, and the distinction is exactly as load-bearing here.
 *
 * `recalled` IS IN THE UNION ON PURPOSE and the promotion policy refuses it.
 * A knowledge system that cannot REPRESENT "I think I remember this" has no
 * way to mark it, and the claim then arrives looking like every other.
 */
export type Directness =
  | "fetched" // the bytes were retrieved and are quoted or hashed
  | "search_snippet" // a search engine's excerpt; the page itself was not read
  | "spec_cited" // an ONIQ input document asserts it; not independently checked
  | "derived" // computed here from other records
  | "recalled"; // from training. NEVER promotable — see `promotion.ts`.

export const DIRECTNESS: readonly Directness[] = [
  "fetched",
  "search_snippet",
  "spec_cited",
  "derived",
  "recalled",
];

export type SourceEvidence = {
  readonly id: string;
  /** Which registered source this came from. Never a free string. */
  readonly sourceId: string;
  readonly sourceType: SourceType;
  /**
   * The version of the SOURCE the claim was read from — a package version, a
   * spec revision, a commit. §9's question 3. A claim about "Qiskit" with no
   * version is a claim about no particular software.
   */
  readonly sourceVersion: string | null;
  /** A URL, a file path, a registry endpoint. Never invented. */
  readonly locator: string;
  /**
   * An integrity handle over what was actually read, when one exists. Its
   * absence is recorded rather than faked — §16 wants a corrupted source to be
   * identifiable and rolled back, and a fabricated hash is worse than none.
   */
  readonly contentHash: string | null;
  /** A short verbatim excerpt or a pointer. Bounded; see `MAX_EXCERPT`. */
  readonly excerpt: string;
  readonly extraction: ExtractionMethod;
  readonly directness: Directness;
  /** ISO 8601. This is an AUDIT field and never enters a cognitive state id. */
  readonly retrievedAt: string;
  /** Who or what checked it, when anything did. */
  readonly verifier: string | null;
  /** Does this evidence argue FOR the assertion, or against it? */
  readonly supports: boolean;
};

export const MAX_EXCERPT = 1000;

/**
 * SOURCE RELIABILITY IS A PROPERTY OF THE SOURCE, NOT OF THE CLAIM, and keeping
 * them apart is §10's "Freshness must never be confused with confidence" in a
 * second dimension. A registry that publishes a package's real license is
 * highly reliable about licenses and says nothing about physics.
 */
export type RegisteredSource = {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  readonly homepage: string;
  readonly license: string | null;
  /** In [0,1]. What this source is trusted ABOUT is `domains`. */
  readonly reliability: number;
  readonly domains: readonly string[];
  /**
   * §16: "Every source connector must have an explicit authorization boundary."
   * A source ONIQ may not fetch is still describable — it is simply not
   * acquirable, and evidence from it must be `spec_cited` at best.
   */
  readonly acquirable: boolean;
};

/** Refuses rather than truncating silently where a field is load-bearing. */
export function makeEvidence(e: SourceEvidence): SourceEvidence {
  if (!e.id || !e.sourceId) throw new Error("OKS evidence: id and sourceId are required");
  if (!e.locator) throw new Error("OKS evidence: a locator is required — see §9 question 2");
  if (e.excerpt.length > MAX_EXCERPT) {
    throw new Error(`OKS evidence: excerpt exceeds ${MAX_EXCERPT} characters`);
  }
  if (!Number.isFinite(Date.parse(e.retrievedAt))) {
    throw new Error("OKS evidence: retrievedAt must be an ISO 8601 instant");
  }
  return e;
}

/**
 * Evidence weight, and the ORDER of these factors is the argument.
 *
 * Directness dominates: a highly reliable publisher RECALLED is still recalled.
 * That inversion is the whole point — it is what stops a confident memory of a
 * good source outranking a genuine reading of a mediocre one.
 */
export const DIRECTNESS_WEIGHT: Readonly<Record<Directness, number>> = {
  fetched: 1,
  search_snippet: 0.6,
  spec_cited: 0.5,
  derived: 0.9,
  recalled: 0,
};

export const EXTRACTION_WEIGHT: Readonly<Record<ExtractionMethod, number>> = {
  structured_field: 1,
  direct_quotation: 1,
  deterministic_parse: 0.95,
  computed: 0.95,
  human_authored: 0.8,
  // A model proposing a fact is a PROPOSAL. §21 forbids it deciding truth
  // alone, and this number is where that rule bites arithmetically.
  model_extraction: 0.5,
};

export function evidenceWeight(e: SourceEvidence, source: RegisteredSource | null): number {
  const direct = DIRECTNESS_WEIGHT[e.directness];
  // Multiplicative, so a zero anywhere is a zero overall: `recalled` cannot be
  // rescued by a five-star publisher, which is the intended behaviour.
  return direct * EXTRACTION_WEIGHT[e.extraction] * (source ? source.reliability : 0.5);
}
