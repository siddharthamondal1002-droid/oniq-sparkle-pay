# ONIQ_AI_FINANCIAL_CONTROL

**Status** IMPLEMENTED AND VERIFIED against real PostgreSQL 16 · **Date** 2026-08-24

---

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

| Ceiling                                | Stops                                   |
| -------------------------------------- | --------------------------------------- |
| `request_usd_cap`                      | one pathological call                   |
| `job_usd_cap` + `max_attempts_per_job` | one film / one shot ladder running away |
| `daily_usd_cap`                        | the fleet                               |

A day cap alone cannot stop one film eating the day, and neither can stop a
single shot retrying forever.

## 3. Fail closed, everywhere

| Condition                           | Verdict                  |
| ----------------------------------- | ------------------------ |
| no config row for the capability    | `no-budget-configured`   |
| `enabled = false` (**the default**) | `capability-disabled`    |
| estimate is 0                       | `zero-estimate`          |
| estimate is null/negative           | `invalid-estimate`       |
| no model id                         | `no-model`               |
| estimate over the request cap       | `over-request-cap`       |
| job spend over the job cap          | `job-cap-reached`        |
| attempts spent                      | `job-attempts-exhausted` |
| day committed over the day cap      | `daily-cap-reached`      |
| request id seen before              | `duplicate-request`      |
| ledger unreachable                  | `admission-unavailable`  |
| service role missing                | `guard-unavailable`      |
| model unpriced                      | `unpriced-model`         |

`enabled` defaulting to **false** is `generation_allowed=false` expressed as a
schema default rather than a flag someone has to remember to set.

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
| Failed output | **still charged to ONIQ** | **₹0 to the user**                             |

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

## 7. Not activated

No capability row is seeded. `enabled` is false. Nothing can spend until the
owner sets the numbers, and there is deliberately no default for any of them.
