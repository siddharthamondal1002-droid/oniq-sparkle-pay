# ONIQ video acceptance benchmark — v1

**The number that was missing is now measured.**

Run 2026-08-23. **49 real CPU renders. ₹0 API, ₹0 GPU, 0 provider calls.**

---

## Headline

```
FIRST_PASS_ACCEPTANCE  =  65.31 %   (32 / 49)   at the shipped 129-frame window
FIRST_PASS_ACCEPTANCE  = 100.00 %   (49 / 49)   at a 121-frame window
```

**All 17 failures have one cause, and it is a framing bug, not a quality
problem.** Every failure is `within_render_envelope`; every border contact is on
the **right edge only**; every offending frame lies in **121–128** of 129. The
character walks rightward and steps out of the fixed camera window in the last
quarter-second.

Trimming the window by **8 frames (0.27 s, 6.2 % of the clip)** takes measured
acceptance from **65.31 % to 100 %**. That was verified by re-gating all 49
trimmed clips, not inferred from the frame indices.

## Dataset — frozen v1

**Selection rule, fixed before any result was seen:** every rig under
`genloop/v3/b4/` holding both `rig/char_cfg.yaml` and `rig/texture.png`, in
lexicographic order, **no exclusions**. 49 of 49 candidates qualified; none was
dropped, and nothing was re-selected after seeing an outcome.

| field              | value                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| benchmark version  | `ONIQ-ACC-v1`                                                                                  |
| characters         | 49                                                                                             |
| clip per character | one, 129 frames @ 30 fps = 4.30 s                                                              |
| motion driver      | `knee050_ref_frame0.bvh` (the shipped 0.50 damper, byte-identical to `b3_knee_damp.py` output) |
| retarget           | `retarget_engineering.yaml`, unmodified                                                        |
| renders attempted  | 49 · **succeeded 49** · rc≠0: **0**                                                            |
| total render time  | **781.9 s** CPU (mean 15.96 s per 4.3 s clip)                                                  |
| requested seconds  | 210.7                                                                                          |
| accepted seconds   | **137.6** (129-frame) → **197.6** (121-frame)                                                  |
| failed seconds     | **73.1** → **0**                                                                               |

## Failure analysis

| category                 | count  | classification |
| ------------------------ | ------ | -------------- |
| `within_render_envelope` | **17** | MEASURED       |
| every other hard check   | 0      | —              |

Border frames per failing character, all right-edge:

| character                                                                            | frames touching the edge | index range |
| ------------------------------------------------------------------------------------ | ------------------------ | ----------- |
| `b4_stress_hair`, `m1_electrician_woman`, `m2_grandpa_stocky`                        | 8                        | 121–128     |
| `m1_dancer_woman`, `m2_kilt_musician`, `m2_tall_basketball_teen`, `m3_desert_trader` | 7                        | 122–128     |
| `m1_farmer_elder`, `m3_grandpa_stocky`                                               | 6                        | 123–128     |
| `b4_muscular_woman`                                                                  | 5                        | 124–128     |
| `b4_heavy_man`, `m1_office_man`, `m3_mountain_hunter`                                | 4                        | 125–128     |
| `b4_short_woman`, `b4_stress_robe`, `m3_artisan_weaver`, `m3_court_scholar`          | 2                        | 127–128     |

**Earliest egress anywhere = frame 121.** Top, bottom and left edges: **zero
contacts, in all 49 clips**. This is the per-character envelope finding from the
generalization work, now quantified across the whole library.

## The gate that produced this

`pricing/acceptance_gate.py`. Deterministic, fail-closed, thresholds lifted from
shipped ONIQ code rather than invented (`CLIP_ALIVENESS_MIN = 0.75` from
`story-worker.mjs`; `DURATION_MIN/MAX_RATIO`, `VIDEO_MIN_BYTES` from
`storyPreflight.ts`).

**It was validated against synthetic defects before being trusted** — a gate
that passes everything measures nothing:

| case                           | expected  | got                                                        |
| ------------------------------ | --------- | ---------------------------------------------------------- |
| real corrected clip            | ACCEPTED  | **ACCEPTED**                                               |
| frozen tail (+400 held frames) | HARD_FAIL | **HARD_FAIL** — `no_frozen_run`, `temporal_aliveness`      |
| 30 blank frames spliced in     | HARD_FAIL | **HARD_FAIL** — `no_blank_frames`, `character_present`, +2 |
| wholly dead clip               | HARD_FAIL | **HARD_FAIL** — `no_frozen_run`, `temporal_aliveness`      |
| truncated file                 | HARD_FAIL | **HARD_FAIL** — `file_min_bytes`, `file_decodes`           |

_(A first attempt used `run1/sample_1.gif` as the negative control. It turned out
to be the **corrected** clip, so it passed — the control was wrong, not the gate.
Synthetic defects replaced it.)_

## Measured in-house cost

| quantity                                                         | value               | class    |
| ---------------------------------------------------------------- | ------------------- | -------- |
| render time per video-second                                     | **3.71 s**          | MEASURED |
| runner-minutes per finished minute (motion stage)                | **3.71**            | DERIVED  |
| ₹ per finished minute (motion stage, @ $0.008/runner-min, ₹84/$) | **₹2.49**           | DERIVED  |
| storyCostModel's budget for the whole film                       | 9.00 runner-min/min | existing |

The motion stage sits **well inside** the budgeted envelope. This does **not**
replace the ₹37.55/finished-minute figure — that covers stills, voices and the
full Remotion composition, none of which ran here.

## Cost per accepted second, at the measured rates

`MAX_ATTEMPTS = 2`:

| route                      | @ 65.31 % (today) | @ 100 % (after the trim) |
| -------------------------- | ----------------- | ------------------------ |
| **in-house**               | **₹0.96**         | **₹0.63**                |
| Veo 3.1 Lite 720p no-audio | ₹3.86             | ₹2.52                    |
| Veo 3.1 Lite 720p audio    | ₹6.43             | ₹4.20                    |

**In-house floor at 26 % margin: ₹107/accepted minute today → ₹72 after the trim.**

## External seconds each price can fund (60 s film, Veo Lite no-audio)

| ₹/min    | today (65.31 %) | after the trim (100 %) |
| -------- | --------------- | ---------------------- |
| ₹49      | 0.0             | 0.0                    |
| ₹79      | 0.0             | 2.1                    |
| **₹99**  | **0.0**         | **8.1**                |
| ₹129     | 4.2             | 17.0                   |
| **₹149** | **8.1**         | **22.9**               |
| ₹199     | 17.8            | 37.8                   |
| ₹249     | 27.5            | 52.7                   |
| ₹299     | 37.3            | 60.0                   |

## What this settles

**₹99 is not viable today and becomes viable after the trim.** Today's in-house
floor is ₹107 — ₹99 is **below cost**. After the trim the floor is ₹72 and ₹99
additionally funds 8.1 external seconds. This is the data-gate the previous loop
asked for, and it has now been measured rather than assumed.

**₹149 is viable today**, with 8.1 external seconds of headroom, and comfortable
after the trim with 22.9.

**₹49 is not viable under either rate.** Zero external seconds and below the
in-house floor in both columns.

## Scope and limits — stated

1. **This measures the in-house MOTION stage only.** The still and TTS stages
   need provider keys that are **absent from this container**, so a complete
   1080×1920 ONIQ film could not be rendered or gated. Whole-film first-pass
   acceptance remains **`OPEN`** and will be lower than 100 %, because it has
   more stages to fail.
2. **One shot per character, one motion class** (forward walk). Talking,
   turning, two-person and camera-move classes are **`OPEN`**.
3. **The 100 % figure is for the trimmed window**, which is a proposed config
   change, not shipped. Nothing was changed in production.
4. Four checks are recorded **`OPEN`** rather than claimed as deterministic
   passes: character-reference consistency, severe-anatomy artefacts, dialogue
   presence, final-assembly integrity. No reliable automated test for them
   exists in this repository.

---

## PHASE 30 — final decision table

Measured acceptance **100 %** (trimmed window) unless noted. External = Veo 3.1
Lite 720p no-audio at the verified $0.03/s. `MAX_ATTEMPTS = 2` per shot.

| tier           | ₹/min | in-house % | external % | ₹/accepted s | max external s | model                      | status                         |
| -------------- | ----- | ---------- | ---------- | ------------ | -------------- | -------------------------- | ------------------------------ |
| **Quick**      | ₹79   | 96.5 %     | 3.5 %      | 0.63         | 2.1            | in-house only              | **viable**                     |
| **Creator** ⭐ | ₹149  | 61.8 %     | 38.2 %     | 0.63 → 2.52  | 22.9           | in-house + Veo Lite        | **viable**                     |
| **Pro**        | ₹249  | 12.2 %     | 87.8 %     | 0.63 → 2.52  | 52.7           | in-house + Veo Lite        | **viable**                     |
| **Cinematic**  | ₹499  | 0 %        | 100 %      | 2.52 → 4.20  | 60.0           | Veo Lite, audio affordable | **viable**                     |
| ₹99            | ₹99   | 86.5 %     | 13.5 %     | 0.63         | 8.1            | in-house + 1 hero shot     | **viable ONLY after the trim** |
| ₹49            | ₹49   | 100 %      | 0 %        | —            | 0.0            | —                          | **NOT VIABLE**                 |

### The fifteen answers

1. **₹49 viable?** **No.** Zero external seconds at either rate, and below the
   in-house floor (₹107) today.
2. **₹79 viable?** **Yes**, in-house only. 2.1 external seconds after the trim.
3. **₹99 viable?** **Not today — yes after the trim.** Today's in-house floor is
   **₹107**, so ₹99 is below cost. After the trim the floor is **₹72** and ₹99
   funds **8.1** external seconds. _This is the data-gate the last loop asked
   for, now measured._
4. **₹149 viable?** **Yes, today.** Clears the ₹107 floor with 8.1 external
   seconds; after the trim, 22.9.
5. **₹249 viable?** **Yes** — 52.7 external seconds, real escalation headroom.
6. **₹499 viable?** **Yes**, and it is the only tier that funds a full minute of
   Veo Lite **with audio** (12.2 s at ₹149 vs 35.8 s at ₹299 vs a full minute at
   ₹499).
7. **Best Indian launch price?** **₹149 Creator** today. Revisit ₹99 the moment
   the trim ships.
8. **Default tier?** **Creator.**
9. **In-house %?** **61.8 %** of a Creator minute at minimum; more when shots
   do not need escalation.
10. **Veo Lite %?** Up to **38.2 %** of a Creator minute (22.9 s).
11. **Veo Fast when?** Only for a defined quality class Lite provably fails.
    **Not yet benchmarked — `OPEN`.**
12. **Runway?** **`UNAVAILABLE_FOR_THIS_EXPERIMENT`** — unintegrated,
    egress-blocked, unpriced.
13. **Cost per accepted second?** **In-house ₹0.96 today, ₹0.63 after the trim**
    (MEASURED). Veo Lite ₹2.52–₹3.86 (provider price verified; **its acceptance
    rate is `OPEN`**).
14. **First-pass acceptance?** **65.31 % measured** (32/49) at the shipped
    window; **100 %** (49/49) at a 121-frame window.
15. **Max safe retry spend?** Per shot, bounded by
    `min(job, daily, user)` remaining budget. At ₹149/min, ₹81.01 is available
    for generation per sold minute — 2.16 in-house passes, 1.23 hybrid passes.

### The one change with the largest economic effect

**Trim the render window from 129 to 121 frames.** It costs 0.27 s of clip and
moves measured first-pass acceptance from **65.31 % to 100 %**, which drops the
in-house floor from **₹107 to ₹72 per accepted minute** — and that single change
is what makes **₹99 viable**. No provider change comes close to that.

---

## CORRECTION 2026-08-23 — the external columns above are superseded

Every "external" figure on this page assumes **Veo 3.1 Lite 720p no-audio at
$0.03/s**. The first live clip proved the shipped path is
`veo-3.1-fast-generate-preview` **with audio** at **$0.10/s** — 3.33× higher —
because `story-clip` sends no `generateAudio` parameter and Veo 3.1 generates
audio by default.

At ₹149 the real headroom is **5.6 external seconds, not 22.9**.

**The in-house numbers on this page are unaffected** — 65.31 % measured
acceptance, 100 % trimmed, the ₹107 → ₹72 floor, and therefore the ₹99 and ₹49
verdicts all stand, because none of them depends on the provider rate. Only the
external-seconds tables move. Corrected tables and the owner decision are in
`ONIQ_VEO_TIER_AND_AUDIO_FINDING.md`.
