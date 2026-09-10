# OQCA v1.1 — report

Brief section 20. Built on `claude/check-56jtg5`, on top of v1.0 at `40b6320f`.
**Nothing is deployed, published, merged to `main`, or wired to any ONIQ
surface. No paid service, no Python service, no QPU vendor, no network call, no
new recurring cost.**

Read `OQCA_CLAIMS.md` first if you only want the verdict. This is how it was
reached, including the parts that went wrong.

---

## 1. What changed

31 new source files, 3 modified, 5 new test files, 2 scripts, 3 documents.

**New — mathematics** (the physical layer, which knows nothing about hypotheses)

| File              | What it is                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `math/complex.ts` | The complex field, extracted so the physical layer can be read without the cognitive vocabulary.                                |
| `math/unitary.ts` | `rotation(θ)`, `mixing(θ, φ)`, `dagger`, `inverse`, `unitarityResidual`, `assertUnitary2`, `ROTATION_TRANSFERS_TOWARD`.         |
| `math/hash.ts`    | `canonicalJson` + `contentHash` (FNV-1a ×4 → 32 hex). Not collision-resistant against an adversary, and says so.                |
| `operators.ts`    | `QuantumOperator` = `pair \| diagonal \| project \| prepare \| embed`; `applyOperator`; `inverseOperator`; `isUnitaryOperator`. |
| `transition.ts`   | `TransitionRecord` + `toWireRecord` (the brief's snake_case shape).                                                             |

**New — state and cognition**

| File             | What it is                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `formalState.ts` | `CognitiveState`: immutable, hashed, validating, with `snapshot/restore/transition/probabilities/norm/validate`. |
| `cognitive.ts`   | The nine `CognitiveGate`s with their A/B/C categories, plus `phasesFavouring`.                                   |

**New — backends** `backends/{backend,classicalSimulator,qpu,tensor}.ts`

**New — benchmark** `bench/{manifest,trials,arms,stats,adversarial,runner,loader}.ts`,
four manifests under `benchmarks/`, three READMEs for the families that
deliberately hold none.

**New — knowledge and loop** `knowledge/{model,gaps,planner}.ts`, `loop/megaLoop.ts`

**Modified** `state.ts` (re-exports the complex ops instead of duplicating
them), `gates.ts` (`interfere` now builds `rotation(−atan s)`),
`scripts/oqca-mutate.sh` (7 mutations → 15).

**Tests** 209 across 10 files. **Mutations** 15, all RED, none NOTAPPLIED.

---

## 2. Mathematics (brief §2)

The specification's interference is
`a_i' = a_i + s·a_j`, `a_j' = a_j − s·a_i`, then a **global** renormalise.
`MᵀM = (1 + s²)I`, so the pair's norm inflates and the global divide takes that
inflation out of every **other** hypothesis. v1.0 corrected it by dividing the
pair by `√(1+s²)`.

**v1.1 does not normalise anything.** The operator is parameterised by angle:

```
R(θ) = [ cos θ  −sin θ ]        U(θ, φ) = [   cos θ      −e^(−iφ) sin θ ]
       [ sin θ   cos θ ]                  [ e^(iφ) sin θ     cos θ      ]
```

`R†R = I` identically, so there is nothing left to forget. Swept over 11 angles
× 6 phases: residual `< 1e-15` everywhere.

**The v1.0 numbers reproduce bit for bit, and that was checked before any code
was written**, because `cos(atan s) = 1/√(1+s²)` — measured equal to ≤ 1.11e-16
for every strength the suite uses. So the θ-form is the same operator, honestly
derived rather than rescued.

**Orientation is now a named export.** `ROTATION_TRANSFERS_TOWARD = "second"`:
positive θ moves amplitude from the first index toward the second. Measured:
`applyPair(rotation(atan 0.9), m, m) → (0.074329·m, 1.412259·m)`.

Two facts that cost real time and are worth carrying:

- **Only _relative_ phase is observable.** A half-turn on either member of a
  pair gives the identical state. v1.0 had a task pair built on the assumption
  that moving the phase between them mattered; it does not, and the pair was
  incoherent.
- `gates.ts`'s `interfere` negates the angle deliberately, to preserve v1.0's
  argument-order convention. `orientation.test.ts` pins **both** directions,
  because two functions in this repo were briefly named `interfere` with
  opposite orientations.

---

## 3. Gates and categories (brief §3)

`QuantumOperator` (physical) is separated from `CognitiveGate` (meaning), and
`security.test.ts` reads the import graph so the separation cannot invert.

| Operation | Category | Note                                                                                                                             |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| SUPERPOSE | A        | share-based admission of a hypothesis                                                                                            |
| PHASE     | A        | diagonal unitary; invisible until an interference reads it                                                                       |
| INTERFERE | A        | two-level unitary                                                                                                                |
| MEASURE   | A        | argmax / threshold / seeded sample; projection is separate                                                                       |
| RESET     | A        | `prepare` channel                                                                                                                |
| CONTROL   | B        | a classical conditional, not a controlled unitary                                                                                |
| EVIDENCE  | B        | **added.** The brief's eight have no way to fold an observation in. `√likelihood` scaling + renormalise, which is exactly Bayes. |
| ENTANGLE  | **C**    | refuses by name. Nothing here factors a basis into subsystems.                                                                   |
| CORRECT   | **C**    | refuses by name. There is no code, no syndrome and no noise model.                                                               |

C refuses rather than returning a plausible answer, and mutation M10 proves it.

---

## 4. State (brief §4, §5)

`CognitiveState` carries state id, basis labels, complex amplitudes, derived
probabilities and phases, context, active hypotheses, evidence references,
timestep, parent id, operation history, normalisation error and confidence.
Every field is readonly and every method returns a new instance.

`validate()` fails on norm drift (`> 1e-9`), NaN/Inf, dimension inconsistency,
an unknown active hypothesis and a malformed history chain.

**The state id hashes the STATE, not the history**, and that is the one design
decision in this file worth arguing about. The first draft hashed the history
too — and the last record's `toState` names the id, so the id depended on a
record that depended on the id. Every transitioned state failed `validate()`.
The resolution is not a provisional hash: **the id is the state and the history
is the path**, and the chain is verified separately by `historyProblems` linking
each record's `fromState` to the previous `toState`. `restore` recomputes the id
and throws if it differs from the snapshot's.

**The timestamp is a logical counter, not a clock.** `Date.now()` in a hashed
record makes every replay produce a different id, which destroys exactly the
property §4 asks for. A wall-clock reading may be attached as `wallClock` and is
excluded from the hash.

---

## 5. Benchmark methodology (brief §6, §8, §9)

**Every experimental choice lives in a JSON manifest** under
`benchmarks/<family>/<id>.json` — hypothesis, null hypothesis, baselines,
treatment, adversarial controls, seeds, metrics, generator, parameters, and two
required prose fields: `information_note` ("what information each model
receives") and `expected_behaviour`, written before the run so it can be wrong.
The runner loads it; the code owns only mechanics.

Four manifests, 40 seeds each. Three families — memory, transfer, planning —
are directories with a README and no manifest, because inventing a fixture for a
capability the kernel does not have is what v1.0 was corrected for.

**Three representations, all given the same fact in their own currency:**

| Arm                | Receives the contextual fact as                                |
| ------------------ | -------------------------------------------------------------- |
| `bayes_uninformed` | _nothing_ — likelihoods only                                   |
| `bayes_informed`   | an ordinary likelihood vector                                  |
| `vector_context`   | a real-valued feature on a log-linear score vector             |
| `oqca_phase`       | a half-turn of phase                                           |
| `oqca_no_phase`    | the null condition: the phase suppressed, nothing else changed |

**Statistics:** exact paired McNemar on the discordant counts (b, c), Wilson
score intervals, Cohen's h, α = 0.05. Paired because both models see the same
trial. Exact rather than chi-square because these runs have tens of trials, not
thousands. `b + c = 0` gives p = 1 — "no evidence either way" — not a small
number produced by dividing by zero.

**Every generator randomises the answer AND the argument order from the seed.**
That is the fix for v1.0's fatal fixture property: its tie task was solvable by
"always pick the first-named hypothesis", which scored 100%. It now scores 50%,
and `adversarial.ts` measures that rather than assuming it.

---

## 6. Adversarial controls (brief §7)

Eight, each with its `expectation` pinned **before** the run and an `ifFailed`
naming the specific claim that stops being available.

| Control                                | Expected      | Result on `phase-tie-break`               |
| -------------------------------------- | ------------- | ----------------------------------------- |
| `phase_provides_no_benefit`            | survive       | **HELD** — 100.0% with, 50.0% without     |
| `random_phase_produces_gains`          | survive       | **HELD** — a random phase scores 50.0%    |
| `basis_permutation_changes_the_answer` | survive       | **HELD** — 0 of 40 changed                |
| `index_order_artifact`                 | survive       | **HELD** — the dumb strategy scores 50.0% |
| `step_order_changes_the_answer`        | informational | 0 of 40 changed                           |
| `classical_vector_can_encode_it`       | **fail**      | **FELL** — identical, 40/40               |
| `bayes_with_equivalent_information`    | **fail**      | **FELL** — identical, 40/40               |
| `information_not_representation`       | **fail**      | **FELL** — the gap is information         |

Three of eight are expected to FAIL. A suite whose every control passes has not
been adversarial; it has been decorative.

---

## 7. Measured results

```
## contextuality/phase-tie-break   (40 seeds)
  oqca_phase vs bayes_uninformed  100.0% [91–100] vs 42.5% [29–58]
                                  discordant 23/0, h=1.72, p=0.0000
  oqca_phase vs bayes_informed    100.0% vs 100.0%  discordant 0/0, p=1.0000
  oqca_phase vs vector_context    100.0% vs 100.0%  discordant 0/0, p=1.0000
  confidence: treatment 0.9234; uninformed 0.4630, informed 0.8190, vector 0.9967
  CONCLUSION: The treatment beat 1 of 3 baselines and did NOT beat the rest.

## contextuality/tie-no-fact       (40 seeds)   the null condition
  every arm 50.0% / 42.5%, p=0.6476.  NO MEASURED ADVANTAGE.

## hypothesis/late-admission       (40 seeds)   the Bayes bridge
  100.0% vs 100.0%, discordant 0/0, p=1.0000.  Identical, as required.

## interference/untouched-hypothesis (40 seeds)
  100.0% vs 100.0%.  untouched_drift 0.0000 for every arm.
```

**`untouched_drift` is the metric that never moves, and it was driven until it
did.** A check that has never been non-zero has never been tested, so the
specification's own operator was run over the same trials:

```
kernel (unitary)   worst drift  8.3e-17
spec   (draining)  worst drift  0.2477   and it LOSES 10 of 10 trials
```

The trial's truth is a hypothesis _outside_ the pair, favoured by the evidence,
so a model that drains what it never touched loses outright. The kernel cannot
be made to build that operator: `assertUnitary2` and `applyOperator` both throw,
residual 0.25. A second check mis-declares which pair is touched (0.1040 against
0 for the honest declaration), so a stubbed `return 0` is caught too.

---

## 8. Failures, and what they cost

**The benchmark's first run scored 0.0% where chance is 50%.** Not a loss — a
systematic inversion. Measured rather than re-derived: `cognitive.interfere(A, B, +θ)`
favours **B**, and `gates.interfere(A, B, s)` favours **A**. Same verb, same
argument order, opposite orientation. The fixture had guessed.

The fix went into the **kernel, not the fixture**: `phasesFavouring` is now an
exported function that answers "which amplitude must carry the half-turn for X
to win this pair", so a fixture cannot guess it, and `ROTATION_TRANSFERS_TOWARD`
states the convention once. **A single hand-written task would have shown this
as a plausible-looking loss.** Forty randomised seeds showed it as an inversion.

Six more, each caught by running something rather than reading it:

1. **The circular hash** (§4 above).
2. **`unitary.test.ts` asserted 4 decimal places from a 3-decimal probe** —
   0.0742 against a true 0.074329. Both source comments quoting it were wrong too.
3. **A `validate()` branch was unreachable** and the test for it was vacuous:
   `restore` refuses an unknown active hypothesis _first_, because it is in the
   hash payload. Re-tested through `transition`, and the unreachability written
   down as a limit rather than papered over.
4. **A norm-drift test tested nothing** — every operator is norm-preserving and
   `restore` refuses edited amplitudes, so the branch cannot be reached today.
   Replaced with the property it protects: 500 transitions, `normError < 1e-14`.
5. **A budget test's premise was wrong** — the seed graph yields 2 open gaps, so
   a budget of 2 dropped nothing and the assertion was reading the message.
6. **Three loop tests failed from one cause:** `SUPERPOSE` runs _before_
   `EVIDENCE_UPDATE`, so an observation that admits a hypothesis must size its
   likelihoods to the post-admission basis. The loop now refuses up front,
   naming the phase ordering — padding the vector would have **invented** a
   likelihood for a hypothesis nobody has evidence about.

**And the mutation script announced its own staleness rather than lying.** M5's
anchor no longer exists (there is no normalising factor left to delete), so it
printed `NOTAPPLIED`. It was rewritten to inject the specification's raw
non-unitary matrix in full — a stronger test than v1.0's.

**Two findings came out of this work being tested rather than written:**

- `applyOperator` and `inverseOperator` had **no `default` branch**. The switch
  is exhaustive over the union, so `tsc` proves no _typed_ caller reaches it —
  and a transition record replayed from JSON is not a typed caller. An unknown
  `kind` returned `undefined`, which the caller would then treat as an amplitude
  vector. Both now throw. (This is the health lesson again: a type that nothing
  runs is not a guard.)
- The security guard's first draft flagged `backends/tensor.ts`, whose refusal
  message honestly says a contraction library is not in `package.json`, "which
  Lovable owns". A genuine identifier collision, not a prose match — the word is
  in a string and strings are kept on purpose. The pattern was narrowed to call
  and URL shapes, and **the narrowing is proven in the same file**, both
  directions.

---

## 9. Falsified

- **"The amplitude representation decides better."** Informed Bayes matches
  OQCA on 40 of 40 trials with zero discordant pairs. Falsified.
- **"A phase carries something a classical vector cannot."** A real-valued
  vector with one extra channel matches on 40 of 40. Falsified.
- **"The gap against a probability vector is about representation."** It is
  about information. Falsified, by the control written to falsify it.
- **"Order matters" (v1.0's name for three tasks).** Reversing the two steps is
  byte-identical (2.8e-17). The first correction — "reversal never matters" —
  was itself falsified by the corroboration task. Order changes an answer only
  when the pair is reweighted **unequally**, and on every scored task it moves a
  confidence and never an answer.
- **"The specification's operator is usable."** It drains untouched hypotheses
  by 0.2477 and loses 10 of 10 trials in the family built to detect it.

## 10. Surviving

- The phase channel is **not inert**: 100% with, 50% without, p < 0.0001.
- The benchmark **does not leak its answer**: random phase 50.0%, index-order
  strategy 50.0%, basis permutation 0 of 40.
- The operators are **unitary**, and the untouched hypotheses stay untouched at
  floating-point zero.
- `EVIDENCE` **is** Bayes — the bridge every tie family rests on.
- Replay is **deterministic**: the same manifest twice gives a byte-identical
  report.

---

## 11. Known limitations

1. **Every trial is synthetic and written here.** This measures a mechanism, not
   reasoning. A real verdict needs a replay corpus of real decisions.
2. **The phase in `phase_tie_break` is DERIVED FROM THE TRUTH.** It is the fact
   "hypothesis X is the reliable one", and that fact is the answer. So 100%
   measures a _channel_, never an inference. Stated in the manifest, not hidden.
3. **The confident number on a tie is the caller's.** Naming the pair `(B, A)`
   instead of `(A, B)` returns the opposite label at the identical 0.9234.
4. **Grounding of the claim stops at four families.** Memory, transfer and
   planning have no benchmark because the kernel has no such capability.
5. **No QPU claim.** `QPUBackend` refuses every method and names five concrete
   gaps. Unitarity is a _precondition_ for a circuit lift, not evidence of one.
6. **`ENTANGLE` and `CORRECT` do not exist.** Category C, refusing by name.
7. **`contentHash` is not collision-resistant** against an adversary. It is a
   replay identity, not a commitment.
8. **The knowledge and loop layers have never run on anything real.** No
   database, no research, `maxToolCalls` 0, `RECORD_ONLY_ACTUATOR`.
9. **The loop's phase order is load-bearing and slightly surprising:**
   `SUPERPOSE` precedes `EVIDENCE_UPDATE`, so likelihoods must be sized to the
   post-admission basis. It refuses rather than padding.
10. **`untouched_drift` is 0 on every real arm**, by construction. It is only
    ever non-zero for a non-unitary operator, which this kernel cannot build.

---

## 12. Next experiments

In the order they would be worth running, and none of them started:

1. **A family the kernel can currently lose.** Every divergent result so far is
   a channel. A trial where the _phase itself must be inferred_ rather than
   supplied would be the first genuine test — and the likely outcome is that
   nothing here can do it.
2. **Unequal reweighting of the interfering pair**, which is the only condition
   under which order was measured to matter. Whether that is ever _useful_ is
   untested.
3. **A circuit-level test** against `ClassicalSimulatorBackend`: compile a
   `CognitiveState` trace to a gate list, run it, and assert the amplitudes
   match. That is what would make a QPU claim discussable, and it is the
   cheapest of these.
4. **More than two hypotheses in the interfering set.** Everything measured here
   is a two-level rotation.
5. **A real replay corpus.** Without it, limitation 1 stands over everything.

---

## 13. Gates run

```
npx tsc --noEmit                     clean
npm run lint:ci -- src/oqca scripts  clean
npx prettier --check                 clean
npx vitest run src/oqca              209 passed (10 files)
npx vitest run                       full suite green
bash scripts/oqca-mutate.sh          15 RED, 0 GREEN, 0 NOTAPPLIED
npx tsx scripts/oqca-bench.ts        4 manifests, all runs valid
```

**Not deployed. Not published. Not merged to `main`. No paid service, no
network call, no credential, no cost.**
