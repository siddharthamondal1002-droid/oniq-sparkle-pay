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

### 8d. HAIKU 4.5 — the single-request gate, measured

Owner directive of 2026-08-24, run 2026-08-25. One real authenticated
`smart-scout` search, after switching the model and rebuilding the reservation.

|                      | RESERVED  | ACTUAL        | over cap           | terminated on     |
| -------------------- | --------- | ------------- | ------------------ | ----------------- |
| **OPUS 5** (control) | $0.445625 | **$0.530683** | **YES** +$0.030683 | `BUDGET_TOKENS`   |
| **HAIKU 4.5**        | $0.195625 | **$0.126595** | no                 | `BUDGET_SEARCHES` |

**The gate passes**: $0.126595 <= $0.50, with 74.7% of the ceiling unused.
Measured reduction against the control is **76.1%** — and it is now measured,
not the 65.6% projected from repricing the control's tokens.

**The reservation is honest for the first time.** Opus reserved $0.085058 LESS
than it spent; Haiku reserved $0.069030 MORE. That inversion is the whole
point, and the token detail shows why the new reserve holds:

```
input   74,017 of 104,000 reserved   (71% used)
output   1,716 of   6,000 reserved   (29% used)
hops          6 of       6 reserved  (100%)
```

Read the termination reasons together — they are the mechanism, not trivia.
Opus stopped on `BUDGET_TOKENS` with **5 of its 11 hops unused**: it ran out of
context before it ran out of permission, so the flat token reserve was the
binding constraint and it was set too low. Haiku stopped on `BUDGET_SEARCHES`
at exactly 6 of 6: the **depth cap** bound, which is the control that was
actually chosen and sized. A ceiling you picked binding in place of one you
mis-estimated is what "under control" looks like.

Capacity follows: $20.00/day is roughly **157 searches** at the measured
actual, against ~37 under Opus.

`over_cap` marking works as specified in §10 — the Opus control backfilled to
`true` with `request_cap_usd_at_settle = 0.5000` and `over_by_usd = 0.030683`,
its `actual_usd` untouched at $0.530683; the Haiku row reads `false`. Exactly
one row appears in `provider_spend_over_cap`, and it is the one that deserves
to.

**This is n=1 and the distribution is not yet characterised.** P95, P99 and the
quality verdict need the request battery; nothing here licenses calling Haiku
production-ready. `ting`, `health-scan` and `hotel-scout` still run their
original models and were deliberately left alone so this experiment moved one
variable.

**A note on the day rollup.** The container clock jumped ~8 hours mid-session,
so the control and the Haiku request landed on different UTC days:
`2026-08-24 settled $0.530683` and `2026-08-25 settled $0.126595`, one request
each. The per-request measurement is unaffected — but the daily totals are not
a running sum across the two, and reading them as one would understate what a
single day can hold.

### 8e. HAIKU 4.5 — the 51-request battery, and the economic gate

Run 2026-08-25: the single-request gate plus a 50-request battery across short,
medium, long, multi-part, local and multilingual queries.

|                             |               |
| --------------------------- | ------------- |
| requests                    | **51**        |
| total actual                | $5.984745     |
| average                     | $0.119695     |
| median                      | $0.123078     |
| **P95**                     | **$0.134487** |
| **P99**                     | **$0.136387** |
| **max actual**              | **$0.136424** |
| max reserved                | $0.195625     |
| **over-cap requests**       | **0**         |
| **under-reserved requests** | **0**         |
| tightest reserve headroom   | $0.059201     |
| average hops                | 5.51 · max 6  |

**ECONOMIC GATE: PASS.** Max actual is **$0.136424** — 27% of the $0.50
ceiling, with the worst request in 51 still leaving 73% unused. Zero over-cap
settlements, and `provider_spend_over_cap` still holds exactly one row: the
Opus control.

**The reservation covered actual on every single request.** `under_reserved`
is 0 across 51, tightest headroom $0.059201. Compare the control, which
under-reserved by $0.085058. That is the difference between an estimator that
models the workload and one that guesses at it.

The termination breakdown shows the depth cap doing the work:

| outcome  | termination       | n   | avg input tokens | max input |
| -------- | ----------------- | --- | ---------------- | --------- |
| ACCEPTED | `BUDGET_SEARCHES` | 35  | 73,514           | 95,559    |
| ACCEPTED | `COMPLETED`       | 15  | 61,580           | 81,108    |
| FAILED   | `PROVIDER_ERROR`  | 1   | 0                | 0         |

Max observed input was **95,559 against a 104,000 reserve** — the reserve held
with room on the worst case in the set, which is what a reserve is for. 35 of
51 hit the 6-hop cap; 15 finished early on their own. Nothing exceeded 6 hops.

The one `PROVIDER_ERROR` is failure isolation behaving correctly: it **settled
rather than released**, because a provider error may still have been billed and
this ledger never assumes an inconvenient cost away.

### 8f. The same defect is still live in two other functions

The battery measured the mechanism precisely: **~13,220 extra input tokens per
search hop**. Applying that to the functions still on their original
configuration, none of which were touched by this experiment:

| function      | model      | hops | projected actual       | verdict                            |
| ------------- | ---------- | ---- | ---------------------- | ---------------------------------- |
| `smart-scout` | haiku-4-5  | 6    | **$0.136424 measured** | deployed, proven                   |
| `health-scan` | sonnet-4-6 | 4    | ~$0.280                | under the ceiling; reserve too low |
| `ting`        | **opus-5** | 5    | **~$0.506**            | **breaches $0.50**                 |
| `hotel-scout` | **opus-5** | 11   | **~$1.033**            | **breaches by 2x**                 |

`ting` and `hotel-scout` are therefore **deliberately not deployed**. Shipping
them unchanged would push real user requests over the owner's ceiling — the
precise failure this work exists to prevent — and the fact that a deploy was
requested does not make a projected $1.03 request acceptable. They need the
same three-part fix `smart-scout` received (cheaper model, explicit depth cap,
depth-scaled reserve), and choosing their model is a product decision, not an
agent's.

`health-scan` is safe to deploy on cost: sonnet-4-6 at 4 hops stays under the
ceiling. Its $0.067 reserve is too low and it will under-reserve, which is an
accounting inaccuracy rather than a breach.

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

### 9d. FIRST LIVE SEARCH — the estimate under-reserves, measured

Rung 3 was climbed on 2026-08-24 and one real `smart-scout` search was run as a
smoke test. It succeeded, settled, and immediately falsified something this
document had been asserting: that `worstCaseUsd()` is a worst case.

```
request  cf859373-…   capability SEARCH   model claude-opus-5   SETTLED/ACCEPTED
estimated_usd  0.445625        <- the reservation
actual_usd     0.530683        <- what Anthropic actually charged
overrun        0.085058  (+19.1%)

detail: searchCount 6   inputTokens 99,321   outputTokens 4,295
        cacheHits 1     terminationReason BUDGET_TOKENS
```

**The reserve is not an upper bound.** Against reserves of 11 hops / 48,000
input / 3,500 output:

|               | reserved | actual     | ratio         |
| ------------- | -------- | ---------- | ------------- |
| search hops   | 11       | 6          | 0.55x (under) |
| input tokens  | 48,000   | **99,321** | **2.07x**     |
| output tokens | 3,500    | 4,295      | 1.23x         |

The mechanism is structural, not a fluke: **each web-search hop feeds its
results back into the context**, so input tokens grow with hop count while the
flat 48,000 reserve does not. `terminationReason BUDGET_TOKENS` confirms it —
the call stopped on tokens with 5 of its 11 hops unused. Reserving fewer hops
than used would have been safe; reserving half the tokens was not.

Three consequences, and they are not equally bad:

1. **The $0.50 request ceiling did not bind the real charge.** One search cost
   **$0.5307**. This is §2's documented behaviour — admission bounds the
   _reservation_, settlement records the _invoice_ and never clamps it — but in
   practice it means the per-request ceiling is advisory for SEARCH rather than
   binding.
2. **The daily $20.00 ceiling still binds real money**, because
   `committed = reserved + settled` and settlement writes the actual. The day
   rollup reads `settled_usd 0.530683, request_count 1`. This is the protection
   that actually holds, and it held.
3. **Capacity is lower than the estimate implied.** At the measured actual,
   $20.00/day is roughly **37 searches fleet-wide**, not the ~44 the
   reservation arithmetic suggested.

**Nothing was changed in response.** The three ways to close the gap are all
decisions that are not an agent's to make:

- raise `request_usd_cap` — the owner's money;
- cut `SCOUT_MAX_SEARCHES` or the token budget — changes answer quality;
- accept that actuals may exceed the per-request ceiling, relying on the daily
  cap as the real bound.

Raising the input reserve to cover observed usage is **not** a free fix: it
pushes the modelled worst case above $0.50, at which point admission would
refuse every `smart-scout` search with `over-request-cap`. That is the trap —
making the estimate honest, on its own, converts a silent overrun into a
visible outage.

This is **one measurement**, n=1. The mechanism is understood well enough to
expect it to recur, but the distribution — how often, how far over — is not
characterised, and should not be guessed at from a single row. The ledger now
records every search, so that question is answerable by waiting rather than by
estimating, which is the first time that has been true.

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

### 9d. The fleet is on Haiku, and the Anthropic account is out of credit

Owner directive, 2026-08-25: "change all to haiku". All four searching edge
functions — `smart-scout`, `ting`, `health-scan`, `hotel-scout` — name
`claude-haiku-4-5` and were deployed at `3e6932d3`.

Two of the three follow-up proof requests returned `PROVIDER_ERROR`. That is
**not** a Haiku incompatibility and not a guard refusal. The edge-function log
gives the reason verbatim:

```
ting: anthropic error 400 — "Your credit balance is too low to access the
      Anthropic API."
hotel-scout: {"error":"AI credits exhausted — top up to keep scouting"}
```

The same error accounts for the single `PROVIDER_ERROR` inside the 51-request
battery. So the correct reading is: **the Anthropic account ran dry partway
through the battery**, and every search-shaped feature in ONIQ has been
unavailable since. The Haiku change is deployed and its economics are measured;
what is not measured is `ting` and `hotel-scout` against a real invoice,
because neither ever reached the model.

Three things this leaves standing, none of them fixed here:

1. **`ting` has no working fallback under this outage.** Its Gemini path exists
   but the spend guard refused it as `unpriced-model` — there is no rate for
   `gemini-3.6-flash` in `MODEL_RATES`, and the guard fails closed rather than
   admitting an unpriced call. Pricing that model is a decision about which
   account's money answers a search when Anthropic is dry, so it is the
   owner's under `CLAUDE.md § Business decisions are the owner's`.
2. **`_shared/llm.ts` still defaults to Opus.** Line ~532 reads
   `model: opts.model ?? "claude-opus-5"`. All four searching functions pass
   `model` explicitly, so the directive is satisfied where it was aimed — but
   any future caller that forgets the field silently buys Opus. Changing the
   default would re-tier every _non-search_ `callClaude` caller at once, which
   is a spend decision, not an implementation detail. Flagged, not changed.
3. **`hotel-scout` has the widest unproven exposure.** 11 hops, a strict JSON
   schema and a cross-check requirement, on the smallest model, with zero
   quality evidence. Its reservation ($0.315625) is the only thing verified
   about it.

`health-scan` was skipped deliberately: the Lovable agent had no real medical
report and was told not to invent one.

## 10. A second provider, and why it is still switched off

Owner loop, 2026-08-25: add a financially bounded Gemini 2.5 Flash-Lite
failover for Anthropic credit exhaustion, and do not blindly enable it.

The failover is built, tested and merged. It is **DISABLED**, and this section
says exactly which gate it fails, because "implemented" and "safe to switch on"
are different claims and the second one is not yet true.

### 10a. The rate is corroborated, not read

`gemini-2.5-flash-lite` enters `MODEL_RATES` at **$0.10 / MTok input, $0.40 /
MTok output**. Three sources agree on those two figures: two independently
worded web searches, both attributing them to Google's own GA announcement, and
the owner's directive.

None of them is a primary read. `ai.google.dev`, `cloud.google.com`,
`docs.cloud.google.com` and `developers.googleblog.com` are **all blocked by
this container's network egress proxy**, so Google's pricing page could not be
opened at all. Every Anthropic rate in the same table was read off
`platform.claude.com`, which is reachable. That asymmetry is recorded in the
code as `GEMINI_PRICING_PROVENANCE = "corroborated-secondary"` and asserted by
a test, so nobody later reads the two kinds of rate as equally established.

### 10b. What is deliberately NOT priced, and what follows from it

Google bills **Grounding with Google Search separately from tokens**, and that
rate could not be established. The searches that returned a number disagreed —
**$14 per 1,000** in one summary, **$35 per 1,000** in a forum thread title —
and the free allowance and the per-query-versus-per-prompt counting rule differ
by model generation. No primary page was reachable to settle it.

So `SEARCH_UNIT_USD_BY_MODEL` carries an **explicit `null`** for Gemini, and
`estimateSearchUsd` throws rather than reserve tokens-only for a call that
would also be billed per query. This is not the same as leaving the model
unpriced: the model IS priced, for the thing it can be priced for.

Two consequences point the same way, and both are load-bearing:

1. **Financial.** A grounded Gemini call cannot be reserved honestly. A
   reservation covering only tokens would under-reserve every hop — the exact
   defect §8f and the 51-request battery existed to remove.
2. **Integrity.** `translateToolsToGemini` in `_shared/llm.ts` silently DROPS
   Anthropic server tools, `web_search_20250305` included. A scouting prompt
   would therefore reach Gemini with **no search at all**, while its system
   prompt still demanded `source_domain`, a working `url`, and a cross-check
   against two independent sources. A model asked for citations it cannot look
   up invents them. Answering a price query from memory and presenting it as
   scouted is worse than returning nothing.

**A request that searches therefore cannot fail over.** smart-scout,
hotel-scout and a searching ting turn all fail honestly instead, and the user
is told search is unavailable. That is a real limitation and it is the correct
one.

### 10c. One trigger, ten non-triggers

Anthropic rejects a credit-exhausted request **before serving it**, so no
tokens are generated and nothing is billed. That is why this class, uniquely,
may RELEASE the Claude reservation rather than settle it — the provider refused
the work, we are not guessing.

Every other way a request can fail is an enumerated non-trigger with its own
test: guard refusal, over-cap, under-reserved, schema failure, application
error, malformed request, safety refusal, user cancellation, validation
failure, and any other provider error (429, 5xx, timeout, unreadable body).
Failing over on a guard refusal would let a request the ceiling rejected simply
run somewhere else, and the ceiling would stop meaning anything.

The classifier is narrow on purpose: status 400 **and**
`error.type === "invalid_request_error"` **and** a message naming the credit
balance. A bare 400 is our own malformed payload, and failing over on it would
spend Google's money to paper over an ONIQ bug.

### 10d. A live trap this loop closed on the way past

`ting`'s Gemini fallback trigger was `else` on `!res.ok` — **any** Anthropic
failure bought a second billable call on a second key. It had never fired only
because `gemini-3.6-flash` carried no rate, which means **pricing any Google
model would have switched it on by accident**. This loop prices one, so the
trigger had to be fixed in the same change. It is now gated on the classified
failure class, the owner's flag, a source-free request, and no attachment.

Two smaller fixes came with it. The fallback's request id is now DERIVED from
the primary (`<id>-gx`) rather than freshly minted, so a client retry collides
with itself in the ledger instead of reserving twice. And `callGemini` took a
`geminiModel` option distinct from `model`, because `callGeminiFallback`
forwards an Anthropic caller's whole opts object — honouring `model` there
would have posted a Claude id to `generativelanguage.googleapis.com`.

### 10f. The model does not answer — measured, not assumed

The loop asked for `gemini-2.5-flash-lite` specifically. Since no Google
documentation host is reachable, availability was checked the only way left:
against ONIQ's own key, through the Lovable sandbox. Two calls, and they
disagree.

```
GET  /v1beta/models/gemini-2.5-flash-lite            -> 200
     models/gemini-2.5-flash-lite, version 001, thinking: true

POST /v1beta/models/gemini-2.5-flash-lite:generateContent -> 404 NOT_FOUND
     "This model models/gemini-2.5-flash-lite is no longer available to new
      users. Please update your code to use models/gemini-3.5-flash-lite for
      the latest features and improvements."
```

**Catalogue presence is not availability.** The free metadata lookup — the
cheap check, the one that costs nothing and feels like proof — passes for a
model that cannot be called. Only the generation call separates them. Any
future model id must clear the generation check before it is priced.

This also re-frames the rate. $0.10/$0.40 is a real published figure for a
model this account cannot call, which makes it more dangerous in the table
than no figure at all: it looks priced and ready. So availability became a
SECOND lock, `GEMINI_FAILOVER_MODEL_AVAILABLE = false`, deliberately NOT
readable from the environment — an operator setting `GEMINI_FAILOVER_ENABLED`
must not be able to start calling a 404. It is checked before the owner's flag
and has its own test.

Google's suggested replacement is `gemini-3.5-flash-lite`. Substituting it is
**not** an engineering call: it picks a different model at a different,
unverified price, which is the owner's under `CLAUDE.md § Business decisions
are the owner's`. Nothing was substituted. What a decision to move would need
is one generation call against the chosen id and its own published rate.

### 10e. The gate it fails

| §10 requirement                         | State                                          |
| --------------------------------------- | ---------------------------------------------- |
| model verified                          | **NOT MET** — no primary Google page reachable |
| pricing authoritative                   | **NOT MET** — corroborated secondary only      |
| financial reservation tested            | met — 51 tests                                 |
| settlement tested                       | met                                            |
| credit-exhaustion classification tested | met                                            |
| Gemini fallback tested                  | met                                            |
| no guard bypass                         | met — ten non-triggers, each tested            |
| no double-spend path                    | met — separate ids, no overlap, retry collides |
| structured output tests pass            | met                                            |
| existing suite green                    | met — 2693 pass                                |
| lint:ci / tsc                           | met                                            |
| real-cost evidence recorded             | **NOT MET** — no live invoice                  |
| audit documentation updated             | met — this section                             |

Three rows fail, and the first is not a gap in evidence but a negative
result: the model does not answer. `GEMINI_FAILOVER_ENABLED` stays unset, and
`GEMINI_FAILOVER_MODEL_AVAILABLE` is false independently of it.

## 11. Resolving the Gemini blockers — what measurement found

Owner loop, 2026-08-25: resolve the blockers at `4130b97f`, do not stop at the
first 404, do not substitute a model without verifying it, do not enable an
ungrounded search fallback.

Three of the four blockers resolved. The fourth did not, and it is not a gap in
evidence — it is a measured negative.

### 11a. The model was found by calling, not by reading

Six candidates against ONIQ's own key, cheapest first:

| id                      | result                                                    |
| ----------------------- | --------------------------------------------------------- |
| `gemini-3.5-flash-lite` | **200, real text**                                        |
| `gemini-3.1-flash-lite` | 200, real text                                            |
| `gemini-2.5-flash-lite` | 404 — "no longer available to new users"                  |
| `gemini-3.5-flash`      | 200 but EMPTY content, MAX_TOKENS after 13 thought tokens |
| `gemini-2.5-flash`      | 404 — "…use gemini-3.6-flash"                             |
| `gemini-3.6-flash`      | 200 but EMPTY content, MAX_TOKENS after 12 thought tokens |

Two things worth keeping. The 404s came only from the generation call — the
free metadata lookup returns a healthy 200 for a model that cannot be called.
And a 200 is not a success: two models returned empty content because thinking
consumed the whole output budget before any text existed.

### 11b. The pricing "contradiction" was a misreading

Last loop recorded grounding as unpriceable because two sources gave $14 per
1,000 and $35 per 1,000. They are not contradictory — they are two schemes:

| generation | free allowance      | then                      |
| ---------- | ------------------- | ------------------------- |
| Gemini 3.x | 5,000 prompts/month | **$14 per 1,000 queries** |
| Gemini 2.x | 1,500 requests/day  | **$35 per 1,000 prompts** |

So the rate is per-model, not one constant. Free allowances are deliberately
NOT modelled: reserving as if every query bills over-reserves inside a free
tier, which is the safe direction, and an allowance shared across a whole
Google project is not something one edge function can account for.

Token rates: `gemini-3.5-flash-lite` is **$0.30 / $2.50** per MTok — 3x and
6.25x the model originally named. All of it remains corroborated-secondary;
no Google page is reachable from this container.

### 11c. Two things the response shape forces

**Google returns a redirect, not a merchant URL.** A grounding chunk carries
`title: "bigbasket.com"` and a `uri` on `vertexaisearch.cloud.google.com`.
`source_domain` is recoverable from the title; a direct product URL is not
returned at all, and Google's terms require serving the redirect unmodified.
So ONIQ can honour `source_domain` but cannot honour `url` as a direct listing
link the way the Anthropic path does.

**Grounded queries are billable and Google does not count them.** Verified
against a real response: `usageMetadata` carries no search or grounding field
of any kind. The count has to come from `webSearchQueries.length`, which the
translator now reports in Anthropic's `server_tool_use` shape so the existing
settlement path prices it with no special case.

`google_search` also has no `max_uses`. On the Anthropic path the hop ceiling
is enforced by the provider; here it is only an input to the reservation, so
the Gemini leg reserves 2x its hop budget and settles on what Google reports.

### 11d. The finding that decided it — schema compliance is not sourcing

Three scout-shaped queries to `gemini-3.5-flash-lite`, ONIQ's real smart-scout
system prompt, `google_search` attached:

```
HTTP 200                       3 of 3
webSearchQueries: []           3 of 3
grounding chunks: 0            3 of 3
result rows returned           13
rows backed by a real source   0
responses parsing as JSON      3 of 3
```

The tool was accepted and never invoked. The model returned confident
amazon.in / flipkart.com / blinkit.com / bigbasket.com / croma.com prices
entirely from memory, every row carrying `source_domain` as though scouted,
and **every response was schema-valid**.

That last part is the lesson. A validator checking shape would have passed
thirteen fabricated prices straight to a user. Only comparing claims against
retrieved evidence catches it.

Two controls, because one is not enough:

- `dropUnbackedRows` removes any row whose `source_domain` never appeared in
  `groundingChunks`. A price shown next to a retailer's name IS a claim that
  the retailer charges it.
- `requireGroundingEvidence` rejects the WHOLE response when no query was
  issued. Row-filtering alone would empty the table and return a technically
  honest zero-row answer, conflating "found nothing" with "never looked".

The measurement is recorded in code as `GROUNDING_FABRICATION_EVIDENCE` so the
gate is not later mistaken for paranoia and quietly relaxed.

### 11e. The non-lite models search sometimes, which is worse

`gemini-3.5-flash-lite` never searched, so at least it failed uniformly. The
non-lite models are inconsistent, and the pattern of the inconsistency is the
problem.

Same probe, same payload, `maxOutputTokens` raised to 8,000:

| model                   | 1kg salt             | 1L cooking oil     | Galaxy M35 phone     |
| ----------------------- | -------------------- | ------------------ | -------------------- |
| `gemini-3.5-flash`      | searched (6 queries) | **did not search** | searched (5 queries) |
| `gemini-3.6-flash`      | **did not search**   | **did not search** | searched (3 queries) |
| `gemini-3.5-flash-lite` | did not search       | did not search     | did not search       |

Across all 9 calls on 3 models:

```
calls that issued any query        3 of 9
result rows returned               37
rows naming a source retrieved      1
rows naming a source NEVER retrieved   36  (97%)
```

**The models skip searching precisely on the commodity items they "know" —
salt, cooking oil — and search on the one with volatile pricing.** They are
most confident exactly where they are most stale, and they populate
`source_domain` either way. For a price scout that is the worst available
failure mode.

Two more findings from the same run:

- On `gemini-3.5-flash`, the two responses that DID ground came back as
  **malformed JSON**. In this sample, grounding and a clean schema did not
  co-occur in a single call.
- `thoughtsTokenCount` is present and large on the non-lite models — 1,947 on
  one call, 3,012–3,495 on others, roughly half of total tokens. The
  thinking-token accounting added earlier is load-bearing, not theoretical.
  There is still no grounding count anywhere in `usageMetadata`.

### 11f. Verdict — BLOCKED, and not for want of engineering

Every engineering blocker was resolved. The tool translates, the fail-closed
gate rejects a search request with no search mechanism, the validator drops
unbacked rows, the attestation gate rejects a response that never searched,
grounding is priced per query, thinking tokens are counted, and the whole thing
reserves and settles inside the unchanged $0.50 ceiling.

What did not clear is the RULE this loop set: _"Declare success only when
Gemini can perform the SAME source-grounded search contract as the Claude
path."_ It cannot. With the validator in place a Gemini scout answer is empty
or near-empty on the majority of queries — correct, and useless. Without it,
users get fabricated prices attributed to real retailers.

The remaining blocker is external in the sense PHASE 11 means: it is Google
model behaviour on the owner's account, not something ONIQ can engineer around
without weakening source integrity. The one route left is PHASE 4's option C —
ONIQ runs the searches itself through a provider it controls and passes the
results to Gemini as tool results. That needs a search provider ONIQ does not
have, which is new credentials and new spend, and therefore the owner's call.

Production stays **disabled**. `GEMINI_FAILOVER_ENABLED` is unset.

## 12. Gemini 3.1 Flash-Lite — the cheapest callable model, and the same wall

Owner loop, 2026-08-25: make `gemini-3.1-flash-lite` the cheapest safe fallback.
Do not use 3.5, do not use 2.5, do not weaken source validation.

The model change is done and the economics are better. The contract still
fails, for the same reason, on the same measurement.

### 12a. The model, priced

`gemini-3.1-flash-lite` is confirmed callable — HTTP 200 with real generated
text on ONIQ's own key — and it is the cheapest id this key can call:

|                       | input            | output           | grounding            |
| --------------------- | ---------------- | ---------------- | -------------------- |
| gemini-3.1-flash-lite | **$0.25** / MTok | **$1.50** / MTok | $14 / 1,000 queries  |
| gemini-3.5-flash-lite | $0.30            | $2.50            | $14 / 1,000          |
| gemini-2.5-flash-lite | $0.10            | $0.40            | _404 — not callable_ |

Cheaper than the previous pick on both token directions, which is the whole
point of a fallback that only runs when the primary is down. Worst-case
reservations, grounding included, at 2x hop headroom: smart-scout **$0.203**,
hotel-scout **$0.361** — both inside the unchanged $0.50 ceiling.

Provenance remains corroborated-secondary. Every Google documentation host is
still egress-blocked; the `$0.25/$1.50` figures come from the owner's directive
plus two independently worded searches across several third-party trackers.

`thoughtsTokenCount` does not appear on this model at all — `totalTokenCount`
equals prompt plus candidates on all three probes. The thinking-token
accounting stays, because it is present and large on the non-lite models, and
because a reserve that only works on one model is not a reserve.

### 12b. The same wall, measured again

Three scout-shaped queries, ONIQ's real system prompt, `google_search` in the
posted body — verified by printing the actual request, not by trusting the
translator:

| query                    | searches issued | rows | rows backed by retrieved evidence |
| ------------------------ | --------------- | ---- | --------------------------------- |
| Tata Salt 1kg            | **0**           | 5    | **0**                             |
| Fortune sunflower oil 5L | **0**           | 4    | **0**                             |
| Redmi Note 14 5G         | **0**           | 3    | **0**                             |

**12 of 12 rows fabricated.** All three parsed as valid JSON. blinkit.com,
zeptonow.com, amazon.in, flipkart.com, jiomart.com, mi.com — every price from
memory, every row carrying `source_domain` as though scouted.

Across all four models now measured:

```
calls                     12
calls that issued a query  3
result rows               49
rows naming a retrieved source   1
```

`gemini-3.1-flash-lite` is not worse than the others. It is the same failure,
and PHASE 13's rule is unambiguous: any fabricated source stops the loop, and
the fix is the evidence architecture, not the prompt.

### 12c. What was built anyway, because it will be needed

PHASE 6's evidence-bound validation is implemented and tested regardless of
which provider eventually supplies the evidence. `validateEvidenceBound`
returns a whole-response verdict and never repairs:

- **`no-evidence-retrieved`** — nothing was retrieved; refused before rows are
  even examined.
- **`domain-not-in-evidence`** — a row names a source that never came back.
- **`url-not-in-evidence`** — a URL the model composed. This is the subtle one:
  Google returns only its own `vertexaisearch.cloud.google.com` redirect, never
  a merchant link, so a perfectly ordinary-looking `amazon.in/dp/B0XXXX` is
  invented by construction.
- **`cross-check-unsupported`** — a two-source claim on fewer than two distinct
  retrieved hosts. Two rows from one domain are one source.

A fabricated URL is never swapped for a guessed one, and a rejection carries no
`rows` field at all — there is nothing to render.

### 12d. PHASE 7 — ONIQ owns no retrieval, and here is what one costs

Checked before proposing any spend. ONIQ's full credential inventory holds no
web-search capability:

- `GOOGLE_MAPS_API_KEY` — Geocoding only (`maps/api/geocode/json`). No web search.
- `AMADEUS_API_KEY` — flight offers, and pointed at **`test.api.amadeus.com`**,
  the sandbox. Not production data, and not hotels.
- `GOOGLE_AI_API_KEY` — Gemini itself.
- Everything else is payments, SMS, storage, TURN, push.

So the evidence-owning architecture needs a search provider ONIQ does not have.
**Nothing was onboarded.** The two candidates, for the owner's decision:

|                      | per 1,000 | free tier          | index                             |
| -------------------- | --------- | ------------------ | --------------------------------- |
| **Serper**           | **$1**    | 2,500 / month      | scrapes a Big Tech (Google) index |
| **Brave Search API** | **$5**    | ~$5 credit / month | Brave's own independent index     |

Impact on the $0.50 ceiling is small either way — at 6 hops, $0.006 with Serper
or $0.03 with Brave, against $0.084 for Google's own grounding. A full
smart-scout request on 3.1-flash-lite with Serper evidence models at roughly
**$0.041**, about a third of Haiku's measured $0.119695 average.

One thing the owner should weigh beyond price: Serper is cheaper because it
resells a scraped Google index, which sits awkwardly beside the earlier
directive not to scrape search-engine result pages. Brave sells its own index
at 5x. That is a policy choice, not an engineering one.

Required credential: one API key in Supabase secrets. Expected monthly minimum:
none on either — both are usage-metered with a free allowance.

### 12e. Verdict

**BLOCKED**, at the same wall as §11f and now with the cheapest model.

The RULE was: _real retrieval → real evidence → evidence-bound Gemini output →
validated JSON → financial settlement._ Links two through five are built and
tested. Link one does not exist, because no Gemini model ONIQ can call will
reliably perform the retrieval, and ONIQ owns no retrieval of its own.

`GEMINI_FAILOVER_ENABLED` stays unset.
