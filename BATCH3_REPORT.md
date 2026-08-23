# CHARACTER LIBRARY — BATCH 3: KNEE-CHAIN DIAGNOSTIC REPORT (2026-08-23)

## Root-cause location (choose exactly one)

**SOURCE BVH.**

The pathological f100 curvature is the zombie walk's own knee excursion,
faithfully transplanted. Proof chain:

1. **TEST A (pre-ARAP skeleton).** A headless trace instrumented the full
   path (BVH → projection → retarget → driven skeleton → ARAP → mesh).
   At f100 the driven skeleton ALREADY forms the complete curl before any
   deformation: right-knee flexion 67.0°, shin swept near-horizontal. The
   ARAP mesh vertices hug that skeleton faithfully. ARAP is innocent.
2. **Retarget mapping is faithful.** At every traced frame the character's
   2D knee interior angle equals the source BVH's projected knee angle to
   0.01° (f100: 112.96° = 112.96°), for both legs and both characters —
   the driver is character-independent.
3. **Coordinate/projection is correct.** Bend SIGN matches the source at
   every frame; 0 sign inversions among deviations >5° across the whole
   rendered window (frames 0–185); Lower-Limbs PCA plane resolves to
   sagittal (z) in every variant. No mirroring, no accumulated rotation
   (max frame-to-frame change 12.5° — the walk cycle itself, no jumps).
4. **The §4 mapping alternatives are identity-equivalent.** The current
   config already maps hip→knee = UpLeg→Leg and knee→ankle = Leg→Foot
   (explicit anatomical chain), computes orientations from world-space
   projected bone vectors (never local Eulers), and preserves the target's
   own bone lengths. Reconstructing Mapping D by hand (project source
   chain, keep target segment lengths, solve knee) reproduces the actual
   rig joints to ≤1.3e-4 world units — rounding noise. There is no
   different skeleton any re-mapping could produce.

Per SS6: sign correct, magnitude excessive → knee-channel damping (SS8).

## Diagnostic evidence — f100 numerical state (identical for both characters)

| quantity | right (trailing) leg | left leg |
|---|---|---|
| source BVH hip (norm, rot-corrected) | (−0.087, 0.394, 0.083) | (−0.087, 0.394, −0.114) |
| source knee interior angle (sagittal proj) | 112.96°, sign −1 | 177.12°, sign +1 |
| char knee interior angle (driven skeleton) | 112.96°, sign −1 | 177.12°, sign +1 |
| char thigh orientation (deg CCW of +Y) | 193.48° | 180.61° |
| char shin orientation | 126.44° | 183.49° |
| knee deviation from straight | 67.0° | 2.9° |
| char bone lengths (basma / rashid) | thigh .159/.226, shin .177/.236 | same |

Full per-frame values (hip/knee/ankle positions, vectors, signed angles,
ARAP constraint coordinates) are in `batch3/trace_{basma,rashid}.json` and
the 186-frame `batch3/full_{ctl,075,050}.json`.

## Experiment matrix

| Candidate | Mapping | f100 knee dev | Skeleton | WALK | IDLE | Pixel verdict |
|---|---|---|---|---|---|---|
| Control | Current | 67.0° | curl present pre-ARAP | ACCEPT_WITH_LIMITS | PASS | Baseline |
| A | Explicit chain | 67.0° | ≡ Control (already explicit) | — | — | identity-equivalent, not re-rendered |
| B | World-space | 67.0° | ≡ Control (already world-space) | — | — | identity-equivalent, not re-rendered |
| C | Projected 2D | 67.0° | ≡ Control (err ≤1.3e-4) | — | — | identity-equivalent, not re-rendered |
| D1 | Knee damping ×0.75 (knees only) | 53.7° | improved, still swept | ALIVE 7.16/8.74 | untouched | better, still marginal |
| **D2** | **Knee damping ×0.50 (knees only)** | **40.1°** | **in anatomical corridor** | **ALIVE 7.21/8.81** | **untouched** | **PASS — curl eliminated** |

Damping construction (`b3_knee_damp.py`): ONLY the 6 rotation channels of
the two BVH knee joints (RightLeg, LeftLeg) scaled toward frame 0,
wrap-safe. Hip, ankle, foot, toe, root translation, frame count and
timing untouched. Recorded deviation from SS8's literal "trailing-leg
knee channel": both knees damped symmetrically, because the trailing role
alternates legs mid-cycle and one-sided damping would break gait symmetry.

**SS9 temporal check (186-frame window, measured):** hip positions, thigh
orientations and root trajectory are IDENTICAL to control (max diff
0.000) at both damping levels — stride drive and contact timing preserved
by construction and confirmed by measurement. Foot-x range (stride width)
changes ≤0.6%. Max knee frame-to-frame jump DROPS 12.5°→6.3° (smoother,
no pop). 0 bend-sign changes. Peak knee deviation across the cycle:
74.4°→43.8° (right), 64.9°→33.5° (left).

**SS10 pixel acceptance (k050, both characters):** f100 curl gone —
trailing leg reads as a natural step; 9-frame ladders (contact, passing,
early/mid/late swing, extremes, return) natural throughout; no knee pop,
no skating, no spikes/claws/tears/merged or detached limbs; identity
structurally stable (texture warp — faces/clothing are the source pixels);
segmentation unchanged (same rig, mask, no border). IDLE untouched (the
IDLE driver derives independently and was not modified). Aliveness: basma
7.21, rashid 8.81 (control 7.09/8.63) — ALIVE with margin.

**SS11 three-way (f100, identical crops):** CTL | ×0.75 | ×0.50 montage;
CTL-vs-k050 changed pixels 1,755 (basma) and 2,258 (rashid) of 176,400 —
a real anatomical change (foot-pin, for contrast, moved ≤15), and the
defect is visibly gone, so the diff is diagnostic AND the anatomy passes.

**SS12 urchin stress regression (k050):** thin-limb merge REMAINS (legs
still fuse into one strand — that defect is ARAP-mesh-pitch-related, not
motion-related), sweep milder, no new artifact. Classification unchanged:
STRESS_TEST.

## Regression

- Basma / Rashid / Urchin Batch-1 controls: all 9 SHA-256 byte-identical.
- Frozen fixtures: regression.sh 3/3 hash-identical (aladdin_hand,
  aladdin_auto, morgiana) — the shipped pipeline is untouched.
- Provider tests 23/23, `npx tsc --noEmit` clean, `lint:ci` clean, on the
  unmodified parked branch 457598ad (SS15: this experiment lives entirely
  in scratchpad + this evidence branch; nothing mixed into 457598ad).

## Cost

Lovable credits: 0. GPU: ₹0. API: ₹0. Generation count: 0 (no character
was generated or altered). Compute: 5 CPU renders (~4.5 min) + traces.

## Decision

**WIN — KNEE DAMPING** (×0.50, knees only), on top of root cause SOURCE
BVH. All 11 SS13 criteria pass for k050.

## Engineering recommendation (SS14 — not implemented)

The winning candidate lives entirely in the motion-driver layer — a
derived BVH, exactly like the accepted IDLE driver. The narrowly scoped
production-safe change would be:

1. add `bvh_knee_damp_reference.py` (the b3 script, promoted) beside
   `bvh_idle_reference.py`;
2. point `ARAP_MOTION_GRAMMAR.WALKING` at
   `derived://bvh_knee_damp_reference.py?src=examples/bvh/fair1/zombie.bvh&scale=0.5&joints=RightLeg,LeftLeg`;
3. one provider test pinning the derivation string.

No retarget-config, ARAP, mesh, or solver change is needed or proposed.
NOT implemented in this loop (SS0/SS17): awaiting explicit owner approval,
separately from (a) merging 457598ad, (b) cast adoption, (c) library
scaling. Note: adopting the damped WALKING driver would change the walk
pixels of ALL ARAP characters (including the frozen aladdin/morgiana
fixture hashes), so its adoption must re-baseline the regression fixtures
in the same change — flagged now so it is a decision, not a surprise.
