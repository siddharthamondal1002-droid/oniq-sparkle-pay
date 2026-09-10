# ONIQ Quantum Knowledge Substrate — implementation report

Branch `claude/check-56jtg5`. Nothing is deployed, published, or merged to
`main`. No QPU vendor, no recurring cloud spend, no new dependency, no Lovable
message, no credits.

---

## 1. What was asked and what was delivered

Two documents arrived together and §15 of the second settled the architecture
between them:

> **"The Quantum Knowledge Substrate should become one domain adapter under the
> general Knowledge Substrate."**

So there is ONE substrate. `src/oqca/knowledge/substrate/` is general — records,
evidence, provenance, promotion, conflict, decay, store, projection, metrics —
and `src/oqca/quantum/` is a domain that feeds it. Quantum facts go through the
same promotion policy as anything else ONIQ will ever learn.

**The headline, stated first rather than last:** the substrate is reached by the
REAL 23-station loop. `ingestQuantumKnowledge` fills a store, the store is
wrapped by `makeSubstrateKnowledgeAdapter`, `runCognitiveLoop` runs all 23
stations against it, and the knowledge seam answers real quantum queries with a
source reference on every fact. That is the upgradation spec's phases 8 and 9,
and `oksLoopIntegration.test.ts` is where it runs.

## 2. The measured shape

|                                                      | Count                     |
| ---------------------------------------------------- | ------------------------- |
| Source ecosystems, harvested from PyPI               | 18                        |
| Concepts (§3), each with a counterexample            | 27                        |
| Algorithms (§6), each naming a classical alternative | 18                        |
| Gates, every invariant computed                      | 19                        |
| Domains (§7–§14)                                     | 8                         |
| Semantic divergences (§23)                           | 4                         |
| Refusing backend adapters (§15)                      | 15                        |
| Categorised objects (§20)                            | 8                         |
| Classical baselines (§16)                            | 4                         |
| Experiments (§17)                                    | 5 (4 runnable, 1 blocked) |
| Knowledge records ingested                           | 113                       |
| Mutations, all RED                                   | 84                        |
| Tests in `src/oqca`                                  | 579 across 22 files       |

## 3. The ingestion, and what it refuses to ingest

```
total      113
VERIFIED   109
CONTESTED    4      the four divergences, by design
CANDIDATE    0
REJECTED     0
```

By predicate:

```
isUnitary                19      computed at ingest
hasDemonstratedAdvantage 18      every one FALSE — no benchmark exists here
hasReleasedVersion       16      fetched from PyPI
hasLicense               16      fetched from PyPI
isHermitian              12      computed
isInvolutory             12      computed
implementsDomain          8      computed by resolving exports
hasOpenGaps               8      computed
oniqConventionIs          4      CONTESTED
```

**Three families are deliberately NOT ingested**, and this is the most important
decision in the whole build. The 27 concept definitions, 18 algorithm
descriptions and 8 domain summaries were written from training with no document
fetched — which under `evidence.ts` is `recalled`, weight **zero**, and the
promotion gate refuses a claim whose every support is recalled, by name.

Ingesting them anyway would produce ~200 rows that can never be believed, and
the "fix" that would follow is relabelling recall as a citation to make the
numbers look better. So the prose stays in its modules as ONIQ's independently
authored representation (§2's preference) and `NOT_INGESTED` says so in code.

**What ONIQ has encountered stays prose; only what it has verified becomes a
record.** That is the upgradation spec's core principle, made visible.

## 4. §16 — the result that justifies the whole method section

Four experiments run on the local simulator for **$0**:

```
dj_unfair    q 1  vs  c 5     UNFAIR: baseline denied randomness and bounded error
dj_fair      q 1  vs  c 6     fair, at matched error <= 0.01
dj_scaling   deterministic 5 -> 1025 over n=4..12   (doubling per qubit)
             randomised    6 -> 8                    (FLAT)
bv_fair      q 1  vs  c 4     fair; recovered 1011 exactly
grover       BLOCKED: no arbitrary-width multi-controlled Z for the diffuser
```

**Deutsch-Jozsa's exponential separation is a fact about the classical machine
being denied a coin, not about the problem.** Bernstein-Vazirani's survives the
same treatment and is LINEAR, not exponential. Same textbook chapter, same
circuit shape, opposite conclusions once the baseline is treated fairly.

`fairnessCheck` refuses the word "superior" for an unfair pair and names every
axis on which the baseline was short-changed. The unfair run still reports its
numbers — hiding the comparison would hide the thing §16 exists to expose.

## 5. §18 — discovery, run against ONIQ's real problems

```
story_dispatch     no_matching_structure
health_extraction  no_matching_structure
shot_allocation    classical
vault_retrieval    classical
```

That IS the answer for this codebase, not a placeholder. A pipeline that could
not return "classical" would be a recommendation engine rather than a decision
procedure. The `quantum_candidate` and `not_executable_here` branches are both
reachable and both tested, so the four-way answer is real.

## 6. §18 (spec) — the ten metrics, computed

```
provenanceCoverage   1.0000     every record has the four required steps
rollbackIntegrity    1.0000     every journal prefix replays, checked AGAINST
                                the journal rather than against another replay
stalenessRate        0.1593     the 18 event_driven advantage records, which are
                                stale by construction; 1.0 a year later
contradictionRate    0          no conflicts detected in this ingestion
UNMEASURED (null)    knowledgePrecision, knowledgeRecall, resolutionAccuracy,
                     upgradeGain, falsePromotionRate
```

**The five nulls are the point.** They need a labelled ground-truth set and
there is none, so they return `null` and never 0 — a dashboard rendering them as
zero would be showing five fabricated numbers.

## 7. §21 — security, and the defaults that refuse

```
remoteQuantumExecution   false
maxQuantumCostUsd        0
maxSimulatedQubits       14
maxShots                 100_000
```

`security.test.ts` walks `src/oqca/**` and finds no `fetch`, no
`XMLHttpRequest`, no `WebSocket`, no credential name, no cloud CLI, no deploy
call, no filesystem write and no clock. `QPUBackend` refuses on the POLICY
before it looks at anything else, so enabling the flag alone creates no vendor.

Two files are exempt from the **URL ban only** — `sources.ts` and
`knowledge.ts`, which carry provenance locators §9 requires — and every other
ban still applies to them, asserted file by file. Mutation M84 widens the
exemption to a third file and goes red.

## 8. Defects found by running it, not by reading it

Nine, each of which shipped green and would have stayed:

1. **The promotion threshold was unreachable.** `minConfidence: 0.6` against a
   curve that caps one perfect source at 0.5 — so the whole substrate refused
   everything at exactly 0.500, and the policy's own comment said one
   authoritative source should suffice. Found by 113/113 coming back CANDIDATE.
2. **The store lost every retired row.** `supersede()` REQUIRES the two records
   to share an id, and the store wrote the retired row and its replacement under
   that same key — so the second write always won and no supersession in the
   history of the module had ever kept its predecessor. §21's "do not erase
   historical knowledge" was broken for every case it applied to.
3. **`rollbackIntegrity` could not detect a store that ignores its journal.** It
   compared each prefix against another replay; a stub returning the current
   state scored a perfect 1. It reads the journal now.
4. **The simulator keyed counts by the whole quantum register.** A
   Bernstein-Vazirani circuit's unmeasured ancilla appeared in every answer:
   every amplitude right, every comparison wrong.
5. **Discovery read "a fair experiment mentions this" as support.** `dj_fair` is
   a fair experiment whose entire finding is that Deutsch-Jozsa has NO
   advantage, and both DJ algorithms were being recommended off the back of it.
6. **The growth test read a saturating curve as growth.** `last > first` on
   6,7,8,8,8 says "grows"; the tail is what says "bounded".
7. **The ingestion never recorded WHEN it verified anything**, so every record
   was born stale and the decay metric read 1.0000 forever — indistinguishable
   from a metric that computes nothing.
8. **`discovery.ts` looked up a category with a key that can never be in the
   map**, and the `?? "PHYSICAL_QUANTUM"` fallback returned the right answer for
   the wrong reason.
9. **Two implementations of `stalenessRate`** — one in `decay.ts`, one
   re-derived in `metrics.ts`. The metric delegates now.

And one in the tooling: **M70 reported NOTAPPLIED** because its anchor matched
twice. The script announced it instead of printing a verdict — the fourth time
that branch has earned its place.

## 9. Guards that were narrowed, with the narrowing proven

- **The clock ban** flagged three substrate files whose only use is
  `Date.parse(e.retrievedAt)`. `Date.parse`, `Date.UTC` and `new Date(<string>)`
  are pure and cannot make a replay differ; `Date.now()`, an argless
  `new Date()` and `performance.now()` are the clock. Seven assertions prove
  both directions in the same file.
- **The credential ban** flagged `experiments.ts` for the word `secret` —
  Bernstein-Vazirani's hidden string. Renamed `hiddenString`, which is the
  standard term anyway. **The guard was not weakened.**
- **A URL literal in a test** was rewritten as a regex literal so the URL ban
  keeps full width rather than gaining a third exemption for convenience.

## 10. A stated limit rather than a claim

The compensating check for the URL exemption asserts that no whole URL survives
in executable text. **Measured: a URL assembled from string pieces passes it** —
`executableText` masks both literals. That is asserted as the gap rather than
described, because the real guarantee is that every network primitive is banned
in those files without exemption (M-A: a real `fetch` in `sources.ts` goes red
on two tests). A string no call can consume is a citation whatever it is made of.

## 11. What was incorporated, by ecosystem

All eighteen are in the manifest with a measured version and licence. **No source
code was copied from any of them.** What was taken is knowledge OF them:

| Ecosystem                     | What ONIQ carries                                                 |
| ----------------------------- | ----------------------------------------------------------------- |
| Qiskit 2.5.2                  | gate/circuit conventions; the endianness divergence; adapter spec |
| Qiskit Aer                    | the depolarizing-parameter divergence                             |
| Cirq                          | gate-naming divergence; adapter spec                              |
| qsimcirq, Qulacs              | tensor/state simulation as a domain; adapter specs                |
| Stim                          | QEC represented, and why nothing is built                         |
| Qualtran, ReCirq              | adapter specs only                                                |
| OpenFermion                   | the chemistry mapping layer as knowledge                          |
| TensorFlow Quantum, PennyLane | QML constructs, parameter-shift, barren plateaus                  |
| QuTiP                         | open-system channels                                              |
| PyZX                          | ZX represented, and #P-hard extraction named                      |
| pytket, BQSKit                | compilation and synthesis as knowledge                            |
| Mitiq (GPL-3.0)               | error mitigation named as ABSENT; nothing taken                   |
| quimb                         | tensor-network constructs                                         |
| Qiskit ecosystem              | listed in the manifest                                            |

## 12. §27 — what remains outstanding

**ONIQ does not have all quantum computing knowledge and nothing here claims it
does.** `coverage()` computes the gap ledger: **8 domains, 6 with some
implementation, 2 knowledge-only, 24 named gaps.**

Knowledge-only (represented, nothing built):

- **Quantum error correction** — no code, no stabilizer, no syndrome, no
  decoder. The state vector is unfactored, so there is no code space.
- **ZX calculus** — no diagram type, no rewrite engine, no extraction.

Named gaps in the six that do have implementations:

- **QML** — no optimiser, no training loop, no autodiff, no dataset, no
  benchmark, no barren-plateau diagnostic.
- **Noise** — no device calibration, no crosstalk, no correlated noise, no error
  mitigation.
- **Compilation** — no transpiler at all: no decomposition, placement, routing or
  synthesis.
- **Tensor networks** — no MPS, no SVD, no truncation, no contraction.
- **Chemistry** — no Hamiltonian construction, no basis set, no fermionic
  operator, no qubit mapping, no VQE, no Trotter.
- **Hardware** — no device is reachable and none may be.

Also outstanding: `grover_scaling` is blocked on the diffuser's
multi-controlled Z; the five ground-truth metrics have no labelled set; no
graph adapter (Jena/AGE) has been evaluated — §12 says not to add one before
benchmarking it against the real workload.

## 13. Deviation from the recommended module layout

The upgradation spec's §19 recommends `src/oqca/knowledge/{model,ingestion,
graph,retrieval,validation,reasoning,evolution,provenance}/`. What was built is
flat: `src/oqca/knowledge/substrate/*.ts`.

Recorded as a deviation rather than glossed. The mapping is one-to-one —
`record.ts` + `evidence.ts` + `provenance.ts` + `conflict.ts` are `model/`;
`promotion.ts` + `decay.ts` are `evolution/`; `store.ts` is the KnowledgeStore
abstraction; `project.ts` is `retrieval/`; `metrics.ts` is `benchmarks/`. The
`graph/`, `ingestion/` and `reasoning/` trees are **absent because nothing fills
them**: §12 says not to add a graph before benchmarking one, and §16 forbids
unbounded acquisition, so an `ingestion/` tree with no connector would be an
empty promise.

## 14. What is NOT built, by explicit instruction

No Python service. No standing endpoint. No QPU vendor. No cloud spend. No new
`package.json` dependency. No network research. No autonomous acquisition — §16:
"No unbounded crawling or autonomous acquisition. Every source connector must
have an explicit authorization boundary."

Retrieved document text is never treated as authority; nothing in this tree
reads a document at all.

## 15. Gates

```
tsc --noEmit                 clean
npm run lint:ci              clean
prettier --check             clean
oqca-mirror.mjs --check      clean (18 files)
deno check (runtime chain)   clean
vitest src/oqca              579 tests / 22 files
vitest (whole suite)         6,779 tests / 380 files (see §15a)
scripts/oqca-mutate.sh       84 mutations, 84 RED, 0 GREEN, 0 NOTAPPLIED
```

### 15a. One flake, reported rather than rounded off

The FIRST full-suite run showed `1 failed | 6778 passed`. Two clean re-runs
immediately after both showed **6,779 / 6,779 across 380 files**, and the
failing name was not captured before the output rolled.

Recorded as an unattributed flake rather than as "the known ARAP one", because
this file has no evidence that it was. The repo does carry a documented timing
flake (`arapStep11dDiagnosis`, which passes alone), and it is the likeliest
candidate — but a likeliest candidate written down as a fact is how a wrong
diagnosis becomes settled, which this repo has receipts for.

## 16. Cost

**$0.** Every experiment ran on the local state-vector simulator under a policy
whose remote flag is false and whose cost ceiling is zero. No Lovable message
was sent and no credits were spent.

## 17. Final SHA

Recorded at the end of the session in `docs/oqca/README.md` and in the commit
message. Nothing is deployed, published or merged.
