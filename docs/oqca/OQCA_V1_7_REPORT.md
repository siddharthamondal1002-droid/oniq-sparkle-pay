# OQCA v1.7 — the autonomous ONIQ self-improvement loop

Owner directive, 2026-09-11. Twenty-five sections, one objective:

> ONIQ continuously observes ONIQ, discovers useful improvements, learns what is
> required, verifies its conclusions, applies only authorized changes, measures
> the result, persists what it learned, and autonomously selects the next
> improvement.

Built on `claude/check-56jtg5` from the v1.6 baseline `af55b689`.

## The state, first

    deployed        NO
    published       NO
    main merged     NO
    money spent     $0 — no Lovable message, no credits, no provider call
    dependencies    none added
    flag            unchanged; `OQCA_STORY_DISPATCH` still ships `off`
    spend bounds    unchanged; maxTokens / maxCostUsd / maxToolCalls still 0

## What is reached and what is not

**REACHED.** The full §1 lifecycle runs. Six real OS processes, sharing nothing
but two JSON files, observed ONIQ, ranked concerns from what they saw, chose an
objective nobody asked for, retrieved verbatim evidence, verified it through the
promotion policy, persisted it through a §12-authorized capability, ran the real
23 stations against the upgraded knowledge, measured before and after, compared,
and continued to the next objective. `docs/oqca/self-improve/console.txt` is the
record and `scripts/oqca-self-improve.ts` re-runs it.

**NOT REACHED.** Nothing was _changed_ about ONIQ. §12's registry has nine
capabilities and three are authorized — run the test suite, run static analysis,
write to the knowledge store — and the host executes only the third. What ONIQ
improves is **what it knows about itself**, measured; what it does not do is
edit configuration, rebuild an artifact or modify its own cognition. Those are
registered and `authorized: false`, and `executeCapability` refuses them by
name. §28's self-modification stays behind the separate gate the 2026-09-10
directive put it behind.

## The autonomous loop path, as run

    BOOT              scripts/oqca-self-improve.ts
    RESTORE           makeSinkCheckpointStore + makeSinkDurableStore
    OBSERVE ONIQ      makeSystemObserver over the real import graph
    WORLD STATE       buildWorldState — nine claims, each with provenance
    GENERATE          planImprovements -> objectivesFromImprovements -> ONE backlog
    KNOWLEDGE GAPS    knowledgeNeeds -> SKIP_RESEARCH | RESEARCH
    PRIORITIZE        selectObjective (user requests first, then score)
    RESEARCH          makeLocalEvidenceResearch — verbatim, located, hashed
    VERIFY            evaluatePromotion — the only path to belief
    UPDATE KNOWLEDGE  executeCapability(UPDATE_KNOWLEDGE) -> durable.save
    HYPOTHESIS/PLAN   design() — hypothesis, arms, variables, controls, seed
    CHECK CAPABILITIES v1.6's ledger, unchanged
    ACT / OBSERVE     runCognitiveLoop — the real 23 stations
    MEASURE           residualUncertainty before and after
    COMPARE           compare() — refuses to call a tie a win
    DIAGNOSE/RECOVER  v1.6's capability vocabulary, unchanged
    LEARN / PERSIST   learned vs settled vs persisted, three separate claims
    SELF-EVALUATE     selfEvaluate — eight questions, tri-state answers
    NEXT OBJECTIVE    continue; no user prompt anywhere in the chain

## §18 — the four-process proof

Four invocations, `--dir docs/oqca/self-improve`, sharing only `checkpoint.json`
and `knowledge.json`:

    P1  restored false  generated 46  learned 3 (runner-availability)  persisted 3
    P2  restored true   generated  1  learned 3 (motion_failure)       persisted 3
    P3  restored true   generated  2  learned 0                        persisted 3
    P4  restored true   generated  1  learned 0                        persisted 0

Per episode, the measured metric:

    P1 #0   restored 0   1.000 -> 0.125   IMPROVED
    P1 #1   restored 3   1.000 -> 1.000   NO_DIFFERENCE
    P1 #2   restored 3   1.000 -> 1.000   NO_DIFFERENCE
    P2 #3   restored 3   1.000 -> 1.000   NO_DIFFERENCE
    P2 #4   restored 3   1.000 -> 1.000   NO_DIFFERENCE
    P2 #5   restored 3   1.000 -> 0.125   IMPROVED
    P3 #6   restored 6   0.125 -> 0.125   NO_DIFFERENCE     <- THE PROOF
    P3 #7   restored 6   1.000 -> 1.000   NO_DIFFERENCE
    ...

**Episode #6 is the critical line.** It is the FIRST episode of the THIRD
process, and its baseline is 0.125 rather than 1.000 — because the SECOND
process wrote those records to `knowledge.json` and this one restored them. A
later process started from where an earlier one finished, and nothing but a JSON
string crossed between them. That is §18's compounding claim, measured rather
than asserted.

The controlled version of the same claim is
`selfImproveLifecycle.test.ts` → "the second invocation starts from a baseline
the first one lowered", where both invocations can be handed the same objective
and the same sinks and nothing else.

## §10 — known versus genuinely learned

`settled`, `learned` and `persisted` are three fields and three claims.

- **settled** — what the objective asked for and now holds.
- **learned** — what THIS episode moved. A record already VERIFIED in the store
  is re-promoted, re-persisted and **not counted**. The first live run reported
  "3 learned, 3 persisted" beside a verdict of NO_DIFFERENCE — a follow-up
  re-retrieving the same three lines. That is v1.5's over-claim in a second
  place, and M144 now catches it.
- **persisted** — durable row ids the store CONFIRMED. Never the count handed to
  it; a sink that writes nothing reports `ok: false` and `persisted: []`.

At the end of the four processes the durable store holds **6 rows**, every one
VERIFIED at exactly 0.500 — which is what `scoreConfidence` computes for one
first-hand item and no more. Each carries a real file, a real line number and
the content hash of the file it was read from.

## §9 — research retrieves; it does not answer

`makeLocalEvidenceResearch` searches a corpus the host supplies (ONIQ's own OQCA
trees, 171 modules, hashed) and returns VERBATIM lines with the locator, the
source version and the content hash. `directness: "fetched"`,
`extraction: "direct_quotation"` — which is why one item reaches the promotion
threshold, and why anything ONIQ merely recalled would weigh zero.

Three refusals are distinguished, because collapsing them is how a fabricated
negative gets in:

    empty corpus            REFUSE   searching nothing establishes nothing
    no usable search term   REFUSE   nothing was asked
    searched, found none    ok, []   an ESTABLISHED negative over a corpus in hand

The EXTERNAL adapter (`makeResearch`, the paid `smart-scout` path) still refuses
unconditionally, and `v13Wiring.test.ts` now scopes its ban to that function's
body with the narrowing proven in the same file.

**MIN_SUBSTANCE was added after the first live run, and it made ONIQ claim
less.** Asked about `motion_failure`, the corpus answered with
`"motion_failure",` — the concept's own entry in `OBSERVATION_KINDS`. Verbatim,
located, hashed, true, and the question read back. A line must now retain some
content once the search terms are struck out.

**A stated limit, measured and not fixed.** After that rule, `motion_failure`
matched a COMMENT in `research.ts` explaining the `motion_failure` example — the
prose match, this repository's twelfth, arriving in the research corpus. Good
comments quote what they discuss. Stripping comments would destroy the good
result to kill the bad one: every genuinely informative `runner-availability`
finding is also a comment. There is no reliable syntactic rule separating "prose
about the concept" from "prose about the concept's name", and inventing one is
what this repo warns against. What bounds the claim instead is the predicate:
`is_documented_as` says the concept is documented as that line, and nothing
more.

## §13 — the measurable, and why it is not a count

The metric is `objective_residual_uncertainty`: the sum of `detectGaps`'
per-concept uncertainty over the objective's own requirements. Lower is better;
zero means every requirement is settled.

**The first version counted open gaps and made the whole demonstration
vacuous.** `openGaps` drops only VERIFIED concepts, and `detectGaps` calls a
concept VERIFIED at support ≥ 0.85 with mean evidence volatility ≤ 0.2. A line
retrieved from a source file is `slow` knowledge — someone can edit the file —
which `project.ts` maps to a belief volatility of 0.25. So a perfectly good
first-hand retrieval leaves the concept UNCERTAIN, the count does not move, and
every experiment answers NO_DIFFERENCE. Measured: three records retrieved,
promoted and persisted, gaps 1 → 1.

The wrong fix was to relabel the record `stable` so the threshold clears. The
right one was to measure what actually changed: 1.000 → 0.125.

## Defects found by running it, not by reading it

1. **`dependencyOf` zeroed every score.** It returned `others / min(total, 6)`,
   which is 0 for any subject no other observation mentions — and six multiplied
   factors mean one zero annihilates the other five. Every concern scored
   0.000000 and `planImprovements` ranked ALPHABETICALLY. The plan was
   non-empty, ordered, reproducible and completely uninformed. `detectGaps` had
   it right all along: `1 + dependents/(n-1)`, at least 1, a boost and never a
   veto.

2. **`tsc` had never looked at four new files.** `tsconfig.json`'s `include` is
   `src/**` only, so a file under `supabase/functions/` is typechecked only when
   something under `src/` reaches it. The first draft of `improvement.ts` called
   `ctx.staleness?.()` — a field `SubstrateContext` has never had — and
   `tsc --noEmit` came back clean. Found by noticing that a property which
   cannot exist was passing; confirmed by `deno check`, which then also caught
   `applyPromotion` imported from the wrong module. The v1.7 test files now
   import all four runtime modules, which is what puts them in the program.

3. **The run contradicted its own caller about research.** The episode retrieved
   while station 10 held `NO_RESEARCH`, so one run reported research as both
   available and unavailable; `unavailable()` reads the refusal, the successful
   retrieval became invisible, and every experiment came back BLOCKED while
   records were being learned and persisted. `LoopInput` now carries a research
   seam.

4. **`learned` counted re-promotion.** Above, §10.

5. **Nineteen objectives from one fact.** A runtime with no observer wired filled
   its backlog with "establish how to observe X" for every kind, from the single
   fact that nothing is wired — `maxBacklog` left doing the policy work. The
   world state still reports all nineteen UNOBSERVED rows (§3 lives there); the
   PLANNER now runs only when an observer actually answered.

6. **A genuine name collision.** `observe.ts` took a clock parameter called `at`,
   and `_shared/oqca/quantum/math/linalg.ts` exports a function called `at`, so
   `edgeImports.test.ts` reported the file using a helper it never imported. Its
   local-binding detector knows declarations and class methods, not parameters.
   Renamed `stampAt` rather than widening a guard to admit a two-letter name.

## §23 — mutation testing

28 new mutations, M135–M162, one per line of §23's own list:

    objective generation     M135        knowledge promotion      M143
    prioritization           M136 M137   learned vs settled       M144
                             M138        baseline measurement     M145
    knowledge-gap detection  M139        improvement measurement  M146 M147
    knowledge persistence    M140 M141   capability blocking      M148 M149 M150
                             M142        research honesty         M151 M152 M153
    observation tri-state    M154 M155   reconsideration          M156
    checkpoint persistence   M157 M159   cross-process restore    M158
    objective continuation   M160 M161   self-evaluation          M162

**162 mutations in total, every one RED, none GREEN, none NOTAPPLIED.**

Six escaped on the first run and each escape was a test that was not testing:

- **The baseline was RED and the verdicts were read anyway.** The script's own
  first line says "must be green before any verdict counts". Two mutations that
  reported RED under a red baseline reported GREEN under a green one.
- **M140** — the round-trip fixture had every list field empty, so a mutation
  that DROPPED a list produced `[]` either way and the content hash matched. A
  fixture whose fields are all at their default tests only the defaults.
- **M146** — the mutation reaches `compare`'s FINAL return; every existing
  assertion hit an EARLY return whose flag is written inline.
- **M143, M147, M153, M161** — no assertion existed for the hole each opened.
- **M155** — a stale multi-line anchor. `NOTAPPLIED`, announced rather than
  reported as a verdict, for the sixth time that fix has earned itself.

## The gate

    tsc --noEmit                              clean
    npm run lint:ci (30 changed files)        clean
    prettier --check                          clean
    node scripts/oqca-mirror.mjs --check      clean, 50 files (was 44)
    deno check (4 new runtime modules +
      story-dispatch chain)                   clean
    npx vitest run src/oqca                   27 files / 780 tests
    npx vitest run (whole suite)              385 files / 6,981 tests
    bash scripts/oqca-mutate.sh               162 RED, 0 GREEN, 0 NOTAPPLIED

## §22 — what was preserved

- **Capability authorization.** Registered ≠ authorized; both checked, above the
  executor, failing with different reasons. `CapabilityRequest` carries an id
  from a closed union and bounded string args — there is no command, path,
  script or url field, so arbitrary execution is not expressible rather than
  merely forbidden.
- **Credential isolation.** `security.test.ts` still walks `src/oqca/**` AND the
  mirror with 26 bans and finds no fetch, no clock, no credential, no URL. The
  four new runtime modules hold seams; `scripts/oqca-self-improve.ts` is the
  only file in the chain that touches a disk.
- **Provider boundaries.** No provider was called. The external research adapter
  still refuses; `REQUEST_RESEARCH` is registered and not authorized.
- **Auditability.** Every episode record carries `persisted`, the experiment
  verdict and the eight self-evaluation answers; the snapshot carries the
  baselines, the failure log and the experiment ledger.
- **Idempotency.** `mergeDurable` upserts by `knowledge_id` keeping the higher
  version; the content-derived objective id dedupes a regenerated objective onto
  its existing row.
- **The recovery system and the security scanners** are untouched.

## Limitations, stated as limitations

- **Nothing was changed about ONIQ.** See "what is not reached".
- **`settled` is 0 on every live episode.** The loop terminates
  `capability_unavailable` at the shipped zero model budget, and a retrieved
  line reaches UNCERTAIN rather than VERIFIED, so no objective's requirements
  are ever fully closed. Both are honest and both are v1.6/§13 behaviour rather
  than defects.
- **The corpus is thin.** See the `motion_failure` limit above.
- **§14's motion objective emerged and is BLOCKED.** `motion_failure` is one of
  the nineteen observation kinds, the host reports it UNOBSERVED, an objective
  is generated for it from the general architecture with no motion-specific code
  anywhere — and what ONIQ can learn about it from its own repository is thin,
  because **no motion metric exists**: `grep -rn "export function .*[Cc]ontinuity"
src` returns nothing. A motion improvement therefore reaches
  IMPROVEMENT_UNVERIFIED, which is §13's own instruction rather than a gap.
- **No live cross-process capability recovery.** With the shipped seams no
  capability is ever observed returning inside a real run; requirement 8 is
  proven by test, as in v1.6.

## Cost

    Lovable messages        0
    credits                 0
    provider calls          0
    money                   $0
