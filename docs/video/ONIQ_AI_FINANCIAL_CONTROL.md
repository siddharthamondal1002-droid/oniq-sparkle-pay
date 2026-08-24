# ONIQ_AI_FINANCIAL_CONTROL

**Status** IMPLEMENTED AND VERIFIED against real PostgreSQL 16 · **Date** 2026-08-24

---

## 0. The ledger is USD

Every money column is USD: `daily_usd_cap`, `request_usd_cap`, `job_usd_cap`,
`estimated_usd`, `actual_usd`, `reserved_usd`, `settled_usd`, `charged_usd`,
`usd_per_accepted_unit`. There is **no INR column and no stored FX rate**, and
`src/lib/__tests__/currencyDiscipline.test.ts` fails the build if either
appears. An FX rate is a second, independently-moving number; letting one into
admission would mean a request could be refused on a day when nothing about the
provider or the budget changed.

## 1. One ledger, many capabilities

```
FINANCIAL_ADMISSION → CAPABILITY → PROVIDER → MODEL → UNIT
  → RESERVATION → PROVIDER CALL → MEASURED SETTLEMENT
```

`provider_spend_ledger` replaces the search-only `search_spend_*` (rows carried
over, then dropped). The accounting is shared; what varies per capability is the
**unit** and the **price**, and those live in the edge-function adapters next to
the call that uses them.

| Capability          | Unit                                         |
| ------------------- | -------------------------------------------- |
| SEARCH              | `search+tokens`                              |
| TEXT                | `tokens`                                     |
| IMAGE               | `images`                                     |
| VIDEO / VIDEO_AUDIO | `video_seconds` / `video_seconds_with_audio` |
| TTS                 | `characters`                                 |
| OTHER               | `provider_unit`                              |

**No unit is ever converted into another.** A video second is not a token and no
exchange rate exists; the ledger only ever adds up dollars.

## 2. Three ceilings, not one

**Owner directive, 2026-08-24.** The three VIDEO caps the owner refers to are
these, and they are **spend ceilings in USD** — not motion-class acceptance
thresholds, not quality bars, not benchmark scores:

| Owner's name  | Column            | Stops                      |
| ------------- | ----------------- | -------------------------- |
| `VIDEO_CAP_1` | `request_usd_cap` | one pathological call      |
| `VIDEO_CAP_2` | `job_usd_cap`     | one film / one shot ladder |
| `VIDEO_CAP_3` | `daily_usd_cap`   | the whole fleet, for a day |

`max_attempts_per_job` is a **separate invariant**: a count, not money. It
bounds how many times a shot may be attempted regardless of how cheap each
attempt is. A $0.001 model retried forever is still an outage.

A day cap alone cannot stop one film eating the day, and neither can stop a
single shot retrying forever.

### The four controls, precisely

| Control                | Kind  | Bounds                                      |
| ---------------------- | ----- | ------------------------------------------- |
| `request_usd_cap`      | money | what ONE attempt may **reserve**            |
| `job_usd_cap`          | money | committed (reserved + settled) for ONE job  |
| `daily_usd_cap`        | money | committed across ALL jobs, per day          |
| `max_attempts_per_job` | count | how many attempts one job's ladder may make |

### Configured ceiling vs currently reachable exposure

**These are different numbers, and the difference is deliberate.**

```
effective_job_exposure = min(job_usd_cap, request_usd_cap × max_attempts_per_job)
```

For the configuration in force — request **$1.00**, job **$5.00**, daily
**$50.00**, attempts **3**:

```
min($5.00, $1.00 × 3) = $3.00
```

So the retry ladder can reserve at most **$3.00** against a job ceiling of
**$5.00**.

> **A job ceiling may be higher than the maximum currently reachable spend
> because the job ceiling is an independent financial backstop. Increasing the
> retry ladder in the future must never bypass the job ceiling.**

The $2.00 gap is **not** wasted, **not** an accounting bug, and **not**
something to "fix" by lowering the job cap or raising the attempt count — both
are owner policy decisions. The $5.00 is retained deliberately as the absolute
per-job backstop, so that a future change to retry policy runs into a ceiling
that is already there rather than one nobody set.

Proved on PostgreSQL 16.13, both directions:

```
attempts = 3  (production)   attempt 4 -> job-attempts-exhausted
                             job committed 3.000000, ceiling 5.0000 unreached
                             THE LADDER BINDS

attempts = 10 (hypothetical) attempt 6 -> job-cap-reached
                             job committed 5.000000, 5 of 10 attempts used
                             THE MONEY BINDS
```

`effectiveJobSpendCap()` in `_shared/financialLedger.ts` states this in code and
`videoCaps.test.ts` regression-tests it at 3, 4, 5, 6 and 10 attempts — where
the answers are $3, $4, $5, $5, $5. It is **explanatory only**: PostgreSQL's
`admit_provider_spend` holds the row locks and makes the real decision, and no
spend is ever routed through the helper.

### What the ceilings bound is ADMISSION, not the provider's invoice

Measured, same instance: admission caps what each attempt may **reserve**, but
`settle_provider_spend` records the provider's **actual** charge with no
ceiling. A $1.00 reservation settled at a reported $3.00 charges $3.00 —
because refusing to record a real invoice would be fabricating a cheaper one,
and this ledger's first rule is that unknown or inconvenient costs never become
smaller than they are.

The protection is that an overspend is immediately visible to the **next**
admission, since `committed = reserved + settled`:

```
reserve 1.00, settle actual 3.00   -> job settled 3.000000
next attempt at 1.00               -> admitted   (committed 4.00 <= 5.00)
next attempt at 2.01               -> over-request-cap
```

So the ladder self-corrects and stops early. Read `effective_job_exposure` as
"the most the retry ladder may **ask for**", never as a guarantee about what a
provider will bill.

### Exactly equal to a ceiling is ADMITTED

The same rule at all three: a ceiling is the most that may be spent, not the
first amount that may not. Measured — request cap $1.00, estimate $1.00 →
admitted; $1.01 → `over-request-cap`. Job committed reaching exactly $2.00
against a $2.00 job cap → admitted; the next cent → `job-cap-reached`.

### request ≤ job ≤ daily, enforced at write time

A request cap above the job cap lets one call exceed the whole job; a job cap
above the daily cap lets one job exceed the whole day. Either way the smaller
ceiling is decorative. `provider_budget_config_cap_ordering` **rejects** such a
row rather than silently normalising it, and `admit_provider_spend` re-checks
the same predicate and refuses `invalid-budget-configuration` — because a row
written before the constraint existed would still be sitting there.

## 3. Fail closed, everywhere

| Condition                           | Verdict                        |
| ----------------------------------- | ------------------------------ |
| no config row for the capability    | `no-budget-configured`         |
| `enabled = false` (**the default**) | `capability-disabled`          |
| estimate is 0                       | `zero-estimate`                |
| estimate is null/negative           | `invalid-estimate`             |
| estimate is NaN / ±Infinity         | `non-finite-estimate`          |
| units are NaN / negative            | `invalid-units`                |
| stored caps unusable or misordered  | `invalid-budget-configuration` |
| no model id                         | `no-model`                     |
| estimate over the request cap       | `over-request-cap`             |
| job spend over the job cap          | `job-cap-reached`              |
| attempts spent                      | `job-attempts-exhausted`       |
| day committed over the day cap      | `daily-cap-reached`            |
| request id seen before              | `duplicate-request`            |
| ledger unreachable                  | `admission-unavailable`        |
| service role missing                | `guard-unavailable`            |
| model unpriced                      | `unpriced-model`               |

`enabled` defaulting to **false** is `generation_allowed=false` expressed as a
schema default rather than a flag someone has to remember to set.

### The NaN ceiling — a real hole, now closed

PostgreSQL's `numeric` accepts `'NaN'` and `'Infinity'` and orders them **above
every real number**. Measured on PostgreSQL 16.13:

```
'NaN'::numeric > 0        -> t
'NaN'::numeric = 'NaN'    -> t
'Infinity'::numeric > 0   -> t
```

So the obvious `check (daily_usd_cap > 0)` **accepts a NaN cap**. Once stored,
admission computes `remaining := NaN - committed` = NaN, tests
`_estimated_usd > NaN`, gets FALSE — and admits **every** request. That is
"missing cap = unlimited spend" wearing a different hat, which is the single
failure mode this ledger exists to make impossible.

`is_spendable_usd(numeric)` is the one place that answers "is this a real,
spendable amount of money?". The NaN test comes first and is an **equality**
test, because any ordering test waves NaN straight past. It is `immutable` +
`strict` so it can sit inside a CHECK constraint, and `admit_provider_spend`
applies the same equality tests to the incoming estimate — a NaN estimate
happens to fail closed today through the ordering accident, and an accident is
not a control.

### `provider_budget_status(capability)` — a reason, not a boolean

Admission answers "may **this** request spend?". A UI, a worker preflight and a
health check need a different question — "is this capability configured to
spend at all?" — and its honest answer is a named state:

| State                 | Meaning                                       |
| --------------------- | --------------------------------------------- |
| `SPEND_CAP_UNSET`     | no config row. **Not** "unlimited", not "$0". |
| `CAPABILITY_DISABLED` | caps configured, `enabled = false`            |
| `CONFIGURED`          | caps configured and enabled                   |

Measured, VIDEO, today:
`{"reason": "SPEND_CAP_UNSET", "generationAllowed": false, "capsConfigured": false}`.

The TypeScript mirror is `providerBudgetStatus()` / `validateBudgetCaps()` in
`_shared/financialLedger.ts`, and `chooseTier()` refuses outright unless it is
handed a gate saying caps are configured and generation is allowed.

### Money is rounded to the column, not to the nearest hope

Every column money actually flows through — `estimated_usd`, `actual_usd`,
`reserved_usd`, `settled_usd` — is 6 decimal places, so `roundUsd()` rounds to 6. (The three ceilings are `numeric(10,4)`: a cap is a round number someone
types, not an accumulated figure. `numeric` comparison is exact across
precisions, so a 6dp estimate tested against a 4dp cap needs no coercion.)

This is not cosmetic: `0.03 * 60 === 1.7999999999999998` and
`0.1 * 3 === 0.30000000000000004` in IEEE-754. Rounding — not ceiling — because
a ceiling turns `0.1*3` into `0.300001` and quietly overcharges every estimate.

## 4. Settlement rules

- **Unknown provider cost stays unknown.** `charge := coalesce(_actual_usd,
led.estimated_usd)`. Never zero, never a fabricated refund.
- **Release only when nothing left the box.** Every ambiguity — timeout, 5xx,
  unparseable body, a thrown exception — settles.
- **Acceptance arrives after settlement.** `record_provider_outcome` records
  what ONIQ did with the output, minutes later, after technical/motion/audio QA.
  It never touches money, and it is the only reason
  `usd_per_accepted_unit` can be a real number.

## 5. Customer billing is a separate system

|               | Provider spend            | Customer billing                               |
| ------------- | ------------------------- | ---------------------------------------------- |
| Where         | `provider_spend_ledger`   | `claim_story_seconds` / `refund_story_seconds` |
| Charged when  | the provider generates    | the film is accepted                           |
| Failed output | **still charged to ONIQ** | **nothing to the user**                        |

The user flow is QUOTE → RESERVE USER CREDITS → GENERATE → QA → ACCEPT → COMMIT,
with RELEASE on failure. The two ledgers never net against each other: ONIQ
absorbing the cost of a rejected clip is the whole point of rejecting it.

## 6. Verified — measured output, real PostgreSQL 16

Both migration paths applied cleanly: a fresh database, and one that already had
the superseded search migration **with a row in it** (carried over, then
dropped).

```
no config row for VIDEO      {"ok": false, "reason": "no-budget-configured"}
config exists, enabled=false {"ok": false, "reason": "capability-disabled"}
estimate 0                   {"ok": false, "reason": "zero-estimate"}
no model id                  {"ok": false, "reason": "no-model"}
estimate 1.2 > cap 1.00      {"ok": false, "reason": "over-request-cap"}
happy path, job-scoped       {"ok": true, "attempt": 1, "remainingUsd": 9.2}
retries 2 and 3              {"ok": true, "attempt": 2} / {"ok": true, "attempt": 3}
retry 4 (max 3)              {"ok": false, "reason": "job-attempts-exhausted"}
job cap 3.00, 2.40 committed {"ok": false, "reason": "job-cap-reached"}
settle actual known          {"chargedUsd": 0.40, "actualKnown": true}
settle actual unknown        {"chargedUsd": 0.800000, "actualKnown": false}
release                      reservation returned, attempts NOT returned (attempts=1)
record outcome after settle  {"ok": true, "outcome": "ACCEPTED"}
record invalid outcome       {"ok": false, "reason": "invalid-outcome"}
```

`provider_spend_daily_metrics` then reported, from those rows:

```
capability | model        | requests | accepted | rejected | failed | charged | usd_per_accepted_second
VIDEO      | veo-3.1-fast |        3 |        1 |        1 |      1 |  1.6000 |                  0.2000
```

$1.60 charged across three generations, 8 accepted seconds → **$0.20 per
accepted second against a $0.05 nominal rate**. That 4× gap is exactly the
number routing has to optimise, and exactly the number a raw price list hides.

The concurrency proof from the previous loop still holds and was re-verified on
the same instance: 10 concurrent admissions against a $1.00 cap → 4 admitted,
reserved exactly 1.000000; the same function with `for update` removed → 10
admitted, **250% of cap**.

## 6a. Invariants migration — measured, same PostgreSQL 16.13 instance

`20260824150000_provider_budget_invariants.sql` applied cleanly on top of the
ledger migration. **Eleven** invalid configurations were attempted and all
eleven were rejected at write time:

```
NaN cap / Infinity cap / zero cap / negative cap        -> caps_spendable
request > job / job > daily / request > daily           -> cap_ordering
max_attempts_per_job = 0 / = 999                        -> attempts_sane
non-numeric cap                                         -> type error
unknown capability                                      -> capability check
request = job = daily                                   -> ACCEPTED (legal)
```

Ceiling boundaries, config request $1.00 / job $2.00 / daily $5.00, attempts 3:

```
estimate 0.99                {"ok": true}
estimate 1.00 (EQUAL)        {"ok": true}                       <- admitted
estimate 1.01                {"ok": false, "over-request-cap"}
job committed exactly 2.00   {"ok": true}
next cent                    {"ok": false, "job-cap-reached"}
5 x 1.00 in one day          all admitted; the sixth  {"daily-cap-reached"}
estimate 'NaN'               {"ok": false, "non-finite-estimate"}
units 'NaN'                  {"ok": false, "invalid-units"}
```

Attempt accounting, and the double-charge questions:

```
reserve -> release           attempts=1  reserved=0.000000   (money back, attempt NOT)
retries consume 2 and 3; the 4th  {"ok": false, "job-attempts-exhausted"}
settle once                  chargedUsd 0.40
settle again                 {"already-settled"}
release after settle         {"already-settled"}   reserved=0 settled=0.400000
record_provider_outcome REJECTED   settled_usd unchanged at 0.400000
```

Concurrency at the **job** ceiling — 8 workers entering together on one shot,
$0.50 each, job cap $2.00:

```
admitted = 4        job.reserved = 2.000000     INVARIANT HELD
```

and with `max_attempts_per_job = 3` instead: 3 admitted, 5 refused
`job-attempts-exhausted`. The day-ceiling proof (including the control that
removes `for update` and reaches **250% of cap**) is unchanged from §6.

## 7. Configured, and still not activated

**Both configured capabilities, in one place.** Owner directives of 2026-08-24.
Every ceiling below is in the production database and **neither capability may
spend a cent**, because configuring a budget and permitting spend are separate
decisions and only the first has been made:

| Capability | request | job   | daily  | attempts | enabled   |
| ---------- | ------- | ----- | ------ | -------- | --------- |
| **SEARCH** | $0.50   | $2.00 | $20.00 | 3        | **false** |
| **VIDEO**  | $1.00   | $5.00 | $50.00 | 3        | **false** |

No other capability has a row, so `TEXT`, `IMAGE`, `VIDEO_AUDIO`, `TTS` and
`OTHER` all read `SPEND_CAP_UNSET` and are refused. See §8b for SEARCH and §8c
for the measurements; the rest of this section is VIDEO.

**VIDEO caps are set. VIDEO generation is off.** Those are two decisions and the
owner has made only the first.

|                          |                                               |
| ------------------------ | --------------------------------------------- |
| `request_usd_cap`        | **$1.00**                                     |
| `job_usd_cap`            | **$5.00**                                     |
| `daily_usd_cap`          | **$50.00**                                    |
| `max_attempts_per_job`   | **3**                                         |
| `enabled`                | **false**                                     |
| `provider_budget_status` | `CAPABILITY_DISABLED`, `capsConfigured: true` |

Owner directive of 2026-08-24, recorded in
`supabase/migrations/20260824170000_video_spend_ceilings.sql`. That migration
inserts `enabled = false` and its `ON CONFLICT` clause deliberately omits
`enabled`, so re-running it can neither switch generation on nor switch it off
behind an owner who set it.

There is still **no default** on any ceiling. A capability the owner has not
configured stays `SPEND_CAP_UNSET` — refused, never unlimited.

An agent must not pick these numbers, change them, or turn generation on. They
decide how much of the owner's money a runaway can spend, which is a business
decision under `CLAUDE.md § Business decisions are the owner's`.

**What is still required to generate:** an explicit owner instruction to set
`enabled = true`, plus live provider credentials, plus benchmark evidence for
`chooseTier()` — which refuses on all three counts today.

## 8. Applied to the production database — 2026-08-24

Until this date the controls in this document existed **only in the repository**.
Every table, function and ceiling described above was absent from the production
database: `to_regclass` returned null for `provider_budget_config`,
`provider_spend_ledger`, `provider_spend_job` and `provider_spend_day`. The
owner's approved ceilings were protecting nothing, and a document headed
IMPLEMENTED AND VERIFIED was true of PostgreSQL 16 on a scratch machine and
false of the system that spends the money. **A migration in `main` is not a
control in force.**

All five `20260824*` migrations were applied verbatim on 2026-08-24 via the
Lovable agent, which owns Supabase migration history — applying the DDL directly
would have left `supabase_migrations` out of step with the schema. Read back
independently afterwards, not taken on report:

```
capability | request_usd_cap | job_usd_cap | daily_usd_cap | max_attempts | enabled
VIDEO      | 1.0000          | 5.0000      | 50.0000       | 3            | false

provider_budget_status('VIDEO')
{"capability":"VIDEO","capsConfigured":true,"generationAllowed":false,
 "requestUsdCap":1,"jobUsdCap":5,"dailyUsdCap":50,"maxAttemptsPerJob":3,
 "reason":"CAPABILITY_DISABLED"}
```

`enabled` is **false**, as it was in the file. Nothing was generated and no
provider was called.

### 8a. SEARCH was `SPEND_CAP_UNSET` — the trap, and how it was closed

The ledger migration drops `search_spend_*` after carrying its rows across, so
SEARCH is a capability of the general ledger like any other. On the morning of
2026-08-24 it had **no row** in `provider_budget_config`:

```
provider_budget_status('SEARCH')
{"capability":"SEARCH","capsConfigured":false,"generationAllowed":false,
 "reason":"SPEND_CAP_UNSET"}
```

That is §3 working as designed — an unconfigured capability is refused, never
unlimited. But `searchGuard.ts` fails closed on it, and four **live** edge
functions call it: `smart-scout`, `ting`, `health-scan`, `hotel-scout`.

Nothing was broken, because edge functions do not deploy with a web publish and
the versions in production still predate the guard (it landed the same day in
`3cec33fa` / `3a2419de`). The trap was in the ordering: **deploying those four
edge functions before a SEARCH row exists would refuse every search in
production.** The correct sequence is SEARCH ceilings first, edge deploy second,
and §9 keeps it.

Those ceilings are dollar limits on the owner's spend, so an agent does not pick
them — `CLAUDE.md § Business decisions are the owner's`. They were an open
question to the owner, not a blocked task with a sensible default. The owner
answered the same day; §8b is the answer.

### 8b. SEARCH ceilings — owner directive, 2026-08-24

|                                |                                |
| ------------------------------ | ------------------------------ |
| `request_usd_cap`              | **$0.50**                      |
| `job_usd_cap`                  | **$2.00**                      |
| `daily_usd_cap`                | **$20.00**                     |
| `max_attempts_per_job`         | 3 (schema default — see below) |
| effective current job exposure | **$1.50**                      |
| `enabled`                      | **false**                      |

Recorded in `supabase/migrations/20260824190000_search_spend_ceilings.sql`,
mirrored in `src/lib/__tests__/searchCaps.test.ts` so drift in either direction
fails the build.

**The owner supplied these numbers; the table they replaced did not.** This
needs saying because of a coincidence that would otherwise erase the
distinction: the dropped `search_budget_config` shipped a `request_usd_cap`
DEFAULT of **0.50**, the same figure the owner chose. Two numbers that agree by
accident are the easiest place in a codebase for an authority to be quietly
swapped, because afterwards nothing looks different. The directive is the
authority. The migration writes literals and never selects from anything, and a
test asserts that.

**No attempt count was authorised, so none was invented.** The migration omits
`max_attempts_per_job` and takes the column default of 3. The consequence,
stated rather than left to be discovered:

```
effective job exposure = min(job_usd_cap, request_usd_cap x attempts)
                       = min(2.00, 0.50 x 3) = 1.50
```

So $2.00 is a backstop **above** what the ladder can reach — the same shape as
VIDEO's $5.00 over $3.00, and for the same reason (§2). Raising attempts to
"use" the ceiling would be an agent spending more of the owner's money to
consume headroom, which is not what headroom is for.

### 8c. Measured against PostgreSQL 16.13, from the migration files

| #   | Property                                                | Result                                                               |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 2   | `0 < 0.50 <= 2.00 <= 20.00`                             | holds                                                                |
| 3   | NaN / +Inf / -Inf / 0 / negative as a **ceiling**       | all rejected; write blocked by `provider_budget_config_cap_ordering` |
| 3   | NaN / +Inf / -Inf / 0 / negative as an **estimate**     | `non-finite-estimate`, `zero-estimate`, `invalid-estimate`           |
| 4   | $0.50 request                                           | **admitted**                                                         |
| 4   | $0.51 and $0.500001                                     | `over-request-cap`                                                   |
| 5   | 4 x $0.50 on one job                                    | $2.00 exactly; 5th `job-cap-reached`                                 |
| 5   | $0.01 onto a job already at $2.00                       | `job-cap-reached`                                                    |
| 6   | 60 requests of $0.50 in a day                           | 40 admitted, day committed exactly $20.00                            |
| 7   | 3 x $0.001 on one job                                   | ladder exhausted at $0.003 of $2.00 — refused on **count**           |
| 8   | release after those 3 attempts                          | money $0.003 → $0.002, attempts stay 3; next admission still refused |
| 9   | settle $3.00 against a $0.50 reservation                | recorded as **$3.00**, unclamped                                     |
| 9   | next admission on that job                              | `job-cap-reached` — the overspend self-corrects                      |
| 10  | settle twice / release after settle / settle unknown id | `already-settled`, `already-settled`, `unknown-request`              |
| 11  | 12 concurrent workers, one job                          | exactly **4** admitted, $2.00 committed                              |
| 11  | 60 concurrent workers, own jobs                         | exactly **40** admitted, $20.00 committed                            |
| 13  | any admission while `enabled = false`                   | `capability-disabled`, including $0.01                               |

`'NaN'::numeric > 0` is **TRUE** in PostgreSQL, which is why `is_spendable_usd`
tests by equality rather than by comparison (§3, "The NaN ceiling").

One correction, recorded because the first result was wrong in a way that
flattered the system: the initial run set `max_attempts_per_job = 99`, the
invariants migration refuses anything outside 1..10, the UPDATE failed, and the
ladder therefore stopped at `job-attempts-exhausted` after **$1.50**. That
measured a real invariant — but not the $2.00 money ceiling it was labelled as.
Re-run at the maximum legal 10 attempts, where money binds first, it gives the
$2.00 figures above. An attempt ceiling stopping the ladder is not evidence
that a money ceiling would have.

## 9. Deployment ladder — four rungs, and SEARCH is on the first

Three states get conflated, and each conflation has its own way of being wrong:

| State                                                       | SEARCH today                            |
| ----------------------------------------------------------- | --------------------------------------- |
| **REPOSITORY CONFIGURATION** — a migration exists in `main` | **$0.50 / $2.00 / $20.00 · ENABLED**    |
| **PRODUCTION DATABASE** — the row is in the live database   | **$0.50 / $2.00 / $20.00 · ENABLED**    |
| **PRODUCTION ENABLEMENT** — spending is permitted           | **ENABLED**, owner directive 2026-08-24 |

The same three states for VIDEO: repository **$1.00 / $5.00 / $50.00 · 3
attempts · disabled**, production database identical, enablement **DISABLED**.
VIDEO's enablement is its own decision and has not been made.

**SEARCH being enabled does not mean SEARCH is spending.** The four searching
edge functions live in production predate the guard and never call the ledger,
so until rung 3 is climbed this flag changes no production behaviour. What it
changes is what happens _when_ they are deployed: admitted against the
ceilings, rather than refused `capability-disabled`.

**A row is not a live capability.** SEARCH is configured and refuses everything;
`provider_budget_status('SEARCH')` says `CAPABILITY_DISABLED`, which is a
different refusal from `SPEND_CAP_UNSET` and deliberately distinguishable from
outside.

The safe order, and why each rung has to come before the next:

1. **database configuration** ← _done._ Before this, admission answered
   `SPEND_CAP_UNSET`.
2. **application publish** — _not required by this change._ No frontend code
   queries the spend tables; `src/integrations/supabase/types.ts` declares them
   but that is compile-time only, and it has already been regenerated so the
   repo's types match the live schema (the dropped `search_spend_*` names are
   gone from it).
3. **edge-function deploy** — **BLOCKED, deliberately.** The four searching
   functions in production predate the guard and do not call the ledger. The
   builds in `main` do. Deploying them while SEARCH is disabled would turn
   every production search into a fail-closed refusal — correct behaviour by
   the ledger's rules, and a user-visible outage caused by shipping rungs out
   of order. Deploy them **after** enablement, not before.
4. **explicit SEARCH enablement** ← _done._ Owner directive of 2026-08-24,
   recorded in `20260824193000_search_enabled.sql`. `provider_budget_status`
   now answers `CONFIGURED` with `generationAllowed: true`.

Rung 3 before rung 4 is the specific mistake this ladder exists to prevent, and
it is not hypothetical: it is what "just deploy the guard" would have done. The
rungs were climbed 1, 2, 4, 3 — enablement before deploy — precisely so that
the deploy lands into a capability that admits rather than one that refuses.

### 9a. Why a deploy cannot leak spend, structurally

Audited 2026-08-24, and the guarantee is structural rather than a matter of
each function remembering to behave:

- `withProviderSpendGuard` reaches `run()` — the callback holding the provider
  call — **only after `admission.ok` is true**. `capability-disabled` returns
  `ok: false`, so a disabled capability never enters the callback.
- All four searching functions place their Anthropic call **inside** that
  callback, and each reads `.admitted` before touching `guarded.value`.
  `searchCaps.test.ts` asserts both by character offset, so a future edit that
  hoisted a provider call above the guard fails the build.
- **No searching function references `provider_budget_config`.** `enabled`
  lives in the database, so shipping code cannot flip it. Deploy and enable
  stay two separate acts, which is what makes rung 3 and rung 4 different rungs
  rather than the same one.

### 9b. Two migration files, and both stay

Applying `20260824190000` produced a second file — Lovable's applied-ledger
copy `20260824171654_ef84b816-….sql`. They are the same SQL: 5052 vs 5051
bytes, with `cmp` reporting **EOF rather than a mismatch**, so the applied copy
is the owner's file minus its final newline.

The duplicate is deliberate and must not be tidied away. The two files make
**different claims**: the owner's says what the repository intends, the applied
record says what actually ran against the live database. Deleting the second
would destroy the only in-repo evidence of the apply and collapse the very
distinction §9 exists to keep.

The real risk of a duplicate is drift — someone edits one and not the other —
so `searchCaps.test.ts` fails the build if their content diverges, if either is
deleted, or if either gains an `enabled =` in its `ON CONFLICT`.

Verified on a fresh database, all 317 migrations applied in Supabase's
lexicographic order:

| Property                                        | Result                                             |
| ----------------------------------------------- | -------------------------------------------------- |
| ordering                                        | applied record (#316) runs **before** owner (#317) |
| each file alone                                 | both yield `0.50 / 2.00 / 20.00 / disabled`        |
| both together                                   | one SEARCH row, the owner's numbers, disabled      |
| idempotence: 8 further applies, mixed order     | unchanged, still exactly one row                   |
| re-run with `enabled` set true by an owner      | stays **true** — a re-run cannot switch it off     |
| re-run over a tampered ceiling (`request=0.25`) | repaired to `0.50`                                 |
| re-run with VIDEO moved to `job=6.00`           | **raises** `VIDEO ceilings changed …`              |

The second application is a no-op `UPDATE` to the values already there. The
owner's file sorts last, so on a fresh database it has the final say — the safe
way round.

### 9c. One paid path the ledger does not cover — Google Maps in `smart-scout`

Found while auditing rung 3, and reported rather than acted on.

`smart-scout/index.ts` calls the Google Geocoding API (`ADDRESS_DESCRIPTORS`)
**before** the spend guard opens — the fetch is at line ~129, the guard at
~236. It is guarded only by the presence of `GOOGLE_MAPS_API_KEY` and by the
caller supplying coordinates, with a 2.5s timeout and a silent fallback.

Three things are true and should not be conflated:

1. **It is outside the ledger.** No `admit_provider_spend`, so no request, job
   or daily ceiling applies to it. `search_spend` never covered it either — it
   is a Maps SKU, not the SEARCH capability.
2. **It is not new, and deploying does not introduce it.** The block dates from
   `024cf9c3` (2026-07-19); the deployed `smart-scout` already contains it. So
   it is not a reason to hold rung 3, and holding rung 3 does not stop it.
3. **It is unaffected by SEARCH being disabled.** A refused SEARCH admission
   happens _after_ this call. Today, a request carrying coordinates can spend
   Maps quota and then be refused a search.

Whether a Maps ceiling is wanted — and at what figure — is a decision about
which paid APIs the owner's money funds, so it is the owner's under `CLAUDE.md
§ Business decisions are the owner's`. Nothing here was changed. It is recorded
so that "SEARCH is fully bounded" is never read as "ONIQ's search path spends
nothing without a ceiling", which is a stronger claim than the evidence
supports.
