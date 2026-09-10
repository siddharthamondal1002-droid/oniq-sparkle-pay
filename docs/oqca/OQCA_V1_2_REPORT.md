# OQCA v1.2 — the first reachable ONIQ cognitive job

Branch `claude/check-56jtg5`. Nothing is deployed, published, merged to `main`,
or turned on. The feature flag ships **off**, and off is `story-dispatch`
behaving exactly as it did before this existed.

**The milestone the brief set was "a real ONIQ job traversed those stations and
came back with a measurable result." That is NOT yet claimed.** What exists is
the wiring, the gates, the comparison record and the tests. A real traversal
needs the flag on in production, which is the owner's, and section H says what
that costs.

---

## A. What was measured before anything changed (§1)

Eight things, and three of the answers changed the design.

| §   | Asked                                     | Measured                                                                                                                                                               |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | the real ONIQ job                         | `story-dispatch` — see B                                                                                                                                               |
| 2   | the `callText` boundary                   | `callText(opts & {tier}) → CallClaudeResult`. `data.usage.{input_tokens,output_tokens}` on **both** engines; `data.model` names who answered. **No dollars anywhere.** |
| 3   | the existing ToolRouter                   | **DOES NOT EXIST** — see below                                                                                                                                         |
| 4   | the audit/event mechanism                 | `provider_spend_ledger` (spend), `story_dispatch_health` (this job's own health), `client_error_reports` (client faults). Health's chain is sealed and off-limits.     |
| 5   | the `_shared` mirror convention           | byte-identical copies + a `cp`-fix test (`src/health/__tests__/agreement.test.ts`)                                                                                     |
| 6   | `Goal` and `ResearchPlan`                 | exist, in `src/oqca/knowledge/gaps.ts` and `planner.ts`. Reused unchanged.                                                                                             |
| 7   | the production database boundary          | PostgREST with the service role from inside the function; the spend authority is `_shared/financialLedger.ts`                                                          |
| 8   | the authorization / feature-flag boundary | `authorizeScheduledCaller` (who may call), `financialLedger`'s capability config (what may spend), `src/lib/flags.ts` (client constants)                               |

### §1.3 — ONIQ has no ToolRouter, and that is a finding rather than a gap

A repo-wide search for `ToolRouter`, `toolRegistry`, `dispatchTool` and
`executeTool` returns **nothing outside `src/oqca/` itself** — where the type is
one I wrote at `be907fe3`. So §5's "connect the existing ToolRouter" cannot be
honoured literally.

What DOES exist is the authorization boundary §5 describes, and it is reused
rather than replaced: **`withProviderSpendGuard`** in `_shared/financialLedger.ts`
reserves, calls and settles against PostgreSQL row locks, and already refuses
`unpriced-model` and `zero-estimate` **by name**. §21's "if price is unknown:
REFUSE" is not a new rule in ONIQ; it is the rule the ledger has enforced in
production since August. `oqcaRuntime/toolRouter.ts` is an adapter over that
shape, not a second authorization system — two systems that must agree forever
drift the first time one is edited alone.

### §1.5 — the mirror works only because `.ts` extensions are already legal here

`tsconfig.json` carries `allowImportingTsExtensions: true`, and
`src/data/capabilities.ts` already imports `"../../supabase/functions/_shared/capabilityRegistry.ts"`
with the extension. Deno **requires** the extension at runtime. That combination
is what makes a byte-identical mirror of a tree with internal imports possible
at all: without it the mirror typechecks locally under
`--unstable-sloppy-imports` and fails on the deployed function.

---

## B. The job, and the exact call path (§1.1, §2)

**"Which queued Story job should be dispatched next, and should one be
dispatched at all."**

```
Supabase cron
  └─ POST /functions/v1/story-dispatch
       authorizeScheduledCaller(req)                     unchanged
       read story_jobs?status=eq.queued&…&limit=1        unchanged, still ONE row
       ── if OQCA_STORY_DISPATCH=assisted ──────────────────────────────
       runOqcaForDispatch()            _shared/oqcaRuntime/storyDispatchHook.ts
         └─ runShadow()                _shared/oqcaRuntime/shadow.ts
              ├─ readQueue()           _shared/oqcaRuntime/dispatchEnv.ts (≤20 rows)
              ├─ worldFrom / perceptsFrom / likelihoodsFrom   dispatchJob.ts
              ├─ runCognitiveLoop()    _shared/oqca/loop/cognitiveLoop.ts  (23 stations)
              │    ├─ engine.estimate → wouldBreach → engine.run
              │    │      makeEngine   _shared/oqcaRuntime/engine.ts
              │    │      callText     _shared/oqcaRuntime/provider.ts → _shared/llm.ts
              │    └─ router.estimate → wouldBreach → router.execute
              │           makeToolRouter  _shared/oqcaRuntime/toolRouter.ts
              │             authorize → isDispatchable(fresh row)      ← the existing rule
              │             perform   → stampDispatched, sendDispatch, readJob
              ├─ makeVerifier()        dispatchJob.ts   (reads the row back)
              └─ buildEpisode()        episode.ts
       ── production pick and dispatch, unchanged ───────────────────────
       ── if OQCA_STORY_DISPATCH=shadow: runOqcaForDispatch() AFTER the send ──
```

### Why this job, and what was rejected

| candidate         | why not                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`smart-scout`** | the richest shape — a goal, `web_search` as a real tool, real external results, an existing spend guard — but a **live, paid, user-facing** path whose decision is prose. Wrong first integration. |
| **`story-sweep`** | discrete and shadow-safe, but its rule is `age > TTL && has_bytes`. Nothing to reason about, so a model call there would be theatre — and it **deletes**.                                          |
| **`study-tutor`** | highest volume, lowest stakes, but its "observation" would be the model's own answer. §10 rules it out.                                                                                            |

`story-dispatch` wins on every axis the brief names: the decision is **discrete**
(one job id or none), so §8's agreement is an equality test rather than a diff of
prose; the observation is **external** (whether a runner claimed the row); it is
a **scheduled** job with no user-visible result, so shadow mode cannot change any
user's outcome by construction; and its production action is safe — its own
header records that "it does not claim the job… a dispatch that never lands on a
runner leaves the job available rather than stranding it".

### Assisted mode can only ever narrow

OQCA proposes a job id; `authorize` then re-reads the row and requires the
**existing** rule (`queued`, outside its 10-minute backoff) to agree
independently. The worst case of a wrong OQCA pick is a film dispatched _later_
than it would have been — never one dispatched that should not have been. §9's
"the existing authorization boundary remains authoritative" is that
intersection, and it is a property of the code rather than a promise about it.

---

## C. What was built

| file                                         | what                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `scripts/oqca-mirror.mjs`                    | computes the loop's import closure and mirrors it; `--check` is what the test asserts                                    |
| `supabase/functions/_shared/oqca/**`         | the mirrored kernel — 13 files, 3,263 lines, byte-identical to `src/oqca/`                                               |
| `_shared/oqcaRuntime/pricing.ts`             | the price boundary over `searchBudget.ts`'s published rates; `null` = refuse                                             |
| `_shared/oqcaRuntime/engine.ts`              | the model adapter — records runId, stateId, purpose, model, who answered, tokens, estimated and actual cost, latency, ok |
| `_shared/oqcaRuntime/provider.ts`            | the **one line** that names `callText`                                                                                   |
| `_shared/oqcaRuntime/toolRouter.ts`          | closed registry, mode gate, property check, the existing authorization boundary                                          |
| `_shared/oqcaRuntime/memory.ts`              | working memory + the persistence gap, stated                                                                             |
| `_shared/oqcaRuntime/episode.ts`             | §13 record, §14 verdicts, §16 reflection, §17 response class                                                             |
| `_shared/oqcaRuntime/dispatchJob.ts`         | the job: goal, world, likelihoods, tools, verifier                                                                       |
| `_shared/oqcaRuntime/dispatchEnv.ts`         | PostgREST + GitHub, the only file with a `fetch`                                                                         |
| `_shared/oqcaRuntime/flag.ts`                | `off` / `shadow` / `assisted`, anything else is `off`                                                                    |
| `_shared/oqcaRuntime/storyDispatchHook.ts`   | the one caller; cannot throw                                                                                             |
| `supabase/functions/story-dispatch/index.ts` | +2 imports, 2 guarded blocks                                                                                             |

### Three defects found in the v1.1 kernel while wiring it

1. **`ask()` never priced a call before making it.** It passed
   `{tokens: maxOutputTokens}` and no cost at all, so §21's
   `estimatedCost <= remainingCostBudget` was not enforced — only "is there any
   headroom". `Engine` and `ToolRouter` now each have an `estimate` half,
   `null` becomes the new `unpriced` bound, and the gate runs before every call.

2. **PLAN derived `touchesProduction` from `reversible`** (`touchesProduction:
!best.reversible`). A story dispatch is **both** reversible **and** a
   production write, so it declared itself as not touching production — and
   shadow mode gates on exactly that field. _Every reversible production write
   in ONIQ would have walked through the gate that exists to stop it._ The two
   properties are now independent and come from the router, which is the only
   thing that knows.

3. **`reversible` was a regex over the action's NAME**
   (`!/delete|drop|purge|overwrite/i`). It cannot know that
   `dispatch story job X` writes to production, and would have called it safe
   because the word "delete" is absent. Also asked of the router now, and both
   directions are asserted: a tool named "delete every row" reaches the router
   when the router says it is reversible.

### And an adapter may not under-report a bound the kernel can compute itself

`maxOutputTokens` is what a call is about to ask for, and the kernel knows it
without asking anyone — so an estimate below it is raised to it. Found by a
test: a stub estimating zero tokens walked straight through a `maxTokens: 0`
budget.

---

## D. What was NOT built, stated as not built (§12, §26)

- **Episodic memory does not persist across runs.** ONIQ has no general memory
  store — `story_cast`, the Study Vault and `learner_profiles` are three
  purpose-built ones, each keyed to its own product and user, and none is where
  a cognitive run's episodes belong. `consolidate` returns **0**, not a count,
  and records the gap. Closing it needs a table and a migration, which is a
  production schema change a shadow-mode integration does not get to make.
- **Episodes are built and returned, never stored.** Same reason.
- **No live traversal.** Nothing has run against production. Every number below
  is from tests.
- **Assisted mode has never run anywhere.** It is built, gated and tested; it
  has dispatched nothing.
- **The replay guarantee is narrow and says so.** `replayChain` checks that a
  recorded chain is internally consistent — every id re-derives, every state
  names its predecessor. It does **not** claim the same run would happen again;
  that would be false the moment a provider answered differently.
- **A fact citing two records may quote either.** Unchanged from v1.1.

---

## E. Safety

### The bounds, and the two kinds (§6, §21)

`DEFAULT_BUDGETS` ships `maxToolCalls: 0`, `maxTokens: 0`, `maxCostUsd: 0`.
With those, the loop runs all 23 stations, reasons about nothing, acts on
nothing, and ends naming the bound. What a scheduled job may spend is a spend
decision and therefore the owner's under CLAUDE.md's first rule.

`maxExecutionTimeMs` is **not** zero and is not read from the environment. It is
a runaway guard, not a spend: a zero time bound fails _dead_ (the run halts at
station 1), and a default nobody can run is a default somebody raises wholesale,
taking the two money bounds with it.

A **run** bound (transitions, elapsed time) is fatal. A **capability** bound
(tools, research, tokens, cost) refuses that capability at its own gate and lets
every station that does not need it carry on. Every refusal names the bound that
actually bound — a gate that reports the wrong one sends whoever reads the log to
raise the wrong number, and the number they would raise is the one governing
writes to production.

### The one-call overshoot, restated for v1.2

`COST_OVERSHOOT_CALLS` is still 1, and its **cause moved**. It used to be that a
caller with no price table crossed the ceiling by one call because the gate had
nothing to compare against; that hole is closed. What remains is **estimate
error**: an estimate prices the output ceiling asked for, and a provider that
bills above it (measured on `smart-scout`: 4,295 output tokens against a 3,500
`max_tokens`) overshoots by the difference. The next gate then sees the real
`spent.costUsd`, so it cannot compound.

### No automatic self-modification (§22)

Reflection produces three arrays of **strings**. It cannot modify source,
prompts, model routing, security policy, budgets, flags, or deploy anything —
not because a branch declines to, but because a string array has no such power
and nothing in the module writes anywhere. Asserted: no adapter contains a
filesystem write, a shell, `eval`, a deploy call or a migration; exactly one
file reaches the network; the only host named anywhere in the runtime is
`https://api.github.com`.

### The kernel is still inert (§3)

`security.test.ts` now walks **both** trees — `src/oqca/**` and the mirror — with
the same 26 bans. A guarantee asserted over one copy of a file and not the other
is not a guarantee, and the mirror is the copy that ships to production. The
runtime adapters live in a sibling directory, `_shared/oqcaRuntime/`, which is
deliberately **not** walked: that path _is_ the boundary.

---

## F. Tests and mutations (§20, §24)

Three new suites, and the three that already existed were extended rather than
weakened. **No existing production test was changed to make anything pass.**

### Three defects the tests found in the tests

1. **`mirror.test.ts` repaired the thing it was checking.** It imports `closure`
   from `scripts/oqca-mirror.mjs` so it checks what the script actually mirrors
   — but an ES module runs its whole body on import, so importing it **re-ran
   the mirror and copied every drifted file back** before a single assertion
   executed. It passed on a genuinely broken mirror. Nothing green ever said so;
   mutation **M22** did, reporting ESCAPED. The script's side effects are now
   behind a `main()` guard. _A check that has never failed has never been
   tested_ — for the fourth time in this repo.

2. **The security guard's residue reader masked strings before regexes**, which
   breaks on the one shape these guards are full of: a regex literal containing
   a **quote**, such as `/from "\.\.\/llm\.ts"/`. The string masker read that
   quote as opening a literal, paired it with the next quote pages later, and
   every string in between survived unmasked — so a URL inside an ordinary
   string looked like executable code. `sourceText.ts` documents exactly this
   limit. Regexes are removed first now, and the fix is mutation-checked both
   ways: a real `await fetch(u)` in a guard file still goes red.

3. **"shadow mode can never report handled" passed through a mutation that
   broke it.** With tight budgets the loop performed nothing, so `handled` was
   false for a reason unrelated to the mode, and
   `handled: mode === "assisted" || performed || held` scored GREEN. Rewritten
   with open budgets so the loop really completes an action, plus its mirror
   (assisted mode _does_ report handled on a hold).

---

## G. What shadow mode measures (§8, §23)

One `ShadowComparison` row per run: `productionDecision`, `oqcaDecision`,
`agreed`, `oqcaConfidence`, `oqcaMargin`, `latencyMs`, `modelCalls`,
`modelCallsRefused`, `toolAttempts`, `toolsRefused`, `estimatedCostUsd`,
`costUsd`, `terminated`, `failure`.

`agreed` is **null**, not `false`, when the loop never reached a decision. That
is a third outcome and not a disagreement: an unconfigured loop that refused
every model call has not disagreed with production, it has declined to answer.
Conflating the two would make the first week of shadow data read as OQCA being
wrong on every tick.

**No claim is made about whether OQCA decides better.** One workflow, no live
data, and §23 says so explicitly.

---

## H. What is left, and who owns it

|           |                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OWNER** | Decide whether to deploy `story-dispatch` at all. Nothing here is deployed.                                                                                                 |
| **OWNER** | Set `OQCA_STORY_DISPATCH=shadow` if a live traversal is wanted.                                                                                                             |
| **OWNER** | Set `OQCA_MAX_COST_USD` — a spend decision, so it is asked rather than picked. At `0` the loop reasons about nothing. `OQCA_MAX_TOKENS` and `OQCA_MAX_TOOL_CALLS` likewise. |
| **AGENT** | Nothing, until one of the above.                                                                                                                                            |

**A shadow tick with the shipped defaults costs $0** — every model call is
refused at the cost gate and no tool touches production. The first tick that
costs anything is the first tick after `OQCA_MAX_COST_USD` is set.

**Rollback is one word:** unset `OQCA_STORY_DISPATCH`, or set it to anything
unrecognised. `parseMode` treats every unknown value as `off`, so a typo cannot
turn a scheduled dispatcher into a cognitive one — and cannot leave one on.

---

## Gates, at the final state

```
node scripts/oqca-mirror.mjs --check   oqca mirror clean — 13 files
npx tsc --noEmit                       clean
npm run lint:ci                        exit 0
npx prettier --check                   clean
deno check story-dispatch/index.ts     Check  (the whole runtime chain, in the
                                              runtime that will actually run it)
npx vitest run                         372 files / 6,518 tests  ALL GREEN
  of which new in v1.2:
    mirror.test.ts                      18
    runtime.test.ts                     44
    runtimeWiring.test.ts               19
    security.test.ts                    41 → 44 (both trees now walked)
    cognitiveLoop.test.ts               24 → 25
bash scripts/oqca-mutate.sh            38 mutations
                                       38 RED   0 GREEN   0 NOTAPPLIED
```

`deno check` is the gate that matters most here and it is not decorative:
`tsconfig.json` includes only `src/**`, so `tsc` never typechecks
`supabase/functions/**` at all, and vitest cannot import an entrypoint that
calls `Deno.serve` at module scope. `edgeImports.test.ts` exists in this repo
because a shipped edge function once called a helper it never imported. The
whole runtime chain — hook, shadow, engine, provider, `llm.ts`, router,
`dispatchEnv`, and the 13 mirrored kernel files — typechecks under Deno with no
import map and no flags. That is the proof the mirror is deployable.
