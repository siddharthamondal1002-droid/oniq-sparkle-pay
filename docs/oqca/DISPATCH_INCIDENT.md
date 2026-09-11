# OQCA and the story-dispatch outage, 2026-09-11

The owner said **"tell oqca to resolve it"** about a live production fault:
`story-dispatch` cannot reach GitHub, every `repository_dispatch` answers
`401 Bad credentials`, no story worker has run since `2026-09-05T14:24:04Z`, and
two films sit `queued` with no shots and no bytes.

**OQCA did not resolve it, and could not have.** It was given the incident
through `scripts/oqca-dispatch-incident.ts` — six readings measured on
production, with the SQL or API call that produced each one as its locator, no
diagnosis and no remedy anywhere in the input, and the real source of
`story-dispatch`, `story-sweep` and `selfModel.ts` as its research corpus. Run
artifacts are beside this file.

## Three gates, and only the third was expected

1. **THE RANKING BURIES IT.** The live outage came **14th of 18**.
2. **THE BUDGET STOPS THE THINKING.** `stop capability_blocked —
model:insufficient_allowance (model call refused: max_tokens)`.
3. **THE CAPABILITY IS NOT AUTHORIZED**, and there is no network anyway.

Only the third was predicted, and it is written into the host's header before
the run so the result could disagree with it. It did.

## The defect, in the numbers the run printed

```
                                              cap  cost  rev  risk  dep   exp    modifier
chore  improve:dead_branch (never observed)   1.00 0.70 1.00  0.80 1.00  0.30  →  0.1680
real   improve:provider_failure:github…       0.00 1.00 1.00  1.00 0.05  1.00  →  0.0025

                       learning score     importance  uncertainty  gain
chore  UNKNOWN               0.30000        0.300       1.000      1.000
real   UNCERTAIN             0.12000        1.000       0.300      0.400

final  chore 0.05040        real 0.00030        — 168× apart
```

**THE LEARNING HALF IS ROUGHLY RIGHT; THE PLANNING HALF INVERTS IT.** The real
fault carries `importance = 1.000` against a chore's `0.300`, and it loses the
learning score only 0.12 to 0.30 — defensible, because you do learn more from a
kind you have never looked at. What decides the outcome is the planning
modifier, 0.1680 against 0.0025, and exactly two of its six factors are
responsible: `capability = 0.00` and `dependencies = 0.05`. Both are zero-ish
for one reason — acting on this needs `UPDATE_CONFIGURATION`, which is
registered and **not authorized**.

Every other factor says _do this one_: `expectedImprovement = 1.00` (the loop
knows this would move the metric further than anything else), `risk = 1.00`,
`reversibility = 1.00`, `cost = 1.00`.

**So ONIQ deprioritises a fault by 67× precisely because nobody has authorized
it to fix that fault.** The consequence is not "it does the wrong work first" —
it is that the outage can never be SELECTED, so `capability_blocked` can never
name it, and the v1.6 entry's claim that the stop is "the difference between
'ONIQ is stuck' and 'a credential is missing'" is unreachable in the one case it
was built for.

**THIS IS THE v1.6 LESSON ONE LAYER UP.** v1.6 fixed _a zero budget stops the
thinking_. This is _an unauthorized capability stops the ranking_ — the same
confusion of "ONIQ may not do this" with "this does not matter", moved from the
loop into the planner. v1.6's own rule for the two context factors already says
a modifier "may re-rank and may not veto"; `capability` and `dependencies` are
planning factors and carry no such floor, and at 0.00 one of them annihilates
the other five.

Stated as a limit rather than a fix: `MODIFIER_FLOOR` exists in `select.ts` for
exactly this shape and is not applied here. Whether the answer is that floor, or
a separate "needs a person" lane that ranks by importance alone and reports
rather than attempts, is a design question — not a constant to nudge.

## What is NOT wrong

- The observer is honest: 6/19 kinds OBSERVED, the other 13 UNOBSERVED with the
  reason attached, and the severity-0 reading (`story_dispatch_function`, 159 ×
  200 in three hours — the dispatcher is up and being refused, not down) was
  correctly dropped from the concern list by `actionable()`.
- Severity does reach the score: `missing_telemetry` at 0.6 scored 0.00011
  against the severity-1.0 readings' 0.00030, a clean 0.6 ratio.
- The three authorized capabilities behaved: nothing was executed, nothing was
  fabricated, and `RUN_TEST_SUITE` / `RUN_STATIC_ANALYSIS` reported that this
  host does not run them.

## What still fixes the video

Nothing here. `GITHUB_DISPATCH_TOKEN` on the production Supabase project is
expired or revoked and only the owner can replace it. OQCA has no network by
construction (`security.test.ts` walks both trees), `UPDATE_CONFIGURATION` is
`authorized: false`, and §22 of the v1.7 directive forbids autonomous cognition
manufacturing a credential. Naming the blocker is the most it could ever do, and
the ranking defect above is why it did not get as far as naming it.

---

## FIXED, 2026-09-11 — and the account above was wrong about why

**THE CORRECTION FIRST.** The section above says `capability` and `dependencies`
"carry no floor". **That is false.** `planningModifier` applies `floor()` to all
six factors and its own header says so. The cause was not an unfloored zero — it
was that TWO factors hit the floor for ONE fact, and 0.05 × 0.05 = 0.0025
against a chore's 0.168. Reading a header instead of the function is how a wrong
cause gets written down confidently, and the probe that settled it should have
been run before the first version of this page rather than after.

### What the probe actually said

```
real fault, EMPTY ledger (every cold start)   cap=0.00 dep=0.05 -> 0.0025
real fault, resource known-but-refused        cap=0.00 dep=1.00 -> 0.0500
chore needing nothing                         cap=1.00 dep=1.00 -> 0.1680
```

`dependencies` was `known / needs.length` over the **same list** `capability`
reads, and `met ⊆ known` — two nested measures of one fact, multiplied. So
**silence was punished twenty times harder than a stated refusal**, which is
backwards: a refusal is strictly more informative than silence. That is v1.6's
"ABSENT IS NOT AVAILABLE" read the wrong way round.

### And the cold start was a closed loop

The ledger learns a capability's state by OBSERVING an episode use it. Nothing
may attempt an **unauthorized** capability, so nothing observes it, so the ledger
stays silent forever, so the objective sits at the floor, so it is never
selected, so nothing attempts it. Authorization is not something to discover by
trying — it is a column in `selfModel.ts`, true before any episode runs.

### The three changes

1. **`needsAPerson`** (`loop/capability.ts`) splits `unauthorized` /
   `no_credentials` — v1.6's own two "somebody else's decision about who ONIQ
   is" — from everything ONIQ's own number controls. The first cannot be waited
   out, so such an objective's whole value is the REPORT, which is work ONIQ can
   always do. `ESCALATION_CAPABILITY = 0.5`: half the work is available, half is
   not. The constant is semantic; the ORDERING is what the tests pin.
2. **`dependencies` stops double-counting.** One shortfall, one factor.
3. **`registryCapabilityStates()`** reports what the registry already knows, and
   `RuntimeInput.knownCapabilities` merges it UNDER the snapshot and under
   anything an episode observed — a real observation always wins. `verification`
   is deliberately ABSENT: three authorized members, but whether one WORKS is
   only an episode's to say, and a host asserting `available` from a table would
   fabricate the one thing it may not.

### Measured after, same six readings, same corpus

```
before   0.00030   14th of 18
after    0.06000    1st of 18

stop before:  capability_blocked — model:insufficient_allowance (max_tokens)
stop after:   capability_blocked — model:insufficient_allowance (max_tokens);
              tool:unauthorized (no tool capability is authorized in this build:
              CREATE_EXPERIMENT, REBUILD_ARTIFACT, RUN_BENCHMARK,
              RUN_MUTATION_TEST, UPDATE_CONFIGURATION)
```

**That second line is the point.** v1.6 built `capability_blocked` to be "the
difference between 'ONIQ is stuck' and 'a credential is missing'", and until now
it could not reach the case it was built for.

### The other half: the films that hang forever

Also fixed, and it is a different defect in a different file. `story-sweep`'s own
comment already records this failure and its fix — "the first live Story sat
queued while every dispatch failed — charged, unrefundable… Ageing it out is the
missing half of the lifecycle" — and a later change quietly defeated it.

Read from `pg_proc` rather than assumed: `story_jobs_guard_transition` OPENS with
`new.updated_at := now()`, unconditional on every UPDATE, and `story-dispatch`
stamps `dispatched_at` BEFORE its GitHub call. So a refused dispatch refreshes
`updated_at` every ten minutes and the 30-minute window never elapses.

`QUEUED_ABANDONED_TTL_MS` is a second clock on `created_at`, which nothing writes
after the insert. **Six hours, measured rather than picked:** over 117 films that
reached `ready`, the longest wait between `created_at` and `dispatched_at` was
65.1 minutes, so six hours is 5.5× the worst real wait.

And the failure message read `dispatched_at` first — but a stamp means a dispatch
was ATTEMPTED, never that a runner took it. During an outage every abandoned film
carries one, so each person was told "a renderer took this one and never
finished": a guess presented as fact, pointing at a busy queue when the fault was
ours and total. The dispatcher's own health is read first now.

### Still true

**Neither fix restores video.** `GITHUB_DISPATCH_TOKEN` is still dead and
replacing it is still the owner's. `story-sweep` is an edge function and does not
ship with a web publish. The OQCA change reaches nothing user-facing: the flag
still ships `off` and nothing imports the runtime.
