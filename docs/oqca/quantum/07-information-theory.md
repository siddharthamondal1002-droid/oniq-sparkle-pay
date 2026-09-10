# §8 — information theory

`src/oqca/quantum/math/info.ts`, over the density matrices in `state.ts`.

## What is computed

von Neumann entropy, Rényi entropy, linear entropy, entanglement entropy across
a cut, mutual information, conditional entropy, trace distance, fidelity and
ℓ1-coherence. `validateInformationTheory(ρ)` runs the standard inequalities and
returns every violation.

Eigenvalues come from a **Jacobi rotation on the real symmetric embedding**
`[[A, −B], [B, A]]` of a complex Hermitian matrix. Eigenvalues appear TWICE in
that embedding, so they are halved — a detail that is silent if got wrong,
because the entropy still comes out positive.

## The numbers that make it checkable

A Bell state, asserted exactly:

```
global entropy   0        (it is pure)
purity           1
reduced purity   0.5      (one half is maximally mixed)
entanglement S   1
mutual info      2        <- the number that separates entanglement from
                             classical correlation
```

A product state gives 0 for both. The maximally mixed state on n qubits gives
entropy exactly n and purity 2⁻ⁿ.

## `fidelity` refuses rather than returning a plausible number

For two MIXED states the Uhlmann fidelity needs a matrix square root this
module does not carry. Returning `Tr(ρσ)` instead would be a real number and a
plausible-looking answer, which is precisely why it refuses. Pure-vs-anything
is computed and returned.

**A diagnostic may never fall back to something that looks like an answer** —
the same rule `vertexError.ts` carries in the health tree, for the same reason.
