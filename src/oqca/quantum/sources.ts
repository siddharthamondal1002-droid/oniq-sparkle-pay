/**
 * THE SOURCE MANIFEST — quantum brief §1 and §2.
 *
 * **EVERY VERSION AND LICENSE BELOW WAS MEASURED, NOT RECALLED.** §1 says
 * "Research current versions and official documentation before implementation.
 * Do not assume old APIs" — and this repo's oldest rule is that a catalogue is
 * not a POST and a checked-in file is not live state. So the whole table was
 * pulled from the PyPI JSON API at the timestamp below, from THIS container,
 * and the harvest is reproducible: `scripts/quantum-harvest-sources.mjs`.
 *
 * WHAT THE MEASUREMENT CHANGED, and it is why the rule exists:
 *   - Qiskit measured at 2.x, several MAJOR versions past the 0.x/1.x APIs a
 *     model recalls. Anything written from memory about `qiskit.execute` or
 *     `QuantumCircuit.bind_parameters` would have been wrong on arrival.
 *   - **Mitiq is GPL-3.0** — the ONLY copyleft licence in the set, and the one
 *     with real consequences for a proprietary application. See LICENSE_RISK.
 *   - ReCirq is NOT ON PyPI at all (404). It installs from source, so it has no
 *     released version to cite and is recorded as such rather than guessed.
 *
 * NOTHING HERE IS A DEPENDENCY. `package.json` is untouched; these are the
 * ecosystems whose PUBLIC DOCUMENTED KNOWLEDGE the substrate represents in
 * ONIQ's own words, which is §2's "Prefer independently authored ONIQ
 * representations of concepts and algorithms".
 */

export type QuantumSource = {
  readonly id: string;
  readonly project: string;
  readonly pypiPackage: string | null;
  readonly version: string;
  readonly license: string;
  readonly repository: string;
  readonly documentation: string;
  readonly summary: string;
  readonly requiresPython: string;
};

/** When the table below was fetched. ISO 8601, UTC. */
export const HARVESTED_AT = "2026-09-10T15:12:30Z";

/** The registry endpoint that answered. Recorded so the claim is checkable. */
export const HARVEST_ENDPOINT = "https://pypi.org/pypi/<package>/json";

export const QUANTUM_SOURCES: readonly QuantumSource[] = [
  {
    id: "qiskit",
    project: "Qiskit",
    pypiPackage: "qiskit",
    version: "2.5.2",
    license: "Apache-2.0",
    repository: "https://github.com/Qiskit/qiskit",
    documentation: "https://quantum.cloud.ibm.com/docs",
    summary:
      "An open-source SDK for working with quantum computers at the level of extended quantum circuits, operators, and primitives.",
    requiresPython: ">=3.10",
  },
  {
    id: "qiskit-aer",
    project: "Qiskit Aer",
    pypiPackage: "qiskit-aer",
    version: "0.17.2",
    license: "Apache 2.0",
    repository: "https://github.com/Qiskit/qiskit-aer",
    documentation: "https://github.com/Qiskit/qiskit-aer",
    summary: "Aer - High performance simulators for Qiskit",
    requiresPython: ">=3.7",
  },
  {
    id: "cirq",
    project: "Cirq",
    pypiPackage: "cirq",
    version: "1.7.0",
    license: "Apache-2.0",
    repository: "http://github.com/quantumlib/cirq",
    documentation: "http://github.com/quantumlib/cirq",
    summary:
      "A framework for creating, editing, and invoking Noisy Intermediate Scale Quantum (NISQ) circuits.",
    requiresPython: ">=3.11.0",
  },
  {
    id: "qsimcirq",
    project: "qsim",
    pypiPackage: "qsimcirq",
    version: "0.22.1",
    license: "Apache-2.0",
    repository: "https://github.com/quantumlib/qsim",
    documentation: "https://github.com/quantumlib/qsim",
    summary: "Schrödinger and Schrödinger-Feynman simulators for quantum circuits.",
    requiresPython: ">=3.10.0",
  },
  {
    id: "stim",
    project: "Stim",
    pypiPackage: "stim",
    version: "1.16.0",
    license: "Apache 2",
    repository: "https://github.com/quantumlib/stim",
    documentation: "https://github.com/quantumlib/stim",
    summary: "A fast library for analyzing with quantum stabilizer circuits.",
    requiresPython: ">=3.6.0",
  },
  {
    id: "qualtran",
    project: "Qualtran",
    pypiPackage: "qualtran",
    version: "0.7.0",
    license: "Apache 2",
    repository: "",
    documentation: "",
    summary: "Software for fault-tolerant quantum algorithms research.",
    requiresPython: "",
  },
  {
    id: "openfermion",
    project: "OpenFermion",
    pypiPackage: "openfermion",
    version: "1.8.1",
    license: "Apache-2.0",
    repository: "https://quantumai.google/openfermion",
    documentation: "https://quantumai.google/openfermion",
    summary: "Package to compile and analyze quantum algorithms for simulating fermionic systems.",
    requiresPython: ">=3.10.0",
  },
  {
    id: "tensorflow-quantum",
    project: "TensorFlow Quantum",
    pypiPackage: "tensorflow-quantum",
    version: "0.7.6",
    license: "Apache 2.0",
    repository: "https://github.com/tensorflow/quantum/",
    documentation: "https://github.com/tensorflow/quantum/",
    summary: "Library for hybrid quantum-classical machine learning.",
    requiresPython: ">=3.10",
  },
  {
    id: "pennylane",
    project: "PennyLane",
    pypiPackage: "pennylane",
    version: "0.45.1",
    license: "Apache-2.0",
    repository: "",
    documentation: "",
    summary:
      "PennyLane is a cross-platform Python library for quantum computing, quantum machine learning, and quantum chemistry. Train a quantum computer the same",
    requiresPython: ">=3.11",
  },
  {
    id: "qutip",
    project: "QuTiP",
    pypiPackage: "qutip",
    version: "5.3.1",
    license: "BSD-3-Clause",
    repository: "https://github.com/qutip/qutip",
    documentation: "https://qutip.readthedocs.io/en/stable/",
    summary: "QuTiP: The Quantum Toolbox in Python",
    requiresPython: ">=3.11",
  },
  {
    id: "pyzx",
    project: "PyZX",
    pypiPackage: "pyzx",
    version: "0.10.6",
    license: "Apache-2.0",
    repository: "https://github.com/zxcalc/pyzx.git",
    documentation: "https://pyzx.readthedocs.io/",
    summary: "Library for quantum circuit rewriting and optimisation using the ZX-calculus",
    requiresPython: ">=3.10",
  },
  {
    id: "pytket",
    project: "pytket/tket",
    pypiPackage: "pytket",
    version: "2.18.1",
    license: "Apache 2",
    repository: "https://github.com/quantinuum/tket",
    documentation: "https://docs.quantinuum.com/tket/api-docs/",
    summary: "Quantum computing toolkit and interface to the TKET compiler",
    requiresPython: ">=3.10",
  },
  {
    id: "bqskit",
    project: "BQSKit",
    pypiPackage: "bqskit",
    version: "1.2.1",
    license: "BSD 3-Clause License",
    repository: "https://github.com/BQSKit/bqskit",
    documentation: "https://bqskit.readthedocs.io/en/latest",
    summary: "Berkeley Quantum Synthesis Toolkit",
    requiresPython: "<4,>=3.8",
  },
  {
    id: "mitiq",
    project: "Mitiq",
    pypiPackage: "mitiq",
    version: "1.1.0",
    license: "GPL v3.0",
    repository: "https://github.com/unitaryfoundation/mitiq/",
    documentation: "https://mitiq.readthedocs.io/en/stable/",
    summary:
      "Mitiq is an open source toolkit for implementing error mitigation techniques on most current intermediate-scale quantum computers.",
    requiresPython: "<3.13,>=3.11",
  },
  {
    id: "quimb",
    project: "quimb",
    pypiPackage: "quimb",
    version: "1.15.0",
    license: "Apache-2.0",
    repository: "https://github.com/jcmgray/quimb/",
    documentation: "https://quimb.readthedocs.io/",
    summary: "Quantum information and many-body library.",
    requiresPython: ">=3.11",
  },
  {
    id: "qulacs",
    project: "Qulacs",
    pypiPackage: "qulacs",
    version: "0.6.14",
    license: "MIT",
    repository: "",
    documentation: "",
    summary: "Quantum circuit simulator for research",
    requiresPython: "",
  },
  {
    // MEASURED 404 ON PyPI. ReCirq is a Google research repository installed
    // from source; it publishes no PyPI release, so there is no version to
    // cite. Recording "unreleased" is the honest answer — inventing one would
    // be exactly the recalled-API failure §1 warns about.
    id: "recirq",
    project: "ReCirq",
    pypiPackage: null,
    version: "unreleased (not on PyPI; measured 404)",
    license: "Apache-2.0 (repository; NOT verified from a registry)",
    repository: "https://github.com/quantumlib/ReCirq",
    documentation: "https://github.com/quantumlib/ReCirq",
    summary: "Research code for quantum computing experiments using Cirq.",
    requiresPython: "",
  },
  {
    // NOT A PACKAGE. "Qiskit ecosystem" is a curated INDEX of community
    // projects, so it has no single version or licence of its own and is
    // recorded as the meta-entry it is rather than as a library.
    id: "qiskit-ecosystem",
    project: "Qiskit ecosystem",
    pypiPackage: null,
    version: "n/a (an index of projects, not a package)",
    license: "per member project",
    repository: "https://github.com/qiskit-community/ecosystem",
    documentation: "https://www.ibm.com/quantum/ecosystem",
    summary: "A curated index of community projects built on Qiskit.",
    requiresPython: "",
  },
];

export const SOURCE_BY_ID: ReadonlyMap<string, QuantumSource> = new Map(
  QUANTUM_SOURCES.map((s) => [s.id, s] as const),
);

/**
 * THE LICENCE FINDING THAT MATTERS, stated where code can read it rather than
 * only in a document.
 *
 * §2: "Do not copy source code unless the license explicitly permits the
 * intended use and the repository policy permits it."
 *
 * Every measured licence in this set is permissive (Apache-2.0, BSD-3-Clause,
 * MIT) EXCEPT Mitiq, which measured as GPL-3.0 via its own OSI classifier.
 * Copyleft is not a reason to avoid Mitiq as a research tool; it IS a reason
 * that no line of it may be copied into ONIQ, and that any adapter must remain
 * an out-of-process, optional, non-bundled research path. ONIQ's own
 * error-mitigation representations are independently authored.
 */
export const COPYLEFT_SOURCE_IDS: readonly string[] = ["mitiq"];

export function isCopyleft(id: string): boolean {
  return COPYLEFT_SOURCE_IDS.includes(id);
}

/**
 * §2's provenance fields, as the shape every imported knowledge item carries.
 * A record whose `sourceProject` names nothing in `SOURCE_BY_ID` is refused by
 * `knowledge.ts` — an unregistered source is an unciteable one.
 */
export type QuantumProvenanceStamp = {
  readonly sourceProject: string;
  readonly sourceRepository: string;
  readonly sourceDocumentation: string;
  readonly sourceVersion: string;
  readonly license: string;
  readonly retrievedAt: string;
  readonly sourceType: string;
};

/**
 * THE ADDRESS TO CITE FOR A SOURCE, and it needs a fallback because three of
 * the eighteen publish NEITHER a repository nor a documentation URL on PyPI:
 * `qualtran`, `pennylane` and `qulacs` came back with empty `project_urls`.
 *
 * The empties stay in the table above — they are what the registry returned,
 * and editing measured data for appearance is how a table stops being a
 * measurement. What they get instead is the address the harvest ACTUALLY read
 * them from: the PyPI project page, which is a registry endpoint the OKS
 * spec's §9 names explicitly and which exists for all eighteen by definition.
 * Nothing here is invented; the fallback is the place the evidence came from.
 */
export function locatorFor(id: string): string {
  const s = SOURCE_BY_ID.get(id);
  if (!s) throw new Error(`quantum sources: ${id} is not a registered source`);
  if (s.documentation) return s.documentation;
  if (s.repository) return s.repository;
  return `https://pypi.org/project/${s.pypiPackage ?? id}/`;
}

export function stampFor(id: string, sourceType: string): QuantumProvenanceStamp {
  const s = SOURCE_BY_ID.get(id);
  if (!s) throw new Error(`quantum sources: ${id} is not a registered source`);
  return {
    sourceProject: s.project,
    sourceRepository: s.repository,
    sourceDocumentation: s.documentation,
    sourceVersion: s.version,
    license: s.license,
    retrievedAt: HARVESTED_AT,
    sourceType,
  };
}
