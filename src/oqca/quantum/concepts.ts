/**
 * QUANTUM FOUNDATIONS — quantum brief §3.
 *
 * "Every mathematical object must have: definition, notation, constraints,
 *  invariants, examples, counterexamples."
 *
 * ALL SIX ARE REQUIRED FIELDS, so a concept cannot be added with the awkward
 * ones left out — and the awkward one is `counterexamples`. A definition plus
 * an example is what a summary produces; the counterexample is what says where
 * the concept STOPS, and it is the field that catches a plausible-sounding
 * misunderstanding.
 *
 * `invariantCheck` NAMES THE FUNCTION THAT VERIFIES IT, where one exists.
 * `conceptsAreExecutable.test.ts` resolves every name against the real exports,
 * so a concept claiming an invariant nothing checks fails the build. That is
 * the difference between this file and an encyclopedia entry.
 */

export type QuantumConcept = {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
  readonly notation: string;
  readonly constraints: readonly string[];
  readonly invariants: readonly string[];
  readonly examples: readonly string[];
  readonly counterexamples: readonly string[];
  /** Exported function that checks the invariant, or null when none can. */
  readonly invariantCheck: string | null;
  readonly dependsOn: readonly string[];
};

export const CONCEPTS: readonly QuantumConcept[] = [
  {
    id: "qubit",
    label: "Qubit",
    definition:
      "A two-level quantum system: a unit vector in a two-dimensional complex Hilbert space.",
    notation: "|psi> = a|0> + b|1>, a,b in C",
    constraints: ["|a|^2 + |b|^2 = 1"],
    invariants: ["normalisation is preserved by every unitary"],
    examples: ["|0>", "|+> = (|0>+|1>)/sqrt(2)", "|i> = (|0>+i|1>)/sqrt(2)"],
    counterexamples: [
      "a classical bit with a probability attached — it has no phase and cannot interfere",
      "an unnormalised vector such as |0> + |1> without the 1/sqrt(2)",
    ],
    invariantCheck: "isNormalized",
    dependsOn: ["hilbert_space"],
  },
  {
    id: "register",
    label: "Quantum register",
    definition: "An ordered collection of n qubits, living in a 2^n-dimensional space.",
    notation: "|q0 q1 ... q(n-1)>",
    constraints: ["dimension is exactly 2^n", "the ORDER convention must be fixed and stated"],
    invariants: ["a register of n qubits has 2^n basis states, not 2n"],
    examples: ["|00>, |01>, |10>, |11> for n = 2"],
    counterexamples: [
      "treating n qubits as n independent bits — that ignores entanglement entirely",
      "assuming an ecosystem's qubit ORDER matches yours; ONIQ is big-endian and Qiskit is not",
    ],
    invariantCheck: null,
    dependsOn: ["qubit", "tensor_product"],
  },
  {
    id: "hilbert_space",
    label: "Hilbert space",
    definition: "A complete complex inner-product space; the state space of a quantum system.",
    notation: "H, dim H = d",
    constraints: ["complex", "has an inner product <.|.>", "complete"],
    invariants: ["the inner product is conjugate-symmetric: <a|b> = conj(<b|a>)"],
    examples: ["C^2 for one qubit", "C^4 for two qubits"],
    counterexamples: ["a real vector space — phases could not exist, so interference could not"],
    invariantCheck: null,
    dependsOn: [],
  },
  {
    id: "basis",
    label: "Basis",
    definition: "A maximal set of orthonormal vectors spanning the space.",
    notation: "{|0>, |1>} computational; {|+>, |->} Hadamard",
    constraints: ["orthonormal", "size equals the dimension"],
    invariants: ["any state expands uniquely in a given basis"],
    examples: ["computational (Z) basis", "X basis", "Bell basis for two qubits"],
    counterexamples: ["{|0>, |+>} — these are not orthogonal, so coefficients are not unique"],
    invariantCheck: null,
    dependsOn: ["hilbert_space"],
  },
  {
    id: "state_vector",
    label: "State vector",
    definition: "A unit vector representing the complete description of a PURE state.",
    notation: "|psi>",
    constraints: ["<psi|psi> = 1"],
    invariants: ["global phase is unobservable: |psi> and e^{i t}|psi> are the same state"],
    examples: ["|0>", "the Bell state (|00>+|11>)/sqrt(2)"],
    counterexamples: [
      "a mixed state — no single vector describes it; it needs a density matrix",
      "the zero vector, which is not a state at all",
    ],
    invariantCheck: "isNormalized",
    dependsOn: ["qubit", "basis"],
  },
  {
    id: "density_matrix",
    label: "Density matrix",
    definition: "A positive semidefinite, unit-trace operator describing a pure OR mixed state.",
    notation: "rho",
    constraints: ["rho = rho-dagger", "Tr(rho) = 1", "rho >= 0"],
    invariants: [
      "Tr(rho^2) <= 1, with equality exactly for a pure state",
      "eigenvalues are probabilities: non-negative and summing to one",
    ],
    examples: ["|0><0| (pure)", "I/2 (maximally mixed one-qubit state)"],
    counterexamples: [
      "a Hermitian unit-trace matrix with a NEGATIVE eigenvalue — it has trace 1 and is still " +
        "not a state; this is why checking the trace alone is insufficient",
    ],
    invariantCheck: "isValidDensity",
    dependsOn: ["state_vector", "hermitian_operator"],
  },
  {
    id: "pure_mixed",
    label: "Pure and mixed states",
    definition:
      "A state is pure when it is a single ray in Hilbert space, mixed when it is a classical " +
      "ensemble of pure states.",
    notation: "Tr(rho^2) = 1 (pure) vs < 1 (mixed)",
    constraints: ["purity lies in [1/d, 1]"],
    invariants: ["a subsystem of an entangled pure state is ALWAYS mixed"],
    examples: ["|+><+| is pure", "I/2 is maximally mixed"],
    counterexamples: [
      "calling a superposition 'mixed' — a superposition is PURE; the words are not synonyms " +
        "and confusing them is the most common conceptual error in the subject",
    ],
    invariantCheck: "isPure",
    dependsOn: ["density_matrix"],
  },
  {
    id: "tensor_product",
    label: "Tensor product",
    definition: "The way composite systems combine: H_AB = H_A (x) H_B.",
    notation: "|a> (x) |b>, A (x) B",
    constraints: ["dim(H_AB) = dim(H_A) * dim(H_B)"],
    invariants: ["(A (x) B)(C (x) D) = AC (x) BD", "unitarity is preserved under tensoring"],
    examples: ["|0> (x) |1> = |01>", "X (x) I acts on the first qubit only"],
    counterexamples: [
      "the Bell state — it is in the tensor-product SPACE but is not a product of two vectors, " +
        "which is exactly what entanglement means",
    ],
    invariantCheck: "kron",
    dependsOn: ["hilbert_space"],
  },
  {
    id: "amplitude",
    label: "Amplitude",
    definition: "A complex coefficient of a basis state.",
    notation: "a_i = <i|psi>",
    constraints: ["sum |a_i|^2 = 1"],
    invariants: ["amplitudes interfere; probabilities do not"],
    examples: ["1/sqrt(2) for each basis state of |+>"],
    counterexamples: ["a probability — it is real and non-negative and cannot cancel"],
    invariantCheck: null,
    dependsOn: ["state_vector"],
  },
  {
    id: "probability",
    label: "Born-rule probability",
    definition: "The probability of outcome i is the squared modulus of its amplitude.",
    notation: "p_i = |<i|psi>|^2",
    constraints: ["p_i >= 0", "sum p_i = 1"],
    invariants: ["probabilities are invariant under a global phase"],
    examples: ["|+> gives p_0 = p_1 = 1/2"],
    counterexamples: ["|a_i| without squaring — a common slip that does not normalise"],
    invariantCheck: "probabilities",
    dependsOn: ["amplitude", "measurement"],
  },
  {
    id: "phase",
    label: "Global phase",
    definition: "An overall factor e^{i t} multiplying a whole state.",
    notation: "e^{i t}|psi>",
    constraints: ["|e^{i t}| = 1"],
    invariants: ["UNOBSERVABLE: no measurement can distinguish |psi> from e^{i t}|psi>"],
    examples: ["-|0> is the same state as |0>"],
    counterexamples: [
      "assuming this makes phase irrelevant — a global phase on a CONTROLLED gate's target " +
        "becomes a RELATIVE phase and is fully observable",
    ],
    invariantCheck: null,
    dependsOn: ["amplitude"],
  },
  {
    id: "relative_phase",
    label: "Relative phase",
    definition: "A phase difference BETWEEN amplitudes in a superposition.",
    notation: "(|0> + e^{i t}|1>)/sqrt(2)",
    constraints: ["defined modulo 2 pi"],
    invariants: ["fully observable — it is what interference measures"],
    examples: ["|+> vs |-> differ only by a relative phase of pi"],
    counterexamples: ["treating it as unobservable like a global phase"],
    invariantCheck: null,
    dependsOn: ["phase"],
  },
  {
    id: "measurement",
    label: "Measurement",
    definition:
      "Extraction of classical information; in the projective case, application of a projector " +
      "followed by renormalisation.",
    notation: "p_i = <psi|P_i|psi>, |psi> -> P_i|psi>/sqrt(p_i)",
    constraints: ["sum_i P_i = I", "P_i^2 = P_i", "P_i = P_i-dagger"],
    invariants: ["outcome probabilities sum to one", "measurement is irreversible"],
    examples: ["measuring |+> in the Z basis gives 0 or 1 with probability 1/2"],
    counterexamples: [
      "believing measurement merely reveals a pre-existing value — Bell inequality violations " +
        "rule that out for entangled systems",
    ],
    invariantCheck: "isProjector",
    dependsOn: ["observable", "probability"],
  },
  {
    id: "observable",
    label: "Observable",
    definition: "A Hermitian operator whose eigenvalues are the possible measurement outcomes.",
    notation: "A = A-dagger",
    constraints: ["Hermitian"],
    invariants: ["eigenvalues are REAL", "the expectation value is real for any state"],
    examples: ["Z with eigenvalues +1, -1", "a Hamiltonian H"],
    counterexamples: [
      "a non-Hermitian matrix such as the raising operator — its 'expectation' is complex",
      "a unitary that is not Hermitian, e.g. S: it is a valid GATE and not an observable",
    ],
    invariantCheck: "isHermitian",
    dependsOn: ["hermitian_operator"],
  },
  {
    id: "hermitian_operator",
    label: "Hermitian operator",
    definition: "An operator equal to its own conjugate transpose.",
    notation: "A = A-dagger",
    constraints: ["square"],
    invariants: ["real eigenvalues", "orthogonal eigenvectors for distinct eigenvalues"],
    examples: ["X, Y, Z, H", "any density matrix"],
    counterexamples: ["T, whose diagonal carries a complex phase"],
    invariantCheck: "isHermitian",
    dependsOn: [],
  },
  {
    id: "unitary",
    label: "Unitary operator",
    definition:
      "An invertible operator preserving the inner product; the evolution of a closed system.",
    notation: "U-dagger U = U U-dagger = I",
    constraints: ["square", "U^-1 = U-dagger"],
    invariants: ["preserves normalisation", "preserves inner products, hence distinguishability"],
    examples: ["every gate in GATES", "e^{-iHt} for Hermitian H"],
    counterexamples: [
      "a projector — it is Hermitian but destroys norm, so it is not evolution",
      "a Kraus operator on its own; only the full SET is trace preserving",
    ],
    invariantCheck: "isUnitary",
    dependsOn: ["hilbert_space"],
  },
  {
    id: "channel",
    label: "Quantum channel",
    definition: "A completely positive, trace-preserving linear map on density matrices.",
    notation: "E(rho) = sum_k K_k rho K_k-dagger",
    constraints: ["sum_k K_k-dagger K_k = I"],
    invariants: [
      "maps states to states",
      "unitary evolution is the special case of one Kraus operator",
    ],
    examples: ["depolarizing", "amplitude damping", "any unitary"],
    counterexamples: [
      "the transpose map — positive but NOT completely positive, so it maps some entangled " +
        "states to non-states; this is precisely why 'completely' is in the name",
    ],
    invariantCheck: "isCPTP",
    dependsOn: ["kraus_operator", "density_matrix"],
  },
  {
    id: "kraus_operator",
    label: "Kraus operator",
    definition: "One element of an operator-sum representation of a channel.",
    notation: "K_k",
    constraints: ["the SET satisfies sum K-dagger K = I"],
    invariants: ["a single Kraus operator is a channel only when it is unitary"],
    examples: ["sqrt(1-p) I and sqrt(p) X for a bit flip"],
    counterexamples: ["an arbitrary matrix set with no completeness relation"],
    invariantCheck: "isTracePreserving",
    dependsOn: ["channel"],
  },
  {
    id: "cptp_map",
    label: "CPTP map",
    definition: "Completely positive and trace preserving — the physical requirement on a channel.",
    notation: "E: B(H) -> B(H)",
    constraints: ["complete positivity", "trace preservation"],
    invariants: ["complete positivity is automatic in the Kraus form (Choi's theorem)"],
    examples: ["every entry in the noise catalogue"],
    counterexamples: ["a map that shrinks the trace — it loses probability, so it is not physical"],
    invariantCheck: "isCPTP",
    dependsOn: ["channel"],
  },
  {
    id: "entanglement",
    label: "Entanglement",
    definition: "A composite state that cannot be written as a product of subsystem states.",
    notation: "|psi>_AB != |a>_A (x) |b>_B",
    constraints: ["needs at least two subsystems"],
    invariants: [
      "for a PURE global state, the reduced state is mixed exactly when the state is entangled",
      "local unitaries cannot create or destroy it",
    ],
    examples: ["(|00>+|11>)/sqrt(2), whose reduced state is I/2"],
    counterexamples: [
      "|+>|+> — a superposition in both qubits and a PRODUCT state, so not entangled at all",
      "a classically correlated mixture, which has correlation but no entanglement",
    ],
    invariantCheck: "entanglementEntropy",
    dependsOn: ["tensor_product", "partial_trace"],
  },
  {
    id: "partial_trace",
    label: "Partial trace",
    definition: "The operation producing a subsystem's reduced density matrix.",
    notation: "rho_A = Tr_B(rho_AB)",
    constraints: ["the result is a valid density matrix"],
    invariants: ["Tr(rho_A) = 1", "it is the unique map giving correct local expectation values"],
    examples: ["tracing out one Bell qubit gives I/2"],
    counterexamples: [
      "'just deleting' the other qubit's amplitudes, which does not preserve the trace",
    ],
    invariantCheck: "partialTrace",
    dependsOn: ["density_matrix"],
  },
  {
    id: "bloch_sphere",
    label: "Bloch sphere",
    definition:
      "The geometric picture of one qubit: pure states on the surface, mixed states inside.",
    notation: "rho = (I + r . sigma)/2, |r| <= 1",
    constraints: ["|r| <= 1", "|r| = 1 exactly for pure states"],
    invariants: ["unitaries are rotations", "non-unital channels move the centre"],
    examples: ["|0> at the north pole", "I/2 at the origin"],
    counterexamples: [
      "extending the picture to two qubits — there is no 2-qubit Bloch SPHERE; the state space " +
        "is 15-dimensional and not a ball",
    ],
    invariantCheck: null,
    dependsOn: ["density_matrix"],
  },
  {
    id: "expectation_value",
    label: "Expectation value",
    definition: "The mean outcome of measuring an observable.",
    notation: "<A> = <psi|A|psi> = Tr(rho A)",
    constraints: ["A must be Hermitian for <A> to be real"],
    invariants: ["lies between the smallest and largest eigenvalue of A"],
    examples: ["<Z> = 1 for |0>, 0 for |+>"],
    counterexamples: [
      "an expectation with a non-zero imaginary part — the operator is not Hermitian",
    ],
    invariantCheck: "expectation",
    dependsOn: ["observable"],
  },
  {
    id: "fidelity",
    label: "Fidelity",
    definition: "A measure of closeness between two states.",
    notation: "F(rho, sigma) = (Tr sqrt(sqrt(rho) sigma sqrt(rho)))^2",
    constraints: ["0 <= F <= 1"],
    invariants: ["F = 1 exactly when the states are equal", "symmetric in its arguments"],
    examples: ["F(|0>, |+>) = 1/2"],
    counterexamples: [
      "Tr(rho sigma), which coincides with F only when one state is PURE and is a different " +
        "quantity otherwise",
    ],
    invariantCheck: "fidelity",
    dependsOn: ["density_matrix"],
  },
  {
    id: "trace_distance",
    label: "Trace distance",
    definition: "Half the trace norm of the difference; the maximum distinguishing probability.",
    notation: "D = (1/2)||rho - sigma||_1",
    constraints: ["0 <= D <= 1"],
    invariants: ["a metric", "contractive under any CPTP map — noise never helps you distinguish"],
    examples: ["D(|0>, |1>) = 1", "D(|0>, |+>) = 1/sqrt(2)"],
    counterexamples: ["the Frobenius distance, which is not operationally the error probability"],
    invariantCheck: "traceDistance",
    dependsOn: ["density_matrix"],
  },
  {
    id: "entropy",
    label: "von Neumann entropy",
    definition: "The quantum analogue of Shannon entropy.",
    notation: "S(rho) = -Tr(rho log rho)",
    constraints: ["0 <= S <= log d"],
    invariants: [
      "S = 0 exactly for a pure state",
      "invariant under unitaries",
      "subadditive: S(AB) <= S(A) + S(B)",
    ],
    examples: ["S(I/2) = 1 qubit", "S of either Bell half = 1"],
    counterexamples: [
      "assuming S(AB) >= S(A) as it is classically — for a Bell state S(AB) = 0 < S(A) = 1, " +
        "which is why conditional entropy can be NEGATIVE",
    ],
    invariantCheck: "vonNeumannEntropy",
    dependsOn: ["density_matrix"],
  },
  {
    id: "coherence",
    label: "Coherence",
    definition: "Basis-dependent superposition, quantified by off-diagonal weight.",
    notation: "C_l1(rho) = sum_{i != j} |rho_ij|",
    constraints: ["C >= 0", "basis dependent"],
    invariants: ["zero exactly for a diagonal (classical) state"],
    examples: ["C = 1 for |+> in the Z basis"],
    counterexamples: [
      "treating it as basis-free — |+> has zero coherence in the X basis and one in the Z basis",
    ],
    invariantCheck: "l1Coherence",
    dependsOn: ["density_matrix"],
  },
];

export const CONCEPT_BY_ID: ReadonlyMap<string, QuantumConcept> = new Map(
  CONCEPTS.map((c) => [c.id, c] as const),
);

/** Every function a concept claims verifies it. Read by the test that resolves them. */
export function claimedInvariantChecks(): readonly string[] {
  return [
    ...new Set(CONCEPTS.map((c) => c.invariantCheck).filter((s): s is string => s !== null)),
  ].sort();
}
