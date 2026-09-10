# OQCA — what was built, and what it is worth

> ## v1.1 is the current state. Read these two first.
>
> - **[`OQCA_CLAIMS.md`](OQCA_CLAIMS.md)** — ESTABLISHED / EXPERIMENTAL / UNPROVEN.
> - **[`OQCA_V1_1_REPORT.md`](OQCA_V1_1_REPORT.md)** — the full v1.1 report.
>
> **What v1.1 changed, in three lines.** The interference operator is now
> parameterised by ANGLE, so it is unitary by construction rather than by
> rescue. The single 7-task fixture became a benchmark FAMILY: four manifests,
> 40 randomised seeds each, three baselines, eight adversarial controls, and
> exact paired McNemar statistics. And the v1.0 headline below **did not
> survive that** — see the next box.
>
> ### The v1.1 verdict, and it is a falsification
>
> ```
> contextuality/phase-tie-break, 40 seeds
>   oqca_phase vs bayes_uninformed  100.0% vs 42.5%  discordant 23/0  p<0.0001
>   oqca_phase vs bayes_informed    100.0% vs 100.0% discordant  0/0  p=1.0000
>   oqca_phase vs vector_context    100.0% vs 100.0% discordant  0/0  p=1.0000
> ```
>
> All three `expected_to_fail` controls FELL. Given the identical fact, a
> probability vector reaches the identical answer on **40 of 40** trials, and so
> does a real-valued vector with one extra channel. **The gap against the
> uninformed control is the information, not the representation** — which is
> what v1.0's single row could only assert and v1.1 measured.
>
> Two v1.0 fixture properties also turned out to be defects, found by
> randomising the answer: its tie task was solvable by "always name the first
> hypothesis" (100% then, 50% now), and the first v1.1 generator got the
> operator's ORIENTATION backwards and scored 0% where chance is 50%. A single
> hand-written task shows that as a plausible-looking loss.

A "quantum-inspired cognitive architecture" specification (OQCA v1.0, 40
sections) was handed to this repo on 2026-09-10. This is the kernel of it,
built in TypeScript in `src/oqca/`, and benchmarked against a Bayesian control.

**Read the verdict first, because it is smaller than the specification's own
framing and that is the point.**

## The v1.0 verdict, kept because v1.1 corrected it

Everything in this section is the v1.0 measurement. It is accurate as far as it
goes and it is superseded: one hand-written row cannot support a claim, which is
precisely what v1.1 was built to establish.

```
OQCA 7 vs Bayes 6 of 7

ok   ok    flat prior, one decisive observation            OQCA 0.8000/0.1000/0.1000  BAYES identical
ok   ok    strong prior overturned by evidence             OQCA 0.0098/0.9872/0.0030  BAYES identical
ok   ok    weak evidence must not overturn a strong prior  OQCA 0.8791/0.0659/0.0549  BAYES identical
ok   ok    accumulating weak evidence does overturn it     OQCA 0.0676/0.8019/0.1305  BAYES identical
ok   ok    CONTEXT: corroboration sharpens                 OQCA 0.8711/0.0574/0.0714  BAYES 0.6429/0.2857/0.0714
ok   MISS  CONTEXT: a tie, and a fact that breaks it       OQCA 0.0026/0.9234/0.0741  BAYES 0.4630/0.4630/0.0741
ok   ok    CONTEXT: the same tie, the fact absent          OQCA 0.9234/0.0026/0.0741  BAYES 0.4630/0.4630/0.0741
```

**That 7–6 is one row, and OQCA won it by being handed a fact Bayes was never
given.** On the divergent task the likelihoods are `[0.5, 0.5, 0.2]` twice, so
the probability vector reaches a dead tie (A = B = 0.4630) and breaks it by
index order. OQCA is additionally told, as a half-turn of phase on B, a third
thing about the situation — and lands on B at 0.9234. `benchmark.test.ts`
asserts the control that keeps this honest: **give Bayes the same fact as an
ordinary likelihood and it reaches B at over 0.8.**

So the measured claim is narrow and it is a claim about REPRESENTATION, not
about reasoning:

> The amplitude state has somewhere to put a piece of context that a
> probability vector has nowhere to put. It does not infer that context, and it
> does not decide better once both models have it.

Nothing here approaches the specification's framing of an architecture that
"reasons in superposition". It is a state with a phase channel, and the phase
is a number the caller supplies.

## The three limits, each measured

**1. On a genuine tie, the confident number is set by the caller's argument
order.** `interfere(state, a, b, s)` rotates mass from `b` into `a`. On the
"fact absent" task, naming the pair `(A, B)` gives A at 0.9234; naming it
`(B, A)` gives **B at 0.9234**, from evidence that has not changed by one bit.
A reader who does not know that will read 0.9234 as a fact about the evidence.

**2. Order-sensitivity is real but conditional, and no scored task shows it
deciding anything.** These tasks were named "ORDER MATTERS" until it was run.
Reversing the two steps of the tie tasks returns a byte-identical posterior
(max difference 2.8e-17), because a `reweight` that scales both members of the
interfering pair by the SAME likelihood is a scalar on that 2-D subspace and
commutes with the rotation. Order changes the answer only when the pair is
reweighted UNEQUALLY — measured at 0.0959 → 0.0034 on a task built for it, with
Bayes byte-identical either way. And on every scored task, reversal moves a
confidence and never an answer (0.8711 → 0.8597, still A).

**3. Four of the seven tasks are built so OQCA cannot win them.** With only
`reweight`, OQCA _is_ Bayes — the test asserts identical distributions to 12
decimal places, not merely the same answer. A suite where OQCA swept would mean
the tasks were built to flatter it.

## Two defects in the specification, measured rather than argued

**`interfere` as specified drains every hypothesis it does not touch.** The
spec's operation on the pair is `a_i' = a_i + s·a_j`, `a_j' = a_j - s·a_i`, then
a global renormalize. `M = [[1, s], [-s, 1]]` satisfies `MᵀM = (1 + s²)I`, so it
inflates the pair's norm and the global divide takes that inflation out of every
_other_ hypothesis. Three equal hypotheses, `s = 0.5`, interfering only the
first two:

```
start    H2 = 0.3333
after 1  H2 = 0.2857      after 4  H2 = 0.1700
after 2  H2 = 0.2424      after 8  H2 = 0.0774
```

H2 loses 77% of its probability without one word of evidence about it. In the
spec's §18 "Mega Quantum Loop", which interferes every iteration, any hypothesis
outside the pair is driven to zero by arithmetic alone. `gates.ts` divides the
PAIR by `√(1+s²)` instead; H2 then holds 0.3333 through eight rounds.

**And that same correction is what makes the spec's §23–24 QPU adapter
possible.** Hardware executes unitaries. A linear map plus a renormalize is not
one, so the specified operator could never have been lifted onto a QPU at all.
Every gate here is norm-preserving on its own and `assertUnitary2` is exported
so a new one has to prove it.

Smaller corrections, each recorded at the code: `superpose` takes a SHARE rather
than a raw amplitude (the spec's version gives a different result on the third
call than the first, for the same argument); `damp`'s `A(t) = A₀e^{-λt}(1 + βI)`
is applied per-amplitude with independent λ, which does not preserve the norm,
so the result is not a state at all; and `measure` defaults to the MAXIMUM, not
to sampling — a benchmark whose rows are coin flips measures the coin.

## What was NOT built, and why

The specification asks for a Python/FastAPI service, a knowledge graph with gap
detection, a four-layer memory, a research/verification pipeline, a world model,
a continuous loop and a QPU backend. **None of that is here.**

The owner answered "[No preference]" to both the runtime and the first-target
questions. Under this repo's first working agreement — business decisions are
the owner's — _no preference is not authorization to start a monthly bill or to
spend on the metered Google key_. A standing Python service and a continuous
loop each do exactly that. So the scope was set by the rule, not by taste:
**the part that can be measured for zero money, measured.** This is recorded as
an ENGINEERING decision (see CLAUDE.md), following the 2026-09-06 Play Billing
precedent for a delegated choice.

TypeScript rather than Python for the same reason: ONIQ's only deployable
surfaces are the Lovable-published bundle and 64 Deno edge functions. The one
Python tree in this repo, `runtime/arap-cpu/`, has a README saying its image has
never been built. A second unbuilt runtime would not have been an architecture.

## Files

**v1.1 — the physical layer, which knows nothing about hypotheses**

| File              | What it is                                                               |
| ----------------- | ------------------------------------------------------------------------ |
| `math/complex.ts` | The complex field, extracted so the physics can be read on its own       |
| `math/unitary.ts` | `rotation` `mixing` `dagger` `inverse` `unitarityResidual`, swept-tested |
| `math/hash.ts`    | `canonicalJson` + `contentHash` — replay identity, not a commitment      |
| `operators.ts`    | `pair` `diagonal` `project` `prepare` `embed`; channels say so in `kind` |
| `transition.ts`   | The brief's snake_case transition record; logical timestamp, not a clock |

**v1.1 — state, cognition, backends**

| File                          | What it is                                                             |
| ----------------------------- | ---------------------------------------------------------------------- |
| `formalState.ts`              | `CognitiveState` — immutable, hashed, validating, replayable           |
| `cognitive.ts`                | The nine gates with A/B/C categories; `ENTANGLE`/`CORRECT` refuse      |
| `backends/classicalSimulator` | The only backend that runs                                             |
| `backends/qpu.ts`             | Refuses every method and names five concrete gaps                      |
| `backends/tensor.ts`          | Conversions real; contraction refuses. No library is in `package.json` |

**v1.1 — the benchmark**

| File                   | What it is                                                          |
| ---------------------- | ------------------------------------------------------------------- |
| `bench/manifest.ts`    | The machine-readable experiment; the runner loads it, never guesses |
| `bench/trials.ts`      | Four generators; every one randomises the truth AND the order       |
| `bench/arms.ts`        | Five arms; every trial carries its fact in all three currencies     |
| `bench/stats.ts`       | Exact paired McNemar, Wilson intervals, Cohen's h                   |
| `bench/adversarial.ts` | Eight controls, three of them expected to FAIL                      |
| `bench/runner.ts`      | Pure; refuses to name a winner the design does not support          |
| `bench/loader.ts`      | The only file in the subsystem that touches `node:fs`               |
| `benchmarks/*/*.json`  | Four manifests, 40 seeds each; three families hold a README instead |

**v1.1 — knowledge and loop, neither run on anything real**

| File                   | What it is                                                      |
| ---------------------- | --------------------------------------------------------------- |
| `knowledge/model.ts`   | Concept / Evidence / Relation / Confidence / Context, in memory |
| `knowledge/gaps.ts`    | UNKNOWN / UNCERTAIN / CONTRADICTED / VERIFIED, a pure function  |
| `knowledge/planner.ts` | Information gain per unit cost. Performs no research            |
| `loop/megaLoop.ts`     | 18 phases, bounded, pausable; `maxToolCalls` defaults to **0**  |

**v1.0 — still here, still passing**

| File                                    | What it is                                                         |
| --------------------------------------- | ------------------------------------------------------------------ |
| `state.ts` `gates.ts`                   | The v1.0 kernel; `interfere` now builds its rotation from an angle |
| `measure.ts`                            | maximum / seeded-sample / threshold policies, entropy              |
| `baseline.ts` `benchmark.ts` `tasks.ts` | The v1.0 Bayesian control and its seven tasks                      |

**Commands**

```
npx vitest run src/oqca        209 tests across 10 files
npx tsx scripts/oqca-bench.ts  every manifest, every seed, the full report
bash scripts/oqca-mutate.sh    15 mutations, every one expected RED
```

The mutations that matter most are the ones that would make OQCA look BETTER
than it is: a fixture that stops isolating the phase, a control task handed an
interference, a summary sentence that always claims a win, the central
falsification control deleted from a manifest, and a drift metric stubbed to
zero.

## If this is taken further

The honest next step is **not** more gates. It is a replay corpus: real
decisions ONIQ already logs, where the ground truth is known afterwards and
nobody chose the phases to make a point. Every fixture in `tasks.ts` was written
here, and this repo has the receipt for what invented fixtures cost — the UPI
investigation spent two days auditing a payload that was never wrong, because
every test that "proved" it ran against a QR fixture invented in this container.
**Reading harder does not produce a byte you do not have.**

Until then the claim is exactly the one measured above, and no wider.
