/**
 * THE QUANTUM DOMAIN AS AN OKS ADAPTER — quantum brief §22/§23/§25, and the
 * upgradation spec's §15: **"The Quantum Knowledge Substrate should become one
 * domain adapter under the general Knowledge Substrate."**
 *
 * That sentence settled the architecture. Quantum knowledge is not a parallel
 * store with its own status vocabulary; it is a producer of `KnowledgeRecord`s
 * that go through the SAME promotion policy, the same conflict resolution and
 * the same decay rules as anything else ONIQ ever learns. §25's chain reads
 * `ONIQ -> QuantumKnowledge -> QuantumCapability -> optional adapter ->
 * research library`, and this file is the first arrow.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY **NOT** INGESTED, AND WHY IT IS THE MOST IMPORTANT
 * DECISION IN THIS FILE.
 *
 * The 27 concept definitions, the 18 algorithm descriptions and the 8 domain
 * summaries are NOT turned into knowledge records. They were written here from
 * training, no document was fetched for any of them, and under `evidence.ts`
 * that is `recalled` — weight **zero**, and the promotion gate refuses a claim
 * whose every support is recalled, BY NAME.
 *
 * Ingesting them anyway would produce ~200 rows that can never be believed,
 * and a substrate whose overwhelming majority of records are unbelievable is a
 * substrate nobody reads the status of. Worse, it would invite the fix that
 * ruins it: relabelling recall as `spec_cited` to make the numbers look better.
 * So the prose stays in `concepts.ts`, `algorithms.ts` and `domains.ts` as
 * ONIQ's independently authored REPRESENTATION (§2's preference), clearly not
 * as belief, and `NOT_INGESTED` says so in the code rather than only here.
 *
 * WHAT **IS** INGESTED IS EXACTLY WHAT HAS EVIDENCE:
 *
 *   version/license   FETCHED from PyPI, a structured field, with the endpoint
 *                     and harvest instant recorded  ->  VERIFIED
 *   algebraic facts   COMPUTED here by running the real checker over the real
 *                     matrix at ingest time                    ->  VERIFIED
 *   capability facts  COMPUTED by resolving each domain's claimed exports
 *                     against the modules                      ->  VERIFIED
 *   divergences       evidence on BOTH sides, so §23's "never silently
 *                     normalize" is the STATUS                 ->  CONTESTED
 *   advantage         refused unless a benchmark is named (§7); the eighteen
 *                     algorithms produce eighteen NEGATIVE records and no
 *                     positive one, because no benchmark exists here
 *
 * That is the spec's core principle made visible: what ONIQ has *encountered*
 * stays prose, and only what it has *verified* becomes a record.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * THE CLOCK IS AN ARGUMENT. `security.test.ts` bans `Date.now()` across
 * `src/oqca/**` because a wall clock destroys replay, and `retrievedAt` on
 * computed evidence is genuinely "when this run computed it" — so the caller
 * supplies it and cannot forget, since it has no default.
 */
import {
  type SourceEvidence,
  type RegisteredSource,
  makeEvidence,
} from "../knowledge/substrate/evidence.ts";
import {
  type KnowledgeRecord,
  type Volatility,
  draftRecord,
} from "../knowledge/substrate/record.ts";
import {
  type Provenance,
  type ProvActivity,
  EMPTY_PROVENANCE,
  withActivity,
} from "../knowledge/substrate/provenance.ts";
import { evaluatePromotion, applyPromotion } from "../knowledge/substrate/promotion.ts";
import { type KnowledgeStore } from "../knowledge/substrate/store.ts";
import { QUANTUM_SOURCES, HARVESTED_AT, HARVEST_ENDPOINT, locatorFor } from "./sources.ts";
import { DOMAINS, DIVERGENCES } from "./domains.ts";
import { ALGORITHMS } from "./algorithms.ts";
import { GATES, GATE_NAMES } from "./gates.ts";
import { isUnitary, isHermitian, mul, identity, approxEqual } from "./math/linalg.ts";

/** The domain tag every record here carries, so `byDomain` finds them all. */
export const QUANTUM_DOMAIN = "quantum";

/**
 * §27's honesty clause as an exported list rather than a paragraph. A future
 * session tempted to ingest the prose has to delete a line that says why not.
 */
export const NOT_INGESTED: readonly string[] = [
  "concept definitions, notations, examples and counterexamples (concepts.ts) — written from training, no document fetched, therefore `recalled` and unpromotable",
  "algorithm descriptions, circuit structures and complexity figures (algorithms.ts) — same reason; the COMPLEXITY CAVEATS are ingested as negative advantage records instead",
  "domain summaries, constructs and pitfalls (domains.ts) — same reason; the IMPLEMENTATION claims are ingested because they can be checked against the modules",
];

/* ──────────────────────────── sources ──────────────────────────── */

/**
 * PyPI is the authority on a package's version and license and on nothing
 * else, which is why `domains` is narrow. `evidence.ts`'s header makes the
 * point: "reliability is a property of the SOURCE, not of the claim".
 */
export const PYPI_SOURCE: RegisteredSource = {
  id: "pypi",
  title: "Python Package Index",
  publisher: "Python Software Foundation",
  homepage: "https://pypi.org",
  license: null,
  reliability: 1,
  domains: ["package_version", "package_license"],
  acquirable: true,
};

/**
 * ONIQ's own execution. Reliability 1 for the mathematics it actually runs —
 * this is not deference, it is that the evidence IS the computation, and the
 * computation is reproducible from the repository.
 */
export const COMPUTATION_SOURCE: RegisteredSource = {
  id: "oniq-computation",
  title: "ONIQ quantum kernel, executed",
  publisher: "ONIQ",
  homepage: "src/oqca/quantum",
  license: null,
  reliability: 1,
  domains: ["quantum_algebra", "oniq_capability"],
  acquirable: true,
};

/**
 * The ecosystem projects. `acquirable: false` is not an oversight: their
 * documentation hosts are not reachable from this container, so nothing here
 * may claim to have READ them, and evidence attributed to a project is
 * `spec_cited` at best — the ceiling §16's authorization boundary imposes.
 */
export function ecosystemSources(): readonly RegisteredSource[] {
  return QUANTUM_SOURCES.map((s) => ({
    id: s.id,
    title: s.project,
    publisher: s.project,
    homepage: locatorFor(s.id),
    license: s.license,
    // High about their OWN semantics and about nothing else; a project is the
    // authority on its own conventions, which is precisely what the
    // divergence records need it to be.
    reliability: 0.9,
    domains: ["quantum_convention", `project:${s.id}`],
    acquirable: false,
  }));
}

export function quantumSourceRegistry(): ReadonlyMap<string, RegisteredSource> {
  const m = new Map<string, RegisteredSource>();
  m.set(PYPI_SOURCE.id, PYPI_SOURCE);
  m.set(COMPUTATION_SOURCE.id, COMPUTATION_SOURCE);
  for (const s of ecosystemSources()) m.set(s.id, s);
  return m;
}

/* ──────────────────────────── provenance ──────────────────────────── */

function chain(
  agent: string,
  used: readonly string[],
  generated: string,
  at: string,
  notes: Partial<Record<ProvActivity["step"], string>>,
): Provenance {
  let p: Provenance = EMPTY_PROVENANCE;
  // The four REQUIRED_STEPS, in order. `validation` is deliberately absent for
  // the fetched facts — nothing re-checked PyPI's answer — and present for the
  // computed ones, where the checker IS the validation.
  for (const step of ["source", "acquisition", "extraction", "assertion"] as const) {
    p = withActivity(p, { step, agent, used: [...used], generated, at, note: notes[step] ?? "" });
  }
  if (notes.validation) {
    p = withActivity(p, {
      step: "validation",
      agent,
      used: [...used],
      generated,
      at,
      note: notes.validation,
    });
  }
  return p;
}

/* ──────────────────────────── evidence builders ──────────────────────────── */

let evidenceCounter = 0;
/** Deterministic within a run and stable across runs for the same order. */
function evidenceId(prefix: string): string {
  evidenceCounter += 1;
  return `${prefix}_${evidenceCounter}`;
}

/** Resets the counter so a test run's ids do not depend on earlier tests. */
export function resetEvidenceIds(): void {
  evidenceCounter = 0;
}

function harvestEvidence(sourceId: string, field: string, value: string): SourceEvidence {
  return makeEvidence({
    id: evidenceId("ev_pypi"),
    sourceId: PYPI_SOURCE.id,
    sourceType: "package_registry",
    sourceVersion: null,
    locator: HARVEST_ENDPOINT.replace("<package>", sourceId),
    contentHash: null,
    excerpt: `${field}: ${value}`,
    extraction: "structured_field",
    directness: "fetched",
    retrievedAt: HARVESTED_AT,
    verifier: "scripts/quantum-harvest-sources.mjs",
    supports: true,
  });
}

function computedEvidence(what: string, result: string, at: string): SourceEvidence {
  return makeEvidence({
    id: evidenceId("ev_computed"),
    sourceId: COMPUTATION_SOURCE.id,
    sourceType: "measurement",
    sourceVersion: null,
    locator: "src/oqca/quantum/knowledge.ts:ingestQuantumKnowledge",
    contentHash: null,
    excerpt: `${what} -> ${result}`,
    extraction: "computed",
    directness: "derived",
    retrievedAt: at,
    verifier: what,
    supports: true,
  });
}

function conventionEvidence(
  sourceId: string,
  excerpt: string,
  at: string,
  supports: boolean,
): SourceEvidence {
  const s = QUANTUM_SOURCES.find((q) => q.id === sourceId);
  return makeEvidence({
    id: evidenceId("ev_convention"),
    sourceId,
    sourceType: "official_documentation",
    sourceVersion: s?.version ?? null,
    locator: locatorFor(sourceId),
    contentHash: null,
    excerpt,
    // NOT `fetched`: the documentation host is unreachable from here, and
    // labelling a cited convention as a reading is the exact inflation this
    // whole type exists to prevent.
    directness: "spec_cited",
    extraction: "human_authored",
    retrievedAt: at,
    verifier: null,
    supports,
  });
}

/* ──────────────────────────── record families ──────────────────────────── */

/**
 * `verifiedAt` IS NOT OPTIONAL, AND THE FIRST VERSION LEFT IT OUT.
 *
 * `draftRecord` defaults to `UNBOUNDED_VALIDITY`, whose `lastVerifiedAt` is
 * null — and `freshness` reads null as "never verified", which is STALE. So
 * every one of the 113 records was born stale, `stalenessRate` read 1.0000 at
 * the harvest instant, and the whole §10 decay mechanism reported the same
 * number it would report if it computed nothing at all. A metric that has only
 * ever read 1 has never been tested, exactly as one that has only ever read 0.
 *
 * The instant is real in both families: the registry facts were verified when
 * PyPI answered (`HARVESTED_AT`), and the computed ones when this run executed
 * the checker (`at`). Neither is invented, and passing the wrong one would put
 * a package version's freshness on the wrong clock.
 */
function record(
  subject: string,
  predicate: string,
  object: unknown,
  domain: readonly string[],
  evidence: readonly SourceEvidence[],
  volatility: Volatility,
  provenance: Provenance,
  verifiedAt: string,
): KnowledgeRecord {
  return draftRecord({
    subject,
    predicate,
    object,
    domain,
    evidence,
    volatility,
    provenance,
    validity: { validFrom: null, validUntil: null, lastVerifiedAt: verifiedAt },
  });
}

/**
 * §22 family 1 — what the registry said. **These decay**: a package version is
 * `fast` volatility, so `usableNow` will stop admitting them without a
 * re-harvest, which is §10 working rather than a comment about §10.
 */
export function sourceFacts(at: string): readonly KnowledgeRecord[] {
  const out: KnowledgeRecord[] = [];
  for (const s of QUANTUM_SOURCES) {
    if (s.pypiPackage === null) continue;
    const prov = chain(
      "scripts/quantum-harvest-sources.mjs",
      [PYPI_SOURCE.id],
      s.id,
      HARVESTED_AT,
      {
        source: "PyPI JSON API",
        acquisition: `GET ${HARVEST_ENDPOINT.replace("<package>", s.pypiPackage)}`,
        extraction: "info.version and info.license read as structured fields",
        assertion: "one record per field",
      },
    );
    out.push(
      record(
        s.id,
        "hasReleasedVersion",
        s.version,
        [QUANTUM_DOMAIN, "package_version"],
        [harvestEvidence(s.pypiPackage, "version", s.version)],
        "fast",
        prov,
        HARVESTED_AT,
      ),
    );
    out.push(
      record(
        s.id,
        "hasLicense",
        s.license,
        [QUANTUM_DOMAIN, "package_license"],
        [harvestEvidence(s.pypiPackage, "license", s.license)],
        "slow",
        prov,
        HARVESTED_AT,
      ),
    );
  }
  // `at` is the instant of THIS run; the registry facts carry the instant PyPI
  // answered instead, which is what `HARVESTED_AT` is.
  void at;
  return out;
}

/**
 * §22 family 2 — algebra ONIQ ran. The checker is EXECUTED here, so a gate
 * that stopped being unitary would produce a record saying so rather than a
 * green test somewhere else. `stable` volatility: mathematics does not decay,
 * and saying it decays yearly would be the freshness/confidence confusion §10
 * warns about, in the other direction.
 */
export function algebraFacts(at: string): readonly KnowledgeRecord[] {
  const out: KnowledgeRecord[] = [];
  const prov = chain("src/oqca/quantum/knowledge.ts", [COMPUTATION_SOURCE.id], "gate algebra", at, {
    source: "the gate matrices in src/oqca/quantum/gates.ts",
    acquisition: "read from the module, not fetched",
    extraction: "the named checker applied to the matrix",
    assertion: "one record per gate per property",
    validation: "isUnitary / isHermitian / U U = I, run at ingest",
  });
  // GATE_NAMES is sorted, so the record order — and therefore the evidence
  // ids — are stable across runs. An object's key order is not a guarantee.
  for (const name of GATE_NAMES) {
    const g = GATES[name];
    const m = g.matrix;
    const unitary = isUnitary(m);
    out.push(
      record(
        `gate:${g.name}`,
        "isUnitary",
        unitary,
        [QUANTUM_DOMAIN, "quantum_algebra"],
        [computedEvidence(`isUnitary(${g.name})`, String(unitary), at)],
        "stable",
        prov,
        at,
      ),
    );
    const hermitian = isHermitian(m);
    if (hermitian) {
      out.push(
        record(
          `gate:${g.name}`,
          "isHermitian",
          true,
          [QUANTUM_DOMAIN, "quantum_algebra"],
          [computedEvidence(`isHermitian(${g.name})`, "true", at)],
          "stable",
          prov,
          at,
        ),
      );
    }
    // Involutory is computed, never declared — the concept table claims it for
    // the Paulis and H, and a claim nobody multiplied out is a claim.
    const involutory = approxEqual(mul(m, m), identity(m.rows));
    if (involutory) {
      out.push(
        record(
          `gate:${g.name}`,
          "isInvolutory",
          true,
          [QUANTUM_DOMAIN, "quantum_algebra"],
          [computedEvidence(`${g.name}^2 == I`, "true", at)],
          "stable",
          prov,
          at,
        ),
      );
    }
  }
  return out;
}

/**
 * §22 family 3 — what ONIQ can actually DO, computed by resolving each
 * domain's claimed exports against the modules that must provide them.
 * `resolved` is supplied by the caller because this module may not import the
 * whole quantum tree back into itself; `domains.test.ts` passes the real one.
 *
 * THIS IS THE §27 GAP LEDGER AS BELIEF. A capability record saying ONIQ does
 * NOT implement quantum error correction is as much a fact as one saying it
 * does, and the negative ones are the reason the report can be honest.
 */
export function capabilityFacts(
  at: string,
  resolved: (name: string) => boolean,
): readonly KnowledgeRecord[] {
  const out: KnowledgeRecord[] = [];
  const prov = chain("src/oqca/quantum/knowledge.ts", [COMPUTATION_SOURCE.id], "capability", at, {
    source: "DOMAINS[].implementedHere in src/oqca/quantum/domains.ts",
    acquisition: "read from the module",
    extraction: "each claimed export resolved against the real module namespace",
    assertion: "one record per domain",
    validation: "an unresolvable name makes the claim false, not merely unproven",
  });
  for (const d of DOMAINS) {
    const present = d.implementedHere.filter((n) => resolved(n));
    const implemented = d.implementedHere.length > 0 && present.length === d.implementedHere.length;
    out.push(
      record(
        `oniq:${d.id}`,
        "implementsDomain",
        implemented,
        [QUANTUM_DOMAIN, "oniq_capability", d.id],
        [
          computedEvidence(
            `resolve(${d.id}.implementedHere)`,
            `${present.length}/${d.implementedHere.length} exports present`,
            at,
          ),
        ],
        "slow",
        prov,
        at,
      ),
    );
    out.push(
      record(
        `oniq:${d.id}`,
        "hasOpenGaps",
        d.notImplemented.length,
        [QUANTUM_DOMAIN, "oniq_capability", d.id],
        [computedEvidence(`count(${d.id}.notImplemented)`, String(d.notImplemented.length), at)],
        "slow",
        prov,
        at,
      ),
    );
  }
  return out;
}

/**
 * §23 — the disagreements, ingested as records with evidence on BOTH sides so
 * `evaluatePromotion` returns **CONTESTED** rather than a winner. That status
 * is the mechanism behind "never silently normalize conflicting semantics":
 * `mayInformDecision` refuses a CONTESTED record, and only a caller that opts
 * in by name (`mayInformConflictAwareDecision`, `contestedFacts`) can read one
 * — so nothing downstream can pick up one convention and forget the other.
 */
export function divergenceFacts(at: string): readonly KnowledgeRecord[] {
  return DIVERGENCES.map((d) => {
    const prov = chain(
      "src/oqca/quantum/knowledge.ts",
      [COMPUTATION_SOURCE.id, ...d.divergentFrom],
      d.id,
      at,
      {
        source: "ONIQ's own convention, and each ecosystem's documented one",
        acquisition: "ONIQ's read from its modules; the ecosystems' cited, not fetched",
        extraction: "hand-authored from the two conventions",
        assertion: "one contested record per topic",
      },
    );
    return record(
      `convention:${d.id}`,
      "oniqConventionIs",
      d.oniqConvention,
      [QUANTUM_DOMAIN, "quantum_convention"],
      [
        computedEvidence(`ONIQ ${d.topic}`, d.oniqConvention, at),
        ...d.divergentFrom.map((p) =>
          conventionEvidence(p, `${d.topic}: ${d.theirConvention}`, at, false),
        ),
      ],
      "slow",
      prov,
      at,
    );
  });
}

/**
 * §7 AS A REFUSAL RATHER THAN A RULE — "Never store 'quantum advantage' as a
 * fact unless supported by a specific benchmark."
 *
 * `assertAdvantage` is the ONLY way a positive advantage record can be made,
 * and it throws without a named benchmark. `advantageFacts` therefore produces
 * eighteen NEGATIVE records and zero positive ones, because no benchmark has
 * been run here — which is the true state and the one §27 must report.
 */
export function assertAdvantage(
  algorithmId: string,
  benchmark: string,
  at: string,
): KnowledgeRecord {
  if (!benchmark.trim()) {
    throw new Error(
      `quantum knowledge: §7 refuses an advantage claim for ${algorithmId} with no benchmark`,
    );
  }
  const prov = chain("src/oqca/quantum/knowledge.ts", [COMPUTATION_SOURCE.id], algorithmId, at, {
    source: benchmark,
    acquisition: "the benchmark run",
    extraction: "its reported outcome",
    assertion: "a positive advantage record",
    validation: benchmark,
  });
  return record(
    `algorithm:${algorithmId}`,
    "hasDemonstratedAdvantage",
    true,
    [QUANTUM_DOMAIN, "quantum_advantage"],
    [computedEvidence(`benchmark:${benchmark}`, "advantage demonstrated", at)],
    "event_driven",
    prov,
    at,
  );
}

export function advantageFacts(at: string): readonly KnowledgeRecord[] {
  const prov = chain("src/oqca/quantum/knowledge.ts", [COMPUTATION_SOURCE.id], "advantage", at, {
    source: "ALGORITHMS[].complexity.caveat",
    acquisition: "read from the module",
    extraction: "no benchmark is registered for any algorithm",
    assertion: "one negative record per algorithm",
    validation: "assertAdvantage is the only positive path and requires a benchmark",
  });
  return ALGORITHMS.map((a) =>
    record(
      `algorithm:${a.id}`,
      "hasDemonstratedAdvantage",
      false,
      [QUANTUM_DOMAIN, "quantum_advantage"],
      [
        computedEvidence(
          `benchmarksFor(${a.id})`,
          `none registered; stated caveat: ${a.complexity.caveat}`,
          at,
        ),
      ],
      "event_driven",
      prov,
      at,
    ),
  );
}

/* ──────────────────────────── ingestion ──────────────────────────── */

export type IngestReport = {
  readonly total: number;
  readonly verified: number;
  readonly contested: number;
  readonly candidate: number;
  readonly rejected: number;
  /** Records whose promotion was refused, with every reason. */
  readonly refusals: readonly { readonly id: string; readonly reasons: readonly string[] }[];
};

/**
 * The §25 arrow. Every record goes through `evaluatePromotion` — there is no
 * path here that writes a status directly, which is what makes the quantum
 * domain an adapter under the general substrate rather than a second one
 * beside it.
 */
export function ingestQuantumKnowledge(
  store: KnowledgeStore,
  at: string,
  resolved: (name: string) => boolean,
): IngestReport {
  const sources = quantumSourceRegistry();
  const drafts = [
    ...sourceFacts(at),
    ...algebraFacts(at),
    ...capabilityFacts(at, resolved),
    ...divergenceFacts(at),
    ...advantageFacts(at),
  ];

  const refusals: { id: string; reasons: readonly string[] }[] = [];
  let verified = 0;
  let contested = 0;
  let candidate = 0;
  let rejected = 0;

  for (const d of drafts) {
    const decision = evaluatePromotion(d, sources);
    const promoted = applyPromotion(d, decision);
    store.put(promoted);
    if (promoted.status === "VERIFIED") verified += 1;
    else if (promoted.status === "CONTESTED") contested += 1;
    else if (promoted.status === "REJECTED") rejected += 1;
    else candidate += 1;
    if (decision.reasons.length > 0) refusals.push({ id: promoted.id, reasons: decision.reasons });
  }

  return { total: drafts.length, verified, contested, candidate, rejected, refusals };
}
