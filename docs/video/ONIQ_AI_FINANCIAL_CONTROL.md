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

### 8a. SEARCH is now `SPEND_CAP_UNSET` — and that is a live trap

The ledger migration drops `search_spend_*` after carrying its rows across, so
SEARCH is a capability of the general ledger like any other. It has **no row**
in `provider_budget_config`:

```
provider_budget_status('SEARCH')
{"capability":"SEARCH","capsConfigured":false,"generationAllowed":false,
 "reason":"SPEND_CAP_UNSET"}
```

That is §3 working as designed — an unconfigured capability is refused, never
unlimited. But `searchGuard.ts` fails closed on it, and four **live** edge
functions call it: `smart-scout`, `ting`, `health-scan`, `hotel-scout`.

Nothing is broken today, because edge functions do not deploy with a web publish
and the versions in production still predate the guard (it landed today in
`3cec33fa` / `3a2419de`). The trap is in the ordering: **deploying those four
edge functions before a SEARCH row exists would refuse every search in
production.** The correct sequence is SEARCH ceilings first, edge deploy second.

Those ceilings are dollar limits on the owner's spend, so an agent does not pick
them — `CLAUDE.md § Business decisions are the owner's`. They are an open
question to the owner, not a blocked task with a sensible default.
