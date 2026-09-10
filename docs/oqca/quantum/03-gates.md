# §4 — the gate library, and the invariants computed over it

Nineteen gates in `src/oqca/quantum/gates.ts`. §4 asks for "automated invariant
tests"; here is what that means concretely.

## No gate declares itself unitary

`quantumKernel.test.ts` multiplies every matrix out, over the **whole
registry** rather than a sample:

- `isUnitary(g.matrix)` for all of them;
- `g.inverse` is asserted to BE `dagger(g.matrix)`, and `g · g⁻¹ = I`;
- the Paulis and H are checked Hermitian and involutory by computing `m·m`;
- `S² = Z` and `T² = S` — the phase ladder, multiplied rather than cited;
- `X = H Z H`.

A hand-picked subset passing says nothing about the twentieth gate someone adds
next week, so the loop is over `GATE_NAMES`.

## Controlled gates come from ONE construction

`controlled(target, controls)` builds CX, CZ, CY, CH, CCX, CRX, CRY, CRZ,
CPHASE and MCX. Asserting `controlled(X) === GATES.CX.matrix` is what keeps the
registry from acquiring a second, subtly different construction.

## A global phase is real when it is controlled

`rx(2π) = −I`, not `I`. The test asserts `approxEqual(rx(2π), I)` is **false**
and that `rx(2π)² = I`. A test that accepted either would accept a wrong sign in
any controlled version — where a "global" phase becomes an observable relative
one. That is also the substance of the `phase_gate_naming` divergence.

## The registry is closed

`circuit.ts` refuses an unknown gate name rather than dropping the operation. A
circuit holding an op no backend can run is a circuit that simulates to the
wrong answer without ever erroring.

## Ingested as knowledge

`knowledge.ts` runs `isUnitary`, `isHermitian` and `m·m = I` at ingestion time
and writes one `KnowledgeRecord` per gate per property, with
`extraction: "computed"` and the checker named as the verifier. So a gate that
stopped being unitary would produce a record SAYING so, rather than a green
test somewhere else.
