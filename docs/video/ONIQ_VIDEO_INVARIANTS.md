# ONIQ_VIDEO_INVARIANTS

Every invariant the owner named, where it is enforced, and how it is proved.
`src/lib/__tests__/videoSpend.test.ts` ·
`src/lib/__tests__/videoCaps.test.ts` ·
`src/lib/__tests__/currencyDiscipline.test.ts`.

---

## The three VIDEO caps

Owner directive, 2026-08-24 — these are **USD spend ceilings**, not motion-class
acceptance thresholds:

| Owner's name  | Column            | Bounds                     |
| ------------- | ----------------- | -------------------------- |
| `VIDEO_CAP_1` | `request_usd_cap` | one call                   |
| `VIDEO_CAP_2` | `job_usd_cap`     | one film / one shot ladder |
| `VIDEO_CAP_3` | `daily_usd_cap`   | the fleet, per day         |

`max_attempts_per_job` is a separate, non-monetary invariant.

**Configured, 2026-08-24:** request **$1.00**, job **$5.00**, daily **$50.00**,
attempts **3**. `generation_allowed = false` — the caps are set, VIDEO is not on.

**Configured ceiling ≠ reachable exposure.**
`min($5.00, $1.00 × 3) = $3.00`. The retry ladder can reserve at most $3.00, so
the $5.00 job ceiling is an intentional backstop rather than a budget the ladder
consumes. It is not waste and not a bug — see ONIQ_AI_FINANCIAL_CONTROL §2, and
`effectiveJobSpendCap()` which states it in code.

The values live in one place — `20260824170000_video_spend_ceilings.sql`, a dated
owner-directive migration. There is still **no default** on any ceiling, so a
capability the owner has not configured remains `SPEND_CAP_UNSET` rather than
unlimited. `provider_budget_status('VIDEO')` now returns `CAPABILITY_DISABLED`:
caps configured, generation off.

## Financial

| Invariant                                      | Enforced by                                                                  | Proved by                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| NO BILLABLE VIDEO WITHOUT RESERVATION          | `admitProviderSpend` before `submit()` in story-clip                         | source-order assertion + callback-never-runs tests                                           |
| NO UNKNOWN COST BECOMES ZERO                   | `charge := coalesce(_actual_usd, estimated_usd)`                             | settle-with-null test; SQL regex                                                             |
| NO UNPRICED MODEL CAN GENERATE                 | `videoUsd()` throws; admission refuses `unpriced-model` / `zero-estimate`    | throw tests for unknown model and for Runway                                                 |
| NO UNBOUNDED RETRY                             | `max_attempts_per_job` under a row lock; release does not return the attempt | live PostgreSQL: attempt 4 → `job-attempts-exhausted`; SQL regex                             |
| NO SILENT FAST ESCALATION                      | `escalationFor()` returns ESCALATE_TIER for exactly one class                | enumerated over all eight classes                                                            |
| NO RUNWAY SELECTION WHILE UNVERIFIED           | `provenance: "UNVERIFIED"` → `chooseTier` refuses, `videoUsd` throws         | both-tiers-fail test still returns no tier                                                   |
| DUPLICATE REQUEST CANNOT DOUBLE-SPEND          | unique index on `request_id`                                                 | live PostgreSQL `duplicate-request`; propagation test                                        |
| FAILED OUTPUT DOES NOT CHARGE USER             | provider ledger and `claim_story_seconds` are separate systems               | ONIQ_AI_FINANCIAL_CONTROL §5                                                                 |
| A NON-FINITE CEILING CANNOT BE STORED          | `is_spendable_usd()` in a CHECK; equality tests, not ordering                | live PostgreSQL: NaN, ±Infinity, 0, negative all rejected                                    |
| CEILINGS CANNOT BE MISORDERED                  | `provider_budget_config_cap_ordering`, re-checked in admission               | live PostgreSQL: 3 misorderings rejected; `request=job=daily` OK                             |
| A NON-FINITE ESTIMATE CANNOT ADMIT             | equality tests at the door, before any comparison                            | live PostgreSQL `non-finite-estimate` / `invalid-units`                                      |
| EQUAL TO A CEILING IS ADMITTED                 | `>` not `>=` at all three ceilings                                           | live PostgreSQL: 1.00 vs cap 1.00 admitted, 1.01 refused                                     |
| MONEY CANNOT BE CHARGED TWICE                  | terminal state check in settle and release                                   | live PostgreSQL: 2nd settle and post-settle release `already-settled`                        |
| ACCEPTANCE NEVER MOVES MONEY                   | `record_provider_outcome` touches no money column                            | live PostgreSQL: `settled_usd` unchanged across REJECTED                                     |
| THE JOB CEILING HOLDS UNDER RACE               | `select … for update` on `provider_spend_job`                                | 8 concurrent on one shot, cap $2.00 → 4 admitted, reserved 2.000000                          |
| THE ATTEMPT CEILING HOLDS UNDER RACE           | same row lock, `attempts` incremented inside it                              | 8 concurrent, max 3 → 3 admitted, 5 `job-attempts-exhausted`                                 |
| ROUTING CANNOT RUN WITHOUT ITS GATE            | `chooseTier` refuses when `gate` is absent                                   | "no routing gate supplied — preconditions unknown, refusing"                                 |
| FLOAT DRIFT CANNOT REACH THE LEDGER            | `roundUsd()` at the column's 6 decimals                                      | `0.03*60` → exactly 1.8; `0.1*3` → exactly 0.3                                               |
| A RETRY INCREASE CANNOT BYPASS THE JOB CEILING | `min(job_usd_cap, request x attempts)`                                       | attempts 3/4/5/6/10 -> $3/$4/$5/$5/$5; live PG: attempts 10 -> `job-cap-reached` at 5.000000 |
| THE LADDER AND THE MONEY BIND SEPARATELY       | attempt count and USD are different columns, checked independently           | live PG: attempts 3 -> `job-attempts-exhausted` at $3.00 with $2.00 of ceiling unused        |
| AN OVERSPENT SETTLE IS VISIBLE, NOT HIDDEN     | `committed = reserved + settled` re-read at each admission                   | live PG: settle 3.00 on a 1.00 reservation -> next 2.01 refused                              |

## Audio

| Invariant                                  | Enforced by                                                         | Proved by                                                   |
| ------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| NO UNNECESSARY VEO AUDIO                   | `inferAudioMode` — ONIQ voice wins, silence is stated not defaulted | six owner examples; a not-all-one-mode test                 |
| NO PROVIDER AUDIO GENERATED THEN DISCARDED | `discardReason` is required whenever a track is dropped             | non-empty-reason test on every discarding mode              |
| NATIVE AUDIO IS PRESERVED WHEN REQUESTED   | `preserveProviderAudio` → `muted={!shot.clip.preserveAudio}`        | resolver test on both surfaces + StoryFilm source assertion |
| generateAudio is never sent on AI Studio   | absent from story-clip                                              | comment-stripped source assertion                           |

## Media

`verifyFinalMedia(mode, probe)`:

- VIDEO_ONLY → video present, **no** audio stream
- ONIQ_SOUND / VEO_NATIVE_AUDIO → video + audio, peak above **−60 dBFS**, A/V
  drift ≤ **0.25 s**
- any mode → a missing video stream fails

A track at −91 dBFS is silence with extra steps; Episode 1 shipped exactly that
once, which is why the floor exists.

## Separation

- No search function references `veo-`, `predictLongRunning`, `story-clip`,
  `runwayml` or `generateVideo`, and none declares `capability: "VIDEO"`.
- `story-clip` declares `capability: "VIDEO"` and contains no `web_search_`.
- No browser-bundled file reads a provider or service-role secret; no `src/`
  file fetches a provider endpoint.

## Not activated

- `enabled boolean not null default false` in the schema
- the ceilings migration inserts `enabled = false`, and its `ON CONFLICT` clause
  deliberately omits `enabled` — re-running it cannot switch generation on
- no video rate wired into `storyCostModel.ts`
- no ceiling has a column default; an unconfigured capability stays
  `SPEND_CAP_UNSET`
- `chooseTier` refuses without a gate, and refuses again while
  `generationAllowed` is false — which is today's state

All asserted by test, so activation cannot happen by accident. Turning VIDEO on
took two separate owner decisions; only the first has been made. The caps are
set at $1 / $5 / $50 and `generation_allowed` is still **false**.

## Provider surface

`ACTIVE_VIDEO_SURFACE = "google-ai-studio"`. `GoogleAgentPlatformProvider`
exists as **static readiness only**: pure request-shaping and response
normalisation, no live call, no credential in this environment. Moving to it
would change which of Google's price lists ONIQ pays against, so it is an owner
decision, not an engineering one.
