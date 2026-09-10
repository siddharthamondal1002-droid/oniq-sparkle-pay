/**
 * THE OPTIONAL RESEARCH ADAPTERS — quantum brief §15, §10, §11, §12, §13, §14,
 * and §25's dependency boundary:
 *
 *   ONIQ -> QuantumKnowledge -> QuantumCapability -> optional adapter -> library
 *
 * **EVERY ADAPTER IN THIS FILE REFUSES, AND THAT IS THE FINISHED STATE, NOT A
 * STUB.** Not one of these libraries is in `package.json`, none is installed,
 * and adding one is Lovable's to do — so an adapter that pretended to work
 * would be the "built and unit-tested is not reachable" failure this repo has
 * recorded four times, with a network call at the end of it.
 *
 * A REFUSAL NAMES WHAT IT WOULD NEED. `adapter_unavailable` with the package,
 * the version measured on PyPI and the licence is actionable; "not supported"
 * is the diagnostic dead end `vertexError.ts` was written to end.
 *
 * THE QPU ADAPTER REFUSES TWICE OVER and that redundancy is deliberate: §15
 * says it "must remain unavailable unless explicitly enabled" and §21 sets
 * `remoteQuantumExecution = false`. Installing a vendor SDK must not be
 * sufficient to reach hardware — the policy still has to say yes, and the
 * owner still has to fund it.
 */
import type { QuantumBackend } from "./backend.ts";
import { refuse } from "./backend.ts";
import { type QuantumPolicy, DEFAULT_QUANTUM_POLICY, checkRemote } from "../policy.ts";
import { SOURCE_BY_ID, isCopyleft } from "../sources.ts";

export type AdapterCapability =
  | "simulation"
  | "compilation"
  | "error_correction"
  | "zx_calculus"
  | "tensor_network"
  | "open_systems"
  | "error_mitigation"
  | "chemistry"
  | "qml";

export type AdapterSpec = {
  readonly name: string;
  /** The `sources.ts` id, so the version and licence come from the measurement. */
  readonly sourceId: string;
  readonly capabilities: readonly AdapterCapability[];
  /** What ONIQ would use it FOR, in one line. */
  readonly purpose: string;
  /** What it cannot do, so nobody plans around a capability it lacks. */
  readonly limitations: string;
};

/**
 * The adapters the briefs name, each bound to a MEASURED source rather than to
 * a remembered version. §1's "Do not assume old APIs" is enforced by the fact
 * that no version string is typed here at all.
 */
export const ADAPTERS: readonly AdapterSpec[] = [
  {
    name: "QiskitBackend",
    sourceId: "qiskit",
    capabilities: ["simulation", "compilation", "qml"],
    purpose: "circuit construction, transpilation to a coupling map, and Aer simulation",
    limitations: "Python only; no browser or Deno runtime; Aer is a separate package",
  },
  {
    name: "CirqBackend",
    sourceId: "cirq",
    capabilities: ["simulation", "compilation"],
    purpose: "circuit construction and device-aware compilation for Google hardware models",
    limitations: "Python only; qsim is a separate package for fast simulation",
  },
  {
    name: "PennyLaneBackend",
    sourceId: "pennylane",
    capabilities: ["qml", "simulation"],
    purpose: "differentiable circuits and hybrid optimisation with parameter-shift gradients",
    limitations: "Python only; autodiff needs a host ML framework",
  },
  {
    name: "StimAdapter",
    sourceId: "stim",
    capabilities: ["error_correction", "simulation"],
    purpose: "fast stabiliser simulation and QEC circuit sampling for syndrome experiments",
    limitations: "CLIFFORD ONLY — it cannot simulate T gates or arbitrary rotations at all",
  },
  {
    name: "PyZXAdapter",
    sourceId: "pyzx",
    capabilities: ["zx_calculus", "compilation"],
    purpose: "ZX-graph rewriting, circuit simplification and equivalence checking",
    limitations: "extraction from a simplified graph is not always efficient and can fail",
  },
  {
    name: "QuimbAdapter",
    sourceId: "quimb",
    capabilities: ["tensor_network", "simulation"],
    purpose: "MPS/MPO/PEPS contraction for weakly entangled states beyond the statevector limit",
    limitations: "accuracy is bounded by the bond dimension; highly entangled states blow up",
  },
  {
    name: "QuTiPAdapter",
    sourceId: "qutip",
    capabilities: ["open_systems", "simulation"],
    purpose: "Lindblad master equations, Monte Carlo trajectories and time-dependent Hamiltonians",
    limitations:
      "§14 is explicit: this must NOT enter the production runtime unless explicitly required",
  },
  {
    name: "TketAdapter",
    sourceId: "pytket",
    capabilities: ["compilation"],
    purpose: "routing, rebasing and peephole optimisation against a device architecture",
    limitations: "Python only",
  },
  {
    name: "BQSKitAdapter",
    sourceId: "bqskit",
    capabilities: ["compilation"],
    purpose: "numerical resynthesis of unitaries into shorter native-gate circuits",
    limitations: "synthesis is expensive and approximate; the tolerance is a parameter",
  },
  {
    name: "MitiqAdapter",
    sourceId: "mitiq",
    capabilities: ["error_mitigation"],
    purpose: "zero-noise extrapolation and probabilistic error cancellation over a backend",
    limitations:
      "GPL-3.0 — the only copyleft source in the manifest. Research use only, never bundled, " +
      "and no line of it may be copied into ONIQ",
  },
  {
    name: "OpenFermionAdapter",
    sourceId: "openfermion",
    capabilities: ["chemistry"],
    purpose: "fermionic operators and Jordan-Wigner / Bravyi-Kitaev mappings to qubits",
    limitations: "needs a classical chemistry package for integrals; those are separate installs",
  },
  {
    name: "QsimAdapter",
    sourceId: "qsimcirq",
    capabilities: ["simulation", "tensor_network"],
    purpose: "high-performance statevector and MPS simulation of Cirq circuits",
    limitations: "Python only; statevector memory still grows as 2^n",
  },
  {
    name: "QulacsAdapter",
    sourceId: "qulacs",
    capabilities: ["simulation"],
    purpose: "fast C++ statevector simulation with a Python binding",
    limitations: "Python/C++ only",
  },
  {
    name: "TFQAdapter",
    sourceId: "tensorflow-quantum",
    capabilities: ["qml"],
    purpose: "batched circuit execution as TensorFlow layers for hybrid models",
    limitations: "pins specific TensorFlow and Cirq versions; a heavy install",
  },
  {
    name: "QualtranAdapter",
    sourceId: "qualtran",
    capabilities: ["compilation"],
    purpose: "resource estimation for fault-tolerant algorithms — T-counts and qubit budgets",
    limitations: "estimates, not compiled circuits",
  },
];

export const ADAPTER_BY_NAME: ReadonlyMap<string, AdapterSpec> = new Map(
  ADAPTERS.map((a) => [a.name, a] as const),
);

/** The sentence a refusal carries. Names the package, the version and why. */
export function unavailableDetail(spec: AdapterSpec): string {
  const src = SOURCE_BY_ID.get(spec.sourceId);
  const pkg = src?.pypiPackage ?? spec.sourceId;
  const version = src?.version ?? "unknown";
  const licence = src?.license ?? "unknown";
  const copyleft = isCopyleft(spec.sourceId) ? " COPYLEFT — research use only, never bundled." : "";
  return (
    `${spec.name} needs ${pkg} (measured ${version}, ${licence}), which is not a dependency of ` +
    `ONIQ and is a Python package this runtime cannot load.${copyleft} ` +
    `Purpose: ${spec.purpose}. Limitation: ${spec.limitations}.`
  );
}

/**
 * A backend that refuses every call with a sentence naming what it would need.
 * `available: false` is the field a caller checks; the refusal is what it gets
 * if it does not.
 */
export function makeUnavailableBackend(spec: AdapterSpec): QuantumBackend {
  const detail = unavailableDetail(spec);
  const no = <T>() => refuse<T>("adapter_unavailable", detail);
  return {
    name: spec.name,
    available: false,
    createState: no,
    applyOperation: no,
    measure: no,
    simulate: no,
    expectation: no,
    reset: no,
  };
}

export const QiskitBackend = () => makeUnavailableBackend(ADAPTER_BY_NAME.get("QiskitBackend")!);
export const CirqBackend = () => makeUnavailableBackend(ADAPTER_BY_NAME.get("CirqBackend")!);
export const PennyLaneBackend = () =>
  makeUnavailableBackend(ADAPTER_BY_NAME.get("PennyLaneBackend")!);

/**
 * THE QPU BACKEND. Refuses on POLICY FIRST and on the missing vendor SDK
 * second, and the order is the argument: if it refused on the SDK first, then
 * installing one would change the refusal to a policy one — and somebody
 * reading "adapter unavailable" would reasonably conclude that installing the
 * package is the fix. It is not. There is no vendor, no credential, no
 * endpoint, and `remoteQuantumExecution` is false.
 */
export function QPUBackend(policy: QuantumPolicy = DEFAULT_QUANTUM_POLICY): QuantumBackend {
  const gate = checkRemote(policy, 0);
  const detail = gate.allowed
    ? "no QPU vendor is configured: ONIQ names no hardware provider, holds no credential, and " +
      "introduces no cloud endpoint. Enabling the policy alone does not create one."
    : `refused by policy: ${gate.reason}. No QPU vendor is configured either.`;
  const no = <T>() => refuse<T>(gate.allowed ? "adapter_unavailable" : gate.reason, detail);
  return {
    name: "QPUBackend",
    available: false,
    createState: no,
    applyOperation: no,
    measure: no,
    simulate: no,
    expectation: no,
    reset: no,
  };
}
