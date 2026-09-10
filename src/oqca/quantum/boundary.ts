/**
 * THE QUANTUM COGNITION BOUNDARY — quantum brief §20.
 *
 *   "Maintain three explicit categories: PHYSICAL_QUANTUM, QUANTUM_INSPIRED,
 *    CLASSICAL_ANALOG. Never silently convert one category into another."
 *
 * THIS IS THE MOST IMPORTANT FILE IN THE QUANTUM SUBSTRATE, and it is the
 * shortest. ONIQ contains, in the same repository:
 *
 *   src/oqca/quantum/gates.ts   2^n x 2^n unitaries on a Hilbert space
 *                               -> PHYSICAL_QUANTUM
 *   src/oqca/gates.ts           two-level rotations on a HYPOTHESIS amplitude
 *                               vector -> QUANTUM_INSPIRED
 *   src/oqca/knowledge/model.ts a probability-weighted belief graph
 *                               -> CLASSICAL_ANALOG
 *
 * All three are real and useful; only the first is a claim about physics. The
 * failure this file prevents is the one v1.1 already measured and wrote down:
 * "Do not describe the result anywhere as 'quantum advantage', 'AGI', or
 * 'better reasoning'." A `QUANTUM_INSPIRED` amplitude that drifted into being
 * described as a quantum state would make ONIQ claim a physical property it
 * does not have.
 */

export type QuantumCategory = "PHYSICAL_QUANTUM" | "QUANTUM_INSPIRED" | "CLASSICAL_ANALOG";

export const QUANTUM_CATEGORIES: readonly QuantumCategory[] = [
  "PHYSICAL_QUANTUM",
  "QUANTUM_INSPIRED",
  "CLASSICAL_ANALOG",
];

export type CategorisedObject = {
  readonly name: string;
  readonly category: QuantumCategory;
  readonly module: string;
  /** Why it is in this category and not the adjacent one. */
  readonly because: string;
};

/**
 * The brief's own three examples, plus every ONIQ object that could plausibly
 * be mistaken for one of the others. The `because` field is the part that
 * matters: a table of labels with no reasons is a table nobody can check.
 */
export const CATEGORISED: readonly CategorisedObject[] = [
  {
    name: "unitary matrix",
    category: "PHYSICAL_QUANTUM",
    module: "src/oqca/quantum/math/linalg.ts",
    because: "U†U = I on a complex Hilbert space; it is the mathematics of physical evolution",
  },
  {
    name: "state vector",
    category: "PHYSICAL_QUANTUM",
    module: "src/oqca/quantum/math/state.ts",
    because: "complex amplitudes whose squared moduli are Born-rule probabilities",
  },
  {
    name: "density matrix",
    category: "PHYSICAL_QUANTUM",
    module: "src/oqca/quantum/math/state.ts",
    because: "a positive semidefinite unit-trace operator; it represents a physical ensemble",
  },
  {
    name: "Kraus channel",
    category: "PHYSICAL_QUANTUM",
    module: "src/oqca/quantum/math/channel.ts",
    because: "a CPTP map; it models real decoherence, not an analogy to it",
  },
  {
    name: "hypothesis superposition",
    category: "QUANTUM_INSPIRED",
    module: "src/oqca/formalState.ts",
    because:
      "a normalised complex amplitude vector over HYPOTHESES. The mathematics is borrowed; the " +
      "hypotheses are not physical degrees of freedom and nothing here is entangled",
  },
  {
    name: "cognitive interference",
    category: "QUANTUM_INSPIRED",
    module: "src/oqca/cognitive.ts",
    because:
      "a unitary rotation on a two-hypothesis subspace. v1.1 MEASURED that its advantage over a " +
      "probability vector was the extra information channel, not the representation",
  },
  {
    name: "probability vector",
    category: "CLASSICAL_ANALOG",
    module: "src/oqca/bench/arms.ts",
    because: "real, non-negative, sums to one; it is Bayes and is used as the control",
  },
  {
    name: "knowledge confidence",
    category: "CLASSICAL_ANALOG",
    module: "src/oqca/knowledge/model.ts",
    because: "a scalar belief in [0,1] with no phase; it cannot interfere",
  },
];

export const CATEGORY_OF: ReadonlyMap<string, QuantumCategory> = new Map(
  CATEGORISED.map((o) => [o.name, o.category] as const),
);

/**
 * THE CONVERSION GUARD. There is no function here that turns one category into
 * another, and that absence is the design — §20 says "never silently convert",
 * and the surest way to keep a conversion from being silent is for it not to
 * exist. This predicate is what a caller asks BEFORE treating one as the other,
 * and it always answers false across categories.
 */
export function sameCategory(a: string, b: string): boolean {
  const ca = CATEGORY_OF.get(a);
  const cb = CATEGORY_OF.get(b);
  return ca !== undefined && ca === cb;
}

/**
 * A claim that would be FALSE if made about a `QUANTUM_INSPIRED` object.
 * Exported so `boundary.test.ts` can assert that no ONIQ source outside the
 * physical tree makes one.
 */
export const PHYSICAL_ONLY_CLAIMS: readonly string[] = [
  "entangled",
  "superposition of physical states",
  "measured on hardware",
  "quantum advantage",
  "quantum speedup",
  "exponentially faster",
];

export function claimIsLegitimate(claim: string, category: QuantumCategory): boolean {
  const lowered = claim.toLowerCase();
  const physical = PHYSICAL_ONLY_CLAIMS.some((p) => lowered.includes(p));
  return !physical || category === "PHYSICAL_QUANTUM";
}
