/**
 * OQCA v1.1 — the knowledge substrate. Brief section 10.
 *
 * "Do NOT build the full knowledge graph yet... This is a research substrate
 * only. Do not introduce a production database."
 *
 * So this is an in-memory, immutable, dependency-free structure, and the brief's
 * restraint is kept literally: no storage, no schema, no migration, nothing that
 * outlives the process.
 *
 * WHAT IT IS FOR, and it is narrower than "knowledge". Section 11 asks whether
 * OQCA can IDENTIFY A GAP before anything is allowed to go and fill one. A gap
 * is a statement about what is known, uncertain, contradicted or absent — so
 * the substrate needs exactly enough structure to make those four
 * distinguishable, and no more. Everything here exists to be read by
 * `gaps.ts`; nothing here reasons.
 *
 * EVERY RELATION CARRIES ITS PROVENANCE, which is the one thing that cannot be
 * added later without rewriting the store. Confidence with no evidence behind
 * it is a number somebody typed, and a graph that cannot say where a claim came
 * from cannot answer "is this contradicted" — it can only answer "is this
 * present".
 */

export type Confidence = {
  /** In [0, 1]. 0.5 is not "unknown" — absence is unknown; this is a belief. */
  readonly value: number;
  /**
   * How much this belief could still move. A claim at 0.9 from one source is a
   * different object from one at 0.9 from twelve, and only this field says so.
   */
  readonly volatility: number;
};

export type EvidenceSource = "measured" | "document" | "inference" | "asserted";

export type Evidence = {
  readonly id: string;
  readonly source: EvidenceSource;
  /** Free text; the substrate never parses it. */
  readonly statement: string;
  /** Where this came from — a URL, a file, a run id. Never invented. */
  readonly provenance: string;
  readonly supports: boolean;
  readonly confidence: Confidence;
};

export type Concept = {
  readonly id: string;
  readonly label: string;
  /** Concepts this one cannot be understood without. Drives `dependency`. */
  readonly dependsOn: readonly string[];
  readonly contextIds: readonly string[];
};

export type Relation = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly confidence: Confidence;
  readonly evidenceIds: readonly string[];
  readonly contextId: string;
  readonly provenance: string;
};

export type KnowledgeState = {
  readonly concepts: ReadonlyMap<string, Concept>;
  readonly relations: ReadonlyMap<string, Relation>;
  readonly evidence: ReadonlyMap<string, Evidence>;
};

export const EMPTY_KNOWLEDGE: KnowledgeState = {
  concepts: new Map(),
  relations: new Map(),
  evidence: new Map(),
};

export function conf(value: number, volatility = 0.5): Confidence {
  if (!(value >= 0 && value <= 1)) throw new Error("OQCA knowledge: confidence must be in [0, 1]");
  if (!(volatility >= 0 && volatility <= 1)) {
    throw new Error("OQCA knowledge: volatility must be in [0, 1]");
  }
  return { value, volatility };
}

/** Immutable insert. Returns a NEW state, like everything else in this kernel. */
export function withConcept(k: KnowledgeState, c: Concept): KnowledgeState {
  return { ...k, concepts: new Map(k.concepts).set(c.id, c) };
}

export function withEvidence(k: KnowledgeState, e: Evidence): KnowledgeState {
  return { ...k, evidence: new Map(k.evidence).set(e.id, e) };
}

export function withRelation(k: KnowledgeState, r: Relation): KnowledgeState {
  for (const id of r.evidenceIds) {
    // A relation naming evidence the store does not hold is exactly the
    // untraceable claim this module exists to make impossible.
    if (!k.evidence.has(id)) throw new Error(`OQCA knowledge: unknown evidence ${id}`);
  }
  return { ...k, relations: new Map(k.relations).set(r.id, r) };
}

/** Every piece of evidence bearing on a concept, in a deterministic order. */
export function evidenceFor(k: KnowledgeState, conceptId: string): Evidence[] {
  const ids = new Set<string>();
  for (const r of [...k.relations.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (r.from === conceptId || r.to === conceptId) for (const e of r.evidenceIds) ids.add(e);
  }
  return [...ids]
    .sort()
    .map((id) => k.evidence.get(id))
    .filter((e): e is Evidence => e !== undefined);
}

/**
 * The example the brief names, built so the gap detector has something real to
 * read and so the test suite is not scoring an empty graph.
 */
export function quantumErrorCorrectionSeed(): KnowledgeState {
  let k = EMPTY_KNOWLEDGE;
  const concepts: Concept[] = [
    {
      id: "quantum_error_correction",
      label: "Quantum error correction",
      dependsOn: ["qubit", "noise", "syndrome", "logical_qubit", "fault_tolerance"],
      contextIds: ["oqca"],
    },
    { id: "qubit", label: "Qubit", dependsOn: [], contextIds: ["oqca"] },
    { id: "noise", label: "Noise", dependsOn: ["qubit"], contextIds: ["oqca"] },
    {
      id: "syndrome",
      label: "Syndrome extraction",
      dependsOn: ["qubit", "noise"],
      contextIds: ["oqca"],
    },
    {
      id: "logical_qubit",
      label: "Logical qubit",
      dependsOn: ["qubit", "syndrome"],
      contextIds: ["oqca"],
    },
    {
      id: "fault_tolerance",
      label: "Fault tolerance",
      dependsOn: ["logical_qubit"],
      contextIds: ["oqca"],
    },
  ];
  for (const c of concepts) k = withConcept(k, c);

  k = withEvidence(k, {
    id: "ev_unitary_norm",
    source: "measured",
    statement:
      "A unitary operator preserves the state norm; measured residual < 1e-15 over a swept grid.",
    provenance: "src/oqca/__tests__/unitary.test.ts",
    supports: true,
    confidence: conf(0.99, 0.05),
  });
  k = withEvidence(k, {
    id: "ev_no_factorisation",
    source: "measured",
    statement: "OQCA's basis is flat and unfactored, so no entanglement is representable.",
    provenance: "src/oqca/cognitive.ts OPERATION_CATALOGUE (ENTANGLE, category C)",
    supports: true,
    confidence: conf(0.98, 0.05),
  });
  k = withRelation(k, {
    id: "rel_qec_needs_logical",
    from: "quantum_error_correction",
    to: "logical_qubit",
    kind: "requires",
    confidence: conf(0.95, 0.1),
    evidenceIds: ["ev_no_factorisation"],
    contextId: "oqca",
    provenance: "brief section 10",
  });
  k = withRelation(k, {
    id: "rel_qubit_norm",
    from: "qubit",
    to: "noise",
    kind: "affected_by",
    confidence: conf(0.9, 0.2),
    evidenceIds: ["ev_unitary_norm"],
    contextId: "oqca",
    provenance: "brief section 2",
  });
  return k;
}
