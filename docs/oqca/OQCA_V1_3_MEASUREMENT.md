# v1.3 + Failure Recovery — what exists, measured before anything was written

Taken on `claude/check-56jtg5` at `252fecf8`, by grep over `src/oqca/**`,
`supabase/functions/_shared/oqca/**` and `_shared/oqcaRuntime/**`. Recorded
first because the last three briefs each turned on a measurement that changed
the design, and because two of the rows below say "do not build this — ONIQ
already has one".

## v1.3's named surfaces

| Brief name                                  | State   | What is actually there                                      |
| ------------------------------------------- | ------- | ----------------------------------------------------------- |
| `ToolRouter`                                | EXISTS  | `loop/seams.ts`, real ledger routing in `oqcaRuntime`       |
| `Verifier`                                  | EXISTS  | `loop/seams.ts`, injected; `dispatchJob.makeVerifier`       |
| `ModelEngine`                               | RENAME  | `Engine` — same contract, brief's vocabulary differs        |
| `MemoryAdapter`                             | RENAME  | `MemoryStore` — same contract                               |
| `Observation` (§3)                          | PARTIAL | `Percept {id,kind,content,source}` lacks confidence,        |
|                                             |         | provenance, timestamp. NAME COLLIDES with `megaLoop`'s      |
|                                             |         | likelihood-vector `Observation` — `loopState.ts:26` already |
|                                             |         | documents that collision and chose `Percept` because of it  |
| terminal states (§1)                        | PARTIAL | all six exist as lowercase `LoopStatus`; but `isTerminal`   |
|                                             |         | is `status !== "running"` and never consults                |
|                                             |         | `TERMINAL_STATUSES`, whose comment says "these three" over  |
|                                             |         | a list of six                                               |
| `BUDGET_EXHAUSTED` names which budget (§23) | PARTIAL | named at one of three sites                                 |
| `CognitiveRun` (§2)                         | ABSENT  | seams are separate optional fields on `LoopInput`           |
| `KnowledgeAdapter`                          | ABSENT  | `KnowledgeState` is passed in whole — §5's "do not dump"    |
| `ResearchAdapter`                           | ABSENT  | `ResearchPlan` is planned and nothing executes it           |
| `CognitivePersistence`                      | ABSENT  | the chain is in memory only                                 |
| world-state provenance (§6/§30)             | ABSENT  | `WorldEntity.uncertainty` is a number, not a class          |
| `controlled_autonomy`                       | ABSENT  | `OqcaMode = "off" \| "shadow" \| "assisted"`, and           |
|                                             |         | `runtimeWiring.test.ts` asserts no `"autonomous"` string    |

## The failure-recovery brief

Nothing under `src/oqca/**` classifies, retries, backs off or escalates.
**But ONIQ does, in two places, and the recovery layer must adapt them rather
than become a third** — this is the `withProviderSpendGuard` finding again,
where "the router adapts the existing authorization boundary" was prose until
it was grepped:

- `_shared/providerError.ts` — `classifyProviderError(status, body, headers)`
  returning 9 kinds with `retryable`, `retryAfterSeconds`, a user-safe message;
  `parseRetryAfter` handling both seconds and an HTTP date; and a circuit
  breaker (`breakerState`, `shouldSkipProvider`, `recordFailure`,
  `DEGRADE_AFTER`, `DEFAULT_QUOTA_COOLDOWN_S`). Written after 18 consecutive
  429s in 0.4s, and it already draws the brief's own distinction — retryable
  versus terminal-for-now.
- `_shared/planOrchestrator.ts` — `classifyFailure(reason)` → transient |
  permanent, with permanent winning ties.
- `_shared/geminiFailover.ts` — `ClaudeFailureClass`, 6 members, provider-specific.

**None of the three covers the cognitive classes** the brief needs —
PLANNING, PREDICTION, STATE, KNOWLEDGE, SECURITY — because nothing in ONIQ has
a planner whose plan can fail. So: the provider half is ADAPTED THROUGH A SEAM
(the kernel may not import outside its own tree; `security.test.ts` walks it),
and only the cognitive half is new.

## What this measurement changes about the design

1. `Observation` is NOT introduced as a new record. `Percept` grows the three
   missing fields instead. Introducing a second `Observation` into a subsystem
   that already documents why it avoided that name would be the exact fault the
   comment warns about.
2. Provider failure classification is a SEAM, not a reimplementation.
3. Recovery is built BEFORE `controlled_autonomy`, because the recovery brief
   §32 says so in its own words: "mandatory for every consequential ONIQ action
   before controlled autonomy is enabled".
4. `isTerminal` is a real defect, not a vocabulary difference: add a
   non-terminal status tomorrow and it is silently terminal today.
