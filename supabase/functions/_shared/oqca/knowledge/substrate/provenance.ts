/**
 * PROVENANCE — spec §9, shaped after W3C PROV-DM.
 *
 * "Every fact should answer five questions: (1) What is the assertion?
 *  (2) Where did it come from? (3) When was it obtained and valid? (4) How was
 *  it extracted, transformed, inferred or verified? (5) Why is it currently
 *  trusted?"
 *
 * The spec's §4 names PROV-O as the normative model. **THE W3C PAGE COULD NOT BE
 * READ FROM THIS CONTAINER** — `w3.org` is egress-blocked, measured, and so is
 * `jena.apache.org`. So this is PROV-SHAPED, not PROV-conformant, and it says
 * so rather than claiming a standard it could not check. The three PROV nouns
 * it borrows — Entity, Activity, Agent — are used because they are the right
 * three, and `docs/oqca/quantum/SOURCE_MANIFEST.md` records the reachability
 * measurement behind this paragraph.
 *
 * WHAT IS DELIBERATELY NOT HERE: an RDF serializer, a SPARQL layer, a Jena
 * binding. §12 of the spec is explicit — "do not replace the current data
 * architecture merely to add a graph. First implement an adapter-backed
 * KnowledgeStore and benchmark." A triple store is a production dependency and
 * a schema; this is the abstraction it would sit behind.
 */

/** §9's chain, as a closed list. Each step is an ACTIVITY that produced state. */
export type ProvStep =
  | "source"
  | "acquisition"
  | "document_version"
  | "extraction"
  | "assertion"
  | "validation"
  | "inference"
  | "reconciliation"
  | "promotion"
  | "decision";

export const PROV_CHAIN: readonly ProvStep[] = [
  "source",
  "acquisition",
  "document_version",
  "extraction",
  "assertion",
  "validation",
  "inference",
  "reconciliation",
  "promotion",
  "decision",
];

/** PROV's three nouns. `agent` is who is ANSWERABLE, not merely who ran it. */
export type ProvActivity = {
  readonly step: ProvStep;
  /** What ran — a function name, a policy id, a person. */
  readonly agent: string;
  /** Ids of the entities this step consumed. PROV `used`. */
  readonly used: readonly string[];
  /** What it produced. PROV `wasGeneratedBy`, read from the other side. */
  readonly generated: string;
  /**
   * ISO 8601 wall clock. AUDIT ONLY — v1.3 §3's rule holds here for the same
   * reason it holds on a percept: a hashed record with a clock in it replays to
   * a different id every time. Nothing in `recordHash` reads this field.
   */
  readonly at: string;
  /** Free text, bounded, never parsed. */
  readonly note: string;
};

export type Provenance = {
  readonly activities: readonly ProvActivity[];
};

export const EMPTY_PROVENANCE: Provenance = { activities: [] };

export function withActivity(p: Provenance, a: ProvActivity): Provenance {
  return { activities: [...p.activities, a] };
}

/**
 * §18's "Provenance coverage" metric, computed rather than asserted.
 *
 * A record is COMPLETE when it can answer all five of §9's questions. Those map
 * onto four steps that must be present — the assertion itself, where it came
 * from, when it was acquired, and how it was extracted. `validation` is NOT
 * required for completeness on purpose: an unvalidated record is a legitimate
 * CANDIDATE, and demanding validation here would conflate "traceable" with
 * "trusted", which is the exact confusion the whole substrate exists to prevent.
 */
export const REQUIRED_STEPS: readonly ProvStep[] = [
  "source",
  "acquisition",
  "extraction",
  "assertion",
];

export function provenanceGaps(p: Provenance): ProvStep[] {
  const seen = new Set(p.activities.map((a) => a.step));
  return REQUIRED_STEPS.filter((s) => !seen.has(s));
}

export function isTraceable(p: Provenance): boolean {
  return provenanceGaps(p).length === 0;
}

/**
 * The chain in order, for a human reading an audit. Activities are kept in
 * INSERTION order in the record and sorted only here, because two steps of the
 * same kind (two extractions, say) must keep the order they actually happened.
 */
export function chainSummary(p: Provenance): string {
  const rank = new Map(PROV_CHAIN.map((s, i) => [s, i] as const));
  return [...p.activities]
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank.get(x.a.step)! - rank.get(y.a.step)! || x.i - y.i)
    .map(({ a }) => `${a.step}:${a.agent}`)
    .join(" -> ");
}
