# ONIQ_VIDEO_INVARIANTS

Every invariant the owner named, where it is enforced, and how it is proved.
`src/lib/__tests__/videoSpend.test.ts` — 49 tests ·
`src/lib/__tests__/videoCaps.test.ts` — 31 tests ·
`src/lib/__tests__/currencyDiscipline.test.ts` — 17 tests.

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

**All three values are `CAP_VALUES_UNSET`.** No row is seeded, no environment
variable supplies them, no deployment config sets them, and there is no default
for any of them. `provider_budget_status('VIDEO')` returns `SPEND_CAP_UNSET`.
The owner supplies them; see ONIQ_AI_FINANCIAL_CONTROL §7 for the exact insert.

## Financial

| Invariant                             | Enforced by                                                                  | Proved by                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| NO BILLABLE VIDEO WITHOUT RESERVATION | `admitProviderSpend` before `submit()` in story-clip                         | source-order assertion + callback-never-runs tests                    |
| NO UNKNOWN COST BECOMES ZERO          | `charge := coalesce(_actual_usd, estimated_usd)`                             | settle-with-null test; SQL regex                                      |
| NO UNPRICED MODEL CAN GENERATE        | `videoUsd()` throws; admission refuses `unpriced-model` / `zero-estimate`    | throw tests for unknown model and for Runway                          |
| NO UNBOUNDED RETRY                    | `max_attempts_per_job` under a row lock; release does not return the attempt | live PostgreSQL: attempt 4 → `job-attempts-exhausted`; SQL regex      |
| NO SILENT FAST ESCALATION             | `escalationFor()` returns ESCALATE_TIER for exactly one class                | enumerated over all eight classes                                     |
| NO RUNWAY SELECTION WHILE UNVERIFIED  | `provenance: "UNVERIFIED"` → `chooseTier` refuses, `videoUsd` throws         | both-tiers-fail test still returns no tier                            |
| DUPLICATE REQUEST CANNOT DOUBLE-SPEND | unique index on `request_id`                                                 | live PostgreSQL `duplicate-request`; propagation test                 |
| FAILED OUTPUT DOES NOT CHARGE USER    | provider ledger and `claim_story_seconds` are separate systems               | ONIQ_AI_FINANCIAL_CONTROL §5                                          |
| A NON-FINITE CEILING CANNOT BE STORED | `is_spendable_usd()` in a CHECK; equality tests, not ordering                | live PostgreSQL: NaN, ±Infinity, 0, negative all rejected             |
| CEILINGS CANNOT BE MISORDERED         | `provider_budget_config_cap_ordering`, re-checked in admission               | live PostgreSQL: 3 misorderings rejected; `request=job=daily` OK      |
| A NON-FINITE ESTIMATE CANNOT ADMIT    | equality tests at the door, before any comparison                            | live PostgreSQL `non-finite-estimate` / `invalid-units`               |
| EQUAL TO A CEILING IS ADMITTED        | `>` not `>=` at all three ceilings                                           | live PostgreSQL: 1.00 vs cap 1.00 admitted, 1.01 refused              |
| MONEY CANNOT BE CHARGED TWICE         | terminal state check in settle and release                                   | live PostgreSQL: 2nd settle and post-settle release `already-settled` |
| ACCEPTANCE NEVER MOVES MONEY          | `record_provider_outcome` touches no money column                            | live PostgreSQL: `settled_usd` unchanged across REJECTED              |
| THE JOB CEILING HOLDS UNDER RACE      | `select … for update` on `provider_spend_job`                                | 8 concurrent on one shot, cap $2.00 → 4 admitted, reserved 2.000000   |
| THE ATTEMPT CEILING HOLDS UNDER RACE  | same row lock, `attempts` incremented inside it                              | 8 concurrent, max 3 → 3 admitted, 5 `job-attempts-exhausted`          |
| ROUTING CANNOT RUN WITHOUT ITS GATE   | `chooseTier` refuses when `gate` is absent                                   | "no routing gate supplied — preconditions unknown, refusing"          |
| FLOAT DRIFT CANNOT REACH THE LEDGER   | `roundUsd()` at the column's 6 decimals                                      | `0.03*60` → exactly 1.8; `0.1*3` → exactly 0.3                        |

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
- no `insert into provider_budget_config` anywhere
- no video rate wired into `storyCostModel.ts`
- no cap value in any migration, env file, deployment config or default
- `chooseTier` refuses without a gate, and the gate cannot say `capsConfigured`
  while `provider_budget_status` says `SPEND_CAP_UNSET`

All asserted by test, so activation cannot happen by accident. Turning VIDEO on
takes two separate owner decisions — the three numbers, and `enabled = true`.

## Provider surface

`ACTIVE_VIDEO_SURFACE = "google-ai-studio"`. `GoogleAgentPlatformProvider`
exists as **static readiness only**: pure request-shaping and response
normalisation, no live call, no credential in this environment. Moving to it
would change which of Google's price lists ONIQ pays against, so it is an owner
decision, not an engineering one.
