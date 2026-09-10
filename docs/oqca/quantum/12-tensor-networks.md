# §13 — tensor networks

Represented; the entropy machinery is implemented and the contraction is not.

## The idea, and the number that governs it

Cost is set by **entanglement**, not by qubit count. A lowly-entangled 100-qubit
circuit is simulable and a highly-entangled 40-qubit one is not. Bond dimension
χ bounds the entanglement across a cut: `S ≤ log₂ χ`.

## What is implemented here

`entanglementEntropy`, `partialTrace`, `spectrum`, `vonNeumannEntropy`, `kron`
— which is to say, the machinery for measuring what a tensor network exists to
exploit, over a **full density matrix**, which is exactly the object a tensor
network exists to avoid building.

## What is not

No MPS type, no SVD, no truncation, no contraction, no contraction-order search.
The v1.1 cognitive tensor seam (`src/oqca/backends/tensor.ts`) reshapes an
amplitude list and its `contract()` throws `BackendUnavailable`; it is not a
quantum tensor-network implementation and is deliberately not claimed as one.

quimb and cotengra are the subject and neither is a dependency.

## Two claims that mean nothing without their qualifier

- **"We simulated 100 qubits"** says nothing without the circuit's entanglement
  and the bond dimension used.
- **An approximate tensor-network result compared against an exact state-vector
  result** is a comparison of two different computations. The truncation error —
  the discarded weight — must be stated, and a simulation reporting no
  truncation error is either exact or not reporting.

Note also that `χ ≥ 2^(n/2)` represents ANY state, so "MPS" alone is not a
compression claim.
