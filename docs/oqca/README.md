# OQCA — what was built, and what it is worth

A "quantum-inspired cognitive architecture" specification (OQCA v1.0, 40
sections) was handed to this repo on 2026-09-10. This is the kernel of it,
built in TypeScript in `src/oqca/`, and benchmarked against a Bayesian control.

**Read the verdict first, because it is smaller than the specification's own
framing and that is the point.**

## The verdict

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

| File                     | What it is                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `src/oqca/state.ts`      | Immutable complex state, normalization, `CollapsedStateError`                              |
| `src/oqca/gates.ts`      | `superpose` `interfere` `phase` `reweight` `damp`, all unitary or explicitly renormalizing |
| `src/oqca/measure.ts`    | maximum / seeded-sample / threshold policies, entropy                                      |
| `src/oqca/baseline.ts`   | The Bayesian control — the thing OQCA has to beat                                          |
| `src/oqca/benchmark.ts`  | The harness, written so it can report a loss                                               |
| `src/oqca/tasks.ts`      | Seven tasks; five of them OQCA cannot win                                                  |
| `scripts/oqca-mutate.sh` | Seven mutations, every one RED                                                             |

`npx vitest run src/oqca` — 33 tests. `./scripts/oqca-mutate.sh` — the mutations
that matter most are the ones that would make OQCA look BETTER than it is: a
fixture that stops isolating the phase, a control task handed an interference,
and a summary sentence that always claims a win.

## If this is taken further

The honest next step is **not** more gates. It is a replay corpus: real
decisions ONIQ already logs, where the ground truth is known afterwards and
nobody chose the phases to make a point. Every fixture in `tasks.ts` was written
here, and this repo has the receipt for what invented fixtures cost — the UPI
investigation spent two days auditing a payload that was never wrong, because
every test that "proved" it ran against a QR fixture invented in this container.
**Reading harder does not produce a byte you do not have.**

Until then the claim is exactly the one measured above, and no wider.
