#!/usr/bin/env node
/**
 * Re-measure the quantum source manifest from PyPI.
 *
 *   node scripts/quantum-harvest-sources.mjs           # print the table
 *   node scripts/quantum-harvest-sources.mjs --json    # machine-readable
 *
 * WHY THIS EXISTS RATHER THAN A HAND-WRITTEN TABLE: quantum brief §1 says
 * "Research current versions and official documentation before implementation.
 * Do not assume old APIs", and this repo's oldest rule is that a catalogue is
 * not a POST. A version written from memory is a guess wearing a fact's
 * clothing — the harvest that produced `src/oqca/quantum/sources.ts` measured
 * Qiskit several MAJOR versions past what a model recalls.
 *
 * IT MEASURES AND PRINTS; IT DOES NOT WRITE. Regenerating a checked-in file
 * from a network fetch would make a diff appear whenever a maintainer released,
 * with nobody having decided to update. Compare the output, then edit
 * deliberately.
 *
 * `pypi.org` IS REACHABLE FROM THE DEV CONTAINER; `jena.apache.org`, `w3.org`
 * and `api.github.com` ARE NOT (measured — see SOURCE_MANIFEST.md). So licences
 * and versions are measurable here and documentation prose is not.
 */
const PKGS = {
  qiskit: "Qiskit",
  "qiskit-aer": "Qiskit Aer",
  cirq: "Cirq",
  qsimcirq: "qsim",
  stim: "Stim",
  qualtran: "Qualtran",
  recirq: "ReCirq",
  openfermion: "OpenFermion",
  "tensorflow-quantum": "TensorFlow Quantum",
  pennylane: "PennyLane",
  qutip: "QuTiP",
  pyzx: "PyZX",
  pytket: "pytket/tket",
  bqskit: "BQSKit",
  mitiq: "Mitiq",
  quimb: "quimb",
  qulacs: "Qulacs",
};

const asJson = process.argv.includes("--json");
const out = {};
let failures = 0;

for (const [pkg, label] of Object.entries(PKGS)) {
  try {
    const res = await fetch(`https://pypi.org/pypi/${pkg}/json`, {
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = (await res.json()).info;
    // `license_expression` is the modern SPDX field; older packages put a whole
    // licence TEXT in `license`, so a long value falls back to the classifier.
    let license = info.license_expression || info.license || "";
    if (!license || license.length > 60) {
      const cls = (info.classifiers || []).filter((c) => c.startsWith("License ::"));
      license = cls.length ? cls[0].split("::").pop().trim() : "(unstated)";
    }
    out[pkg] = { project: label, version: info.version, license };
    if (!asJson) console.log(`OK   ${label.padEnd(22)} ${info.version.padEnd(14)} ${license}`);
  } catch (e) {
    failures++;
    out[pkg] = { project: label, error: String(e.message || e) };
    if (!asJson) console.log(`MISS ${label.padEnd(22)} ${e.message || e}`);
  }
}

if (asJson) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`\n${Object.keys(PKGS).length - failures} measured, ${failures} unreachable.`);
  console.log("Compare against src/oqca/quantum/sources.ts and edit deliberately.");
}
