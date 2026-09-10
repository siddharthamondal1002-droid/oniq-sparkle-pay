# OQCA v1.5 — the Autonomous Cognitive Runtime

**STATE FIRST, because "committed" is a state and it is not shipped.** Everything
below is committed to `claude/check-56jtg5` and **nothing is deployed, published
or merged to `main`**. No migration was applied, no edge function was deployed,
no Lovable message was sent, **$0 was spent**, and the spend bounds
(`maxToolCalls`, `maxTokens`, `maxCostUsd`) still ship at zero.

Owner directive, 2026-09-10: _"At this point I would stop expanding the knowledge
substrate... The next milestone should be autonomy, not more infrastructure."_
Three capabilities were named, and the target was stated as a server that _"can
sit there with no new user request, notice that it has an unresolved knowledge
gap, choose what to learn, research it, verify it, update its knowledge, test the
consequence, discover the next useful objective, and continue"_ — with the
explicit rider that _"blocked on one objective != cognitively dead."_

---

## Is the milestone reached? Half of it, and the halves are separable

**REACHED, and measured across two operating-system processes:** ONIQ generates
its own objective with nobody asking, chooses what to learn with the six-factor
function, runs the real 23 stations against knowledge it built itself, blocks,
recovers, reprioritises, continues to the next objective, checkpoints to disk,
and a second process restores that checkpoint and carries on.

**NOT REACHED, and it is one clause of the owner's sentence:** _research it,
verify it, update its knowledge_. ONIQ cannot learn anything new in an episode,
for two independent reasons, both measured and neither new:

1. **There is no research capability.** `NO_RESEARCH` refuses rather than
   answering "no findings", exactly as v1.3 designed it to. Nothing in this
   container can see whether a GPU runner is alive.
2. **There is no write-back.** `buildSubstrate` re-ingests every record
   deterministically on every tick, so the store an episode ends with is the
   store it began with. That is `substrateGap()` seen from the other end: no
   durable knowledge table means nothing an episode establishes can persist.

So `learned` is **empty on every run**, and it is reported as empty rather than
filled with things ONIQ already knew — see the third defect below.

---

## What ran, and what it said

`npx tsx scripts/oqca-autonomous-run.ts` — the real objective generator, the real
selector, the real 23 stations, the real substrate, a real JSON checkpoint on
disk, run as separate processes that share nothing but that file.

### The true clock: ONIQ's actual autonomous position today

```
surveyed at              : T0 + 0d
episodes THIS process    : 1
stop                     : stalled — nothing is pending: 1 objective(s) remain
                           blocked — learn:runner-availability
                           (the concept is not in the knowledge state at all)
objectives generated     : 1
checkpoints durably kept : 2 of 2
settled (concepts)       : none
LEARNED (moved by a run) : none
```

One open gap, one objective minted for it with nobody asking, one episode, one
honest block. That is the whole of what ONIQ can autonomously pursue right now,
and it is the same `runner-availability` v1.4-R named.

### The advanced clock: the maintenance path, and why it needs one

```
surveyed at              : T0 + 400d
episodes THIS process    : 3
  #0 success  maintenance   reverify:queue-eligibility
  #1 success  maintenance   reverify:dispatch-backoff
  #2 blocked  knowledge_gap learn:runner-availability
settled (concepts)       : queue-eligibility, dispatch-backoff
LEARNED (moved by a run) : none
checkpoints durably kept : 4 of 4
```

### Across the process boundary, with a person's request arriving late

```
restored from checkpoint : true
episodes THIS process    : 2          episodes total : 5
  #3 blocked  user_request  user:dispatch  -> follow-up badec653
  #4 blocked  follow_up     unblock:user:dispatch

--- backlog ---
  done       1.0000 d0 a1 maintenance   reverify:queue-eligibility
  blocked    1.0000 d0 a1 user_request  user:dispatch
  blocked    1.0000 d1 a1 follow_up     unblock:user:dispatch
  blocked    0.8000 d0 a1 knowledge_gap learn:runner-availability
  done       0.7000 d0 a1 maintenance   reverify:dispatch-backoff
```

Four separate things are visible in those five lines, and none of them is
asserted anywhere — they are what the runtime did:

- **The restore is real.** Three episodes of history and two `done` objectives
  came out of a file written by a process that had already exited.
- **The follow-up chain terminated by itself.** `user:dispatch` requires three
  concepts and blocked on one, so a follow-up was earned; that follow-up requires
  exactly the concept it then blocked on, so the same-requirement-set guard
  refused a grandchild. `MAX_FOLLOW_UP_DEPTH` was never reached — the cheaper
  guard fired first, which is what it is for.
- **The six-factor score moved.** `learn:runner-availability` was 0.7200 in the
  first process and 0.8000 in the third, because the focus changed and the
  survey merged a higher-importance view of the same concept from the focus
  goal. Real re-ranking, not a constant.
- **Nothing was re-done.** The two `done` maintenance objectives were regenerated
  by the survey and deduped onto their existing rows.

---

## Four defects, every one found by running it

### 1. The episode bound was read against the LIFETIME counter

`maxEpisodes` was checked as `snapshot.episode >= bounds.maxEpisodes`. The
snapshot's episode count persists across processes, so **the second process to
open a checkpoint that had already reached the bound would stop before its first
episode, forever**, reporting `max_episodes` as though it had done work. The
bound belongs to the invocation; the counter belongs to the lifetime, and
conflating them makes a restored runtime dead on arrival.

**No single-process test can see this.** It was found by running the script
twice, which is the whole reason the script exists.

### 2. An all-blocked backlog reported `idle`

The first live run printed _"nothing is pending and the survey found nothing
open"_ while an unresolvable objective sat in the backlog. There are **three
ways to have nothing to do** and they are not the same thing:

```
idle      the backlog is empty and the survey found nothing open
blind     the survey REFUSED — the runtime cannot see, so it cannot choose
stalled   there was work and every attempt at it blocked
```

A system that reports having nothing left to learn while it is stuck is
announcing that it knows everything. Now separated, and each arm is asserted.

### 3. `learned` was reporting what was already known

The episode reported the objective's VERIFIED concepts as `learned`, so a run
that confirmed two facts ONIQ already held announced that it had learned them.
`settled` and `learned` are two different claims and are two fields now:
`settled` is what the objective asked for and now holds; `learned` is what **this
episode moved**, which on this substrate is always nothing. A metric that reads
as progress and is really a restatement of the starting position is worse than no
metric.

### 4. The maintenance path is UNREACHABLE in production, and that is a finding

`buildSubstrate` re-ingests every record on every tick and stamps
`lastVerifiedAt` with that tick's own instant, so `nowMs` and the verification
time are always equal and `freshness` can never call a `stable` or `slow` record
stale. **Nothing ages, because nothing persists.** So the staleness factor and
every maintenance objective are real code with no reachable input until ONIQ has
a durable knowledge table.

That is the **sixth** "built and unit-tested is not reachable" in this repository.
It was not fixed — the honest exercise is `--advance-days`, which surveys at
T0+N while the records stay stamped at T0 and says in the source that this is
the only way to reach the path today. Manufacturing staleness inside the
substrate to make the demonstration look busier would have hidden exactly the
thing worth reporting.

---

## Design decisions worth reading

**THE BRIEF SAYS "FRESHNESS"; THE FACTOR IS ORIENTED AS DEMAND.** This is the one
place the formula could not be transcribed literally, and getting it wrong would
have been silent. A factor rising with how _fresh_ knowledge is would down-rank
exactly the stale claims maintenance exists to find — a record unverified for a
year scoring near zero and never looked at again. The field is `staleness`, 1
means overdue now, and the direction is asserted on two otherwise-identical gaps
rather than left to the name.

**THE TWO NEW FACTORS MAY RE-RANK AND MAY NOT VETO.** Six multiplied terms mean
any single zero annihilates the other five. `detectGaps` handles that for its own
four by FILTERING (`openGaps` drops VERIFIED), which is right for evidence about
the gap; staleness and relevance are context, and context that can silently
discard four measurements is not a modifier but a gate nobody declared. Both are
clamped into `[MODIFIER_FLOOR, 1]`.

**IT IS A STRICT EXTENSION, AND THAT IS ASSERTED.** With no staleness source and
no focus, the six-factor ranking is `detectGaps`' own priority ordering element
for element, over 60 randomised knowledge states. A caller who cannot supply the
new information loses nothing.

**RELEVANCE IS GRAPH DISTANCE, NEVER STRING SIMILARITY.** A similarity score over
labels would be a measure invented here and calibrated against nothing — the
physiological lab ranges that were written from memory and deleted the same day.
It walks the `dependsOn` edges that already exist and reports UNREACHABLE as the
floor rather than guessing.

**THE ID HASHES WHAT THE OBJECTIVE IS FOR, NOT WHAT IS BELIEVED ABOUT IT.** Status,
attempts, priority and the blocker move; the source and the concepts do not. So a
regenerated objective dedupes onto its existing row instead of minting a copy
every cycle — the substrate's own `assertionId` rule, and here it is what stands
between the runtime and unbounded backlog growth. Importance is deliberately
outside the hash: the same thing to learn at a different weight is the same thing
to learn, and including it would make dedupe fail on a drift of 0.01.

**THE RUNTIME MAY NEVER MINT A `user_request`.** Three of the four sources are
autonomous; the fourth is a person speaking and can only be handed in.
`generateObjectives` is typed to `AutonomousSource` rather than told not to. A
generator that could emit `user_request` would let the loop attribute its own
goal to somebody who never asked for it.

**A PERSON'S REQUEST OUTRANKS THE RUNTIME'S OWN CHORES, UNCONDITIONALLY.** Not by
a weight — a numeric bonus large enough to guarantee it is a number nobody chose.
An autonomous system whose self-generated maintenance can outscore a waiting
person has inverted who it is for.

**THE LIFECYCLE BOUNDS ARE RUNAWAY GUARDS AND ARE NOT ZERO.** Read against
`DEFAULT_BUDGETS`, whose `maxToolCalls`, `maxTokens` and `maxCostUsd` all ship at
0 because what a run may SPEND is the owner's decision. `maxEpisodes` and
`maxWallMs` bound how long a lifecycle goes round — the `maxExecutionTimeMs`
case, where a zero does not fail closed but fails DEAD. **Nothing in the runtime
file can spend anything**; the episode seam does, and it carries the budgets.

**GENERATED GOALS STAY NARROW BECAUSE A QUESTION IS OPEN, not because it is
tidier.** v1.4-R measured that SUPERPOSE admits one prerequisite per iteration in
declaration order and never consults the gap detector. The owner's instruction is
that the mismatch _"deserves a measured experiment rather than a convenient
implementation"_, so nothing here works around it:
`MAX_GENERATED_REQUIREMENTS = 2`, and generation simply does not produce goals
wide enough to depend on the answer. The prerequisite it does pick is chosen by
**how many other concepts name it**, not by declaration order — picking the same
way twice would make the two decisions agree by coincidence and hide the mismatch
the owner asked to keep visible.

---

## What was deliberately NOT done

|                                     |                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| SUPERPOSE prerequisite/gap mismatch | Untouched. It needs a measured experiment.                                                                      |
| A graph database (Jena / AGE)       | Not added. The v1.4-R benchmark stands: tens of microseconds per query over 123 records, 6 ms for a whole tick. |
| Deploy / publish / merge to `main`  | None. The flag `OQCA_STORY_DISPATCH` still ships `off`.                                                         |
| A non-zero execution budget         | Still the **owner's decision, still unanswered**.                                                               |
| `remoteQuantumExecution`            | `false`, `maxQuantumCostUsd` 0, `OQCA_MAX_COST_USD` 0 — unchanged and asserted.                                 |
| A server                            | Nothing hosts the lifecycle. `autonomyGap()` says so in its own words.                                          |

---

## The open owner decision, restated

Two things now stand between this runtime and the owner's full sentence, and both
are decisions rather than engineering:

1. **A non-zero execution budget.** At `maxToolCalls`/`maxTokens`/`maxCostUsd` =
   0 the loop reasons about nothing and acts on nothing. This has been raised
   once and is not answered; it is a spend decision under CLAUDE.md's first rule.
2. **A durable knowledge table.** Without one, nothing an episode establishes
   survives the tick, so "update its knowledge" cannot be true however good the
   research capability gets. That is a production schema change, and a
   shadow-mode integration does not get to make one on its own.

Neither is blocking anything user-facing: nothing here is deployed, and with the
shipped defaults an autonomous tick costs **$0**.

---

## Gates

|                                        |                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/oqca`                             | 679 tests across 24 files (37 of them v1.5)                                                                                                                                   |
| whole suite                            | **382 files / 6,880 tests green** — one run showed the known unrelated `arapStep11dDiagnosis` timing flake under load; it passes alone and the next clean run was 6,880/6,880 |
| mutations                              | **120 run, 120 RED, 0 GREEN, 0 NOTAPPLIED** (`bash scripts/oqca-mutate.sh`) — 18 of them new, one per stop this runtime depends on                                            |
| tsc / `lint:ci` / Prettier             | clean                                                                                                                                                                         |
| `node scripts/oqca-mirror.mjs --check` | clean, **43 files** (was 40)                                                                                                                                                  |
| `deno check`                           | `story-dispatch/index.ts` and `_shared/oqcaRuntime/autonomous.ts` clean                                                                                                       |
| spend                                  | **$0**. No migration, no edge-function deploy, no Lovable message, no credits, no publish, `main` untouched.                                                                  |

The eighteen new mutations, each removing one stop rather than one feature:

```
M103 the generator mints a user_request        M112 relevance stops being graph distance
M104 the objective id commits to importance    M113 the runtime dies on the first block
M105 a regenerated objective overwrites        M114 the episode bound reads the lifetime
M106 a follow-up may be its own parent         M115 a stalled runtime reports idle
M107 the follow-up chain loses its depth bound M116 trimming drops objectives with history
M108 chores outrank a person's request         M117 reawakening ignores the attempt bound
M109 a blocked objective becomes selectable    M118 already-known reported as learned
M110 staleness read as literal freshness       M119 maintenance unscoped from the goals
M111 a context factor may veto the other five  M120 the world offers a research action
```

## Reproducing it

```
npx tsx scripts/oqca-autonomous-run.ts --reset                       # the true clock
npx tsx scripts/oqca-autonomous-run.ts --reset --advance-days=400    # process 1
npx tsx scripts/oqca-autonomous-run.ts --advance-days=400            # process 2, restores
npx tsx scripts/oqca-autonomous-run.ts --advance-days=400 --seed-user
npx vitest run src/oqca/__tests__/autonomy.test.ts
bash scripts/oqca-mutate.sh                                          # 120, all RED
```

`docs/oqca/autonomous-run/console.txt` is the verbatim output of the four
processes above — the script prints to stdout and a shell redirect names the
file, so nothing in the script has to know where its own record lives — and
`checkpoint*.json` is what actually crossed between them. It is `.txt` rather
than `.log` because `.gitignore` excludes `*.log` repo-wide, and an artifact a
report points at has to be committed for the pointer to mean anything.
The clock is pinned so a rerun reproduces it byte for byte; the only difference
between process 1 and process 2 is the restore.
