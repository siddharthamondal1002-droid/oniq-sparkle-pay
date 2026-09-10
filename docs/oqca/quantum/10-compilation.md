# §11 — compilation and transpilation

Represented; the METRICS are implemented and no rewriting is.

## What exists here

`circuitUnitary`, `depth`, `twoQubitCount`, `tCount`, `gateCount`,
`controlled`, `approxEqual`. These **measure** a circuit.

## What does not

**No transpiler.** No gate-set decomposition, no qubit placement, no routing
pass, no peephole optimiser. No Solovay-Kitaev and no approximate synthesis —
that is BQSKit's subject and it was not vendored.

## The invariants a transpiler would have to hold

- Correct compilation preserves the unitary **up to a global phase**, and
  global phase alone is unobservable — so an equality check that rejects it
  would reject every correct synthesis.
- Routing can only INCREASE two-qubit count and depth; it never decreases them.
- A SWAP is three CX on a CX-native device, so a routing decision is a
  two-qubit-count decision.
- Optimisation that changes the measured distribution is not optimisation.

## The comparison pitfall

Gate counts are not comparable across ecosystems without fixing the gate set. A
count in `{rz, sx, cx}` and a count in `{u, cz}` are different quantities, and
a table that puts them in the same column is measuring the compiler's target
rather than the circuit.
