# ONIQ_VIDEO_ROUTING_SPEC

**Status** IMPLEMENTED, INERT (no tier is selectable without benchmark evidence)
· **Date** 2026-08-24

---

## 1. There is only one router

`src/lib/motionCost.ts` already decides the **cheapest level that makes a shot
perform**:

```
0 STATIC     still only                          CPU, ~free
1 CAMERA     Ken Burns / parallax / VFX          CPU, ~free
2 RIG        measured 2D rig puppet              CPU, ~free
3 POSE_WARP  segment + auto-rig + 2D warp        CPU, ~free
4 DIFFUSION  Wan2.1-VACE 1.3B, pose-conditioned  GPU
5 PREMIUM    external video generation           paid API
```

`_shared/videoRouting.ts` **is not a second router**. It picks up at level 5,
once that ladder has already concluded external generation is required, and
answers three things the level ladder does not: which external **tier**, what it
**costs**, and what to do when it comes back **wrong**.

## 2. The full path

```
USER REQUEST
  → STORY/SCENE ANALYSIS        story-plot (movie grammar: motion, dialogue, vfx)
  → QUALITY REQUIREMENT         motionCost.classifyShotMotion → level 0..5
  → AUDIO REQUIREMENT           videoAudio.inferAudioMode → 1 of 3 modes
  → IN-HOUSE ELIGIBILITY        levels 0–3 short-circuit here, at no provider cost
  → PROVIDER HEALTH             providerError breaker (HEALTHY/DEGRADED/QUOTA_EXHAUSTED)
  → FINANCIAL ADMISSION         admit_provider_spend (request / job / day)
  → MODEL SELECTION             videoRouting.chooseTier(evidence, bar)
  → AUDIO MODE                  videoAudio.resolveAudioMode(mode, surface)
  → GENERATION                  story-clip start → poll
  → TECHNICAL QA                aliveness floor, duration, streams
  → MOTION/PROMPT QA            adherence
  → AUDIO QA                    verifyFinalMedia(mode, probe)
  → ACCEPTANCE                  record_provider_outcome(ACCEPTED|REJECTED)
  → SETTLEMENT                  settle_provider_spend (measured cost)
  → FINAL MIX                   StoryFilm: preserveAudio decides the track
  → DELIVERY
```

## 3. Tier selection

`chooseTier(evidence, qualityBar)`:

- **No evidence for the motion class → no tier.** "Lite is probably fine" is how
  a benchmark gets skipped.
- Lite if its **measured** acceptance clears the bar.
- Fast only if Lite does not and Fast's measured acceptance does.
- **Runway never**, while its provenance is `UNVERIFIED`.

The comparison is on `usd_per_accepted_second`: a tier at half the price that
fails twice as often is not cheaper. Lite at 40% acceptance ($0.2450/accepted s)
is worse than Fast at 90% ($0.1233/accepted s), and only this metric says so.

**No FX rate enters tier selection.** `chooseTier()` takes acceptance evidence
and a quality bar; it takes no rate, and `currencyDiscipline.test.ts` asserts
that no routing signature can be handed one.

## 4. Failure classification, and the one class that escalates

`classifyVideoFailure(signal) → FailureClass`, then `escalationFor(class)`:

| Class                                               | Action                     | Why                                                                                                            |
| --------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| MOTION_COMPLEXITY                                   | **ESCALATE_TIER**          | the one thing a stronger tier can fix                                                                          |
| MOTION_COMPLEXITY, already failed on the other tier | STOP                       | a third generation buys nothing                                                                                |
| CONTENT_FILTERED                                    | FIX_PROMPT                 | a responsible-AI refusal is about the request; **measured: the same two prompts returned empty on BOTH tiers** |
| BAD_PROMPT                                          | FIX_PROMPT                 | the provider named the prompt                                                                                  |
| BAD_REFERENCE                                       | FIX_REFERENCE              | the provider named the starting frame                                                                          |
| PROVIDER_OUTAGE                                     | WAIT (30 s)                | provider-side fault, not a model choice                                                                        |
| QUOTA_EXHAUSTED                                     | STOP                       | a daily quota does not clear by retrying                                                                       |
| BUDGET                                              | STOP                       | there is no tier that is free                                                                                  |
| UNKNOWN                                             | RETRY_SAME once, then stop |                                                                                                                |

Exactly one class returns ESCALATE_TIER, and that is asserted by test.

## 5. Bounded retries

Not a loop counter in the worker — a **ceiling in the database**.
`admit_provider_spend` increments `provider_spend_job.attempts` under a row lock
and refuses `job-attempts-exhausted` past `max_attempts_per_job` (default 3).
`release_provider_spend` returns the money but **not the attempt**: handing the
attempt back would make a never-called retry loop unbounded by construction.

A shot that runs out of attempts becomes a still. In a movie, a still shot is a
shot, not a hole.

## 6. Runway

`UNVERIFIED`, and unselectable. `video_jobs` has **0 rows** — no ONIQ
server-side Runway call has ever succeeded. 5 credits/second is documented in
`runway.server.ts`; what a credit costs is not, and a credit is not a dollar
until someone reads an invoice. `videoUsd()` throws for it, which means
admission refuses, which means it cannot generate.

Verification checklist before it can be considered: secret, authentication,
endpoint, model, generation, output, **pricing**.

## 7. Search must remain separate

`SEARCH → RETRIEVAL → OPTIONAL AI SYNTHESIS`, never `SEARCH → VIDEO`. Asserted:
no search function references `veo-`, `predictLongRunning`, `story-clip`,
`runwayml` or `generateVideo`, and none declares `capability: "VIDEO"`.
`story-clip` declares `capability: "VIDEO"` and contains no `web_search_` tool.
