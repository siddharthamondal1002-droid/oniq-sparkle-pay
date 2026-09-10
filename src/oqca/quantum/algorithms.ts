/**
 * ALGORITHM KNOWLEDGE — quantum brief §6.
 *
 * Eleven required fields per algorithm, and the last two are the ones that make
 * this useful rather than decorative: `classicalAlternative` and
 * `knownLimitations`. §16 forbids calling a quantum method superior when the
 * classical baseline was denied equivalent information, and §18's discovery
 * pipeline can only answer "classical preferred" if every entry SAYS what the
 * classical option is.
 *
 * **NO ENTRY CLAIMS AN ADVANTAGE WITHOUT NAMING ITS ASSUMPTION.** The oracle
 * separations (Deutsch-Jozsa, Bernstein-Vazirani, Simon) are exponential ONLY
 * in the query model against a deterministic classical machine — Deutsch-Jozsa
 * is easy for a randomised classical algorithm, and saying so is the honest
 * version of "exponential speedup". §7's rule for QML is applied to the whole
 * file: never store "quantum advantage" as a fact unless a specific benchmark
 * supports it.
 */

export type ComplexityClaim = {
  readonly quantum: string;
  readonly classical: string;
  /** What must hold for the comparison to mean anything. */
  readonly caveat: string;
};

export type AlgorithmSpec = {
  readonly id: string;
  readonly name: string;
  readonly problem: string;
  readonly input: string;
  readonly output: string;
  readonly circuitStructure: readonly string[];
  readonly complexity: ComplexityClaim;
  readonly assumptions: readonly string[];
  readonly qubitRequirements: string;
  readonly depthConsiderations: string;
  readonly noiseSensitivity: "low" | "moderate" | "high" | "extreme";
  readonly classicalAlternative: string;
  readonly knownLimitations: readonly string[];
  /** Can ONIQ's local simulator run a meaningful instance of it today? */
  readonly locallySimulable: boolean;
};

export const ALGORITHMS: readonly AlgorithmSpec[] = [
  {
    id: "deutsch",
    name: "Deutsch",
    problem: "Decide whether a one-bit function is constant or balanced.",
    input: "An oracle U_f for f: {0,1} -> {0,1}",
    output: "One bit: constant or balanced",
    circuitStructure: ["H on both qubits", "oracle U_f", "H on the query qubit", "measure"],
    complexity: {
      quantum: "1 query",
      classical: "2 queries",
      caveat: "a factor of two; it is a teaching example, not a useful speedup",
    },
    assumptions: [
      "the oracle is given as a reversible unitary",
      "f is promised constant or balanced",
    ],
    qubitRequirements: "2",
    depthConsiderations: "constant depth",
    noiseSensitivity: "low",
    classicalAlternative: "evaluate f(0) and f(1) — two calls",
    knownLimitations: ["solves no problem anyone has", "the promise does the real work"],
    locallySimulable: true,
  },
  {
    id: "deutsch_jozsa",
    name: "Deutsch-Jozsa",
    problem: "Decide whether an n-bit function is constant or balanced, given the promise.",
    input: "An oracle for f: {0,1}^n -> {0,1}",
    output: "constant or balanced, with certainty",
    circuitStructure: ["H^n", "oracle", "H^n", "measure all"],
    complexity: {
      quantum: "1 query",
      classical: "2^(n-1)+1 queries DETERMINISTICALLY",
      caveat:
        "against a RANDOMISED classical algorithm the gap collapses to O(1) queries for bounded " +
        "error. The 'exponential separation' is exact-vs-deterministic only",
    },
    assumptions: ["the promise holds", "oracle access is free"],
    qubitRequirements: "n + 1",
    depthConsiderations: "depth dominated by the oracle",
    noiseSensitivity: "moderate",
    classicalAlternative: "sample a few random inputs; wrong with exponentially small probability",
    knownLimitations: ["the promise is artificial", "no known practical application"],
    locallySimulable: true,
  },
  {
    id: "bernstein_vazirani",
    name: "Bernstein-Vazirani",
    problem: "Recover a hidden bit string s from f(x) = s.x mod 2.",
    input: "An oracle for the inner product with s",
    output: "s, exactly",
    circuitStructure: ["H^n", "oracle", "H^n", "measure"],
    complexity: {
      quantum: "1 query",
      classical: "n queries",
      caveat: "a linear, not exponential, separation — and it is tight",
    },
    assumptions: ["the oracle computes an inner product"],
    qubitRequirements: "n + 1",
    depthConsiderations: "constant beyond the oracle",
    noiseSensitivity: "moderate",
    classicalAlternative: "query the n unit vectors e_i to read s bit by bit",
    knownLimitations: ["contrived oracle", "no application outside teaching"],
    locallySimulable: true,
  },
  {
    id: "simon",
    name: "Simon",
    problem: "Find the hidden period s of a 2-to-1 function with f(x) = f(x XOR s).",
    input: "An oracle for f",
    output: "s",
    circuitStructure: ["H^n", "oracle", "H^n", "measure", "classical linear solve over GF(2)"],
    complexity: {
      quantum: "O(n) queries",
      classical: "Omega(2^(n/2)) queries even with randomness",
      caveat:
        "a genuine exponential separation for BOUNDED-ERROR classical algorithms — unlike " +
        "Deutsch-Jozsa. It is still an ORACLE result, not a statement about a concrete function",
    },
    assumptions: ["the 2-to-1 promise holds"],
    qubitRequirements: "2n",
    depthConsiderations: "repeated runs plus classical post-processing",
    noiseSensitivity: "high",
    classicalAlternative: "birthday-paradox collision search, exponential",
    knownLimitations: ["oracle model", "its importance is that it inspired Shor"],
    locallySimulable: true,
  },
  {
    id: "grover",
    name: "Grover search",
    problem: "Find a marked item in an unstructured set of N.",
    input: "An oracle marking solutions",
    output: "A marked item, with high probability",
    circuitStructure: [
      "uniform superposition",
      "repeat ~pi/4 sqrt(N/M): oracle then diffusion",
      "measure",
    ],
    complexity: {
      quantum: "O(sqrt(N)) queries",
      classical: "O(N) queries",
      caveat:
        "QUADRATIC, and provably optimal. The iteration count must be right: overshooting " +
        "rotates PAST the target and the success probability falls again",
    },
    assumptions: ["an efficient oracle exists", "the number of solutions is known or estimated"],
    qubitRequirements: "log2(N) plus oracle workspace",
    depthConsiderations: "depth grows as sqrt(N); this is what makes it hard without QEC",
    noiseSensitivity: "high",
    classicalAlternative: "linear scan, or a better classical algorithm if the set has structure",
    knownLimitations: [
      "quadratic only — it does not make NP-hard problems tractable",
      "the oracle must be built, and building it can cost more than the search saves",
      "no speedup when the data must first be loaded into a quantum memory",
    ],
    locallySimulable: true,
  },
  {
    id: "amplitude_amplification",
    name: "Amplitude amplification",
    problem: "Boost the success probability of any state-preparation procedure.",
    input: "A unitary A preparing a state with success amplitude a",
    output: "The good subspace, with high probability",
    circuitStructure: ["A", "repeat: reflect about good subspace, reflect about A|0>"],
    complexity: {
      quantum: "O(1/a) applications",
      classical: "O(1/a^2) repetitions",
      caveat: "the generalisation of Grover; the same quadratic factor",
    },
    assumptions: ["A is reversible", "the good subspace can be reflected about"],
    qubitRequirements: "as A requires",
    depthConsiderations: "depth multiplies by the iteration count",
    noiseSensitivity: "high",
    classicalAlternative: "repeat-until-success sampling",
    knownLimitations: ["needs a coherent reflection oracle", "quadratic ceiling"],
    locallySimulable: true,
  },
  {
    id: "qft",
    name: "Quantum Fourier transform",
    problem: "Apply the discrete Fourier transform to amplitudes.",
    input: "An n-qubit state",
    output: "Its Fourier transform, in the amplitudes",
    circuitStructure: ["for each qubit: H then controlled phase rotations", "reverse qubit order"],
    complexity: {
      quantum: "O(n^2) gates",
      classical: "O(N log N) = O(n 2^n) for the FFT",
      caveat:
        "THE SPEEDUP IS NOT USABLE ON ITS OWN. The result lives in amplitudes you cannot read " +
        "out; QFT is useful only INSIDE an algorithm that measures something coarse afterwards",
    },
    assumptions: ["the input state is already prepared"],
    qubitRequirements: "n",
    depthConsiderations: "O(n^2) rotations, many exponentially small and truncatable",
    noiseSensitivity: "high",
    classicalAlternative: "the FFT, which returns all amplitudes — something QFT never does",
    knownLimitations: [
      "output is not readable",
      "small rotations are below hardware precision and get dropped",
    ],
    locallySimulable: true,
  },
  {
    id: "phase_estimation",
    name: "Quantum phase estimation",
    problem: "Estimate the eigenvalue phase of a unitary given an eigenvector.",
    input: "Controlled-U powers and an eigenstate",
    output: "The phase, to m bits",
    circuitStructure: [
      "H^m on the counting register",
      "controlled-U^(2^k)",
      "inverse QFT",
      "measure",
    ],
    complexity: {
      quantum: "O(1/epsilon) applications of U for precision epsilon",
      classical: "problem dependent",
      caveat: "requires an EIGENSTATE; preparing one can be as hard as the original problem",
    },
    assumptions: [
      "an eigenstate is available or has good overlap",
      "controlled-U is implementable",
    ],
    qubitRequirements: "m counting + the system register",
    depthConsiderations: "controlled-U^(2^k) makes depth grow exponentially in the precision bits",
    noiseSensitivity: "extreme",
    classicalAlternative:
      "classical eigensolvers, which are excellent for the sizes we can simulate",
    knownLimitations: [
      "the deepest common primitive; effectively needs fault tolerance",
      "eigenstate preparation is the hidden cost",
    ],
    locallySimulable: true,
  },
  {
    id: "shor",
    name: "Shor factoring",
    problem: "Factor an integer N.",
    input: "N",
    output: "A non-trivial factor",
    circuitStructure: [
      "modular exponentiation",
      "inverse QFT",
      "measure",
      "classical continued fractions",
    ],
    complexity: {
      quantum: "polynomial in log N",
      classical: "sub-exponential (general number field sieve)",
      caveat:
        "SUPER-POLYNOMIAL, NOT PROVEN EXPONENTIAL: no proof exists that factoring is classically " +
        "hard. The advantage is against the best KNOWN classical algorithm",
    },
    assumptions: ["fault tolerance", "efficient modular arithmetic in superposition"],
    qubitRequirements: "thousands of LOGICAL qubits; millions of physical ones under current codes",
    depthConsiderations: "modular exponentiation dominates and is very deep",
    noiseSensitivity: "extreme",
    classicalAlternative: "GNFS — entirely practical for the sizes any current device can attempt",
    knownLimitations: [
      "far beyond present hardware",
      "period finding is the quantum part; the rest is classical",
    ],
    locallySimulable: false,
  },
  {
    id: "quantum_walks",
    name: "Quantum walks",
    problem: "Traverse a graph with quantum interference between paths.",
    input: "A graph and a coin/shift operator",
    output: "A distribution over vertices, or a hitting time",
    circuitStructure: ["coin operator", "shift operator", "repeat", "measure"],
    complexity: {
      quantum: "quadratically faster hitting times on some graphs",
      classical: "classical random walk",
      caveat: "the speedup is graph dependent, not universal",
    },
    assumptions: ["the graph structure is implementable as a unitary"],
    qubitRequirements: "log2(vertices) plus a coin register",
    depthConsiderations: "depth grows linearly with the number of steps",
    noiseSensitivity: "high",
    classicalAlternative: "a classical random walk, often adequate",
    knownLimitations: ["ballistic spreading needs coherence for the whole walk"],
    locallySimulable: true,
  },
  {
    id: "hamiltonian_simulation",
    name: "Hamiltonian simulation",
    problem: "Approximate e^{-iHt} for a physical Hamiltonian.",
    input: "H as a sum of terms, and a time t",
    output: "The evolved state",
    circuitStructure: ["Trotter-Suzuki product formulas, or qubitisation/LCU"],
    complexity: {
      quantum: "near-linear in t for sparse H",
      classical:
        "exponential in general, but tensor networks do very well on low-entanglement cases",
      caveat: "THE most credible near-term advantage claim — and the classical bar keeps rising",
    },
    assumptions: ["H is local or sparse", "term decomposition is known"],
    qubitRequirements: "one qubit per mode or spin",
    depthConsiderations: "Trotter error trades against step count; deeper is more accurate",
    noiseSensitivity: "high",
    classicalAlternative: "DMRG/MPS for 1D, quantum Monte Carlo where there is no sign problem",
    knownLimitations: [
      "Trotter error must be bounded",
      "measurement of observables costs many shots",
    ],
    locallySimulable: true,
  },
  {
    id: "quantum_simulation",
    name: "Digital quantum simulation",
    problem: "Simulate a quantum system's statics or dynamics on a gate-based device.",
    input: "A model Hamiltonian and an observable",
    output: "Expectation values",
    circuitStructure: ["state preparation", "evolution", "measurement of observables"],
    complexity: {
      quantum: "polynomial for local Hamiltonians",
      classical: "exponential in the worst case",
      caveat: "worst case only; many physically interesting cases are classically tractable",
    },
    assumptions: ["the model is the right model — a physics question, not a computing one"],
    qubitRequirements: "system size dependent",
    depthConsiderations: "the main constraint on present hardware",
    noiseSensitivity: "high",
    classicalAlternative: "tensor networks, quantum Monte Carlo, mean-field methods",
    knownLimitations: ["readout cost", "the classical competition is strong and improving"],
    locallySimulable: true,
  },
  {
    id: "vqe",
    name: "Variational quantum eigensolver",
    problem: "Estimate a Hamiltonian's ground-state energy.",
    input: "A qubit Hamiltonian and a parameterised ansatz",
    output: "An energy estimate and the optimal parameters",
    circuitStructure: [
      "parameterised ansatz",
      "measure Pauli terms",
      "classical optimiser",
      "repeat",
    ],
    complexity: {
      quantum: "shallow circuits, MANY measurements",
      classical: "CCSD(T), DMRG, and other methods that are extremely strong",
      caveat: "NO PROVEN ADVANTAGE. Measurement cost scales badly with the number of Pauli terms",
    },
    assumptions: ["the ansatz can express the ground state", "the optimiser converges"],
    qubitRequirements: "one qubit per spin orbital under Jordan-Wigner",
    depthConsiderations: "deliberately shallow — that is the point of the design",
    noiseSensitivity: "moderate",
    classicalAlternative: "coupled cluster, DMRG, quantum Monte Carlo",
    knownLimitations: [
      "barren plateaus as width grows",
      "shot noise dominates the total run time",
      "the variational principle bounds the energy but does not certify the state",
    ],
    locallySimulable: true,
  },
  {
    id: "qaoa",
    name: "Quantum approximate optimization algorithm",
    problem: "Approximate a solution to a combinatorial optimisation problem.",
    input: "A cost Hamiltonian and depth p",
    output: "A bit string with a good cost value",
    circuitStructure: [
      "alternate cost and mixer unitaries p times",
      "measure",
      "classical outer loop",
    ],
    complexity: {
      quantum: "depth grows with p",
      classical: "Goemans-Williamson achieves 0.878 for MaxCut and runs on a laptop",
      caveat:
        "NO ADVANTAGE DEMONSTRATED. At low p, QAOA is beaten by classical heuristics on the " +
        "problems it is usually benchmarked against",
    },
    assumptions: ["the cost function maps to a diagonal Hamiltonian"],
    qubitRequirements: "one qubit per binary variable",
    depthConsiderations: "quality improves with p; so does noise",
    noiseSensitivity: "moderate",
    classicalAlternative: "simulated annealing, tabu search, Goemans-Williamson, or a MILP solver",
    knownLimitations: [
      "parameter optimisation is itself hard",
      "no performance guarantee at fixed p",
    ],
    locallySimulable: true,
  },
  {
    id: "quantum_annealing",
    name: "Quantum annealing",
    problem: "Find a low-energy configuration of an Ising model.",
    input: "An Ising Hamiltonian with couplings and fields",
    output: "A low-energy spin configuration",
    circuitStructure: [
      "ANALOG: slowly interpolate from a transverse field to the problem Hamiltonian",
    ],
    complexity: {
      quantum: "runtime depends on the minimum spectral gap, which is generally unknown",
      classical: "simulated annealing and parallel tempering are strong baselines",
      caveat: "a DIFFERENT computational model — not gate-based, and not universal",
    },
    assumptions: ["adiabaticity", "the problem embeds in the hardware graph"],
    qubitRequirements: "one physical qubit per spin, plus a large embedding overhead",
    depthConsiderations: "not applicable; the control is an annealing schedule",
    noiseSensitivity: "moderate",
    classicalAlternative: "simulated annealing, parallel tempering, specialised Ising solvers",
    knownLimitations: [
      "no general speedup has been demonstrated",
      "minor-embedding overhead can be quadratic in the number of variables",
    ],
    locallySimulable: false,
  },
  {
    id: "qsp",
    name: "Quantum signal processing",
    problem: "Apply a polynomial transformation to the eigenvalues of a unitary.",
    input: "A unitary and a sequence of phase angles",
    output: "A polynomial in the signal, encoded in a block",
    circuitStructure: ["interleave signal operators with single-qubit rotations"],
    complexity: {
      quantum: "circuit length equals the polynomial degree",
      classical: "not directly comparable",
      caveat: "a PRIMITIVE, not a standalone algorithm",
    },
    assumptions: ["the polynomial satisfies parity and boundedness conditions"],
    qubitRequirements: "one ancilla plus the system",
    depthConsiderations: "linear in the degree",
    noiseSensitivity: "extreme",
    classicalAlternative: "classical polynomial approximation of a matrix function",
    knownLimitations: ["finding the phase angles is numerically delicate at high degree"],
    locallySimulable: true,
  },
  {
    id: "qsvt",
    name: "Quantum singular value transformation",
    problem: "Apply a polynomial to the singular values of a block-encoded matrix.",
    input: "A block encoding and phase angles",
    output: "A block encoding of the transformed matrix",
    circuitStructure: ["alternate the block encoding with projector-controlled phase rotations"],
    complexity: {
      quantum: "degree-many applications of the block encoding",
      classical: "depends on the matrix",
      caveat:
        "unifies search, simulation and linear systems in one framework — its importance is " +
        "conceptual as much as practical",
    },
    assumptions: ["an efficient block encoding EXISTS, which is the usual sticking point"],
    qubitRequirements: "ancillas for the block encoding plus the system",
    depthConsiderations: "deep; fault tolerance assumed",
    noiseSensitivity: "extreme",
    classicalAlternative: "classical matrix function methods; randomised linear algebra",
    knownLimitations: [
      "block encoding cost is usually where the advantage is lost",
      "dequantisation results have removed the speedup for several low-rank cases",
    ],
    locallySimulable: false,
  },
  {
    id: "lcu",
    name: "Linear combination of unitaries",
    problem: "Implement a weighted sum of unitaries as a quantum operation.",
    input: "Unitaries U_i with coefficients c_i",
    output: "A block encoding of sum c_i U_i, heralded on an ancilla",
    circuitStructure: [
      "PREPARE the coefficient state",
      "SELECT the controlled unitaries",
      "PREPARE-dagger",
    ],
    complexity: {
      quantum: "success probability ~ 1/(sum |c_i|)^2 without amplification",
      classical: "not applicable",
      caveat: "PROBABILISTIC — it is heralded, and the herald can fail",
    },
    assumptions: ["each U_i is implementable", "coefficients can be prepared"],
    qubitRequirements: "log2(number of terms) ancillas plus the system",
    depthConsiderations: "SELECT dominates and grows with the term count",
    noiseSensitivity: "extreme",
    classicalAlternative: "not applicable — it is a quantum construction",
    knownLimitations: ["the 1-norm of the coefficients drives the cost"],
    locallySimulable: true,
  },
];

export const ALGORITHM_BY_ID: ReadonlyMap<string, AlgorithmSpec> = new Map(
  ALGORITHMS.map((a) => [a.id, a] as const),
);

/**
 * §18's applicability question, answered from the specs rather than by a model.
 * Deliberately CONSERVATIVE: an algorithm with an unresolved assumption is
 * "experimentally uncertain", never "recommended".
 */
export function applicability(
  a: AlgorithmSpec,
  availableQubits: number,
  faultTolerant: boolean,
): string {
  if (a.noiseSensitivity === "extreme" && !faultTolerant) {
    return "not applicable: needs fault tolerance that is not available";
  }
  if (!a.locallySimulable && availableQubits < 50) {
    return "not applicable: beyond both this simulator and the stated hardware";
  }
  if (
    a.complexity.caveat.toUpperCase().includes("NO ADVANTAGE") ||
    a.complexity.caveat.toUpperCase().includes("NO PROVEN ADVANTAGE")
  ) {
    return "classical preferred: no advantage has been demonstrated for this method";
  }
  return "quantum candidate: simulable here, with the assumptions stated";
}
