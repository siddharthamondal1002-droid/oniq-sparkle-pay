# §5 — the circuit model

`src/oqca/quantum/circuit.ts` carries all ten §5 elements: qubits, classical
bits, gates, measurement, reset, barriers, delays, parameters, conditions and
timing.

## The metrics a compiler decision actually needs

`depth`, `twoQubitCount`, `tCount`, `gateCount`, and `circuitUnitary` for the
whole circuit's matrix.

**Which one matters depends on the target, and quoting the wrong one answers a
different question.** T-count governs fault-tolerant cost and is nearly
irrelevant on today's noisy hardware, where two-qubit count and depth dominate.
Both are carried; neither is called "the" cost.

## Non-adjacent embedding is permutation conjugation

`embedMulti` handles a two-qubit gate on qubits 0 and 2 of a three-qubit
register by conjugating with a permutation. A version that only handled
adjacent pairs would still produce a unitary — and the wrong one — so the test
asserts a specific matrix entry (`|100⟩ → |101⟩`) rather than only that the
result is unitary.

## What the simulator does with a measurement

`simulate` samples the final state and keys the counts by the **declared
classical register**, in clbit order, big-endian.

That was wrong until the §17 experiments were run: it keyed by
`circuit.qubits`, so a Bernstein-Vazirani circuit with an unmeasured ancilla
returned a 5-character string for a 4-bit answer. Every amplitude was right and
every comparison was wrong. Mid-circuit measurement is REFUSED rather than
silently ignored, because collapsing the state is a different simulation mode.
