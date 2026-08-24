# ONIQ_VEO_LITE_FAST_BENCHMARK

**Status** BLOCKED — NOT RUN · **Date** 2026-08-24

---

## 1. Verdict

**The clean Lite-vs-Fast benchmark has not been run, and no acceptance figure
for either tier exists.** Everything below is the frozen design; the numbers
column is empty on purpose.

## 2. Why it is blocked

Three independent blockers, each of which is a STOP condition in its own right:

1. **Daily Veo quota exhausted** (measured 2026-08-24: 18 consecutive
   `429 RESOURCE_EXHAUSTED` in 0.1–0.4 s). No generation is possible.
2. **No Google key in this session.** `GOOGLE_AI_API_KEY` is absent from this
   container's environment, so not even a free `models.list` probe can run.
   Provider health is therefore **UNKNOWN**, not "healthy".
3. **Benchmark inputs were contaminated.** The previous 20-clip run used
   `remotion/public/sheets/cut/*.png`, which are character **design sheets**
   with captions, labels and multiple poses — unequally so (aladdin none,
   princess heavy). Only 4 of 10 yielded a clean pose.

## 3. The previous run is NOT blind, and is not being re-labelled

The 2026-08-24 review exposed `MODELS={"A":"lite","B":"fast"}` to the reviewer.
It is recorded as **NON_BLIND VISUAL REVIEW** and its absolute quality numbers
are **not** production evidence. A future blind review is preferable and is what
the design below assumes. History is not being rewritten to make it look
stronger.

## 4. Frozen input contract

Every benchmark input must contain, and is rejected otherwise:

- exactly one character/reference
- no captions, no labels, no legends
- no multiple poses in one image
- no unrelated graphics
- the production frame: 1080×1920, 9:16, 720p target

**Freeze before comparing.** The input set is hashed and committed before any
generation, so a mid-run substitution cannot happen silently.

## 5. Frozen motion classes

`walking · talking · close-up · turning · two-person interaction · hand movement
· lower-body movement · camera movement · environmental movement ·
known knee-regression case`

Held identical across tiers: prompt, input, duration, resolution, orientation,
downstream pipeline, acceptance criteria.

## 6. Four metrics, recorded separately

A clip that moves but ignores "turn around" is **not** fully successful.
Aliveness ≠ prompt adherence, and collapsing them is how the last benchmark
overstated itself.

1. **GENERATION SUCCESS** — did a video come back at all
2. **TECHNICAL QA** — duration, streams, aliveness floor, audio state matches mode
3. **REQUEST/MOTION ADHERENCE** — did it do the thing the prompt asked
4. **HUMAN VISUAL/AUDIO QUALITY** — blind review

## 7. Audio benchmark, once generation is possible

Four cells per representative scene: `LITE × {VIDEO_ONLY, NATIVE_AUDIO}`,
`FAST × {VIDEO_ONLY, NATIVE_AUDIO}` — noting that on the current surface the
VIDEO_ONLY cells are _billed identically_ to the NATIVE_AUDIO ones and differ
only in whether the track is kept. Measure: speech, sync, SFX, ambience, music
interaction, audio artefacts, visual quality, motion quality, overall appeal.

## 8. The metric that decides

**ACCEPTED PRODUCT QUALITY PER RUPEE**, not lowest generation price.

```
cost per accepted second = rate x E[attempts] / P(first-pass acceptance)
```

`provider_spend_daily_metrics.usd_per_accepted_unit` computes exactly this from
real rows, and is null until something is accepted — dividing by zero
acceptances would invent a figure.

## 9. Results

| motion class | Lite acceptance  | Fast acceptance  | Lite ₹/accepted s | Fast ₹/accepted s |
| ------------ | ---------------- | ---------------- | ----------------- | ----------------- |
| all ten      | **NOT MEASURED** | **NOT MEASURED** | —                 | —                 |

`chooseTier()` refuses to select any tier without measured evidence for that
motion class. With this table empty, **no external tier can be chosen**, which
is the correct behaviour and not a bug.
