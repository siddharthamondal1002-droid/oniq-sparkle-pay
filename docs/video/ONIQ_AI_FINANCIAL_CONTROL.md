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

## 13. Retrieval-first — ONIQ owns the evidence, and a policy gate fires

Owner loop, 2026-08-25: give ONIQ deterministic retrieval through Serper, use
`gemini-3.1-flash-lite` only for synthesis, and **stop before onboarding if
project policy prohibits that index source**.

The architecture is built and tested. The onboarding did not happen, because
the policy check the loop asked for came back positive.

### 13a. The policy conflict, stated plainly

**Serper resells a scraped Google index.** ONIQ would not scrape anything —
the adapter calls Serper's documented JSON endpoint with an API key — but the
data on the other side of that endpoint was obtained by scraping Google's
result pages. Recording that is a condition of the loop and it is right.

`SEARCH_PROVIDER_MATRIX.md` §3, already in this repository, reads:

> **Scraping is out, and stays out** — The loop says: do not scrape SERPs or
> bypass anti-bot controls. … any "DuckDuckGo adapter" would in practice be
> scraping **or an unofficial reseller**. It stays `UNVERIFIED` and should not
> be built on that basis.

That clause names an unofficial reseller of scraped SERPs, which is exactly
what Serper is. So this is the case the loop pre-committed to stopping on:
_"If project policy prohibits this type of index source, STOP before onboarding
and report the policy conflict. Do NOT silently substitute Brave."_

Nothing was onboarded, no credential was created, no substitute was chosen.
Two things would each clear it, and both are the owner's:

1. **Lift or scope §3** — e.g. "ONIQ does not scrape; procuring from a
   reseller is permitted" — and add `SERPER_API_KEY`.
2. **Choose a provider with its own index.** Brave at $5/1,000 against Serper's
   $1/1,000; at a six-call ceiling that is $0.03 versus $0.006, both immaterial
   against a $0.50 ceiling.

A second, independent blocker stands either way: **no retrieval credential
exists**. `SERPER_API_KEY` is absent from ONIQ's secrets, so the live micro
battery could not have run even with policy cleared.

### 13b. What was built, and why it survives the provider choice

Everything upstream of the credential is provider-independent, so the owner's
decision plugs into a `RetrievalProvider` interface rather than reshaping the
architecture. `webRetrieval.ts` implements:

**ONIQ owns the queries and the ceiling.** `buildQueries` is deliberately dull
and deterministic — the user's ask plus fixed framings — so the number of
billable retrievals is known _before_ any of them run. `MAX_RETRIEVAL_CALLS` is
6, matching smart-scout's existing hop budget, and `gatherEvidence` truncates
to it however many queries it is handed.

**Native grounding is off on this path.** `retrievalFirstBudget` ZEROES
`maxSearches`, so a grounded query cannot be billed, and
`RETRIEVAL_FIRST_FORBIDS_GROUNDING` records why: leaving it on would give the
model a second source of "evidence" ONIQ never saw and could not validate
against.

**The evidence package carries exact URLs**, plus an instruction written as
prohibitions — never invent a URL, never build a listing URL from a domain,
never name a source you were not given, never present a remembered price as a
retrieved one — and `insufficient_evidence` as a permitted answer, so "not
enough" is a shape the model can return instead of invention.

**Retrieval is reserved before it runs**: 1 call $0.001, 2 calls $0.002,
6 calls $0.006, and `null` from an unpriced provider fails the request closed
rather than running against a guessed rate. One attempt per query, no
pagination, no retry — a retry on a metered API is unaccounted spend.

### 13c. The validator got stricter, because supplied evidence allows it

On the grounding path the best available check was "is this domain one that
came back", because Google returned only a redirect and a publisher name. With
ONIQ holding the exact retrieved URLs, the check becomes exact-match, and three
rules exist specifically for near-misses that look completely ordinary:

| claim                                                     | verdict                             |
| --------------------------------------------------------- | ----------------------------------- |
| `amazon.in/dp/B0XXXXXXX`, never retrieved                 | **REJECT**                          |
| a real, retrieved domain + a URL that was not retrieved   | **REJECT**                          |
| a retrieved URL + a price absent from its snippet         | **REJECT**                          |
| a retrieved URL whose host contradicts the claimed domain | **REJECT**                          |
| one backed source while claiming a two-source cross-check | **REJECT**                          |
| two retrieved URLs with prices present in their snippets  | **ACCEPT**                          |
| no evidence retrieved                                     | **REJECT before rows are examined** |

A domain alone does not prove a source was retrieved, and neither does a
syntactically valid URL. Nothing is repaired: a rejection reports the offending
claims and carries no `rows` field at all.

### 13d. Economics, as a projection and labelled as one

Not measured — no credential, so no live run. On the published rates:

```
retrieval   6 x $0.001                    = $0.006
gemini      104,000 in  @ $0.25/MTok      = $0.026
             6,000 out  @ $1.50/MTok      = $0.009
                                    total ≈ $0.041
```

against Haiku's **measured** $0.119695 average. Roughly a third, and about an
eighth of the $0.50 ceiling. hotel-scout's wider shape projects to ~$0.065.
These are projections; the Haiku figures are invoices. They must not be
compared as though they were the same kind of number.

### 13e. Verdict

**BLOCKED**, on a policy gate rather than an engineering one — a different
wall from §11f and §12e, and a lower one.

Links two through five of the RULE — evidence-bound output, validated JSON,
financial settlement, and a validator that catches a composed product URL — are
built, tested, and provider-agnostic. Link one, real retrieval, needs a
provider ONIQ may use and pay for. That is one owner decision, not another
engineering loop.

`GEMINI_FAILOVER_ENABLED` stays unset.

## 14. Serper authorised — policy scoped, credential absent

Owner directive, 2026-08-25: proceed with Serper. The policy is to be scoped so
it prohibits ONIQ-operated scraping, not documented third-party search APIs.

### 14a. The policy now says what it meant

`SEARCH_PROVIDER_MATRIX.md` §3 previously read as barring any provider whose
index was built by scraping, which was broader than intended. It is now stated
at the level it was meant for — what ONIQ itself does:

> **ONIQ-operated scraping is prohibited.** No fetching of search-result HTML,
> no browser automation against a search engine, no bypassing anti-bot or
> access controls, no unofficial endpoints.
>
> **Documented third-party search APIs are permitted** when ONIQ calls the
> documented API, does not scrape result HTML, does not bypass provider
> controls, preserves attribution where required, accounts for the spend, and
> stores credentials as secrets.

The general prohibition is unchanged and stays. Two facts are recorded side by
side, because collapsing them misleads in one direction or the other: **ONIQ
performs no scraping**, and **Serper's underlying index is built from Google's
result pages**. Serper is an external API provider, not an ONIQ scraper, and
the owner has made the call knowing the provenance.

### 14b. `SERPER_API_KEY` does not exist

The loop's baseline states the credential has been added. It has not. Checked
two ways in the project that holds every other ONIQ secret:

```
sandbox environment      SERPER_API_KEY: MISSING
project secret store     21 secrets present, no Serper entry
```

`GOOGLE_AI_API_KEY` and `ANTHROPIC_API_KEY` are both in that same store and
both work, so this is the right project and the key is genuinely absent.

PHASE 2 says stop there, so the live probe, the pricing verification, the micro
battery and the economic measurement did not run. Nothing was invented in their
place. Adding the secret in Project Settings → Secrets is the whole unblock.

### 14c. Everything that does not need the key was done

**PHASE 8 gained four cases**, and they are the ones that matter most, because
each is a URL that is real, well-formed, and on a host ONIQ genuinely
retrieved — while being a page ONIQ never fetched:

| claim                                                             | verdict |
| ----------------------------------------------------------------- | ------- |
| a retrieved URL **plus `?variant=2`**                             | REJECT  |
| a retrieved URL **minus its trailing slash**                      | REJECT  |
| a shortener (`bit.ly/…`) whose target is not in evidence          | REJECT  |
| a retailer + price with **no URL**, where the schema requires one | REJECT  |
| a retrieved URL with the price **quietly changed** 28 → 27        | REJECT  |

`isRetrievedUrl` matches byte-for-byte and deliberately performs **no
canonicalisation**. Stripping query parameters, following redirects or
normalising slashes would each convert "close to something we fetched" into
"something we fetched", and every one of those transformations can change which
page is being cited. If an equivalence rule is ever wanted it has to be argued
for and proven, not assumed.

`requireUrl` is new: a domain alone is permitted when the schema has no URL
field and refused when it has one. A row naming a retailer and a price without
a link is a claim the user cannot check.

**Secret hygiene is tested, not asserted.** The credential travels in an
`X-API-KEY` header and never in a URL; a test drives all three failure paths —
HTTP error, unparseable body, thrown exception — and asserts the key value
appears in none of the returned error shapes.

### 14d. Verdict

**BLOCKED at PHASE 2**, on a missing credential — the shallowest blocker yet
and the only one that is a single action away.

Every gate that can be closed without the key is closed: policy scoped, adapter
built on the documented endpoint, ONIQ-owned queries with a six-call ceiling,
retrieval reserved before execution, native grounding forced off, validator
extended to the near-miss cases, secret hygiene proven. 2,793 tests.

Unmeasurable until the key exists: the live Serper probe, Serper's current
documented price, evidence normalisation against a real response shape, whether
Serper reports `credits` consumed per call, the 3×3 micro battery, hotel-scout's
special gate, and every actual-cost figure. `GEMINI_FAILOVER_ENABLED` stays
unset.

## 15. RunPod GPU layer — the A5000 has no price to quote

Owner loop, 2026-08-25: validate RunPod on RTX A5000 24GB, scale-to-zero, no
always-on GPU, no production worker until every gate passes.

Phases 1–3 ran against RunPod's own API. Phase 4 did not, and the loop's own
instruction is why.

### 15a. Nothing was billing, and the target GPU is unavailable

```
GET /v1/pods        200   []      0 pods
GET /v1/endpoints   200   []      0 serverless endpoints, 0 workers
```

Authentication works and **nothing was quietly running** — the first thing
worth knowing about a GPU account.

`NVIDIA RTX A5000` is in the catalogue at `memoryInGb 24`, `secureCloud true`,
and its `lowestPrice` is **null for both on-demand and spot**. A null price is
RunPod saying it has none to allocate. So the A5000 is **not currently
provisionable**, and the **$0.27/hour figure this loop opened with was never
confirmed by the API** — it must not be used as a reservation input.

Cheapest available at ≥16GB, live from the same response:

| GPU              | VRAM     | $/h       | cloud                  |
| ---------------- | -------- | --------- | ---------------------- |
| RTX 4000 Ada SFF | 20GB     | $0.18     | community only         |
| RTX A4500        | 20GB     | $0.19     | secure + community     |
| Tesla V100       | 16GB     | $0.19     | community only         |
| **RTX 3090**     | **24GB** | **$0.22** | **secure + community** |
| RTX 4090         | 24GB     | $0.34     | secure + community     |

**The three cheapest are not substitutes.** The parked workload this layer
exists for — WAN 2.1 I2V-14B, task #113 — needs 24–40GB. A 20GB card bought to
save two cents produces a job that cannot run, discovered at runtime, after
paying for the boot. The V100 is additionally Volta, without bf16.

The like-for-like replacement is **RTX 3090 24GB at $0.22/h on Secure Cloud** —
*cheaper* than the A5000's unconfirmed $0.27. RTX 4090 at $0.34/h buys
materially more throughput.

**Nothing was provisioned.** Phase 2 says of an unavailable A5000: "do not
automatically provision it; report the alternative and price." Which GPU ONIQ
rents is a spend decision under `CLAUDE.md § Business decisions are the
owner's`.

### 15b. Why GPU money needed its own machinery

Every other line in this ledger is billed per unit consumed: a failed token
call cost almost nothing. **A GPU is billed per second of wall clock from
boot to termination**, computing or idling or wedged. That inverts the risk.
The dangerous failure is not an expensive job — it is a cheap job whose worker
never stopped. $0.22/hour is $0.015 for four minutes and **$158 for a month**.

Three consequences, all implemented:

1. **`GPU` is its own ledger capability.** It happens to share the SEARCH
   ceiling's number ($0.50, the owner's figure) and nothing else; collapsing
   them would mean a change to one silently moved the other.
2. **A reservation is a TIME budget** — the full `maxRuntimeSeconds`, never an
   expected runtime. At admission a job that finishes in 20 seconds and one
   that wedges for 900 are indistinguishable, and only one is affordable to be
   wrong about. 900s at $0.22/h is $0.055.
3. **Termination is unconditional.** `withGpuWorker` terminates in a `finally`,
   because the expensive failure is an exception thrown between provisioning
   and cleanup. When termination itself fails the worker id comes back as
   `orphan` — a lost worker must be loud, never swallowed.

### 15c. The caller cannot choose what it costs

Admission refuses, in this order, and VRAM is checked **before** price:

| condition                             | refusal                   |
| ------------------------------------- | ------------------------- |
| GPU not on the server-side allow-list | `gpu-type-not-allowed`    |
| VRAM below what the workload needs    | `insufficient-vram`       |
| runtime above the ceiling             | `runtime-exceeds-ceiling` |
| price null — the A5000's exact state  | `gpu-unpriced`            |
| reservation above the job cap         | `over-job-cap`            |

A runtime above the ceiling is **refused, not clamped**: clamping would let a
caller ask for a week and be told yes. "Give me 8× H100" is a $30/hour sentence
typed by someone who does not pay the bill, and the allow-list is why it cannot
be typed at all.

### 15d. Verdict

**BLOCKED at PHASE 4**, on GPU availability, by the loop's own rule.

Built and green (2,814 tests): provider-neutral `GpuProvider` contract, the
bounded `GpuJob` model, GPU as a separate ledger capability, time-based
reservation and billed-seconds settlement, the admission matrix above,
unconditional termination with orphan surfacing, and the no-idle-cost
invariant.

Not done, and honestly not done: no worker was provisioned, so there is no
startup time, no inference measurement, no VRAM peak, no actual billing, no
20-job reliability run, and no cost-per-job. **Total RunPod spend this loop:
$0.00.**

The unblock is one decision — which GPU to rent when the A5000 has none free.

## 16. The GPU worker exists and is not yet an artifact

Owner loop, 2026-08-25 (RTX 3090 chosen, task #147): build the worker as its
own repository, build the container, prove CUDA, then rent one card.

The worker is written and its logic is proven — 39/39 tests, no GPU involved.
It is still **not a deployable artifact**, and the gap between those two
sentences is the entire content of this section. The loop's own final rule
names it: _do not confuse "worker code exists" with "worker is a deployable
GPU artifact."_

### 16a. Three egress denials, each ending a different chain

Every remaining phase stops at the network policy of the container this agent
runs in. Verbatim from `$HTTPS_PROXY/__agentproxy/status`:

| host                                                                | verdict                | what it ends                            |
| ------------------------------------------------------------------- | ---------------------- | --------------------------------------- |
| `production.cloudfront.docker.com`                                  | 403 CONNECT            | Docker Hub **blob** CDN — no base layer |
| `pkg-containers.githubusercontent.com`                              | 403 CONNECT            | GHCR blob CDN — no mirror either        |
| `download.pytorch.org`                                              | 403 CONNECT            | the cu121 torch wheel                   |
| `rest.runpod.io`, `api.runpod.io`, `api.runpod.ai`, `www.runpod.io` | 403 CONNECT (all four) | pricing, auth, provisioning, billing    |

`RUNPOD_API_KEY` is also **absent from this container's environment**. So
Phases 33–34 are blocked twice over, and §15's live pod/endpoint/pricing figures
— which did reach RunPod's API — were gathered under different conditions than
this session has. Those numbers are still the last measured ones; they are not
re-confirmable from here and **$0.22/h must be re-queried before it is used as
a reservation input**, exactly as $0.27 had to be.

These are **policy denials on the blob CDNs, not on the registries**.
`registry-1.docker.io` answers 401 (a normal auth challenge) and manifest
resolution begins; the pull then dies fetching layer bytes. So "can I reach
Docker Hub" and "can I pull an image" have different answers, and only the
second one matters.

**A correction to §15's environment note.** An earlier report in this
workstream recorded "docker CLI present but no daemon" and treated the
container build as impossible. That was wrong in a way worth writing down: the
daemon was merely _not running_. This session started it —
`dockerd --iptables=false --bridge=none`, 29.3.1, overlayfs, 4 CPUs, 15.7GiB —
and it works. The build still cannot happen, but for a completely different
reason, and "no daemon" would have sent the next person to fix the wrong thing.
Enumerating a failure is not the same as diagnosing it.

The pytorch denial is **local only**. RunPod builds the image on its own
builder from the repository, and `download.pytorch.org` is a normal host there.
The Dockerfile is correct as written and must not be repointed at PyPI to suit
this container's policy — that would change what production builds in order to
make a development environment happy.

### 16b. The repository cannot be created from here, by design

`create_repository` returns `403 Resource not accessible by integration`. The
raw API call is more explicit about why:

```
POST https://api.github.com/user/repos  →  403
"sessions are bound to their configured repositories.
 Use repository-scoped endpoints (repos/{owner}/{repo}/...)."
```

This is not a GitHub permission that could be widened; it is the session
boundary. The identity resolves to the owner's own account and still cannot
create a repository, because _no_ repository outside the configured set is
addressable. Creating `oniq-gpu-worker` is an owner action and there is no
version of this agent that performs it.

Nothing was worked around. Committing the worker into `oniq-sparkle-pay` would
have put `runpod.serverless.start()` on that repository's default branch and
made RunPod's pre-deploy scan pass there — which is exactly the outcome the
owner prohibited, reached sideways. The prohibition is on the outcome, not on
the phrasing of the commit.

### 16c. What the image can be judged on without building it

Phase 30 asks for secrets, credentials, history and shell surface. Some of that
needs layers that do not exist yet. Some of it does not, and the part that does
not comes back clean:

| check                                                                | result                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| credentials or private keys in any worker file                       | **none** — the only three hits are prose saying `RUNPOD_API_KEY` must never be here                   |
| env vars the worker reads                                            | exactly four: `R2_S3_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `ONIQ_ALLOW_CPU_FALLBACK` |
| database / Firebase / Anthropic / Gemini / Serper / Razorpay clients | **none**                                                                                              |
| `ARG` in the Dockerfile                                              | **none** — so no build argument can bake a secret into a layer                                        |
| `ENTRYPOINT` / shell form `CMD`                                      | **none** — `CMD ["python3","-u","handler.py"]`, exec form                                             |
| `eval`, `exec`, `subprocess`, `os.system`, `pickle`, `shell=True`    | **none**                                                                                              |

The strongest of these is not in the table. `COPY` names five files
individually — `requirements.txt`, `contract.py`, `preprocess.py`,
`storage.py`, `handler.py`. There is no `COPY . .`, so the image cannot receive
a stray `.env` even if `.dockerignore` were wrong. `.dockerignore` is a second
lock, not the only one.

**One finding, not fixed.** There is no `USER` directive, so the container runs
as root. That is the RunPod serverless norm and the worker has no shell to
escape into, but it is a real hardening gap and it is the owner's call whether
to close it — the loop said not to rewrite the worker, and quietly adding a
`USER` line ahead of a build that has never run is how a working image becomes
an image with a permissions bug nobody attributes.

Undeterminable until the image exists: `docker history`, the resolved
dependency tree, and the final image digest.

### 16d. `torch.cuda.is_available()` is not a question this machine can answer

Phase 29 requires that call to return TRUE inside the container, and to stop if
it returns FALSE. On CPU-only hardware it returns FALSE **whatever the image
contains** — the answer carries no information about the container and must not
be read as a failed gate. The check is meaningful on exactly one machine: the
rented 3090, at Phase 37.

Two claims are worth keeping apart, because a build log satisfies the first and
only a card satisfies the second:

- _CUDA-enabled torch is installed_ — provable at build time (`torch.version.cuda == "12.1"`).
- _CUDA is available_ — provable only on a GPU.

The worker already encodes this distinction. `run_gpu_op(require_cuda=True)` is
the default and raises `cuda-unavailable` rather than falling back, so a CPU
host cannot produce a green job that looks like GPU proof.

### 16e. R2: the bucket exists, the credentials do not

`oniq-gpu` created 2026-08-25, ENAM, Standard, default jurisdiction. Empty, so
its cost today is $0.00.

It is a **separate bucket from `oniq-chat-media`**, which is the only other
bucket on the account. Reusing that one would have handed a rented, internet-
reachable GPU worker read/write access to users' chat media in exchange for
saving one API call.

Phase 32's live test cannot run. Scoped R2 S3 credentials have to be minted in
the Cloudflare dashboard — bucket CRUD is available to this agent, API-token
creation is not — so the keys are an owner action. Until they exist the worker
fails closed with `storage-not-configured`, naming the missing variables and
never their values.

### 16f. Verdict

**BLOCKED at PHASE 27**, on repository creation, which is the first link of a
chain where every later link is also blocked from here.

| link                                          | state                                                |
| --------------------------------------------- | ---------------------------------------------------- |
| private repo                                  | blocked — owner action                               |
| push                                          | blocked on repo                                      |
| Docker image                                  | blocked — blob CDN 403 (and torch index 403)         |
| CUDA container                                | blocked on image                                     |
| real R2                                       | bucket ✅, scoped credentials blocked — owner action |
| real RTX 3090                                 | blocked — `rest.runpod.io` 403                       |
| GPU inference, bill, termination, reliability | blocked on all of the above                          |

**Total RunPod spend this loop: $0.00. Total R2 spend: $0.00.** No GPU was
provisioned, so there is no startup time, no VRAM peak, no cost per job and no
orphan count — and none of those numbers will be estimated to fill a table.

Production stays **DISABLED**. Nineteen of the twenty-four Phase 46 gates are
unmet, and four of the five that are met are the ONIQ-side ones (tests, lint,
tsc, git) that were never in doubt.

### 16g. The non-root runtime, and how it was actually checked

Owner superloop, 2026-08-25, Section D: close the one hardening finding §16c
raised — the worker ran as root — and change nothing else.

`USER oniq:oniq` (uid/gid 10001) now sits between the last `COPY` and `CMD`.
The placement is the substance: everything above it builds as root, everything
below executes as `oniq`, so `/app` and site-packages end up root-owned and
merely **readable** by the process running the handler. A compromised job cannot
rewrite the code it is running.

That only works because the worker writes nowhere except a `mkdtemp` directory
under `TMPDIR`. Two supporting details are load-bearing rather than cosmetic:

- **`PYTHONDONTWRITEBYTECODE=1`** — without it Python would try to drop
  `__pycache__` into a directory this user cannot write.
- **`HOME=/home/oniq`** — a non-root process with no home is a class of late,
  confusing failure. A library deciding to cache under `~` discovers the problem
  at runtime, on a rented GPU, instead of at build time.

**Measured, not asserted.** The image cannot be built here, so the check was run
the closest honest way: a real uid-10001 user, a root-owned mode-755 `/app`, and
a clean virtualenv holding the image's exact pins — `runpod==1.7.7`,
`pillow==11.0.0`, `boto3==1.35.76`.

| check                                     | result                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| test suite as uid 10001, read-only `/app` | **39/39**                                                |
| runtime user can write to `/app`          | **no** — `Permission denied`                             |
| `__pycache__` written into `/app`         | **none**                                                 |
| `mkdtemp` + `Cleanup.run()`               | temp dir owned by 10001, removed, `ok=True`              |
| `pillow` / `boto3` / `runpod` import      | all three                                                |
| `runpod.serverless.start` present         | yes                                                      |
| R2 client constructs as non-root          | yes                                                      |
| missing credentials                       | `storage-not-configured`, naming variables, never values |
| writes to `$HOME` at import               | **none**                                                 |

**Not verified: `torch` under this user.** It needs the built image, and saying
otherwise would be the exact substitution this ledger exists to prevent.

One process note worth keeping. The first attempt at the dependency check failed
four times in a row with a different missing module each time, which looked like
a broken worker and was not: `pip` was installing into `/root/.local`, and
mode-700 `/root` makes those packages invisible to any other user. The symptom
was `ModuleNotFoundError`; the cause was a directory permission on the test rig.
Chasing the symptom produced four wrong fixes and some collateral damage to the
container's system packages — the clean virtualenv above is what should have
been built first.

### 16h. A second place money can be spent from: GitHub Actions

Owner decision, 2026-08-25: make GitHub Actions the execution environment for
GPU validation. Recorded here rather than only in the worker repository, because
a **new path by which ONIQ can spend provider money** belongs in this ledger
regardless of which repository the code lives in.

The reasoning is sound and worth stating plainly: Actions runners reach Docker
Hub, `download.pytorch.org` and `runpod.io`; the agent's container reaches none
of them. Moving execution beats weakening a check.

What that buys, and what it costs: CI can now hold a RunPod provisioning
credential. The gates that make that acceptable are, in order of how much they
matter:

1. **`workflow_dispatch` only.** No push trigger, no schedule, no
   `pull_request`. A merge must never be able to rent a GPU. Verified by
   parsing the file, not by reading it.
2. **Default mode is read-only** and costs $0.00. Spending additionally
   requires typing `SPEND` into an input.
3. **`cancel-in-progress: false`.** Cancelling a run that holds a worker is
   precisely how an orphan is created — the cleanup step never runs.
4. **The orphan sweep runs `if: always()`** and fails the run. A sweep that
   cannot reach the API reports `None`, never `0`; "cannot confirm terminated"
   and "confirmed terminated" must never be the same value.
5. **CI cannot create an endpoint**, only verify one. `min_workers 0` /
   `max_workers 1` is checked against the live endpoint before any job is sent,
   and refused otherwise. Verifying a configuration is a much smaller privilege
   than authoring one.
6. **R2 credentials are not GitHub secrets.** They live in the RunPod
   endpoint's environment. CI submits jobs and never touches the bucket, so
   spreading the storage keys across two systems would buy nothing.

Every decision that can spend sits in `validation/admission.py`, which has no
network and is therefore tested — 26 tests, and they encode findings this ledger
already paid for: reservations round **up** (a cent too little silently defeats
the ceiling), the reservation is the **full** runtime rather than an expected
one, a **null price means no capacity rather than free** (§15a, the A5000), and
an unavailable 3090 **raises with alternatives instead of substituting**. There
is deliberately no default price argument, so `$0.22/h` cannot be reached by
forgetting one — it appears nowhere in the code.

**None of it has run.** Commit `a8b6e8c` exists only in an ephemeral container:
the repository is not in this session's authorized set, so the git proxy will
not inject a credential for it. A GitHub integration asking for `a8b6e8c` will
therefore return 404 correctly — the commit was never pushed, which is a
different failure from an access problem and has a different fix.

The RunPod payload shapes in `runpod_client.py` were written **without ever
reaching RunPod**. A wrong field name there does not raise; it yields a null
price, which reads as "no capacity", which reads as "the 3090 is unavailable".
The read-only discover mode exists to correct that file for free, and should be
expected to find at least one error. **GPU production remains DISABLED. RunPod
spend $0.00.**

### 16i. Check, 2026-08-25 — the repository blocker is gone; the code stays lost

Owner prompt: "check". A fresh container, so everything below is re-measured,
not remembered.

**What changed since §16h.** `oniq-gpu-worker` now exists on GitHub and is in
this session's authorized set — both halves of §16b's blocker are gone in one
move. Measured to the edge of what can be measured without mutating anything:

| probe                                        | result                                     |
| -------------------------------------------- | ------------------------------------------ |
| `git ls-remote` against the worker repo      | answers; **zero refs** — the repo is empty |
| `git push --dry-run` of a local probe commit | accepted, `[new branch]`, exit 0           |
| actual pushes made                           | **none** — the probe commit was deleted    |

So the next loop can push the worker, which no previous loop could.

**What did not change.** The four egress denials of §16a hold verbatim — all
four host groups still end in `CONNECT tunnel failed, response 403`, and
`registry-1.docker.io` still answers while its blob CDN does not.
`RUNPOD_API_KEY`, the R2 keys and `SERPER_API_KEY` are all still absent from
the environment. §16h's decision — Actions as the execution environment —
therefore remains the only route that reaches RunPod.

**The code is lost; the record is not.** Commit `a8b6e8c` is confirmed
unrecoverable: the container that held it is gone, this clone holds no such
object, and the empty remote never received it. The worker must be
**rewritten, not recovered**. What survives is everything this ledger paid to
learn: the five-file layout and four env vars (§16c), the installed-vs-available
CUDA distinction (§16d), the separate `oniq-gpu` bucket (§16e), the non-root
runtime with its exact pins (§16g), and the six CI gates plus the 26
admission-test findings (§16h). A rewrite starts from those sections, not from
zero.

**ONIQ-side gates, re-run at `5a61aae`** (identical to `origin/main`; the
previous working branch was merged and deleted): `lint:ci` 0 · `check:deps` 0 ·
`format:check:changed` clean · `tsc --noEmit` 0 · tests **2813 passed, 1
skipped, 0 failed** across 186 files · the lint workflow green on `main` at
HEAD. One PR open, #83 (Wan2.1 motion provider), untouched since 2026-08-23 and
unaffected by any of this.

The rewrite itself was **not started** — "check" asks what is true, and this
section is the answer. **RunPod spend $0.00. R2 spend $0.00. GPU production
remains DISABLED.**

### 16j. Rebuild loop, 2026-08-25 — the worker is an artifact, and the parser met real bytes

Owner loop: rebuild the worker from §§16c–16h in its own repository, drive
CI green, discover with zero spend, quote the 3090 live, gate the money, and
stop at the spend gate unless both approvals exist. They do not, so this
section ends BLOCKED at Phase 8 — by design, not by failure.

**The worker exists as pushed history now.** `oniq-gpu-worker` holds three
commits ending at `f059f53`; nothing was recovered from Lovable or anywhere
else — rebuilt from this ledger's record, per the loop's rule. 140 tests
(worker suite + harness suite; the target was 65). `worker-ci` run 3 is
green on GitHub's runner, which is a normal host for every CDN this
container cannot reach: the image builds, `torch.version.cuda == "12.1"`,
all imports resolve and `runpod.serverless.start` is present, the runtime
user is uid 10001 with `/app` read-only, and the payload is exactly the five
COPY'd files. That closes §16g's recorded gap — **torch now verified under
the non-root user**, in the built image rather than a simulation.
`torch.cuda.is_available()` printed FALSE on the CPU runner and was not
gated, per §16d.

Two CI failures on the way, both worth their lesson: the Dockerfile gate
tripped on its own documentation (the comment saying there is no `COPY . .`
contains the string it forbids), and run 2 passed all 134 tests as uid 10001
and then crashed — pytest chdir-ing back, on exit, into the runner-owned
checkout that uid 10001 cannot enter. The permission model doing its job,
shaped exactly like a test failure.

**Discovery ran blocked, then through the authorized fallback.**
`gpu-validation.yml` (workflow_dispatch only; discover mode default, $0)
fails at its first guard: `RUNPOD_API_KEY` is not a secret on the repository
— Actions can reach RunPod but cannot authenticate, and adding the key is an
owner action. The keyless run's orphan sweep failed with "cannot confirm
zero" — None never became 0, as specified. The read-only Lovable fallback
(§16h's sandbox, the channel that gathered §15's figures) was then used
once: three requests, raw bodies verbatim, 1.6 Lovable credits, $0 provider
spend, nothing created or modified.

**The parser lost to real bytes, exactly as §16h predicted.** Two field
findings, both committed verbatim as regression fixtures in the worker repo:

- RunPod's `id` carries the canonical full name (`NVIDIA GeForce RTX 3090`);
  `displayName` is the short name (`RTX 3090`). The parser matched on
  displayName and would have read the 3090 as permanently unavailable — the
  exact predicted shape: a wrong field does not raise, it reads as "no
  capacity".
- `securePrice` is a **list price, not capacity**: the A5000 now shows
  `securePrice 0.27` — the figure §15 said was never API-confirmed appears
  after all, as a rack rate — while its `lowestPrice` stays null for both
  on-demand and spot: still not provisionable. Availability now additionally
  requires a non-null `lowestPrice`, so a list price can never admit a card
  the provider cannot allocate.

**Live RTX 3090, quoted 2026-08-25 ~12:08 UTC** (the only figures that may
feed a reservation, and only until the pre-spend recheck re-quotes them):

| field              | live value                   |
| ------------------ | ---------------------------- |
| id                 | `NVIDIA GeForce RTX 3090`    |
| VRAM               | 24 GB                        |
| secureCloud        | true                         |
| securePrice        | **$0.50/h**                  |
| communityPrice     | $0.22/h                      |
| lowestPrice, 1 GPU | $0.22/h (on-demand and spot) |
| account pods       | 0                            |
| account endpoints  | 0 — none exists yet          |

The $0.22/h this workstream carried as "the 3090's price" was the
**community** rate. The live Secure Cloud rate is $0.50/h — 2.3× it. The
ban on reusing stale prices was worth exactly that factor.

**Financial gate, on live numbers:** reservation = CEIL($0.50 × 900/3600,
$0.01) = **$0.13** for the full ceiling window, under the $0.50 job cap →
admitted. Every later phase re-quotes before it may spend.

**Phase 8 verdict: BLOCKED — DO NOT SPEND.** The literal `SPEND` input was
not given, and the `gpu-spend` approval cannot exist because the GitHub
environment itself has not been created. Owner actions before any spend run:

1. `RUNPOD_API_KEY` as an Actions secret on `oniq-gpu-worker`;
2. the `gpu-spend` environment with required reviewers — that reviewer
   click is the second half of the gate;
3. the serverless endpoint, min 0 / max 1, RTX 3090, Secure Cloud, with the
   three `R2_*` variables in its environment;
4. scoped R2 credentials for the `oniq-gpu` bucket.

Phases 9–15 were not reached, on purpose. **RunPod spend $0.00. R2 spend
$0.00. Lovable: 1.6 credits, the authorized read-only fallback. GPU
production remains DISABLED.**
