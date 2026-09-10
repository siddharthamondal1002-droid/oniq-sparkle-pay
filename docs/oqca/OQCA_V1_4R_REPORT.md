# OQCA v1.4-R — Reachable Knowledge Upgrade

**The milestone IS reached, and that is the first sentence rather than the last.**
Shipped ONIQ code reads the knowledge substrate. `story-dispatch`'s cognitive
path builds a store on every tick, ingests the quantum domain through the
promotion policy, retrieves a verified quantum fact, and closes two of the three
gaps its own goal names — through the MIRRORED kernel that a deploy would carry,
not through a test harness.

**And nothing is deployed, published or merged.** The flag still ships `off`, the
spend bounds still ship at zero, `main` is untouched, and a tick at the shipped
defaults still costs **$0**. No migration, no edge-function deploy, no Lovable
message, no credits, no new dependency.

---

## What v1.4-R was asked for, and what happened to each

| Item | Asked                                                          | Outcome                                                                               |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A    | Mirror the substrate into the shared runtime                   | **Done.** The mirror grew 18 → 40 files, by COMPUTATION rather than by a list         |
| B    | Connect it to the real story-dispatch read path, zero spend    | **Done.** `IDENTIFY_GAPS` had refused every run since it was written; it does not now |
| C    | One real execution retrieving verified quantum knowledge       | **Done.** `quantumFactsUsed: 2` on a real shadow run                                  |
| D    | One controlled knowledge upgrade, end to end                   | **Done.** K0 → conflict → K1 → dependents → world → replan, decision flipped          |
| E    | One experimentally verified quantum convention                 | **Done.** A discriminating circuit with a control settles ONIQ's qubit order          |
| F    | Keep `remoteQuantumExecution = false`, `OQCA_MAX_COST_USD = 0` | **Unchanged**, and asserted                                                           |
| G    | Do not add a graph database; benchmark first                   | **Benchmarked, not added.** One arm measured, two stated as unmeasured                |
| H    | Do not populate the five labelled metrics                      | **All five still `null`**, and asserted                                               |

---

## The chain, measured

```
  shipped runtime      supabase/functions/_shared/oqcaRuntime/substrate.ts
    -> mirrored kernel   _shared/oqca/knowledge/substrate/**  (40 files, byte-identical)
      -> store           123 records, 116 VERIFIED, promoted through evaluatePromotion
        -> quantum       118 of them, incl. the §18 discovery verdict for THIS job
          -> decision    quantumFactsUsed 2, gaps 1 open of 3, agreed with production
```

From the shadow run's own comparison row:

```
  knowledgeRecords     123        knowledgeGapsOpen    1
  knowledgeVerified    116        knowledgeGapsTotal   3
  quantumFactsUsed     2          substrateBuildMs     7
  believedBackoffMs    600000     enforcedBackoffMs    600000
  costUsd              0.001046   production writes    sent=0 stamped=0
```

**THAT COST FIGURE IS ARITHMETIC, NOT MONEY**, and the distinction is worth the
line. `oqca-shadow-run.ts` deliberately raises the token budget so the loop
actually reasons, and then charges a RECORDED provider reply at the real
`MODEL_RATES` price — real pricing over recorded usage, so no request left this
container. **At the SHIPPED defaults the figure is $0**, because `maxTokens`,
`maxCostUsd` and `maxToolCalls` are all zero and every model call is refused at
the cost gate. `reachableKnowledge.test.ts` asserts the shipped-default case
separately, and the tool budget of zero is what makes a production write
unreachable rather than merely unchosen.

`quantumFactsUsed` is counted from the PERCEPTS the loop took in, not from what
the store holds. A fact the store carries and nobody retrieved has not reached
the decision — the same distinction a chunk grep cannot make, and the reason
this repo has a receipt for reading one.

---

## Item A — the mirror's entrypoints are computed too

`ENTRY` used to be one hard-coded path. That made the mirror correct for exactly
the tree the cognitive loop reaches and silently wrong for anything else the
runtime imports — and v1.4-R adds two whole subsystems to that read path.

Now every `../oqca/...` specifier under `_shared/oqcaRuntime/**` is a root.
Import a kernel module from the runtime and the mirror grows on the next run;
stop importing one and it leaves. **The list someone forgets to extend is gone
one level up from where the script already avoided it.**

One correctness trap, found while writing it: those specifiers resolve INTO the
mirror, which is the script's own OUTPUT. Closing over it would make the script
check its product against itself — a file that had drifted in `src/` would be
read from the stale copy and reported clean. The roots are rebased onto
`src/oqca` before the closure runs, and `mirror.test.ts` asserts it.

---

## Item B — and the four defects wiring it exposed

**`toKnowledgeState` HAD NO CALLER ANYWHERE IN THE REPOSITORY.** Not the loop,
not a test. `project.ts`'s own header called it one of the substrate's "exactly
two exits"; it was prose. That is this repo's most-recorded failure — "built and
unit-tested is not reachable" — and this time the thing that was unreachable was
the bridge that existed to make something else reachable.

Because nothing had ever looked at the graph it produces, three defects had
never been seen:

1. **Every evidence item was given the RECORD's aggregate confidence.**
   `model.ts`'s `Confidence` belongs to one `Evidence`, so a record holding a
   fetched registry field and a recalled guess gave both the same belief — and
   `detectGaps` takes the max over supporting and over opposing, so every
   dispute read as symmetric. It also made the two scales fail to compose: the
   substrate's confidence saturates at 0.5 for one source by design, while
   `detectGaps` calls a concept VERIFIED at 0.85, so **no substrate record could
   ever settle a gap** and RESEARCH would ask forever about a constant ONIQ had
   read out of its own module. Each item carries its own `evidenceWeight` now.

2. **The dispatch rules were labelled as first-hand readings and were
   paraphrases.** Four sentences about what `isDispatchable` and `dispatchTools`
   do, checked in beside them and never checked against them. Dressing a
   paraphrase as a reading is the pseudo-provenance the whole type exists to
   prevent. They are `spec_cited` + `human_authored` now — weight 0.400,
   confidence 0.286 — so the promotion gate refuses them and they do not reach
   the loop. **That is the correct outcome for a sentence nothing checked**, and
   the fix is to measure the behaviour rather than relabel the sentence.

3. **The backoff VALUE was labelled `derived`**, whose definition is "computed
   here from other records". Nothing is computed: the module is imported and its
   constant read, so the bytes are in hand and the excerpt quotes them. That is
   `fetched`, and calling it `derived` under-rated a first-hand reading at 0.9
   against a document's 1.0.

4. **A belief attached to evidence claiming to be a reading of the code.** The
   first `dispatchRuleRecords` took a bare number and always attached the same
   locator, so a stale value would have carried a citation naming a module that
   says something else — at the exact rung that claims a first-hand reading.
   `BackoffBelief` carries its provenance with it now.

### What the loop knows, and what it still cannot see

```
  dispatch-backoff     VERIFIED   fetched/computed from the deployed constant
  queue-eligibility    VERIFIED   experimentally_verified — isDispatchable, probed
  runner-availability  UNKNOWN    highest priority (0.720), and honestly so
```

`runner-availability` has **no record on purpose**. story-dispatch genuinely
cannot see whether a GPU runner is free — its own header records a film sitting
`queued` for half an hour beside an idle GPU. Writing a plausible sentence about
it would close the one gap that is real.

### The one behavioural consequence, stated as a cost

With real knowledge supplied, RESEARCH now has a gap to ask about, the research
adapter refuses (as it is designed to), and the recovery ladder escalates —
which a headless run correctly reports as `blocked`. **Before, the loop ran to
`success` while having identified no gaps at all**, which is a success with
nothing to be incomplete about. The decision is unchanged and still agrees with
production. Making `runner-availability` answerable is real follow-on work and a
spend question (an API call per tick), not a tweak.

---

## Item D — one controlled knowledge upgrade

`npx tsx scripts/oqca-knowledge-upgrade.ts`, artifacts in
`docs/oqca/knowledge-upgrade/`:

```
  enforced backoff (code)  10 min   <- never moves
  production decision      8f2c1a

  K0   believed 60 min (2 x fetched/human_authored)  VERIFIED conf 0.615
       actions available 2      decision  dispatch story job b71e04    agreed false
  NEW  rival pairs 1   strategy measured_precedence   competing kept 2 (nothing deleted)
  DEP  derived from K0: queue-eligibility ruleIs
  K1   believed 10 min (measurement/fetched)          VERIFIED conf 0.487
       actions available 3      decision  dispatch story job 8f2c1a    agreed true

  DECISION CHANGED            true
  UPGRADE RESTORED AGREEMENT  true
  believed vs enforced, K0    3600000 vs 600000       production writes sent=0 stamped=0
```

**The stale belief costs the 41-minute-old film its turn** — the exact failure
story-dispatch's own header records — and the upgrade is what brings the loop
back into agreement with production.

### A changed VALUE is a conflict, not a supersession

`supersede()` requires both records to share an id, and the id hashes
subject|predicate|**object**. So two different backoff values are two different
assertions and §8's conflict machinery is what adjudicates them; supersession is
for the same assertion re-verified. Both are in the substrate and only one fits
here — getting that backwards is the first thing this would have got wrong.

### The fixture was wrong first, and the substrate was right

A SINGLE stale note reaches confidence 0.286, the gate refuses it, and
`believedBackoff` falls back to the enforced constant — so the "stale" run was
indistinguishable from the fresh one. **The substrate was working; the fixture
was not.** Two agreeing notes reach 0.615.

### And that is what exposed the ordering defect

`evidence_weight` is ADDITIVE, so two agreeing release notes (2 × 0.800 = 1.600)
out-weigh one reading of the deployed constant (0.950). The substrate would have
adopted a stale document's number over the value it had just read out of the
running module, **with a rationale that reads perfectly**. Nothing said so until
a knowledge-upgrade fixture put the two side by side.

`measured_precedence` is the fix, and it is narrow: it fires only when exactly
one side rests on a `measurement` of the subject and no rival does. Corroboration
genuinely counts for a claim about the WORLD; for a claim about a system ONIQ can
OBSERVE, the system is the authority on itself and a description of it is
second-hand however many copies exist.

### The belief never reaches an authorization site

`isDispatchable(job, now, backoffMs?)` — the belief reaches `worldFrom` and
`likelihoodsFrom`. It reaches `productionChoice`, the tool REGISTRY filter and
the tool's own `authorize` **never**: all three omit the argument and get the
constant, and the parameter is defaulted so the safe value is what you get for
saying nothing. Two mutations (M97, M98) prove it.

---

## Item E — a convention settled by experiment

`experimentally_verified` is the sixth `Directness` rung and ONIQ's **second
route to knowledge**. Every other rung describes a document somebody else wrote,
so a container that cannot reach the network is a container that cannot learn.
It can still MEASURE.

```
  X on qubit 1, 2 qubits, 512 shots, seed 7   ->  "01"     big-endian predicts 01
  the CONTROL, X on qubit 0                   ->  "10"     little-endian predicts 10
  verdict                                          big_endian
```

Three properties are enforced rather than described: the predictions are
**pre-registered literals** and `settle` only looks an outcome up in them; the
**control must differ** or the outcome is void (a backend answering "01" to
everything would otherwise "confirm" big-endian); and an outcome no registered
convention predicts is a **refusal, never a new entry**.

It runs inside `ingestQuantumKnowledge`, so the record is a measurement of THIS
build rather than a number somebody copied forward — 2 qubits, one gate,
microseconds, no network, no credential, no money.

### The weight is 1, and the rung is load-bearing anyway

The scale is capped at 1 by construction — every factor in `evidenceWeight` is
in [0,1] and `promotion.ts` sets its threshold from that arithmetic — so a rung
above 1 would silently rewrite the promotion table. What distinguishes an
experiment is not more weight but `experimental_precedence`, which is checked
before `measured_precedence` and after `divergent_by_design`. **An experiment on
ONIQ's own backend can never delete Qiskit's convention**: §23's case is answered
first, and `conflicts()` requires the same subject anyway.

### Two proposed rungs are deliberately absent

- **EXTRACTED** is `ExtractionMethod` — how a claim came OUT of an artefact,
  orthogonal to how far the artefact is from an observation. A model extraction
  from a fetched page and a direct quotation from one are the same directness
  and very different evidence; collapsing the axes loses exactly that.
- **CROSS_VERIFIED** is a property of the RECORD, not of one item:
  `minIndependentSources` and the additive score already carry it. As a
  directness it would let a SINGLE item claim corroboration it cannot have —
  pseudo-provenance, which is what the type exists to prevent.

The dispatch domain gained the same route: `queue-eligibility` is now
`experimentally_verified` because `eligibilityProbe` runs `isDispatchable`
against three rows straddling the window and records the result, instead of
paraphrasing what the function does.

---

## Item G — the store was benchmarked; no graph database was added

`npx tsx scripts/oqca-store-benchmark.ts`, artifacts in
`docs/oqca/store-benchmark/`:

```
  corpus                  123 records (116 VERIFIED), 184 concepts, 116 relations
  full tick build         min 5.20 ms   median 6.17 ms   max 25.34 ms

  all()                          37.36 us     get(id)                    5.13 us
  byStatus(VERIFIED)             37.22 us     dependentsOf(backoff)     47.43 us
  bySubject(...)                 35.70 us     lookup(goal, 8)          467.17 us
  byDomain(quantum)              36.14 us     detectGaps(goal)          25.80 us
                                              toKnowledgeState        2866.29 us
```

**MEASURED ARMS: 1 of 3, and the other two are absent rather than zero.** Apache
Jena is a JVM dependency `package.json` would have to carry (Lovable owns that
file); Apache AGE is a Postgres extension on a project this container cannot
reach and must not migrate. A one-armed benchmark reported as a comparison is
the unfair-baseline failure §16 exists to name, so it is not reported as one.

What one arm CAN answer is the question §20 actually asks: **is the existing
store a bottleneck on ONIQ's real workload?** Every query the shipped runtime
makes answers in tens of microseconds over a hundred-odd records, and the whole
tick — ingesting 118 quantum records, running the convention experiment, probing
`isDispatchable`, promoting 123 records and projecting the graph — is six
milliseconds. A triple store cannot make that faster in any way a person would
notice. **No graph database is added.** Revisit when one of those numbers moves.

---

## What is still true, and what is not

**Deliberately not built:** the store does not persist. It is rebuilt per tick
and discarded, because a durable knowledge table is a migration and a write path
and v1.4-R's own instruction is that the first integration is read-only.
`substrateGap()` says so on every lookup rather than in a design note. One
consequence is architectural: `conflict.ts` is NOT in the mirror, because a store
with no history has no rivals to adjudicate — it becomes shipped code the day the
store persists, and the mirror will grow to include it without anyone editing a
list.

**A finding recorded and NOT acted on:** `SUPERPOSE` admits one prerequisite per
iteration in `goal.requires` DECLARATION order and never consults the gap
detector (station 06 runs before station 09). So which prerequisites become
hypotheses is a fact about how many iterations ran, not about what is still
unknown — and `queue-eligibility`, VERIFIED at 0.85 from ONIQ's own probe, is
still admitted as a hypothesis on iteration 1. Changing it to prefer the
highest-priority open gap is three lines and a different change.

**Not proven:** nothing here has run on production. The flag is off, no function
was deployed, and every number above comes from tests and from scripts run in
this container against fixtures and recorded provider replies. The gate for the
next milestone is a scheduled tick on production writing a real comparison row —
and that is a non-zero-budget decision, which is the owner's.

---

## Gates

```
  vitest src/oqca            638 tests across 23 files
  whole suite               (see the closing report)
  tsc --noEmit              clean
  npm run lint:ci           clean
  prettier                  clean
  node scripts/oqca-mirror.mjs --check    clean, 40 files
  deno check story-dispatch/index.ts      clean
  scripts/oqca-mutate.sh    102 mutations, every one RED, none GREEN, none NOTAPPLIED
```
