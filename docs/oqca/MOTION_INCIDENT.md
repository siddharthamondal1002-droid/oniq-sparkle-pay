# OQCA on the in-house video motion problem

Owner request, 2026-09-12: _"Use oqca to check inhouse video motion problem."_

Run it with `npx tsx scripts/oqca-motion-incident.ts --reset --episodes 3`.
Cost **$0**: no engine is passed, so `REFUSING_ENGINE` refuses every model call
before it is made, no tool touches production, and nothing is deployed.

## What the readings say — measured 2026-09-12, in both repositories

The in-house video path is LTX-Video 2B on an A5000 in `oniq-gpu-worker`; the
jobs it produces are rows in `oniq-sparkle-pay`'s production database. Six
readings were taken, each a count that can be re-run from its locator, and none
of them carries a diagnosis or a remedy.

| #   | kind                    | subject                        | measured                                                                                                                                                  | sev             |
| --- | ----------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | `missing_validation`    | `clip_quality_shipped`         | the Dockerfile COPYies 16 paths and names 14 python modules individually; `validation/clip_quality.py` is not among them and no shipped module imports it | 0.9             |
| 2   | `missing_telemetry`     | `gpu_video_jobs_verdict`       | 33 columns covering cost, bytes, timing, audio, watermark — none records a motion verdict, aliveness or anchor distance                                   | 0.7             |
| 3   | `motion_failure`        | `ltx_clip_inspection`          | three clips inspected on gpu-validation run 79, one is a pass                                                                                             | 0.8             |
| 4   | `missing_validation`    | `static_threshold_calibration` | `static_below` is 0.0015, half the least-alive known-good sample; no frozen fixture exists                                                                | 0.6             |
| 5   | `generation_failure`    | `gpu_video_jobs_volume`        | four rows in total, three completed 08-26..08-27, one orphaned 08-28, nothing since                                                                       | 0.3             |
| 6   | `resource_availability` | `clip_quality_module`          | 288 lines, four verdicts, a calibration block, 24 tests needing no network, ffmpeg or GPU                                                                 | 0 **(control)** |

The three inspected clips, verbatim from `validation/fixtures/fixtures.json`:

    GOOD_MOTION       aliveness 0.0030  anchor_p75 0.0044   PASS
    IDENTITY_DRIFT    aliveness 0.0046  anchor_p75 0.1567   PARTIAL
    CONTENT_COLLAPSE  aliveness 0.0106  anchor_p75 0.2618   FAIL

**THE MOTION JUDGEMENT IS NOT THE PROBLEM — IT IS GOOD, AND IT CANNOT RUN.**
`clip_quality.py` computes two numbers off a 32x18 luma plane (mean
consecutive-frame difference, and distance from the conditioning plate) and
separates the three fixtures by wide margins at the 75% anchor point. Its
thresholds are derived from those measured numbers and it refuses rather than
passing when any threshold is uncalibrated. It is 288 lines with 24 tests. The
Dockerfile's `COPY` list does not name it, and nothing that ships imports it —
so **every clip ONIQ generates in production reaches a user with no motion
check at all**, and the database has no column that could record one if it did.
This is the repository's most-recorded failure — built and unit-tested is not
reachable — in a sixth place.

Reading 4 is the sharpest of the four gaps and the easiest to miss: the one
verdict that names a clip which never moved (`STATIC_MOTION_FAILED`) is the one
with no evidence behind it. Its threshold is half the least-alive _good_ sample
because no frozen fixture exists. The file says so itself, and says the first
real STATIC verdict should be re-inspected by eye.

The control (reading 6, severity 0) was **correctly dropped by `actionable()`**
— it is absent from all 19 ranked concerns on both taps, so the host is
demonstrably not feeding only bad news.

## What OQCA did with them — and the prediction was wrong

The host states its prediction before the run so the result can disagree with
it, per §hard-rule. Predicted: a `missing_validation` concern ranks **first**.

**It ranked first among the measured findings, on both taps, stably — and 20x
BELOW every never-observed chore.**

    0.05040  UNOBSERVED  improve:configuration_mismatch      <- tap 1 top
    0.05040  UNOBSERVED  improve:runtime_failure             <- tap 2 top
    0.00252  UNOBSERVED  (thirteen more chores, all tied)
    ---------------------------------------------------------- every chore above
    0.00243  OBSERVED    improve:missing_validation:clip_quality_shipped
    0.00192  OBSERVED    improve:motion_failure:ltx_clip_inspection
    0.00147  OBSERVED    improve:missing_telemetry:gpu_video_jobs_verdict
    0.00108  OBSERVED    improve:missing_validation:static_threshold_calibration
    0.00027  OBSERVED    improve:generation_failure:gpu_video_jobs_volume

**Six episodes across two taps. Zero touched a motion reading.** `settled 0,
learned 0, persisted 0` both times; every episode went to a never-observed
chore or to `runner-availability`, the permanent gap no corpus can close.

    #0 learn:runner-availability                     blocked
    #1 improve:configuration_mismatch                blocked
    #2 learn:configuration_mismatch                  blocked
    #3 improve:runtime_failure                       blocked
    #4 learn:runtime_failure                         blocked
    #5 improve:test_health                           blocked

### The mechanism, measured rather than reasoned

**THE 2026-09-11 PLANNING FIX WORKS HERE AND IS NOT THE PROBLEM.** The measured
findings carry `cap=0.50` — `ESCALATION_CAPABILITY`, exactly what `needsAPerson`
was built for — and their planning modifier is **higher** than a chore's:

    chore planning  1.00 x 0.70 x 1.00 x 0.80 x 1.00 x 0.30 = 0.168
    real  planning  0.50 x 1.00 x 1.00 x 1.00 x 1.00 x 0.90 = 0.450

The inversion is entirely in the TARGET (learning) score, which the 2026-09-11
entry called _"roughly right"_. It is not:

    chore target  imp 0.300 x unc 1.000 x dep 1.000 x gain 1.000 x stale 1.000 x rel 1.000 = 0.3000
    real  target  imp 0.900 x unc 0.300 x dep 1.000 x gain 0.400 x stale 1.000 x rel 0.050 = 0.0054

**A FAULT IS PENALISED FOR HAVING BEEN MEASURED.** A never-observed kind scores
`uncertainty 1.000` and `informationGain 1.000` _by definition_ — nothing is
known, so everything is to be gained. A fault somebody actually went and
measured scores 0.300 and 0.400 _because_ it was measured. Even with relevance
neutralised the chore still wins **0.300 to 0.108**; the relevance floor widens
it to 55x.

**AND RELEVANCE IS THE SECOND HALF.** `relevanceTo` returns 1 for a concept the
focus goal requires and otherwise walks `dependsOn` edges. These
observation-derived concepts have no edges between them, so every non-focus
concept is UNREACHABLE and takes `MODIFIER_FLOOR = 0.05`. The 1.0 slot is
therefore winner-take-all — and it is always won by a chore, because the
selection that sets the focus is itself won by chores.

**A SECOND HYPOTHESIS WAS FALSIFIED BY THE SECOND TAP, and the truth is worse.**
I expected a ratchet: whatever is picked first stays the focus and stays on top.
It does not. On tap 2 the top concern is `runtime_failure` and
`configuration_mismatch` has fallen back to 0.00252, tied with the rest. So the
focus **rotates** through the fourteen never-observed chores, none of which any
corpus can close, while the five measured findings sit still at the bottom. It
is not a lock-in; it is a carousel that never stops at the evidence.

This is distinct from the 2026-09-11 finding and one layer further in. That one
was _an unauthorized capability sinks the ranking_ and was fixed in the planner.
This is _a measurement sinks the ranking_, in the learning selector, and the
direction is the same confusion: treating "ONIQ knows about this" as "this
matters less". A gap detector should prefer ignorance; a **fault** selector
should not, and both currently run through one score.

## What is NOT claimed

- No clip was generated, inspected or re-measured. Reading 3 is the 2026-08-29
  inspection as recorded, and three clips is a tiny sample the fixtures file
  itself flags as tiny.
- Nothing here says LTX moves badly. Two of three inspected clips failed on
  **identity drift** and **content collapse**, not on stillness, and no clip has
  ever been classified `STATIC_MOTION_FAILED` by anything.
- The selector defect is measured on this host's readings. Whether the live
  `oqca-observe` tap shows it depends on its own five readings, and that was
  not run here.
- Nothing was deployed, published, merged or spent.
