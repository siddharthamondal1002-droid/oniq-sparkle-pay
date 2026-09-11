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
