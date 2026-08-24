# ONIQ_VIDEO_INVARIANTS

Every invariant the owner named, where it is enforced, and how it is proved.
`src/lib/__tests__/videoSpend.test.ts` — 49 tests.

---

## Financial

| Invariant                             | Enforced by                                                                  | Proved by                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| NO BILLABLE VIDEO WITHOUT RESERVATION | `admitProviderSpend` before `submit()` in story-clip                         | source-order assertion + callback-never-runs tests               |
| NO UNKNOWN COST BECOMES ZERO          | `charge := coalesce(_actual_usd, estimated_usd)`                             | settle-with-null test; SQL regex                                 |
| NO UNPRICED MODEL CAN GENERATE        | `videoUsd()` throws; admission refuses `unpriced-model` / `zero-estimate`    | throw tests for unknown model and for Runway                     |
| NO UNBOUNDED RETRY                    | `max_attempts_per_job` under a row lock; release does not return the attempt | live PostgreSQL: attempt 4 → `job-attempts-exhausted`; SQL regex |
| NO SILENT FAST ESCALATION             | `escalationFor()` returns ESCALATE_TIER for exactly one class                | enumerated over all eight classes                                |
| NO RUNWAY SELECTION WHILE UNVERIFIED  | `provenance: "UNVERIFIED"` → `chooseTier` refuses, `videoUsd` throws         | both-tiers-fail test still returns no tier                       |
| DUPLICATE REQUEST CANNOT DOUBLE-SPEND | unique index on `request_id`                                                 | live PostgreSQL `duplicate-request`; propagation test            |
| FAILED OUTPUT DOES NOT CHARGE USER    | provider ledger and `claim_story_seconds` are separate systems               | ONIQ_AI_FINANCIAL_CONTROL §5                                     |

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

All three asserted by test, so activation cannot happen by accident.
