# OQCA v1.2 — the first reachable ONIQ cognitive job

Branch `claude/check-56jtg5`. Nothing is deployed, published, merged to `main`,
or turned on. The feature flag ships **off**, and off is `story-dispatch`
behaving exactly as it did before this existed.

**A real ONIQ job has traversed all 23 stations and come back with a measurable
result** — and the qualification matters as much as the claim: the traversal ran
HERE, against a fixture queue and a recorded provider reply, not on production.
Section C states exactly what was real and what was not. Nothing has run on
production and no live model call was made.

**Making it reachable found nine defects.** Five were in the v1.1 kernel and
four were in this integration; every one of them shipped GREEN — tsc clean, the
suite passing, no station refusing — and the loop was silently wrong. They are
listed in G, and each now has a mutation that goes red.

---

## A. Reachability

The exact call path from a scheduled tick to the loop and back.

```
Supabase cron
  └─ POST /functions/v1/story-dispatch
       authorizeScheduledCaller(req)                    unchanged
       read story_jobs?status=eq.queued&…&limit=1       unchanged, still ONE row
       ── if OQCA_STORY_DISPATCH=assisted ─────────────────────────────
       runOqcaForDispatch()          _shared/oqcaRuntime/storyDispatchHook.ts
         └─ runShadow()              _shared/oqcaRuntime/shadow.ts
              ├─ readQueue()         _shared/oqcaRuntime/dispatchEnv.ts (≤20 rows)
              ├─ worldFrom / perceptsFrom / likelihoodsFrom  dispatchJob.ts
              ├─ runCognitiveLoop()  _shared/oqca/loop/cognitiveLoop.ts  23 stations
              │    ├─ engine.estimate → wouldBreach → engine.run
              │    │      makeEngine  oqcaRuntime/engine.ts
              │    │      callText    oqcaRuntime/provider.ts → _shared/llm.ts
              │    ├─ VERIFY  → makeVerifier(env)     reads the queue back
              │    └─ ACT     → router.estimate → wouldBreach → router.execute
              │           makeToolRouter  oqcaRuntime/toolRouter.ts
              │             mode gate  → shadow refuses production writes
              │             authorize  → isDispatchable(FRESH row)
              │             paying?    → withProviderSpendGuard (the ledger)
              │             perform    → stampDispatched, sendDispatch, readJob
              ├─ buildEpisode()      oqcaRuntime/episode.ts
              └─ memory.consolidate([episode])         oqcaRuntime/memory.ts
       ── production pick and dispatch, unchanged ──────────────────────
       ── if OQCA_STORY_DISPATCH=shadow: runOqcaForDispatch() AFTER the send ──
```

### The job, and what was rejected

**"Which queued Story job should be dispatched next, and should one be
dispatched at all."** Chosen by measurement:

| candidate         | why not                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`smart-scout`** | the richest shape — a goal, `web_search` as a real tool, real external results, an existing spend guard — but a **live, paid, user-facing** path whose decision is prose. |
| **`story-sweep`** | discrete and shadow-safe, but its rule is `age > TTL && has_bytes`. Nothing to reason about, so a model call there would be theatre — and it **deletes**.                 |
| **`study-tutor`** | highest volume, lowest stakes, but its "observation" would be the model's own answer. §10 rules it out.                                                                   |

`story-dispatch` wins on every axis §2 names: the decision is **discrete** (one
job id or none), so §8's agreement is an equality test; the observation is
**external**; it is **scheduled**, so shadow cannot change any user's result by
construction; and its production action is safe by its own design — its header
records that a dispatch which lands on no runner leaves the job available.

**Assisted mode can only narrow.** OQCA proposes; `authorize` re-reads the row
and requires the existing rule to agree. The worst case of a wrong pick is a
film dispatched _later_, never one dispatched that should not have been.

---

## B. Architecture — what is pure and what is at the boundary

|                                          |                                                                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`src/oqca/**`**                        | the kernel. No fetch, no credential, no clock, no tool, no model.                                                                                                                                                                                 |
| **`supabase/functions/_shared/oqca/**`** | the same 13 files, **byte-identical**, mirrored so Deno can run them. `security.test.ts` walks BOTH trees with the same 26 bans — a guarantee asserted over one copy and not the other is not a guarantee, and the mirror is the copy that ships. |
| **`_shared/oqcaRuntime/**`**             | the boundary. Holds the fetch, the credential and the clock. Deliberately **not** walked.                                                                                                                                                         |

The path _is_ the boundary. Asserted: exactly one runtime file reaches the
network (`dispatchEnv.ts`), exactly one names `callText` (`provider.ts`), and
the only host named anywhere in the runtime is `https://api.github.com`.

The kernel receives five seams, each with a refusing default: `Engine`,
`ToolRouter`, `Verifier`, `Clock`, `MemoryStore`. `Engine` and `ToolRouter` each
have an `estimate` half, so §21's `estimatedCost <= remainingCostBudget` is
enforced before every call and `null` becomes an `unpriced` **bound**.

---

## C. Real execution — one complete shadow run

`npx tsx scripts/oqca-shadow-run.ts`; artifacts in `docs/oqca/shadow-run/`
(`chain.json`, `episode.json`, `comparison.json`, `stations.json`), and the same
traversal is asserted by `src/oqca/__tests__/shadowRun.test.ts`.

**What was real:** the loop, all 23 stations, the engine adapter, the tool
router, the mode gate, the job, the verifier, the pricing (real `MODEL_RATES`),
the episode, the memory adapter, the chain and the replay.

**What was not:** the queue is a three-row fixture and the provider is a
recorded reply. `*.supabase.co` is proxy-blocked from this container, and a live
model call is a spend nobody authorised for a script. So the token counts are
the adapter's arithmetic over a recorded reply — real pricing, recorded usage.

```
COMPLETE SHADOW EXECUTION — runId shadow-0001, mode shadow

  production decision      8f2c1a
  OQCA decision            dispatch story job 8f2c1a
  agreement                true
  confidence / margin      0.8570 / 0.7140

  stations run             92        (23 stations x 4 iterations)
  state transitions        33        every one on the persisted chain
  terminated               max_iterations
  verdict                  rejected — 2 job(s) still dispatchable after 1 action(s)
  response class           blocked

  model calls              16 (0 refused)
  tokens in / out          3559 / 960
  estimated cost           $0.006170
  charged cost             $0.002330
  tool attempts / refused  0 / 4
  production writes        sent=0  stamped=0
  episodes persisted       0
  wall clock               21 ms

  REPLAY FROM DISK         CLEAN — every id re-derived, every link held
```

**The verdict is `rejected` and that is correct, not a failure of the run.**
Shadow mode refused all four dispatch attempts, so the dispatchable work really
was still waiting when VERIFY read the queue back. A run that reported
`verified` there would be reporting the loop's intention rather than the world.

---

## D. Measurements

Per §23, from `comparison.json` and `episode.json`:

|                                  |                                                                    |
| -------------------------------- | ------------------------------------------------------------------ |
| OQCA invocations                 | 1 run, 4 iterations, 92 station executions                         |
| completion rate                  | 0/1 completed — `blocked` by `max_iterations`                      |
| verification rate                | 1/1 verified against the environment (verdict `rejected`)          |
| model calls / run                | 16, 0 refused, all answered by `gemini-3.1-flash-lite`             |
| tokens / run                     | 3,559 in / 960 out                                                 |
| estimated cost / run             | $0.006170                                                          |
| charged cost / run               | $0.002330                                                          |
| latency                          | 7 ms per model call (recorded provider); 21 ms wall clock          |
| state transitions                | 33                                                                 |
| knowledge gaps                   | 0 — IDENTIFY_GAPS refused `no_knowledge_state` on all 4 iterations |
| plans generated                  | 4 (one per iteration), each one step                               |
| prediction accuracy              | 0/1 matched — the one action was refused by the mode               |
| agreement with the existing path | **true**                                                           |

**The estimate exceeds the charge by 2.6x, deliberately.** `CHARS_PER_TOKEN` is
3 (a bound, not an average) and the estimate prices the output **ceiling** the
call asked for. Being wrong in the cheap direction is the safe way to be wrong
about a spend gate; the gap is stated rather than tuned away.

**No claim is made that OQCA decides better.** One workflow, a fixture queue, a
recorded provider. §23 says so and this report says so.

---

## E. Refusals — every gate that correctly prevented execution

| refusal                                               | where               | what it prevented                                                        |
| ----------------------------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| `shadow mode: … touches production` ×4                | router mode gate    | every dispatch. `sent=0`, `stamped=0`.                                   |
| `no_knowledge_state` ×4                               | IDENTIFY_GAPS       | research over a knowledge state the job does not supply                  |
| `unverified`                                          | VERIFY, iteration 1 | a verdict before anything had been attempted                             |
| `max_iterations`                                      | run bound           | an unbounded loop                                                        |
| `likelihood_missing`                                  | UPDATE_STATE        | a keyed map with a basis element absent — never padded                   |
| `likelihood_width_mismatch`                           | UPDATE_STATE        | a positional vector against a widened basis                              |
| `unpriced`                                            | model + tool gate   | any call whose price cannot be determined                                |
| `max_cost` / `max_tokens` / `max_tool_calls`          | capability gates    | spend past an explicit ceiling; each names the bound that actually bound |
| `… costs money and names no ledger capability`        | router              | a paying tool outside `withProviderSpendGuard`                           |
| `… costs money and no ledger connection was supplied` | router              | the same, with no RPC                                                    |
| `the spend ledger refused: daily-cap-reached`         | ledger              | an admitted-then-refused reservation; `perform` never ran                |
| `declared properties do not match the registry`       | router              | a call under-declaring `touchesProduction` to slip the shadow gate       |
| `unknown tool: … is not registered`                   | router              | an action the model named that nobody registered                         |
| `job … is inside its dispatch backoff`                | the EXISTING rule   | an OQCA pick the production rule refuses                                 |
| `irreversible_no_rollback`                            | EVALUATE            | an irreversible plan with no rollback                                    |
| `tie at the top of the action ranking`                | shadow              | reporting a decision that is a fact about basis order                    |

With the shipped defaults (`maxToolCalls`, `maxTokens`, `maxCostUsd` all 0) the
loop runs all 23 stations, reasons about nothing, acts on nothing, and ends
naming the bound. **A shadow tick then costs $0.**

---

## F. Replay

`replayChain(chain)` takes **one argument**. There is no engine, router or clock
parameter to pass one to — that is the guarantee, not a rule a caller follows.

Proven three ways, all in `shadowRun.test.ts` and by the script:

1. The 33-state chain is written to `docs/oqca/shadow-run/chain.json`, read back
   **from disk**, and every id re-derives from its own content while every
   `parentStateId` links to its predecessor. A chain that only replays as the
   object the run left in memory has not been persisted at all.
2. Tampering with one state in the middle is caught as `state_id_mismatch` at
   that index — not carried.
3. Replaying makes no model call (the provider spy's count is unchanged) and
   performs no action (`env.sent` is unchanged).

Determinism is asserted separately: the same input twice produces the same 33
state ids.

**What replay does NOT claim:** that the same run would happen again. That would
be false the moment a provider answered differently. What it claims is that a
recorded chain is internally consistent and cannot be edited without detection.

---

## G. Failures — nine defects, every one of which shipped green

**In the v1.1 kernel, found by wiring it to something real:**

1. **`ask()` never priced a call before making it.** It passed
   `{tokens: maxOutputTokens}` and no cost, so §21's
   `estimatedCost <= remainingCostBudget` was not enforced — only "is there any
   headroom".
2. **PLAN derived `touchesProduction` from `reversible`.** A story dispatch is
   **both** reversible **and** a production write, so it declared itself as not
   touching production — **and shadow mode gates on exactly that field.**
3. **`reversible` was a regex over the action's NAME**, which cannot know that
   `dispatch story job X` writes to production.
4. **IMAGINE scored the action's own name.** Every ONIQ story job id is hex, so
   the digit scan read the `1` in `8f2c1a` as risk 1.0 and priced every dispatch
   at expected value zero. The loop held, every time, on a queue it had
   correctly understood — which reads as caution, not as a broken parser.
5. **VERIFY asked the model to label its own claims.** A model marking its own
   homework, over the loop's beliefs rather than over real output.

**In this integration:**

6. **A positional likelihood vector can never be right.** SUPERPOSE admits one
   hypothesis per `goal.requires` _before_ UPDATE_STATE, so 3 likelihoods met a
   basis of 4 on every iteration. The refusal was correct and the caller could
   not satisfy it; evidence never folded and the loop never decided.
7. **The evidence gate read only the positional field.** Adding the keyed map
   without widening the condition meant good evidence typechecked, ran, and was
   reported as "no evidence this iteration" — four times, nothing red.
8. **Evidence was supplied for iteration 0 only.** REPRESENT rebuilds the
   amplitude state each iteration, so it was discarded on iteration 1 and the
   final measurement reflected nothing: three actions tied at exactly 1/3.
9. **The decision ranked prerequisites against actions.** By MEASURE the basis
   held three actions and three goal prerequisites, and `confidence()` ranked
   all six — a category error that ties forever. The wider basis is correct; the
   question asked of it was not.

**And two defects in the tests and the tooling, both found by mutation:**

- **The mutation script mutated `src/` while the new tests read the mirror**, so
  six kernel mutations changed nothing the assertions could see and every one
  reported GREEN — the script flattering the tests exactly as a bad benchmark
  flatters its subject. Kernel mutations now re-mirror.
- **A block replacement silently deleted the six verification tests.** M31
  reported ESCAPED because its test no longer existed. Restored.

**Also corrected:** the v1.2 report's own claim that "the router is an adapter
over `withProviderSpendGuard`" was **prose only** — the ledger was named in a
comment and called from nowhere. A paying tool now goes through it or does not
run, and M44 proves it.

---

## H. Remaining gaps

Stated as gaps, not as capabilities.

| gap                           | state                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Durable memory**            | **Not built.** `consolidate` returns **0**, not a count. ONIQ has no general memory store — `story_cast`, the Study Vault and `learner_profiles` are three purpose-built ones keyed to their own products, and a run's notes do not belong in a child's study vault. Closing it needs a table and a migration: a production schema change a shadow integration does not get to make. |
| **Research acquisition**      | **Not built.** IDENTIFY_GAPS refused `no_knowledge_state` on all four iterations because the job supplies no `KnowledgeState`. RESEARCH therefore has nothing to plan. §12's `importance × uncertainty × dependency × expectedInformationGain` exists in `knowledge/gaps.ts`; nothing feeds it.                                                                                      |
| **World model**               | Minimal by design (§7) — three entities, no relations. RELATE bound 0 dependencies because a queue of independent films has none. A job with real structure would exercise it; this one does not.                                                                                                                                                                                    |
| **Autonomous tools**          | One tool, registered per run from the queue. `maxToolCalls` defaults to 0. No tool has ever run outside a test.                                                                                                                                                                                                                                                                      |
| **Production authorization**  | Assisted mode is built, gated and tested; **it has never dispatched anything anywhere.**                                                                                                                                                                                                                                                                                             |
| **Long-horizon learning**     | Reflection produces three arrays of strings and nothing applies them (§22). With no durable memory, nothing carries between runs.                                                                                                                                                                                                                                                    |
| **A live traversal**          | **Not done.** Nothing is deployed. The run in section C is local, against a fixture queue and a recorded provider.                                                                                                                                                                                                                                                                   |
| **Assisted-mode measurement** | **Not done.** Every measurement here is shadow.                                                                                                                                                                                                                                                                                                                                      |

---

## Gates, at the final state

```
node scripts/oqca-mirror.mjs --check      oqca mirror clean — 13 files
npx tsc --noEmit                          clean
npm run lint:ci                           exit 0
npx prettier --check (changed files)      clean
deno check story-dispatch/index.ts        Check — the whole runtime chain, in
                                          the runtime that will actually run it
npx tsx scripts/oqca-shadow-run.ts        one complete traversal, replay CLEAN
npx vitest run                            all green
bash scripts/oqca-mutate.sh               46 mutations
                                          46 RED   0 GREEN   0 NOTAPPLIED
```

`deno check` is the gate that matters most and it is not decorative:
`tsconfig.json` includes only `src/**`, so `tsc` never typechecks
`supabase/functions/**`, and vitest cannot import an entrypoint that calls
`Deno.serve` at module scope. `edgeImports.test.ts` exists in this repo because
a shipped edge function once called a helper it never imported.

---

## What is left, and who owns it

|           |                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OWNER** | Decide whether to deploy `story-dispatch` at all. Nothing here is deployed.                                                                                                                     |
| **OWNER** | Set `OQCA_STORY_DISPATCH=shadow` for a live traversal.                                                                                                                                          |
| **OWNER** | Set `OQCA_MAX_COST_USD` — a spend decision, so it is asked rather than picked. At `0` the loop reasons about nothing and a tick costs $0. `OQCA_MAX_TOKENS` and `OQCA_MAX_TOOL_CALLS` likewise. |
| **AGENT** | Nothing, until one of the above.                                                                                                                                                                |

**Rollback is one word:** unset `OQCA_STORY_DISPATCH`, or set it to anything
unrecognised. `parseMode` treats every unknown value as `off`, so a typo cannot
turn a scheduled dispatcher into a cognitive one — and cannot leave one on.
