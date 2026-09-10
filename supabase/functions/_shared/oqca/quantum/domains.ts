/**
 * DOMAIN KNOWLEDGE — quantum brief §7 (QML), §9 (noise), §10 (QEC),
 * §11 (compilation), §12 (ZX), §13 (tensor networks, hardware) and §14
 * (open systems / chemistry).
 *
 * `concepts.ts` holds the mathematical objects and `algorithms.ts` the
 * procedures. This file holds the SUBFIELDS — the parts of quantum computing
 * that are bodies of practice rather than single objects, and where the honest
 * answer is usually "represented, partly implemented, mostly not".
 *
 * THE TWO FIELDS THAT MAKE IT KNOWLEDGE RATHER THAN A BROCHURE are
 * `implementedHere` and `notImplemented`. §27 forbids claiming ONIQ has "all
 * quantum computing knowledge" and requires the report to say exactly what was
 * incorporated and what remains outstanding — so every domain carries its own
 * gap list, and `domains.test.ts` resolves every name in `implementedHere`
 * against the real exports. A domain claiming an implementation nothing exports
 * fails the build; a domain with an empty `notImplemented` fails it too,
 * because no subfield here is finished.
 *
 * AND `advantageClaims` IS ALLOWED TO BE EMPTY AND USUALLY IS. §7: "Never store
 * 'quantum advantage' as a fact unless supported by a specific benchmark." Each
 * entry must name the benchmark; `domains.test.ts` refuses one that does not.
 */
import { QUANTUM_SOURCES } from "./sources.ts";

export type DomainConstruct = {
  readonly name: string;
  readonly definition: string;
  /** Where the construct's meaning is fixed. Free text; never parsed. */
  readonly notation: string;
};

export type AdvantageClaim = {
  readonly claim: string;
  /** The specific benchmark. §7 refuses the claim without it. */
  readonly benchmark: string;
  /** What the benchmark does NOT establish. */
  readonly limits: string;
};

export type DomainKnowledge = {
  readonly id: string;
  readonly label: string;
  /** The brief section this domain answers. */
  readonly briefSection: string;
  readonly summary: string;
  readonly constructs: readonly DomainConstruct[];
  readonly invariants: readonly string[];
  /** Exported symbols in this repo that realise part of this domain. */
  readonly implementedHere: readonly string[];
  /** §27's outstanding list, per domain. Never empty. */
  readonly notImplemented: readonly string[];
  /** Registered source ids this knowledge is attributed to. */
  readonly sourceIds: readonly string[];
  readonly pitfalls: readonly string[];
  readonly advantageClaims: readonly AdvantageClaim[];
};

export const DOMAINS: readonly DomainKnowledge[] = [
  {
    id: "qml",
    label: "Quantum machine learning",
    briefSection: "§7",
    summary:
      "Parameterised quantum circuits trained by a classical optimiser against a measured cost function. The circuit is a model; the training loop is entirely classical.",
    constructs: [
      {
        name: "Parameterised quantum circuit (ansatz)",
        definition:
          "A circuit whose gates carry free real parameters, applied to a fixed initial state.",
        notation: "U(theta)|0>^n, theta in R^p",
      },
      {
        name: "Feature map / data encoding",
        definition:
          "A circuit that writes classical data into a quantum state. Angle, amplitude and basis encodings differ in qubit cost and in what a kernel then measures.",
        notation: "|phi(x)> = S(x)|0>^n",
      },
      {
        name: "Quantum kernel",
        definition:
          "k(x,y) = |<phi(x)|phi(y)>|^2, estimated by sampling; fed to a classical kernel method.",
        notation: "k: X x X -> [0,1]",
      },
      {
        name: "Parameter-shift rule",
        definition:
          "An exact gradient of an expectation value with respect to a rotation angle, obtained from two circuit evaluations at shifted parameters rather than by finite differences.",
        notation: "d<H>/dtheta = (<H>_{theta+pi/2} - <H>_{theta-pi/2}) / 2",
      },
      {
        name: "Barren plateau",
        definition:
          "The concentration of the cost gradient towards zero, exponentially in qubit count, for sufficiently expressive random ansatze — so training stalls before it begins.",
        notation: "Var[d C/d theta] ~ 2^{-n}",
      },
    ],
    invariants: [
      "the parameter-shift rule is exact only for gates whose generator has two distinct eigenvalues (a rotation), not for arbitrary unitaries",
      "an expectation value is estimated from finite shots, so every gradient carries shot noise of order 1/sqrt(shots)",
      "a quantum kernel is a positive semidefinite Gram matrix up to sampling error",
    ],
    implementedHere: [
      "rx",
      "ry",
      "rz",
      "expectation",
      "circuit",
      "circuitUnitary",
      "isPositiveSemidefinite",
    ],
    notImplemented: [
      "no optimiser, no training loop, no autodiff — the parameter-shift rule is described and not coded",
      "no dataset, no benchmark harness, and therefore no measured QML result of any kind",
      "no barren-plateau diagnostic; the variance scaling is stated, not measured here",
    ],
    sourceIds: ["pennylane", "tensorflow-quantum", "qiskit"],
    pitfalls: [
      "reporting a training-set fit as an advantage: the classical baseline must see the same data and the same feature map, which §16 requires and most published comparisons do not do",
      "amplitude encoding looks cheap in qubits and is expensive in DEPTH — the state-preparation circuit is the cost, and it is usually left out of the quoted complexity",
      "a simulator's exact expectation is not what hardware returns; a QML result with no shot noise is a result about linear algebra",
    ],
    advantageClaims: [],
  },
  {
    id: "noise",
    label: "Noise and error models",
    briefSection: "§9",
    summary:
      "Real devices apply completely positive trace-preserving maps rather than unitaries. A noise model is a set of such channels attached to gates, idle periods and measurement.",
    constructs: [
      {
        name: "Kraus representation",
        definition:
          "A channel written as E(rho) = sum_k K_k rho K_k^dagger with sum_k K_k^dagger K_k = I.",
        notation: "{K_k}",
      },
      {
        name: "Depolarizing channel",
        definition:
          "With probability p the state is replaced by the maximally mixed state; otherwise it is untouched.",
        notation: "E(rho) = (1-p) rho + p I/2",
      },
      {
        name: "Amplitude damping",
        definition: "Energy loss towards |0>, parameterised by gamma; the T1 process.",
        notation: "K0 = [[1,0],[0,sqrt(1-g)]], K1 = [[0,sqrt(g)],[0,0]]",
      },
      {
        name: "Phase damping",
        definition: "Loss of coherence with no energy exchange; the T2 (pure dephasing) process.",
        notation: "K0 = [[1,0],[0,sqrt(1-g)]], K1 = [[0,0],[0,sqrt(g)]]",
      },
      {
        name: "Readout (measurement) error",
        definition:
          "A classical confusion matrix applied to the measured bit, distinct from any quantum channel on the state.",
        notation: "P(read 1 | is 0) = p01",
      },
    ],
    invariants: [
      "every channel is trace preserving: sum_k K_k^dagger K_k = I",
      "every channel is completely positive, which the Choi matrix being PSD certifies",
      "depolarizing at p = 1 returns exactly the maximally mixed state, and at p = 0 the identity",
      "readout error is CLASSICAL: it acts on the outcome distribution, never on the density matrix",
    ],
    implementedHere: [
      "depolarizing",
      "bitFlip",
      "phaseFlip",
      "bitPhaseFlip",
      "amplitudeDamping",
      "phaseDamping",
      "thermalDamping",
      "coherentError",
      "readoutNoise",
      "applyReadout",
      "isCPTP",
      "isTracePreserving",
      "applyChannel",
      "composeChannels",
      "onQubitChannel",
    ],
    notImplemented: [
      "no device calibration data: T1, T2 and per-gate error rates for a real backend are not carried anywhere",
      "no crosstalk or correlated (non-Markovian) noise; every channel here acts on one qubit independently",
      "no error mitigation — zero-noise extrapolation and probabilistic error cancellation are Mitiq's subject and Mitiq is GPL-3.0, so nothing was taken from it",
    ],
    sourceIds: ["qiskit-aer", "qutip", "cirq", "mitiq"],
    pitfalls: [
      "the single-qubit depolarizing parameter has TWO conventions in the wild and they differ by 4/3 — see DIVERGENCES; quoting an error rate without saying which is an unusable number",
      "composing per-gate channels and calling the result a device model ignores idling, which is where most of the decoherence happens on a real machine",
      "readout error corrected by inverting the confusion matrix can produce negative probabilities; that is a symptom of the method, not of the data",
    ],
    advantageClaims: [],
  },
  {
    id: "qec",
    label: "Quantum error correction",
    briefSection: "§10",
    summary:
      "Encoding a logical qubit into many physical ones so that errors move the state into a detectable subspace, measured by stabilizers without measuring the logical information.",
    constructs: [
      {
        name: "Stabilizer group",
        definition:
          "An abelian subgroup of the Pauli group not containing -I; the code space is its simultaneous +1 eigenspace.",
        notation: "S <= P_n, -I not in S",
      },
      {
        name: "Syndrome",
        definition:
          "The measured eigenvalues of the stabilizer generators. It identifies an error class, never the encoded state.",
        notation: "s in {0,1}^{n-k}",
      },
      {
        name: "Code distance",
        definition:
          "The minimum weight of a logical operator; a distance-d code corrects floor((d-1)/2) arbitrary single-qubit errors.",
        notation: "[[n, k, d]]",
      },
      {
        name: "Surface code",
        definition:
          "A topological stabilizer code on a 2D lattice with local checks, whose threshold and locality make it the leading hardware candidate.",
        notation: "d x d lattice, distance d",
      },
      {
        name: "Threshold theorem",
        definition:
          "Below a physical error rate threshold, logical error falls exponentially with distance, so arbitrary computation is possible with polylogarithmic overhead.",
        notation: "p < p_th",
      },
    ],
    invariants: [
      "stabilizer generators commute pairwise, or the syndrome is not simultaneously measurable",
      "a syndrome measurement must reveal nothing about the logical state — otherwise it collapses it",
      "correcting an error and applying a logical operator are indistinguishable from the syndrome alone; the decoder chooses a coset representative",
      "an [[n,k,d]] code encodes k logical qubits in n physical ones and no fewer",
    ],
    implementedHere: [],
    notImplemented: [
      "NOTHING. No code is constructed, no stabilizer is represented, no syndrome is extracted and no decoder exists",
      "the state vector here is a flat 2^n amplitude list with no factorisation, so there is no code space to project onto — the same reason `cognitive.entangle` is category C",
      "Stim's stabilizer simulator is the right tool for this and was not vendored: it is a large C++ surface and its Python package is not a dependency ONIQ may add",
    ],
    sourceIds: ["stim", "qiskit", "qualtran"],
    pitfalls: [
      "quoting a code's distance as its error-correcting power without the floor((d-1)/2): a distance-3 code DETECTS two errors and CORRECTS one",
      "a threshold is a property of a code, a noise model and a decoder together; a number quoted without all three is not comparable to any other number",
      "simulating a surface code on a state vector is not merely slow, it is the wrong representation — stabilizer simulation is polynomial, state vectors are exponential",
    ],
    advantageClaims: [],
  },
  {
    id: "compilation",
    label: "Compilation and transpilation",
    briefSection: "§11",
    summary:
      "Rewriting an abstract circuit into one a specific device can execute: decomposing into a native gate set, mapping logical to physical qubits, routing two-qubit gates onto the coupling graph, and optimising what results.",
    constructs: [
      {
        name: "Native gate set",
        definition:
          "The gates a device actually implements; everything else must be decomposed into them.",
        notation: "e.g. {rz, sx, x, cx} or {rz, ry, cz}",
      },
      {
        name: "Coupling map",
        definition: "The graph of qubit pairs on which a two-qubit gate can be applied directly.",
        notation: "G = (V, E)",
      },
      {
        name: "Routing / SWAP insertion",
        definition:
          "Inserting SWAP gates so that every two-qubit gate acts on adjacent physical qubits.",
        notation: "3 CX per SWAP",
      },
      {
        name: "Unitary synthesis",
        definition:
          "Producing a circuit that implements a given unitary to a stated fidelity, exactly or approximately.",
        notation: "||U - V(theta)|| <= eps",
      },
      {
        name: "Solovay-Kitaev",
        definition:
          "Approximating any single-qubit unitary to accuracy eps with O(log^c(1/eps)) gates from a discrete universal set.",
        notation: "c ~ 3.97 in the original analysis",
      },
    ],
    invariants: [
      "a correct compilation preserves the circuit's unitary up to a global phase, and global phase alone is not observable",
      "routing can only increase two-qubit count and depth; it never decreases them",
      "a SWAP costs three CX on a CX-native device, so a routing decision is a two-qubit-count decision",
      "optimisation that changes the measured distribution is not optimisation",
    ],
    implementedHere: [
      "circuitUnitary",
      "depth",
      "twoQubitCount",
      "tCount",
      "gateCount",
      "controlled",
      "approxEqual",
    ],
    notImplemented: [
      "no transpiler: no gate-set decomposition, no qubit placement, no routing pass and no peephole optimiser",
      "no Solovay-Kitaev and no approximate synthesis — BQSKit's subject, not vendored",
      "the circuit metrics here MEASURE a circuit; nothing rewrites one",
    ],
    sourceIds: ["qiskit", "pytket", "bqskit", "cirq"],
    pitfalls: [
      "comparing gate counts across ecosystems without fixing the gate set: a count in {rz,sx,cx} and a count in {u,cz} are different quantities",
      "T-count matters for fault tolerance and is nearly irrelevant on today's noisy hardware, where two-qubit count and depth dominate; quoting the wrong one answers a different question",
      "a global phase difference is not an error, and an equality check that rejects it will reject every correct synthesis",
    ],
    advantageClaims: [],
  },
  {
    id: "zx",
    label: "ZX calculus",
    briefSection: "§12",
    summary:
      "A graphical language for qubit computation: circuits become diagrams of Z and X spiders, and a complete set of rewrite rules simplifies them. Its value is in optimisation and equality checking, not in execution.",
    constructs: [
      {
        name: "Spider",
        definition:
          "A generator with any number of inputs and outputs, in the Z (green) or X (red) basis, carrying a phase.",
        notation: "Z(alpha), X(alpha)",
      },
      {
        name: "Spider fusion",
        definition:
          "Two connected spiders of the same colour merge, adding their phases. The workhorse rewrite.",
        notation: "Z(a) - Z(b) => Z(a+b)",
      },
      {
        name: "Hadamard edge",
        definition:
          "H represented as an edge decoration rather than a node, which is what makes graph-like form usable.",
        notation: "dashed edge",
      },
      {
        name: "Graph-like form / local complementation",
        definition:
          "A normal form of only Z spiders and Hadamard edges, on which local complementation and pivoting remove spiders.",
        notation: "G, local comp at v",
      },
      {
        name: "Completeness",
        definition:
          "The rule set is complete for stabilizer quantum mechanics: any two diagrams denoting the same map can be rewritten into one another.",
        notation: "|- D1 = D2 iff [[D1]] = [[D2]]",
      },
    ],
    invariants: [
      "a rewrite preserves the diagram's denotation up to a scalar; scalars must be tracked or the final normalisation is wrong",
      "colour change is conjugation by Hadamard, so any rule stated for Z has an X mirror",
      "T-count reduction by phase-gadget resynthesis preserves the unitary, which is the property that makes it an optimisation and not an approximation",
    ],
    implementedHere: [],
    notImplemented: [
      "NOTHING. No diagram type, no rewrite engine and no extraction back to a circuit",
      "circuit extraction from a simplified graph-like diagram is the genuinely hard half and is #P-hard in general — a fact worth carrying before anyone starts",
      "PyZX is the reference implementation and was not vendored; §2 prefers an independent ONIQ representation, and none has been written",
    ],
    sourceIds: ["pyzx", "pytket"],
    pitfalls: [
      "treating ZX as a simulator: a diagram denotes a linear map, and evaluating it is as hard as the map",
      "dropping scalars because 'phase is unobservable' — global phase is unobservable, but a scalar factor changes the amplitude of a POSTSELECTED branch",
      "assuming completeness for all of quantum mechanics; the classic completeness result is for the stabilizer fragment, with later extensions",
    ],
    advantageClaims: [],
  },
  {
    id: "tensor_networks",
    label: "Tensor networks",
    briefSection: "§13",
    summary:
      "Representing a many-body state as a contracted network of small tensors. The cost is set by entanglement (bond dimension) rather than by qubit count, so lowly-entangled 100-qubit circuits are simulable and highly-entangled 40-qubit ones are not.",
    constructs: [
      {
        name: "Matrix product state (MPS)",
        definition:
          "A 1D chain of rank-3 tensors whose contraction gives the amplitude of a basis state.",
        notation: "A^{s1} A^{s2} ... A^{sn}",
      },
      {
        name: "Bond dimension",
        definition:
          "The size of the index joining neighbouring tensors; it upper-bounds the entanglement across that cut.",
        notation: "chi, S <= log2(chi)",
      },
      {
        name: "Contraction order",
        definition:
          "The sequence in which indices are summed. It sets the cost, and finding the optimal order is NP-hard.",
        notation: "a tree over the network",
      },
      {
        name: "Truncation",
        definition:
          "Discarding the smallest Schmidt coefficients at a bond to cap chi, which makes the simulation approximate by a controlled amount.",
        notation: "keep chi largest singular values",
      },
    ],
    invariants: [
      "an MPS with chi >= 2^{n/2} can represent any state, so 'MPS' alone is not a compression claim",
      "the entanglement entropy across a cut is bounded by log2 of the bond dimension at that cut — that is the whole reason the method works",
      "truncation error is knowable: it is the discarded weight, and a simulation reporting no truncation error is either exact or not reporting",
    ],
    implementedHere: [
      "entanglementEntropy",
      "partialTrace",
      "spectrum",
      "vonNeumannEntropy",
      "kron",
    ],
    notImplemented: [
      "no MPS type, no SVD, no truncation and no contraction. The v1.1 COGNITIVE tensor seam (`src/oqca/backends/tensor.ts`) reshapes an amplitude list and its `contract()` throws `BackendUnavailable` — it is not a quantum tensor-network implementation and is deliberately not claimed as one",
      "no contraction-order search; quimb and cotengra are that subject and neither is a dependency",
      "the entropy machinery here works on a full density matrix, which is exactly the object a tensor network exists to avoid building",
    ],
    sourceIds: ["quimb", "qsimcirq", "qulacs"],
    pitfalls: [
      "quoting a qubit count as a simulation capability: 'we simulated 100 qubits' says nothing without the circuit's entanglement and the bond dimension used",
      "an approximate tensor-network result compared against an exact state-vector result is a comparison of two different computations, and the truncation must be stated for it to mean anything",
      "the SVD that truncates is the numerically delicate step; a naive implementation loses orthogonality and the error becomes unbounded rather than controlled",
    ],
    advantageClaims: [],
  },
  {
    id: "chemistry",
    label: "Quantum chemistry and simulation",
    briefSection: "§14",
    summary:
      "Mapping an electronic-structure problem onto qubits: a molecular Hamiltonian in second quantisation, transformed to Pauli operators, whose ground-state energy is then estimated variationally or by phase estimation.",
    constructs: [
      {
        name: "Second quantisation",
        definition:
          "The Hamiltonian written in fermionic creation and annihilation operators over a chosen basis set.",
        notation: "H = sum h_pq a_p^dag a_q + 1/2 sum h_pqrs a_p^dag a_q^dag a_r a_s",
      },
      {
        name: "Jordan-Wigner transform",
        definition:
          "A fermion-to-qubit map that enforces antisymmetry with a string of Z operators, giving locally simple terms with non-local strings.",
        notation: "a_j -> (prod_{k<j} Z_k) (X_j + iY_j)/2",
      },
      {
        name: "Bravyi-Kitaev transform",
        definition:
          "An alternative map with O(log n) operator weight, trading the Jordan-Wigner string for a more complex encoding.",
        notation: "weight O(log n)",
      },
      {
        name: "Trotterisation",
        definition:
          "Approximating exp(-iHt) for a sum of non-commuting terms by a product of short exponentials, with error controlled by step size and order.",
        notation: "(prod_j e^{-i H_j t/r})^r",
      },
      {
        name: "UCCSD ansatz",
        definition:
          "A chemically motivated variational ansatz from singles and doubles excitations of a reference determinant.",
        notation: "|psi> = e^{T - T^dag}|HF>",
      },
    ],
    invariants: [
      "the fermionic map must preserve anticommutation: {a_p, a_q^dag} = delta_pq, and a map that does not is not a fermionic encoding",
      "particle number is conserved by the electronic Hamiltonian, so a state leaving that sector is a bug and not a result",
      "the variational principle bounds from ABOVE: a VQE energy is an upper bound on the ground state, so a lower number is better and a lower-than-exact number means an error somewhere",
      "Trotter error is a function of the commutators of the terms, not merely of the step count",
    ],
    implementedHere: ["expectation", "eigenvaluesHermitian", "isHermitian", "densityFromState"],
    notImplemented: [
      "no Hamiltonian construction, no basis set, no integrals, no fermionic operator type and no qubit mapping",
      "no VQE and no Trotter product formula; `eigenvaluesHermitian` diagonalises a matrix somebody else built",
      "OpenFermion is the reference for the mapping layer and was not vendored — this is knowledge, not a chemistry package",
    ],
    sourceIds: ["openfermion", "qiskit", "recirq"],
    pitfalls: [
      "reporting a VQE energy without the basis set and active space: the same molecule at different bases is a different number, and neither is 'the' energy",
      "comparing against an exact diagonalisation of the SAME truncated Hamiltonian and calling the agreement chemical accuracy — it is agreement about the model, not about the molecule",
      "measuring a Jordan-Wigner Hamiltonian term by term ignores that the number of Pauli terms grows as O(n^4), which is where the shot budget goes",
    ],
    advantageClaims: [],
  },
  {
    id: "hardware",
    label: "Hardware abstractions",
    briefSection: "§13",
    summary:
      "What a physical device exposes to a compiler: a qubit topology, a native gate set with per-gate durations and fidelities, coherence times, and a measurement model. ONIQ has none of these and holds no vendor credential.",
    constructs: [
      {
        name: "Topology",
        definition: "The coupling graph — heavy-hex, square lattice, all-to-all on trapped ions.",
        notation: "G = (V, E)",
      },
      {
        name: "Coherence times",
        definition:
          "T1 (energy relaxation) and T2 (dephasing); the circuit's wall-clock duration must be well under them.",
        notation: "T1, T2, T2 <= 2 T1",
      },
      {
        name: "Gate fidelity",
        definition:
          "A scalar summary of how close a realised gate is to its ideal, per gate and per qubit pair.",
        notation: "F, or error 1 - F",
      },
      {
        name: "Shots",
        definition:
          "Repetitions of prepare-and-measure. Every device answer is a sample, so a statistic has an error bar of order 1/sqrt(shots).",
        notation: "N",
      },
    ],
    invariants: [
      "T2 <= 2 T1 always; a device sheet violating it is misreported",
      "a circuit's executable depth is bounded by coherence divided by gate duration, not by any abstract gate count",
      "an all-to-all connectivity claim means no routing overhead, which changes the compiled two-qubit count and therefore every comparison",
    ],
    implementedHere: [
      "QPUBackend",
      "ADAPTERS",
      "checkRemote",
      "DEFAULT_QUANTUM_POLICY",
      "REFUSAL_TEXT",
    ],
    notImplemented: [
      "NO DEVICE IS REACHABLE AND NONE MAY BE: §21 fixes `remoteQuantumExecution = false` and `maxQuantumCostUsd = 0`, and `QPUBackend` refuses on the policy before it looks at anything else",
      "no calibration ingest, no vendor SDK, no credential and no queue",
      "the adapters are refusal stubs that name what they would need; none of them executes",
    ],
    sourceIds: ["qiskit", "cirq", "pytket"],
    pitfalls: [
      "reading a vendor's headline qubit count as usable width — the coupling graph and the two-qubit fidelity decide what fits",
      "quoting a 'quantum volume' or similar single number across vendors: it folds topology, fidelity and compiler quality together and is not decomposable",
      "assuming a simulator result transfers: the simulator has no T1, no readout error and no routing, and those three account for most of the gap",
    ],
    advantageClaims: [],
  },
];

export const DOMAIN_BY_ID: ReadonlyMap<string, DomainKnowledge> = new Map(
  DOMAINS.map((d) => [d.id, d]),
);

/**
 * §23 — "Where two libraries disagree, preserve both implementations and
 * explicitly record the difference. Never silently normalize conflicting
 * semantics."
 *
 * These are the disagreements ONIQ actually meets, not a survey. Each names
 * ONIQ's own choice and says what a reader must convert before comparing.
 * `oniqConvention` is the code's behaviour and `divergentFrom` the ecosystem's;
 * `knowledge.ts` ingests each of these as a CONTESTED assertion so the loop can
 * never read one side as settled.
 */
export type SemanticDivergence = {
  readonly id: string;
  readonly topic: string;
  readonly oniqConvention: string;
  readonly divergentFrom: readonly string[];
  readonly theirConvention: string;
  /** What breaks if the two are silently identified. */
  readonly consequence: string;
  /** How to move a value from one convention to the other. */
  readonly conversion: string;
};

export const DIVERGENCES: readonly SemanticDivergence[] = [
  {
    id: "qubit_endianness",
    topic: "Qubit ordering in the tensor product",
    oniqConvention:
      "big-endian: kron(A, B) puts qubit 0 (A) on the MOST significant index, so |q0 q1> reads left to right",
    divergentFrom: ["qiskit"],
    theirConvention:
      "little-endian: qubit 0 is the LEAST significant, so a Qiskit bitstring reads right to left",
    consequence:
      "every multi-qubit matrix, every measured bitstring and every partial trace disagrees. A Bell state looks identical and a CX on (0,1) does not.",
    conversion: "reverse the bit order of the index, equivalently reverse the qubit list",
  },
  {
    id: "depolarizing_parameter",
    topic: "The single-qubit depolarizing rate",
    oniqConvention:
      "E(rho) = (1-p) rho + p * I/2, so p = 1 gives exactly the maximally mixed state",
    divergentFrom: ["qiskit-aer", "cirq"],
    theirConvention:
      "the Pauli form, E(rho) = (1-p) rho + (p/3)(X rho X + Y rho Y + Z rho Z), where p = 1 is NOT the maximally mixed state",
    consequence:
      "the same quoted 'depolarizing p' produces different states; error rates copied between ecosystems are wrong by 4/3 or 3/4",
    conversion: "p_pauli = (3/4) p_oniq, and p_oniq = (4/3) p_pauli",
  },
  {
    id: "phase_gate_naming",
    topic: "What the letters S, T and P name",
    oniqConvention: "S = diag(1, i), T = diag(1, e^{i pi/4}), phase(l) = diag(1, e^{i l})",
    divergentFrom: ["qiskit", "cirq"],
    theirConvention:
      "Cirq exposes S and T as Z**0.5 and Z**0.25; Qiskit's `p` is ONIQ's `phase` while `u1` is its deprecated ancestor, and the global-phase bookkeeping differs between them",
    consequence:
      "a circuit translated symbol-for-symbol can be correct up to a global phase in one direction and NOT in the other once the gate is controlled — a controlled global phase is a real relative phase",
    conversion:
      "translate through the matrix, never through the name; check with approxEqual up to global phase, and check the CONTROLLED version separately",
  },
  {
    id: "measurement_basis_labels",
    topic: "Classical register ordering in a returned bitstring",
    oniqConvention:
      "counts are keyed by the register read in qubit order 0..n-1, matching the big-endian index",
    divergentFrom: ["qiskit"],
    theirConvention:
      "counts are keyed with classical bit 0 rightmost, and the string is additionally split by classical register",
    consequence:
      "a histogram compared key-by-key across the two ecosystems appears to disagree on a circuit that is in fact identical",
    conversion: "reverse each key, and join the register-split segments before comparing",
  },
];

export const DIVERGENCE_BY_ID: ReadonlyMap<string, SemanticDivergence> = new Map(
  DIVERGENCES.map((d) => [d.id, d]),
);

/** Every source id named anywhere in this file, for the ingestion pass. */
export function domainSourceIds(): readonly string[] {
  const ids = new Set<string>();
  for (const d of DOMAINS) for (const s of d.sourceIds) ids.add(s);
  for (const d of DIVERGENCES) for (const s of d.divergentFrom) ids.add(s);
  return [...ids].sort();
}

/**
 * The §27 gap count, computed rather than asserted. A domain with an empty
 * `implementedHere` is knowledge ONIQ holds and cannot execute, and saying so
 * is the point of the field.
 */
export function coverage(): {
  readonly domains: number;
  readonly withImplementation: number;
  readonly knowledgeOnly: readonly string[];
  readonly openGaps: number;
} {
  const knowledgeOnly = DOMAINS.filter((d) => d.implementedHere.length === 0).map((d) => d.id);
  return {
    domains: DOMAINS.length,
    withImplementation: DOMAINS.length - knowledgeOnly.length,
    knowledgeOnly,
    openGaps: DOMAINS.reduce((n, d) => n + d.notImplemented.length, 0),
  };
}

/** Guard for the ingestion pass: every named source must be registered. */
export function unregisteredSourceIds(): readonly string[] {
  const known = new Set(QUANTUM_SOURCES.map((s) => s.id));
  return domainSourceIds().filter((id) => !known.has(id));
}
