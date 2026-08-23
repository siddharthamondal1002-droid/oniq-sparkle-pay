# ROUTE 5B — third-party external BVH engineering loop

## Headline

The external arm **stopped at source acceptance**: the third-party BVH is not
obtainable from this session. But the loop's actual objective — *find the
smallest causally justified fix for the right-knee over-curl* — **did produce a
result**, by running the directive's own §12 cause-ordering against the source
ONIQ already has.

**`ENGINEERING FIX` — CANDIDATE, not deployed:**
change the damper's reference pose from the shared frame 0 to each leg's own
maximum-extension frame. Scale stays 0.50, six rotation channels, both knees,
source-BVH layer.

**`CAUSE` (measured):** the accepted damper is symmetric in *rotation* space but
references both knees to the *shared frame 0*. A walk's legs are in **antiphase**,
so frame 0 is a systematically different point of each leg's cycle. A symmetric
scale about a phase-asymmetric reference produces an **asymmetric** change in
knee-flexion depth — the damper *amplifies* the very left/right difference it
appears neutral about.

```
production window, 129 frames        |R − L| knee minimum
  raw source (no damper)                     3.454
  KNEE 0.50 ref = frame 0  (SHIPPED)         7.223   <-- amplified x2.09
  KNEE 0.50 ref = per-leg extension          3.304   <-- candidate
  KNEE 0.50 ref = per-leg mean               4.215   <-- rejected, see below
```

---

## 1–2. Source provenance and SHA-256 — `STOPPED`

`SOURCE_CLASS = THIRD_PARTY_RETARGETED`. Full record in
`100STYLE_RETARGET_SOURCE_PROVENANCE.json`.

**MEASURED FACT — the BVH is deliberately not in the git repository.** The
repo's own `.gitignore` (HTTP 200) lists `bvh/*`, `fbx/*`, `fbx.zip`, `bvh.zip`.
No `raw.githubusercontent.com` path can serve it *by the author's design* —
this is not a path I failed to guess.

**MEASURED FACT — the only declared download host is blocked.**
`theorangeduck.com` and `www.theorangeduck.com`: `connect_rejected` 403 at
15:49:54Z. Control `raw.githubusercontent.com` → **200** in the same batch.

Other routes checked and closed: `codeload.github.com` 403 (and excluded by
`.gitignore` anyway); git-LFS 404 with no `.gitattributes`, so the repo uses no
LFS; release assets undiscoverable without `api.github.com`, which is 403.

The repo's licence evidence *was* retrievable and is recorded: `LICENSE.txt`
HTTP 200, 18,650 bytes, sha256 `7e7170e3…`, "Attribution 4.0 International",
with the Mason/Starke/Komura citation. That establishes terms, not a file.

**§2 HARD PROVENANCE RULE met — STOP.** No substitute was used. Refused: ONIQ
fixtures, generated/reconstructed BVH, FBX conversion, Geno.fbx, unknown mirrors.

`SOURCE SHA-256`, `file size`, `hierarchy`, `joint names`, `channel order`,
`rotation order`, `rest pose`, `axis convention`, `frame count`, `frame time` —
all **UNRESOLVED**. None invented.

## 3. Baseline captured before anything ran

`4881811b`, working tree clean. Driver 0.50 / "6 rotation channels on LeftLeg +
RightLeg" / bilateral. `generation_allowed=false`. `productionEligible` 0/1000.
Determinism `PER_HOST / PER_CPU_CLASS`. **All unchanged at the end.**

## 4–6. Adapter, round-trip — `NOT_APPLICABLE`

No external file arrived, so no adapter was built and no round-trip was run.
Building one would have produced an unvalidatable component and an unverifiable
mapping. **Not manufactured.**

## §12 cause-ordering, run against the source ONIQ has

`KNEE_CAUSE_ORDERING.json`. The directive ranks representation causes *above*
motion correction; all were tested first.

| # | cause | verdict | evidence |
|---|---|---|---|
| 1 | joint mapping | `NOT_THE_CAUSE` | both leg chains present, identically parented under mirrored parents |
| 2 | rotation order | `NOT_THE_CAUSE` | identical Euler order on both sides |
| 3 | axis / sign | `NOT_THE_CAUSE` | rest skeleton mirrors exactly in X, worst error 0.000000 |
| 4 | rest pose | `MOTION_NOT_REST_POSE` | frame 0 already differs — expected in a walk; the difference lives in the motion |
| 5 | coordinate conversion | `NOT_APPLICABLE` | one BVH space; this check only goes live when an external source is adapted |
| 6 | driver interpretation | `CONTRACT_CLEAN` **but see below** | the damper touches only `LeftLeg`/`RightLeg`; everything else bit-identical |

Causes 1–5 excluded. **Cause 6 is where the finding is** — the driver's
*contract* is clean, but its *reference choice* is not phase-neutral.

## A correction to the earlier classification

**MEASURED FACT — the asymmetry's direction is window-dependent.**

```
raw source, FULL 779 frames    L min 100.070   R min 105.018   -> LEFT is deeper
raw source, WINDOW 0-128       L min 115.738   R min 112.284   -> RIGHT is deeper
```

"Right-knee-deeper-flexion" is a property of the **129-frame production window**,
not of the source motion as a whole. Earlier reports classified it as a
source-BVH finding evidenced on one source; it is narrower than that — a
**window** finding on one source. Pinned by `t14`.

## 8. Conditions run

| condition | what varied | result |
|---|---|---|
| **A** raw source, no driver | — | `|R−L|` 3.454; 4L/5R frames < 120° |
| **B** ref = frame 0 (**the shipped damper**) | control | `|R−L|` 7.223; **0** frames < 120° |
| **C** ref = per-leg extension | reference pose only | `|R−L|` 3.304; **0** frames < 120° |
| **D** ref = per-leg mean | reference pose only | `|R−L|` 4.215; **0** frames < 120° |

Exactly **one** variable changed: the reference pose. Scale, channel count,
joints and layer held constant; no clamp, smoothing, foot pinning, retiming or
amplitude correction.

**Harness fidelity (MEASURED FACT):** condition B is **byte-identical** to the
shipped `b3_knee_damp.py` output — sha256 `ea15d921…` from both. The control
*is* production.

**Out-of-window generalisation** (refs chosen inside the 129-frame window,
measured over all 779): frame 0 → `|R−L|` 3.022; extension → **0.896**; mean →
0.014. All three still remove over-curl completely.

## 9–11. Candidate assessment against §15

| criterion | ref = extension | ref = mean |
|---|---|---|
| 1 right-knee over-curl decreases | **PASS** 140.008 → **144.645** | **FAIL** → 135.809, *more* bent than control |
| 2 left leg no regression | **PASS** 147.231 → 147.950 | 147.231 → 140.024 |
| 3 foot contact | **PASS** — stance plateau identical | PASS |
| 4 gait timing | **PASS** frame count + frame time identical | PASS |
| 5 root | **PASS** Hips max diff 0.000000 | PASS |
| 6 hip | **PASS** `*UpLeg` channels bit-identical | PASS |
| 7 ankle | **PASS** channels bit-identical | PASS |
| 8 deterministic | **PASS** identical sha256 across runs | PASS |
| 9 explainable | **PASS** phase-asymmetric reference | PASS |
| 10 nothing unrelated | **PASS** only the 6 knee channels differ | PASS |

**`mean` is rejected on criterion 1**, and the reason is recorded rather than
buried: it symmetrises by bending the *right* knee further, not by improving it.
`t07` pins that reason, so if it ever stops being true the rejection gets
revisited.

**A self-correction worth stating.** My first reading of the foot data used
`argmin` of foot height and showed the right-foot contact moving 9 frames under
`extension`. That was an artifact: the stance minimum is **flat — 41 frames
within 2% of the minimum** — and the *plateau* (frames 0–40) is identical across
all three damped conditions. Compared on the plateau, foot contact is preserved.
`t09` now pins the plateau comparison so the argmin trap cannot recur.

## 10. Pixel diagnostics

`KNEE_REFERENCE_PIXELS.json` + `KNEE_REFERENCE_PIXELS.png`. Frames **fixed from
the motion measurement before any pixel was inspected** — f0 (start pose), f27
(stance), f101 (right-knee minimum), f126 (left-knee minimum). Identical
methodology for all four conditions; GIF entries expanded by duration first,
because PIL collapses identical frames.

**RENDER FINDING.** At f101 the raw source shows the classic over-curl — the
trailing leg sharply folded, foot kicked up behind. All three damped conditions
remove it. `extension` is visually indistinguishable from the shipped damper at
f0 and f27 (IoU vs raw 0.9617 at f0), and shows a slightly straighter trailing
leg at f101. `mean` is visibly different at f0 — a wider, more bent stance
(IoU 0.9236) — which is the pixel expression of its 7°/4° frame-0 offset.
No condition touches the render border. `two_leg_fraction` reported as
**DIAGNOSTIC ONLY**, never as a gate.

## 11. Regression test

`test_knee_reference_regression.py` — **18 tests, all green.** They pin the
**mechanism**, not a pixel: `t01` asserts the shipped frame-0 damper *amplifies*
the asymmetry by >1.8×; `t02` asserts frame 0 really is phase-asymmetric (>5°
between legs, minima >10 frames apart); `t03`/`t04` assert the candidate does not
amplify and beats control by >40%; `t05` that over-curl removal is not traded
away; `t09` the plateau comparison; `t11` that the control is byte-identical to
production; `t12` that production is unmodified; `t14` the window dependence.
**No existing test was weakened.**

## 12–14. Selected fix, why it works, remaining uncertainty

**`CANDIDATE_FIX` = reference the 0.50 knee damper to each leg's own
maximum-extension frame instead of the shared frame 0.**
**`CAUSE` = phase-asymmetric reference against antiphase legs.**
`RIGHT_KNEE = IMPROVED` (140.008 → 144.645) ·
`LEFT_KNEE = NO_REGRESSION` (147.231 → 147.950) ·
`GAIT = PRESERVED` · `FOOT_CONTACT = PRESERVED` · `ROOT = PRESERVED` ·
`DETERMINISM = PASS`.

**Remaining uncertainty — stated, not hidden:**

1. **One source motion.** Everything here is measured on `zombie.bvh`. Whether
   the mechanism generalises is exactly the question the blocked external-source
   experiment exists to answer. `OPEN`.
2. **One character rendered.** The BVH-domain result is character-independent by
   construction, but the pixel check is `m3_suit_woman` only.
3. **The extension reference is itself motion-derived** — it is chosen from the
   clip, so a clip with no clean extension frame is untested.
4. **Window dependence** (above) means the *sign* of the raw asymmetry is not a
   stable property of the source. The fix targets the damper's *amplification*,
   which is stable; the underlying raw asymmetry is not.

## 15–17. Statuses

- `100STYLE_PRISTINE_SOURCE = UNTESTED`
- `THIRD_PARTY_EXTERNAL_SOURCE_REPRODUCTION = UNTESTED` — the file was never obtained
- `RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN` (unchanged; **not** promoted)
- `SOURCE-BVH FINDING` — narrowed: right-deeper is a **window** property
- `ADAPTER FINDING` — **NONE, UNTESTED**
- `DRIVER FINDING` — **PRESENT and measured**: the frame-0 reference amplifies
  the L/R asymmetry ×2.09 in the production window
- `POTENTIALLY-GENERALIZED` — **UNTESTED**
- **Production: UNCHANGED.** `generation_allowed=false` · `productionEligible`
  0/1000 · `two_leg_fraction = DIAGNOSTIC_ONLY` · driver 0.50 / 6 / bilateral ·
  `b3_knee_damp.py` byte-unmodified · no merge · no deploy.

## 18–21. Tests, git, cost, images

**198 tests green, 0 failed** across 11 suites (**+18 new**). `tsc` clean ·
`lint:ci` clean. Branch `claude/engineering-library-driven-walk`; PR #86
untouched (`574d2d8f`); val-charlib untouched (`db94fdac`).

**₹0 API · ₹0 GPU · 0 BVH downloaded · 0 new character images.** Four CPU
renders, ~49 s total wall.

## Artifacts created

`100STYLE_RETARGET_SOURCE_PROVENANCE.json` · `KNEE_CAUSE_ORDERING.json` ·
`KNEE_REFERENCE_EXPERIMENT.json` · `KNEE_REFERENCE_PIXELS.json` ·
`KNEE_REFERENCE_PIXELS.png` · `knee050_ref_{frame0,extension,mean}.bvh` ·
`render_{raw,frame0,extension,mean}.gif` · `knee_cause_ordering.py` ·
`knee_reference_experiment.py` · `knee_reference_pixels.py` ·
`test_knee_reference_regression.py` · this report.

**Production stays locked pending your decision.** The candidate is measured,
regression-tested and reproducible; what it is *not* is validated against a
second motion source.
