# OQCA — what was built, and what it is worth

> ## v1.5 — the loop runs itself, across two processes, with nobody asking.
>
> - **[`OQCA_V1_5_REPORT.md`](OQCA_V1_5_REPORT.md)** — the three capabilities.
> - **[`autonomous-run/console.txt`](autonomous-run/console.txt)** — four OS
>   processes, verbatim; only `checkpoint*.json` crosses between them.
>
> ONIQ generates its own objective, ranks what to learn on the six-factor
> function, runs the 23 stations against knowledge it built itself, blocks,
> spawns a follow-up, continues to the next objective, checkpoints to disk —
> and a **separate process** restores that checkpoint and carries on. **What it
> cannot do is learn**: there is no research capability and the substrate is
> rebuilt per tick, so `learned` is empty on every run and is reported empty.
>
> ### Four things worth carrying
>
> - **The brief's "freshness" factor had to be oriented as DEMAND.** Taken
>   literally, a claim unverified for a year scores near zero and is never
>   looked at again — the silent inversion of what maintenance is for.
> - **`maxEpisodes` was read against the LIFETIME counter**, so a restored
>   runtime was dead on arrival. No single-process test can see that.
> - **An all-blocked backlog reported `idle`** — a system announcing it has
>   nothing left to learn while it is stuck. `idle` / `blind` / `stalled` are
>   three different empties now.
> - **The maintenance path is unreachable in production**, because nothing
>   persists so nothing ages. Recorded rather than papered over with a fixture.
>
> Nothing is deployed, published or merged; the flag still ships `off`; $0.

> ## v1.4-R — the substrate is REACHABLE from shipped code.
>
> - **[`OQCA_V1_4R_REPORT.md`](OQCA_V1_4R_REPORT.md)** — items A through H.
> - **[`knowledge-upgrade/`](knowledge-upgrade/)** — one controlled K0 → K1 upgrade.
> - **[`store-benchmark/`](store-benchmark/)** — the store, on ONIQ's real queries.
>
> `story-dispatch`'s cognitive path builds a knowledge store on every tick,
> ingests the quantum domain through the promotion policy, retrieves a verified
> quantum fact, and closes two of the three gaps its goal names — through the
> MIRRORED kernel a deploy would carry. `IDENTIFY_GAPS` had refused every run
> since it was written; it does not now. **Nothing is deployed or published**,
> the flag still ships `off`, and a tick still costs $0.
>
> ### Four things worth carrying
>
> - **`toKnowledgeState` had no caller anywhere in the repository** — not the
>   loop, not a test — while `project.ts` called it one of the substrate's
>   "exactly two exits". Because nothing had ever looked at the graph it
>   produces, three defects in it had never been seen.
> - **Additive evidence weight let two stale documents out-vote a reading of the
>   running module** (1.600 vs 0.950), with a rationale that reads perfectly.
>   `measured_precedence` is the fix; a knowledge-upgrade fixture is what
>   exposed it.
> - **A convention is now settled by EXPERIMENT.** A discriminating circuit with
>   a control returns `01` where little-endian predicts `10`, so
>   `experimentally_verified` is a rung ONIQ earns rather than asserts — and a
>   second route to knowledge that does not need the network.
> - **The store is not a bottleneck**: every real query in tens of microseconds
>   over 123 records, the whole tick in 6 ms. No graph database was added, and
>   the two unmeasured arms are reported as absent rather than as zero.

> ## The Quantum Knowledge Substrate sits UNDER the general one.
>
> - **[`OQCA_QUANTUM_KNOWLEDGE_REPORT.md`](OQCA_QUANTUM_KNOWLEDGE_REPORT.md)** — the §28 report.
> - **[`quantum/`](quantum/)** — seventeen pages, one per brief section.
>
> The upgradation spec's §15 settled the architecture: _"The Quantum Knowledge
> Substrate should become one domain adapter under the general Knowledge
> Substrate."_ So there is ONE substrate — `src/oqca/knowledge/substrate/` —
> and `src/oqca/quantum/` is a domain that feeds it. Quantum facts go through
> the same promotion policy as anything else ONIQ will ever learn.
>
> **The milestone IS reached here:** the substrate is read by the real
> 23-station loop. `ingestQuantumKnowledge` fills a store, the store is wrapped
> as the v1.3 knowledge seam, `runCognitiveLoop` runs all 23 stations against
> it, and every fact comes back with a source reference.
>
> ### Three numbers worth carrying
>
> - **113 records ingested; 109 VERIFIED, 4 CONTESTED, 0 REJECTED.** The four
>   contested ones are the library disagreements §23 forbids normalising.
> - **~200 rows deliberately NOT ingested.** The concept, algorithm and domain
>   PROSE was written from training with no document fetched, which is
>   `recalled` — weight zero, unpromotable. What ONIQ has _encountered_ stays
>   prose; only what it has _verified_ becomes a record.
> - **Deutsch-Jozsa's exponential separation does not survive a fair
>   baseline.** Measured: the deterministic classical cost runs 5 → 1,025 over
>   n = 4..12 and the randomised one runs 6 → 8, flat. Bernstein-Vazirani's
>   separation does survive, and it is LINEAR.
>
> **Nothing is deployed, published or merged to `main`. $0 spent.**
>
> ---

> ## v1.2 is the current state. It made OQCA REACHABLE.
>
> - **[`OQCA_V1_2_REPORT.md`](OQCA_V1_2_REPORT.md)** — the full v1.2 report.
> - **[`OQCA_CLAIMS.md`](OQCA_CLAIMS.md)** — ESTABLISHED / EXPERIMENTAL / UNPROVEN.
>
> **v1.2 in three lines.** The 23-station loop is wired to one real ONIQ job —
> `story-dispatch`'s "which queued Story film goes out next" — through a
> byte-identical mirror of its kernel that runs in Deno, a `callText` model
> adapter that prices every call before making it, and a tool router over the
> spend ledger ONIQ already had. **The feature flag ships OFF, nothing is
> deployed, and no live traversal has happened.**
>
> ### The milestone is NOT yet reached, and that is stated first
>
> The brief's own words: the milestone "is no longer '23 stations exist.' It is
> 'a real ONIQ job traversed those stations and came back with a measurable
> result.'" **No such traversal has occurred.** What exists is the wiring, the
> gates, the comparison record and 38 mutation-checked guards. Turning it on is
> the owner's, and `OQCA_V1_2_REPORT.md` section H says what it costs ($0 at
> the shipped budgets).
>
> ### Three defects v1.2 found in the v1.1 kernel, by wiring it to something real
>
> - `ask()` **never priced a call before making it**, so section 21's
>   `estimatedCost <= remainingCostBudget` was not enforced — only "is there any
>   headroom left".
> - PLAN derived `touchesProduction` from `reversible`. A story dispatch is
>   **both** reversible and a production write, so it declared itself as not
>   touching production — **and shadow mode gates on exactly that field.**
> - `reversible` was a **regex over the action's name**, which cannot know that
>   `dispatch story job X` writes to production.
>
> ---
>
> ## v1.1 — the falsification. Still true, still the honest verdict.
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

**v1.2 — the runtime. Impure by design, and the path is the boundary.**

The kernel stays inert. Everything that spends money, writes to production or
reads a clock lives OUTSIDE `oqca/`, is handed in as a seam, and is deliberately
not walked by `security.test.ts` — which walks BOTH `src/oqca/` and the mirror.

| File                                       | What it is                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `scripts/oqca-mirror.mjs`                  | Computes the loop's import closure and mirrors it. `--check` is the test's assertion; the fix is to run it |
| `supabase/functions/_shared/oqca/**`       | The mirrored kernel — 13 files, byte-identical, the copy that runs in Deno                                 |
| `_shared/oqcaRuntime/pricing.ts`           | The price boundary over `searchBudget.ts`. `null` = refuse, never 0                                        |
| `_shared/oqcaRuntime/engine.ts`            | The model adapter. Names no provider, so it stays testable                                                 |
| `_shared/oqcaRuntime/provider.ts`          | The ONE line that names `callText`                                                                         |
| `_shared/oqcaRuntime/toolRouter.ts`        | Closed registry, mode gate, property check, then the EXISTING authorization boundary                       |
| `_shared/oqcaRuntime/dispatchJob.ts`       | The job: goal, world, likelihoods, tools, verifier                                                         |
| `_shared/oqcaRuntime/dispatchEnv.ts`       | PostgREST + GitHub. The only file in the runtime with a `fetch`                                            |
| `_shared/oqcaRuntime/memory.ts`            | Working memory, and the persistence gap stated rather than papered over                                    |
| `_shared/oqcaRuntime/episode.ts`           | §13 record, §14 verdicts, §16 reflection, §17 response class                                               |
| `_shared/oqcaRuntime/flag.ts`              | `off` / `shadow` / `assisted`. Anything else — including a typo — is `off`                                 |
| `_shared/oqcaRuntime/shadow.ts`            | The runner, the comparison, and replay (which takes no seams at all)                                       |
| `_shared/oqcaRuntime/storyDispatchHook.ts` | The one caller. Cannot throw                                                                               |

**Commands**

```
npx vitest run src/oqca            317 tests across 14 files
npx tsx scripts/oqca-bench.ts      every manifest, every seed, the full report
node scripts/oqca-mirror.mjs       re-mirror the kernel into the edge tree
node scripts/oqca-mirror.mjs --check   what the mirror test asserts
bash scripts/oqca-mutate.sh        38 mutations, every one expected RED
deno check supabase/functions/story-dispatch/index.ts
```

The mutations that matter most are the ones that would make OQCA look BETTER
than it is: a fixture that stops isolating the phase, a control task handed an
interference, a summary sentence that always claims a win, the central
falsification control deleted from a manifest, a drift metric stubbed to zero —
and, added in v1.2, shadow mode performing a production write, an unpriced model
costing nothing, and a `handled` flag read from the loop's opinion rather than
from what the environment says happened.

**M22 is the one to read.** It drifts the mirror, and it reported ESCAPED on its
first run: `mirror.test.ts` imports the mirror script, an ES module runs its body
on import, and importing it RE-RAN the mirror — repairing the drift before a
single assertion executed. The test passed on a genuinely broken mirror and
nothing green ever said so. _A check that has never failed has never been
tested._

## If this is taken further

The honest next step is **not** more gates. It is a replay corpus: real
decisions ONIQ already logs, where the ground truth is known afterwards and
nobody chose the phases to make a point. Every fixture in `tasks.ts` was written
here, and this repo has the receipt for what invented fixtures cost — the UPI
investigation spent two days auditing a payload that was never wrong, because
every test that "proved" it ran against a QR fixture invented in this container.
**Reading harder does not produce a byte you do not have.**

Until then the claim is exactly the one measured above, and no wider.
