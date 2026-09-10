# OQCA — what may be claimed

Brief section 17. Three lists, and the only one that matters to a reader in a
hurry is the third.

Every line below is either MEASURED here (a command is given), or labelled as
not measured. Nothing is inferred from the specification's own framing.

Re-run everything with:

```
npx tsx scripts/oqca-bench.ts      # the benchmark, all manifests, all seeds
npx vitest run src/oqca            # 209 tests
bash scripts/oqca-mutate.sh        # 15 mutations, all expected RED
```

---

## ESTABLISHED

Facts about this code, checkable without agreeing to anything.

| Claim                                                                                                                                                                             | How it is established                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The two-level operators are **unitary by construction**, not by rescue. `rotation(θ)` and `mixing(θ, φ)` are parameterised by angle, so there is no normalising factor to forget. | `unitary.test.ts` sweeps 11 angles × 6 phases and asserts `‖U†U − I‖ < 1e-15`; `assertUnitary2` runs on every application.                                         |
| **A pair operator leaves every hypothesis outside the pair exactly where it was.**                                                                                                | `untouched_drift` = 8.3e-17 over 40 seeds. The specification's own operator, run on the same trials, drains 0.2477 and **loses all 10 trials it was measured on**. |
| The specification's `M = [[1, s], [−s, 1]]` **cannot be built here at all** — not merely unused.                                                                                  | `assertUnitary2` and `applyOperator` both throw `NonUnitaryOperatorError`; residual 0.25.                                                                          |
| `EVIDENCE` is exactly Bayes.                                                                                                                                                      | `hypothesis/late-admission`: 40 trials, **zero** discordant pairs against a probability vector, p = 1.                                                             |
| A state's identity is a **content hash of the state**, so replay reproduces it bit for bit.                                                                                       | `formalState.test.ts`; `runBenchmark` twice produces a byte-identical report for every manifest.                                                                   |
| The subsystem **cannot reach the network, a credential, a shell or a deployment**.                                                                                                | `security.test.ts`, 25 banned shapes over every `.ts` in the tree; mutation M15 adds a real `fetch` and it goes red.                                               |
| `node:fs` appears in **exactly one** non-test file, read-only.                                                                                                                    | `security.test.ts`.                                                                                                                                                |
| No clock and no unseeded randomness anywhere.                                                                                                                                     | `security.test.ts` (comments stripped — two files discuss avoiding both).                                                                                          |
| Nothing in ONIQ imports `src/oqca`. It is a measured subsystem, not a feature.                                                                                                    | `grep -rn "oqca" src --include=*.tsx` returns nothing; no migration, no edge function, no publish.                                                                 |
| Categories A / B / C are **enforced**: `ENTANGLE` and `CORRECT` refuse by name rather than returning a plausible answer.                                                          | `cognitive.test.ts`; mutation M10 makes one stop refusing and it goes red.                                                                                         |

---

## EXPERIMENTAL

Measured, reproducible, and **narrow**. Each is a statement about this
benchmark family and about nothing wider.

**On `contextuality/phase-tie-break`, 40 seeds:**

```
oqca_phase vs bayes_uninformed   100.0% [91–100] vs 42.5% [29–58]
                                 discordant 23/0, h=1.72, p<0.0001
oqca_phase vs bayes_informed     100.0% vs 100.0%  discordant 0/0, p=1.0000
oqca_phase vs vector_context     100.0% vs 100.0%  discordant 0/0, p=1.0000
```

- A contextual fact supplied as a **phase** changes which hypothesis the state
  selects, where a bare likelihood vector must break the tie by index order.
  (Control `phase_provides_no_benefit` HELD: 100% with the phase, 50% without.)
- The trials leak nothing: a **random** phase scores 50.0%, and "always name the
  first hypothesis of the pair" scores 50.0%. v1.0's single fixture scored 100%
  on that second strategy.
- The result does not depend on the order hypotheses were written down: 0 of 40
  trials change their answer under a basis permutation.

**And the same run falsifies the interesting reading of it.** All three
`expected_to_fail` controls fell:

- `bayes_with_equivalent_information` — informed Bayes matches OQCA on **all 40
  trials, zero discordant pairs**.
- `classical_vector_can_encode_it` — a real-valued vector with one extra channel
  matches it too, on all 40.
- `information_not_representation` — so the gap against the uninformed control
  **is the information, not the representation**.

The honest summary, which is the sentence `runBenchmark` itself emits:

> The treatment beat 1 of 3 baselines and did NOT beat the rest. The baselines
> it did not beat are the honest ceiling on what this family shows.

Two further experimental facts:

- **Order-sensitivity exists and is not a result.** Reversing the two steps of a
  tie task is byte-identical (2.8e-17), because a reweight scaling both members
  of the pair equally is a scalar on that subspace and commutes with the
  rotation. It changes an answer only when the pair is reweighted **unequally**,
  and on every scored task it moves a confidence and never an answer.
- **The confident number on a tie is the caller's, not the evidence's.**
  `interfere(state, a, b, θ)` rotates mass from `b` into `a`, so naming the pair
  `(B, A)` returns the opposite label at the identical 0.9234 from evidence that
  has not changed by one bit.

---

## UNPROVEN

Nothing here supports any of these, and the brief requires them listed.

| Not claimed                                                        | Why it is not claimed                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AGI**, or any step toward it.                                    | The subsystem is a normalised complex vector with a phase channel, four trial generators and a Bayesian control. There is no learning, no world model and no agency; the loop's `maxToolCalls` default is 0.                                                                                                                                                                  |
| **General reasoning superiority.**                                 | Four of the four benchmark families tie or show no measured advantage; the one divergent comparison is closed by two controls that hand the baselines the same fact.                                                                                                                                                                                                          |
| **Quantum computational advantage.**                               | Everything runs on a classical simulator over a dense amplitude vector. There is no entanglement (`ENTANGLE` is category C and refuses), no superpolynomial structure, and nothing that a probability vector plus one real number was measured to be unable to do.                                                                                                            |
| **Outperforming classical AI generally.**                          | The only classical systems compared against are an exact Bayesian update and a log-linear score vector, on synthetic trials written in this repository. No language model, retrieval system or learned model was benchmarked.                                                                                                                                                 |
| **Requiring quantum hardware.**                                    | `QPUBackend` throws `BackendUnavailable` on every method and names five concrete gaps (vendor SDK, qubit encoding for non-power-of-two bases, circuit synthesis, shot statistics, noise model). No circuit-level test has been run, so QPU compatibility is not claimed — only that the operators are now unitary, which is a **precondition** for it and not evidence of it. |
| That the benchmark says anything about **real decisions**.         | Every trial is synthetic and generated here. CLAUDE.md's standing warning applies in full: reading harder does not produce a byte you do not have. A real verdict needs a replay corpus of real decisions, which does not exist.                                                                                                                                              |
| That `TensorBackend` does anything.                                | `stateToTensor` / `tensorToState` / `tensorNorm` are real; `applyTensorOperator`, `contract` and `measureTensor` refuse by name. No contraction library is in `package.json`.                                                                                                                                                                                                 |
| That the knowledge and loop layers have been run on anything real. | `knowledge/` is an in-memory prototype with no database, and `megaLoop` performs no research and no tool call — `RECORD_ONLY_ACTUATOR` writes an entry and returns. Brief sections 11 and 12 explicitly deferred network research.                                                                                                                                            |

---

## The one sentence

> On synthetic tie-breaking trials, an amplitude state with a phase channel
> carries a contextual fact that a bare likelihood vector was not given — and a
> probability vector given the same fact, or a real vector with one extra
> channel, reaches the identical answer on every trial. The representation was
> not measured to add anything.
