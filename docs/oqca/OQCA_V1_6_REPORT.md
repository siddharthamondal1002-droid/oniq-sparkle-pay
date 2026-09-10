# OQCA v1.6 — cognitive autonomy is not resource availability

> **The one-line answer.** A zero execution allowance no longer stops ONIQ
> thinking. It stops one **action**. The run-level starvation flag and the four
> jumps that ended a run on a capability bound are gone; a per-capability ledger
> and a `blocked` terminal took their place, the blocked objective keeps its
> dependency, the planner picks something else, and the work is reconsidered
> when the resource comes back.
>
> **Nothing was deleted.** `breach`, `wouldBreach` and `breachRun` are
> byte-identical to v1.5, every gate still refuses **before** the call it
> guards, and `DEFAULT_BUDGETS` still ships `maxTokens`, `maxCostUsd` and
> `maxToolCalls` at **0**. What changed is only what a refusal _means_ to the
> stations after it.
>
> **State: COMMITTED.** Not deployed, not published, not merged to `main`. The
> flag ships `off`, a tick costs **$0**, no Lovable message was sent and no
> credits were spent.

Owner directive, 2026-09-10:

> _"The autonomous runtime must NOT become cognitively inert because an
> execution budget is zero. We previously established the intended model:
> **COGNITIVE AUTONOMY ≠ RESOURCE AVAILABILITY**… Therefore `budget = 0` must
> NOT mean `autonomous runtime = stopped`. It should mean only that a particular
> resource-consuming action cannot currently execute."_

---

## 1. THE EXACT CODE PATH THAT MADE ZERO BUDGET A GLOBAL AUTONOMY BARRIER

Five sites in `src/oqca/loop/cognitiveLoop.ts`, at `HEAD` before this change.
One flag and four jumps. **All five are reached by the SHIPPED defaults**, which
is what made this a barrier rather than an edge case: `DEFAULT_BUDGETS` carries
`maxTokens: 0`, `maxCostUsd: 0` and `maxToolCalls: 0`, so the first model call
of the first station tripped the flag on every unconfigured run.

### 1a. The flag — a capability refusal became the run's terminal status

```ts
// line 272 — one run-level variable, set by ANY refused model call
let starvedBy: BoundBreach | null = null;

// line 463, inside ask() — the model gate
const b = wouldBreach(spent, budgets, estimate);
if (b) {
  starvedBy = b;                                     // <-- the whole run is now "starved"
  return { ok: false as const, text: "", reason: b };
}

// line 1194, CHECK_GOAL — and the run ends
} else if (starvedBy) {
  state = step({ status: "budget_exhausted", spent });   // <-- TERMINAL
  terminated = starvedBy;
  note(station, `cannot continue: ${starvedBy}`, starvedBy);
}
```

`ask()` is called by **seven** stations (UNDERSTAND, REASON, VERIFY, IMAGINE,
EVALUATE, REFLECT, RESPOND). With `maxTokens: 0` the FIRST of them — UNDERSTAND,
station 2 of 23 — set the flag, and CHECK_GOAL then set the terminal status
`budget_exhausted` at the end of iteration 1. Every subsequent iteration was
never run.

### 1b. Four jumps out of the station walk, each on a capability bound

```ts
// RESEARCH, line 626-630
} else if (spent.researchOperations >= budgets.maxResearchOperations) {
  terminated = "max_research_operations";
  note(station, "research bound reached", "max_research_operations");
  break outer;                                        // <-- the RUN ends
}

// EVALUATE, line 922-931
const wouldSpend = wouldBreach(spent, budgets, planCost);
if (wouldSpend) {
  state = step({ selectedPlan: null, spent });
  recover(fromBudget(site(station, 1, "READ"), wouldSpend), { exhaustedBudget: wouldSpend });
  break outer;                                        // <-- self-evaluation stopped self-evaluation
}

// ACT, line 993-996 and 1004-1007
if (spent.toolCalls >= budgets.maxToolCalls) {        // maxToolCalls is 0 by default
  note(station, "tool-call bound reached", "max_tool_calls");
  terminated = "max_tool_calls";
  break outer;
}
const priced = wouldBreach(spent, budgets, router.estimate(step.call));
if (priced) { note(station, `action refused: ${priced}`, priced); terminated = priced; break outer; }

// ACT's retry ladder, line 1068-1074
recover(fromBudget(site(station, attempt, props.idempotency), "max_tool_calls"), {
  exhaustedBudget: "max_tool_calls",
});
break outer;
```

`break outer` leaves the `for (const station of STATIONS)` loop **and** the
iteration loop. So an unaffordable plan at EVALUATE (station 15) meant ACT,
OBSERVE, MEASURE, LEARN_OR_CORRECT, CONSOLIDATE, REFLECT, CHECK_GOAL and RESPOND
did not run — that iteration or any later one.

### 1c. And the autonomy layer above it read the result as cognitive

`supabase/functions/_shared/oqcaRuntime/autonomous.ts` reported the still-open
concepts as `blockedOn`, so the runtime spawned a **follow-up objective to
research a concept whose only problem was that nobody could afford to think
about it** — and the follow-up blocked the same way. `runAutonomousRuntime` then
counted that as a cognitive block and stopped with `stalled`, which reads as
"ONIQ has run out of ideas".

**Measured before the change**, `scripts/oqca-autonomous-run.ts`:
`stop: stalled — 1 objective(s) remain blocked`.

---

## 2. THE EXACT CODE PATH AFTER THE CORRECTION

### 2a. The distinction: a RUN bound is fatal, a CAPABILITY bound is not

`src/oqca/loop/capability.ts` (new, ~190 lines) draws the line once:

```ts
export function availabilityForBound(bound: BoundBreach): CapabilityAvailability | null {
  switch (bound) {
    case "max_tokens":
    case "max_cost":
    case "max_tool_calls":
    case "max_research_operations":
      return "insufficient_allowance";
    case "unpriced":
      return "resource_unavailable"; // a missing PRICE, not a missing budget
    case "max_iterations":
    case "max_state_transitions":
    case "max_execution_time":
      return null; // RUN bounds — not capability states at all
    default: {
      const never: never = bound; // a replayed value is not a typed caller
      throw new Error(`OQCA capability: unclassified bound ${String(never)}`);
    }
  }
}
```

`breachRun` — which names exactly `max_state_transitions` and
`max_execution_time` — is untouched and still ends the run at the top of the
next station. Only the other five changed meaning.

### 2b. The flag is a ledger; CHECK_GOAL blocks instead of exhausting

```ts
// replaces `let starvedBy` — one row per capability, refusal outranks success
let capabilities: ReadonlyMap<Capability, CapabilityState> = new Map();
const noteCapability = (capability, availability, detail, bound, station) => {
  capabilities = recordCapability(capabilities, { capability, availability, detail, bound, station });
};

// ask() — the SAME gate, refusing before the same call
const b = wouldBreach(spent, budgets, estimate);
if (b) {
  const availability = availabilityForBound(b);
  if (availability) noteCapability("model", availability, `model call refused: ${b}`, b, station);
  return { ok: false as const, text: "", reason: b };
}
// `availability === null` records NOTHING: a RUN bound is not a capability
// state, and the next station's `breachRun` ends the run as it always did.

// CHECK_GOAL
} else if (
  unavailable(capabilityList(capabilities)).length > 0 &&
  spent.iterations + 1 >= budgets.maxIterations          // <-- only on the LAST iteration
) {
  const blockers = unavailable(capabilityList(capabilities));
  state = step({ status: "blocked", spent });            // NOT `budget_exhausted`
  terminated = CAPABILITY_UNAVAILABLE;                   // "capability_unavailable"
  note(station, `waiting on ${blockers.map((c) => `${c.capability}:${c.availability}`).join(", ")}`,
       CAPABILITY_UNAVAILABLE);
}
```

**The second clause is load-bearing and was found by regression, not by
reasoning.** The first draft made CHECK_GOAL terminal on the first capability
refusal — which is `starvedBy` with a new name. It broke four shadow-run tests:
the chain fell **33 states → 12**, `UPDATE_STATE` folded evidence once instead
of four times, the replan that withdraws a refused dispatch never happened, and
the decision margin dropped **0.4189 → 0.2123**. Gating on the last iteration
restored all four. _The same disease, in a new place, caught by a test written
for something else._

### 2c. The four jumps became local refusals

| station                    | before                                  | after                                                                     |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| RESEARCH                   | `terminated = …; break outer`           | record `research/insufficient_allowance`, fall through to VERIFY          |
| RESEARCH (adapter refusal) | `recover(...)` only                     | also record `availabilityForFailureClass(refusal.class)`                  |
| EVALUATE                   | `recover(fromBudget(...)); break outer` | clear the plan, record `tool/…`, `note(...)`, `break` (this station only) |
| ACT step loop              | `break outer` ×2                        | labelled `steps:`, `break steps` — the step loop, not the run             |
| ACT retry ladder           | `recover(fromBudget(...)); break outer` | record and `break steps`                                                  |

`break outer;` went **9 → 4** in that file. The four survivors are the
legitimate ones and each is asserted: `stopAfterStations` (a caller-requested
pause), `breachRun` (a RUN bound), the recovery ladder's own `decision.terminal`,
and RESPOND on an already-terminal state.

### 2d. A capability shortfall does NOT go through the recovery ladder

EVALUATE used to call `recover(fromBudget(...))`, whose `BUDGET` class the ladder
turns terminal. A ladder answers retry / replan / escalate, and **retrying an
action whose resource is absent is spend chasing a wall**. So the shortfall is
recorded and the loop carries on; only a _provider_ failure still reaches the
ladder.

### 2e. The runtime: preserve, choose another, come back

```ts
// EpisodeOutcome carries the FULL ledger, refused AND working
readonly capabilities: readonly CapabilityState[];

// Objective carries the resource dependency, SEPARATE from the knowledge one
readonly blockedCapabilities: readonly CapabilityState[];

// RuntimeSnapshot carries the ledger, so recovery survives a process boundary
readonly capabilities: readonly CapabilityState[];

// Every cycle, BEFORE selecting — including the first pass of a restored runtime
let backlog = reconsider(snapshot.backlog, capabilities);
…
capabilities = observeCapabilities(capabilities, outcome.capabilities);
const refused = unavailable(outcome.capabilities);
backlog = reconsider(backlog, capabilities);          // same cycle, so a cron tick works
```

- **`reconsider`** returns a capability-blocked objective to `pending` once
  **every** capability it named is observed working, bounded by `MAX_ATTEMPTS`.
- **A capability blocker spawns NO follow-up**, structurally: `followUpFor`
  reads `blockedOn`, and a resource block names no concept. There is nothing to
  research about a missing key.
- **`capability_blocked`** is a fourth stop, distinct from `stalled`, both where
  the backlog runs out and where `maxConsecutiveBlocked` trips. The backlog is
  preserved either way; the _name_ says whether somebody can go and fix it.
- **`RuntimeReport`** gained `capabilities` and `capabilityBlocks`; every
  `EpisodeRecord` gained `capabilities` and `reconsidered`.

### 2f. Two opposite merge rules, both asserted

| scope                                 | rule                                           | why                                                                                                                              |
| ------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| within one run (`recordCapability`)   | the **first refusal** outranks a later success | a run refused once did less than one that was not; the receipt must say so                                                       |
| across cycles (`observeCapabilities`) | the **latest observation** wins                | a ledger that kept a refusal forever could never see a credential come back — requirement 8 would be unreachable by construction |

Silence is not an observation in either: a capability the episode never touched
is left alone, never cleared. Reawakening on _unknown_ would spin every blocked
objective back to pending every cycle (mutation **M126**).

---

## 3. WHAT WAS NOT DONE, because the directive forbade it

| #   | requirement                                                                           | how it is held                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7   | never fabricate execution because a resource is unavailable                           | a blocked episode contributes **nothing** to `learned`/`settled` and its objective is not marked done; `spent.tokens/costUsd/toolCalls` all 0. `RESPOND` still composes ONIQ's own one-line status — a report, not an invention, and the test asserts it _reports the block_.                                                                                              |
| 8   | do not automatically spend money because autonomy is enabled                          | `DEFAULT_BUDGETS.maxTokens/maxCostUsd/maxToolCalls` all **0**, asserted; mutation **M132** puts a 0.5 ceiling in and goes red.                                                                                                                                                                                                                                             |
| 9   | do not introduce an arbitrary monetary ceiling into the cognitive loop                | no number was added anywhere. `maxExecutionTimeMs` stays non-zero because **time is a runaway guard, not a spend**, and a zero there fails DEAD rather than closed.                                                                                                                                                                                                        |
| 10  | do not bypass authorization, credentials, provider permissions or security boundaries | `availabilityForBound` can never return `unauthorized`, `no_credentials` or `rate_limited` — asserted over every member of the union, read from `seams.ts` rather than from a list this test keeps. Those three arrive **only** from a provider, through `availabilityForFailureClass`. Mutation **M123** makes a spend bound speak for a permission refusal and goes red. |

---

## 4. THE TEN LIFECYCLE TESTS THE DIRECTIVE NAMED

`src/oqca/__tests__/capabilityAware.test.ts` — 29 tests, each labelled with the
requirement it answers.

| the directive's claim                                 | test         | how it is proven                                                                                                                                         |
| ----------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| zero allowance does not stop **objective generation** | TEST 1       | a runtime whose every episode blocks on the model still reports `generated > 0`                                                                          |
| …does not stop **planning**                           | TEST 2       | IMAGINE / PLAN / EVALUATE each run `maxIterations` times; the plan is cleared, not the run                                                               |
| …does not stop **knowledge-gap identification**       | TEST 3       | IDENTIFY_GAPS runs every iteration and returns `runner-availability` from a real substrate                                                               |
| **unavailable research** does not kill autonomy       | TEST 4       | the research-blocked objective is set aside and the next one runs to success                                                                             |
| **unavailable generation** does not kill autonomy     | TESTS 1–3, 5 | all 23 stations, all four iterations, at the shipped zero                                                                                                |
| **blocked objectives remain persisted**               | TEST 6       | `blockedCapabilities` on the objective, in the snapshot, surviving `JSON.stringify` and `validateSnapshot`                                               |
| **another executable objective can be selected**      | TEST 7       | `seen === ["blocked-goal", "runnable-goal"]`                                                                                                             |
| the capability returns → **reconsidered**             | TEST 8       | four tests: same-cycle wake, unobserved ≠ available, `MAX_ATTEMPTS`, two capabilities need both — plus a **second invocation** sharing only the snapshot |
| **resource usage still recorded correctly**           | TEST 9       | the bound, the station and the detail on each row; and a RUN bound still ends the run and is _not_ filed as a capability                                 |
| **unauthorized actions remain impossible**            | TEST 10      | see requirement 10 above                                                                                                                                 |

---

## 5. FOUR THINGS THE MEASUREMENTS SAID THAT READING DID NOT

1. **`max_state_transitions` is unreachable at a zero allowance.** Transitions
   are counted at IMAGINE and ACT — exactly the stations a refused capability
   skips. A test written against it would have passed for the wrong reason;
   measured, a run with `maxStateTransitions: 3` went all four iterations. The
   RUN-bound test uses **time** instead.
2. **The real lifecycle reports TWO refusals of different kinds**, and the pair
   is what makes the vocabulary worth having:
   `model: insufficient_allowance (bound max_tokens, at UNDERSTAND)` and
   `research: provider_unavailable (bound null, at RESEARCH)`. Collapsing them
   would send a reader to raise a budget that cannot help.
3. **A mutation caught a test that was not testing.** Disabling the
   consecutive-capability-block guard (**M131**) reported **GREEN**: with one
   objective the backlog empties and the _selection_ branch reports
   `capability_blocked` anyway, so the two paths overlapped. Four objectives and
   a bound of three separate them — and with the guard disabled those same four
   episodes end as `stalled`.
4. **A cast in a fixture hid a whole new field.** `scripted()` in
   `autonomy.test.ts` ended `} as EpisodeOutcome`, so adding `capabilities` to
   the outcome broke nothing at compile time and every test ran with an
   `undefined` list. The assertion is a typed `const` now. _A fixture that
   silences the compiler stops being a fixture for the shape it is fixing._

**And two collisions, both narrowed with the narrowing proven in the same
commit** (2026-09-10's rule): `/authorize/` matches the substring inside
`unauthorized` — this module's own vocabulary — so the ban is on the **call**
shape; and `security.test.ts`'s auth-header ban lists the lowercase wire
spelling, which two of my test **titles** carried, so the titles were reworded
rather than a third exemption cut into a security guard.

---

## 6. VERIFICATION

```
tsc --noEmit                                            clean
npm run lint:ci                                         clean
node scripts/format-check-changed.mjs                   clean (205 changed files)
node scripts/oqca-mirror.mjs --check                    clean, 44 files (was 43)
deno check supabase/functions/story-dispatch/index.ts    clean
deno check .../oqcaRuntime/autonomous.ts                clean

src/oqca                        25 files /   707 tests   green   (was 24 / 680)
whole suite                    383 files / 6,910 tests   green*
bash scripts/oqca-mutate.sh    134 mutations — 134 RED, 0 GREEN, 0 NOTAPPLIED
                               (14 new: M121–M134)
```

\* one run showed the known unrelated `arapStep11dDiagnosis` timing flake under
load; it passes alone (6/6), exactly as CLAUDE.md records.

### The lifecycle, four OS processes — `autonomous-run/console.txt`

```
true clock        1 episode · stop capability_blocked
                  learn:runner-availability [waiting on model:insufficient_allowance,
                                             research:provider_unavailable]
T0+400d proc 1    3 episodes · TWO maintenance objectives SUCCEEDED while the
                  learning objective was capability-blocked · capability blocks 3
T0+400d proc 2    restored, 0 episodes, ledger carried across the process boundary
T0+400d proc 3    restored + a seeded user request: it blocked, its follow-up
                  blocked, the chain terminated by the same-set guard; three
                  objectives held with their dependencies, two still done
```

The second line is the directive's diagram running: **blocked on one objective,
successful on another, in the same lifecycle.**

---

## 7. WHAT IS STILL NOT TRUE, stated as not true

- **No live cross-process reconsideration.** With the shipped seams no
  capability is ever `available` inside `makeLoopEpisode` — there is no engine,
  no router and no research adapter — so the script cannot demonstrate a
  resource coming back. Requirement 8 is proven by the two-invocation **test**
  (a snapshot written by one call, restored by another with the ledger showing
  the model back, the objective running on the first pass), and the guard for
  the episode passing its whole ledger through is a **source read**, with the
  limit written at the assertion. The day one of those seams is wired it becomes
  behavioural.
- **`learned` is still empty on every run.** `buildSubstrate` re-ingests
  deterministically per tick, so an episode ends with the store it began with.
  That is v1.5's finding and v1.6 does not touch it.
- **The maintenance path is still unreachable in production** for the same
  reason: nothing persists, so nothing ages. `--advance-days` is the labelled
  way to exercise it.
- **`SUPERPOSE` is untouched**, per the owner's standing instruction that the
  prerequisite/gap mismatch deserves a measured experiment.
- **Nothing is deployed, published or merged**, the flag ships `off`, and a tick
  costs **$0**.
