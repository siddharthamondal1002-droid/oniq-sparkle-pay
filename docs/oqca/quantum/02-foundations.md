# §3 — the 27 foundations

Every entry in `src/oqca/quantum/concepts.ts` carries six required fields:
definition, notation, constraints, invariants, examples and
**counterexamples**.

## Why the counterexample is required rather than optional

A definition plus an example is what a summary produces. The counterexample
says where the concept STOPS, and it is the field that catches a
plausible-sounding misunderstanding — "a classical bit with a probability
attached" is not a qubit, because it has no phase and cannot interfere.
`quantumKnowledge.test.ts` fails on any entry with an empty counterexample
list.

## `invariantCheck` names a real function

Where an invariant is checkable, the concept names the exported function that
checks it — `isNormalized`, `isUnitary`, `isHermitian`, `isCPTP`,
`isValidDensity`, `isPositiveSemidefinite`. `claimedInvariantChecks()` returns
every such name and the test resolves each against the real module namespace.
**A concept claiming an invariant nothing checks fails the build.** That is the
difference between this file and an encyclopedia entry.

## The dependency graph is closed

Every `dependsOn` edge names another concept in the same table; a dangling edge
fails. The graph is what lets `gaps.ts` answer "what does understanding this
require", which is §11's question.

## The one convention stated here and enforced everywhere

`QUBIT_ORDER` is **big-endian**: `kron(A, B)` puts A on the LOWER qubit index,
so `|q0 q1⟩` reads left to right and `|0⟩⊗|1⟩` is basis index 1.

Qiskit is little-endian. That disagreement is recorded in `DIVERGENCES` and
ingested as a CONTESTED knowledge record — see [16-boundary.md](16-boundary.md).
It is never normalised, because normalising it would delete a true fact about
one of the two ecosystems.
