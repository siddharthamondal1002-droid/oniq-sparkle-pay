# §20, §23 — the three categories, and the disagreements kept

## §20 — never silently convert one category into another

```
PHYSICAL_QUANTUM   a unitary matrix, a density matrix, a Kraus channel
QUANTUM_INSPIRED   OQCA's amplitude vector and its rotation operators
CLASSICAL_ANALOG   a scalar confidence in [0,1]
```

`CATEGORISED` in `src/oqca/quantum/boundary.ts` gives every object a category
and a `because` — a table of labels with no reasons is a table nobody can check.

**There is no function that converts one category into another, and that
absence is the design.** The surest way to keep a conversion from being silent
is for it not to exist. `sameCategory(a, b)` is what a caller asks BEFORE
treating one as the other, and it always answers false across categories.

`PHYSICAL_ONLY_CLAIMS` are the claims that would be FALSE about a
quantum-inspired object — "entangled", and its relatives.
`claimIsLegitimate(claim, category)` refuses them for `QUANTUM_INSPIRED` and
`CLASSICAL_ANALOG` and admits an ordinary claim for all three, so the predicate
is discriminating rather than rejecting everything.

### The trap this exists to stop

Two of the loop's 23 stations share a NAME with a category-C operation and are
not it. Station 07 RELATIONAL BINDING is a graph over the world model and is
NOT `cognitive.entangle`; station 19 CORRECT is a diagnosis over the outcome
record and is NOT quantum error correction. Reading the shared name as a shared
refusal would cripple two working stations; reading it the other way would
claim two physical operations ONIQ does not have.

## §23 — where two libraries disagree, preserve both

> **"Never silently normalize conflicting semantics."**

Four disagreements are recorded in `DIVERGENCES`, each with ONIQ's convention,
theirs, the CONSEQUENCE of conflating them, and the CONVERSION between them —
the last being what makes it knowledge rather than a warning.

| Topic                | ONIQ                                            | Divergent from | Conversion                                                                |
| -------------------- | ----------------------------------------------- | -------------- | ------------------------------------------------------------------------- |
| Qubit ordering       | big-endian: `kron(A,B)` puts A on the low index | Qiskit         | reverse the bit order                                                     |
| Depolarizing p       | `(1−p)ρ + p·I/2`; p=1 IS maximally mixed        | Aer, Cirq      | `p_pauli = ¾·p_oniq`                                                      |
| S / T / phase naming | `S = diag(1,i)`, `phase(λ) = diag(1,e^{iλ})`    | Qiskit, Cirq   | translate through the MATRIX, and check the CONTROLLED version separately |
| Counts key ordering  | qubit order 0..n−1, big-endian                  | Qiskit         | reverse each key, join register-split segments                            |

### How "never normalise" is enforced

Each divergence is ingested as a `KnowledgeRecord` carrying evidence on BOTH
sides — ONIQ's own computed convention supporting it, each ecosystem's
documented convention refuting it — so `evaluatePromotion` returns
**CONTESTED**.

That status is the mechanism. `mayInformDecision` refuses a CONTESTED record,
`makeSubstrateKnowledgeAdapter` reads VERIFIED only, and the only way to see one
is `contestedFacts()`, which labels every statement `[CONTESTED]`. So nothing
downstream can pick up one endianness convention and forget the other.

`resolveConflict(..., "divergent_by_design")` refuses to resolve at all: choosing
between two correct conventions would delete a true fact about one of them.
