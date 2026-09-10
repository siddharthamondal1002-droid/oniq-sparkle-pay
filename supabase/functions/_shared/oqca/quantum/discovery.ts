/**
 * QUANTUM ALGORITHM DISCOVERY — quantum brief §18.
 *
 * Given a problem ONIQ is actually facing, decide whether any quantum method
 * in `algorithms.ts` applies, and — far more often — say that none does and
 * that the classical route is the right one.
 *
 * **THE PIPELINE'S MOST COMMON CORRECT ANSWER IS "CLASSICAL".** That is not a
 * hedge, it is the measured state of the field for problems of ONIQ's size,
 * and a discovery pipeline that could not return it would be a recommendation
 * engine for quantum computing rather than a decision procedure. §16's rule is
 * enforced through `experiments.ts`: a candidate may only be called superior
 * where a FAIR experiment says so, and today exactly one does — Bernstein-
 * Vazirani, by a LINEAR factor, on a problem nobody has.
 *
 * IT ALSO CANNOT RECOMMEND WHAT IT CANNOT RUN. `DEFAULT_QUANTUM_POLICY` caps
 * the simulator at 14 qubits and forbids remote execution, so a candidate
 * needing 50 logical qubits is `not_executable_here` — a separate outcome from
 * `no_advantage`, because the two have completely different fixes (one needs
 * hardware ONIQ may not buy; the other needs a better idea).
 */
import { ALGORITHMS, type AlgorithmSpec, applicability } from "./algorithms.ts";
import { EXPERIMENTS, fairnessCheck, type QuantumExperiment } from "./experiments.ts";
import { DEFAULT_QUANTUM_POLICY, type QuantumPolicy } from "./policy.ts";
import { type QuantumCategory } from "./boundary.ts";

/**
 * EVERY ENTRY IN `algorithms.ts` IS A PHYSICAL-QUANTUM PROCEDURE, stated here
 * rather than looked up — and the first draft DID look it up, with
 * `CATEGORY_OF.get(a.id) ?? "PHYSICAL_QUANTUM"`.
 *
 * `CATEGORY_OF` is keyed by the OBJECT NAMES in `boundary.ts` ("unitary
 * matrix", "amplitude vector"), never by algorithm ids, so that lookup missed
 * on all eighteen and the `??` returned the right answer for the wrong reason.
 * It would have gone on returning it if `boundary.ts` were re-keyed tomorrow.
 * `quantumMethod.test.ts` asserts the map holds no algorithm id, so nobody
 * reinstates the lookup.
 */
const ALGORITHM_CATEGORY: QuantumCategory = "PHYSICAL_QUANTUM";

/** A problem stated in the terms the matcher can actually reason about. */
export type ProblemStatement = {
  readonly id: string;
  readonly description: string;
  /** The structure, from a closed list. Anything else matches nothing. */
  readonly structure: ProblemStructure;
  /** Size in the problem's own units — items, variables, bits. */
  readonly size: number;
  /** Is an oracle/black box available, or only an explicit input? */
  readonly hasOracle: boolean;
  /** Is a bounded-error answer acceptable? */
  readonly boundedErrorAcceptable: boolean;
};

export type ProblemStructure =
  | "unstructured_search"
  | "hidden_linear_structure"
  | "period_finding"
  | "eigenvalue_estimation"
  | "combinatorial_optimisation"
  | "hamiltonian_dynamics"
  | "linear_algebra"
  | "classification"
  | "none_of_these";

export const PROBLEM_STRUCTURES: readonly ProblemStructure[] = [
  "unstructured_search",
  "hidden_linear_structure",
  "period_finding",
  "eigenvalue_estimation",
  "combinatorial_optimisation",
  "hamiltonian_dynamics",
  "linear_algebra",
  "classification",
  "none_of_these",
];

/**
 * Which algorithms answer which structure. A CLOSED MAP, not a keyword search
 * over descriptions — a matcher that grepped the prose would recommend Shor
 * for anything mentioning "factor", which is the shape of mistake that makes a
 * discovery pipeline worse than nothing.
 */
const STRUCTURE_TO_ALGORITHMS: Readonly<Record<ProblemStructure, readonly string[]>> = {
  unstructured_search: ["grover", "amplitude_amplification"],
  hidden_linear_structure: ["bernstein_vazirani", "simon", "deutsch_jozsa", "deutsch"],
  period_finding: ["shor", "qft", "phase_estimation"],
  eigenvalue_estimation: ["phase_estimation", "vqe", "qsvt"],
  combinatorial_optimisation: ["qaoa", "quantum_annealing"],
  hamiltonian_dynamics: ["hamiltonian_simulation", "quantum_simulation", "qsp", "lcu"],
  linear_algebra: ["qsvt", "lcu"],
  classification: [],
  none_of_these: [],
};

export type Recommendation =
  "classical" | "quantum_candidate" | "not_executable_here" | "no_matching_structure";

export type CandidateAssessment = {
  readonly algorithmId: string;
  readonly category: QuantumCategory;
  readonly applicability: string;
  /** A FAIR experiment supporting an advantage for this algorithm, if any. */
  readonly fairExperimentId: string | null;
  readonly executableHere: boolean;
  readonly reason: string;
};

export type DiscoveryResult = {
  readonly problemId: string;
  readonly recommendation: Recommendation;
  readonly candidates: readonly CandidateAssessment[];
  /** Why, in one sentence a person can act on. */
  readonly rationale: string;
  /** What would have to change for the answer to change. */
  readonly wouldChangeIf: readonly string[];
};

/**
 * A fair experiment naming this algorithm **whose finding is an advantage**.
 * `experiments.ts` decides both halves; this file never re-derives either — the
 * health work's "never re-derive a policy beside the policy".
 *
 * THE `establishes` CLAUSE WAS MISSING IN THE FIRST DRAFT and it inverted the
 * answer: `dj_fair` is a perfectly fair experiment whose entire finding is that
 * Deutsch-Jozsa has NO meaningful advantage, and matching on fairness alone
 * read it as support. Deutsch and Deutsch-Jozsa came back `quantum_candidate`
 * off the back of the experiment that refutes them.
 */
function fairExperimentFor(a: AlgorithmSpec): QuantumExperiment | null {
  return (
    EXPERIMENTS.find(
      (e) =>
        e.status !== "blocked" &&
        e.establishes === "advantage" &&
        fairnessCheck(e).fair &&
        e.quantumMethod.toLowerCase().includes(a.name.toLowerCase()),
    ) ?? null
  );
}

/**
 * Can the local simulator run a meaningful instance? A problem of size N needs
 * about log2(N) qubits for a search or a hidden-string problem, plus an
 * ancilla — and `maxSimulatedQubits` is where that stops.
 */
export function executableHere(
  a: AlgorithmSpec,
  size: number,
  policy: QuantumPolicy = DEFAULT_QUANTUM_POLICY,
): boolean {
  if (!a.locallySimulable) return false;
  const needed = Math.ceil(Math.log2(Math.max(2, size))) + 1;
  return needed <= policy.maxSimulatedQubits;
}

export function assess(
  a: AlgorithmSpec,
  p: ProblemStatement,
  policy: QuantumPolicy = DEFAULT_QUANTUM_POLICY,
): CandidateAssessment {
  const exp = fairExperimentFor(a);
  const runnable = executableHere(a, p.size, policy);
  const app = applicability(a, policy.maxSimulatedQubits, false);
  const reasons: string[] = [];
  if (!p.hasOracle && a.input.toLowerCase().includes("oracle")) {
    reasons.push("the algorithm needs an oracle and the problem has none");
  }
  if (!p.boundedErrorAcceptable && a.noiseSensitivity !== "low") {
    reasons.push("an exact answer is required and this method is sampled");
  }
  if (!runnable) reasons.push("beyond the local simulator, and no device is reachable");
  if (!exp) reasons.push("no fair experiment here supports an advantage for it");
  return {
    algorithmId: a.id,
    category: ALGORITHM_CATEGORY,
    applicability: app,
    fairExperimentId: exp?.id ?? null,
    executableHere: runnable,
    reason:
      reasons.length > 0 ? reasons.join("; ") : "applicable, and supported by a fair experiment",
  };
}

export function discover(
  p: ProblemStatement,
  policy: QuantumPolicy = DEFAULT_QUANTUM_POLICY,
): DiscoveryResult {
  const ids = STRUCTURE_TO_ALGORITHMS[p.structure];
  if (ids.length === 0) {
    return {
      problemId: p.id,
      recommendation: "no_matching_structure",
      candidates: [],
      rationale: `no quantum algorithm in the registry addresses '${p.structure}'; use the classical method`,
      wouldChangeIf: [
        "the problem is restated in a structure the registry covers",
        "an algorithm for this structure is added with its assumptions and a classical alternative",
      ],
    };
  }

  const candidates = ids
    .map((id) => ALGORITHMS.find((a) => a.id === id))
    .filter((a): a is AlgorithmSpec => a !== undefined)
    .map((a) => assess(a, p, policy));

  const supported = candidates.filter((c) => c.fairExperimentId !== null && c.executableHere);
  if (supported.length > 0) {
    return {
      problemId: p.id,
      recommendation: "quantum_candidate",
      candidates,
      rationale: `${supported.map((c) => c.algorithmId).join(", ")} applies, is simulable at this size, and ${supported[0].fairExperimentId} is a fair experiment supporting it`,
      wouldChangeIf: ["the problem grows past the simulator's qubit ceiling"],
    };
  }

  // EXECUTABILITY AND ADVANTAGE ARE SEPARATE ANSWERS. Collapsing them into one
  // "no" would hide which of the two is the blocker, and they have completely
  // different fixes.
  const anyRunnable = candidates.some((c) => c.executableHere);
  if (!anyRunnable) {
    return {
      problemId: p.id,
      recommendation: "not_executable_here",
      candidates,
      rationale: `${candidates.map((c) => c.algorithmId).join(", ")} match the structure, and none is executable within ${policy.maxSimulatedQubits} simulated qubits with remote execution off`,
      wouldChangeIf: [
        "the owner authorises a QPU vendor, which §21 fixes off and this file may not change",
        "the instance shrinks below the simulator ceiling",
      ],
    };
  }

  return {
    problemId: p.id,
    recommendation: "classical",
    candidates,
    rationale: `${candidates.map((c) => c.algorithmId).join(", ")} match the structure but no FAIR experiment supports an advantage, so the classical method is the recommendation`,
    wouldChangeIf: [
      "a fair experiment is registered and run for one of these candidates",
      "the classical baseline is shown to need information it cannot have",
    ],
  };
}

/**
 * The problems ONIQ actually has, and the answer for each. Written down so the
 * pipeline is judged against real work rather than against a textbook.
 *
 * EVERY ANSWER HERE IS "CLASSICAL" OR "NO MATCHING STRUCTURE", and that IS the
 * result of §18 for this codebase — not a placeholder waiting to be filled in.
 */
export const ONIQ_PROBLEMS: readonly ProblemStatement[] = [
  {
    id: "story_dispatch",
    description: "Which queued Story film goes out next, and should one go out at all.",
    structure: "none_of_these",
    size: 50,
    hasOracle: false,
    boundedErrorAcceptable: false,
  },
  {
    id: "health_extraction",
    description: "Which analyte values a lab report states.",
    structure: "none_of_these",
    size: 28,
    hasOracle: false,
    boundedErrorAcceptable: false,
  },
  {
    id: "shot_allocation",
    description: "Allocate narration time across shots so every cut lands on a pause.",
    structure: "combinatorial_optimisation",
    size: 90,
    hasOracle: false,
    boundedErrorAcceptable: true,
  },
  {
    id: "vault_retrieval",
    description: "Find the study notes relevant to a question.",
    structure: "unstructured_search",
    // The Study Vault is Postgres FTS over an INDEXED corpus, so it is not an
    // unstructured search at all in Grover's sense — recorded here because the
    // pipeline must be able to say so rather than matching on the word.
    size: 5000,
    hasOracle: false,
    boundedErrorAcceptable: true,
  },
];

export function discoverAll(
  policy: QuantumPolicy = DEFAULT_QUANTUM_POLICY,
): readonly DiscoveryResult[] {
  return ONIQ_PROBLEMS.map((p) => discover(p, policy));
}
