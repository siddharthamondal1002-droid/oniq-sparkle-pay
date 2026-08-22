# Arm/torso separation — L3 quality experiment (Phase 8)

**The question:** can a CPU-only, ₹0 **part-aware mask** fix the Phase-7 arm-claw
artifact (arm over-stretch on a real ONIQ still) so L3 walks without tearing?
**Answer: NO. The part-aware mask does not fix it.** The arm tear is an
**ARAP_LIMIT**, not the arm/torso silhouette merge that Phase 7 hypothesised.
Same character, same driver, A/B measured. **GPU=0, API cost ₹0.**

## Setup (unchanged from Phase 7)

- Still: `remotion/public/sheets/aladdin.jpg` (front pose) — the exact Phase-7 input.
- Driver: `zombie.bvh` — the exact Phase-7 walk driver.
- A = Phase-7 baseline (U²-Net mask). B = part-aware carved mask. Same rig
  (skeleton), same render path; only the mask changed.

## Experiment A — part-aware mask (built, CPU, ₹0)

`remotion/scripts/part_aware_mask_reference.py` carves a thin separation seam
between each arm bone-chain (shoulder→elbow→hand) and the torso axis in the
U²-Net foreground, leaving the shoulder attached so the arm becomes a hinged
flap. **Safety:** it only REMOVES a thin internal line (never adds pixels, never
invents an arm) and is **fail-closed** — if an arm can't be located in the
foreground it returns `PART_MASK_UNCERTAIN` and the shot escalates. On this still
both arms were cleanly detected (bone-in-foreground 1.0 / 0.99), merged with the
torso (merge fraction 1.0 / 0.84), and carved; the result stayed one connected
component (no limb dropped). The carve was verified correct by eye (seam runs
between arm and torso, torso/head/legs untouched).

## A/B result — the carve does nothing

| Comparison | Pixel diff (mean abs, 0–255) | Claw |
|---|---|---|
| A vs B (part-mask, 3px seam) | **0.004** | unchanged |
| A vs C (part-mask, wide 22px seam) | **0.007** | unchanged |
| A vs D (diagnostic: 4× denser ARAP mesh, 40→110 grid) | 4.0 | **still present** |

**Why the mask can't help:** Animated Drawings builds ONE mesh from a single
contour plus a coarse **40×40 interior grid** (~24 px spacing on this character)
and **discards all but the largest polygon**. A seam finer than the mesh is
bridged; a seam wide enough to disconnect would make AD drop the arm. Even a
4×-denser mesh (much slower — 56.8s and 2.1 GB vs 15s and 0.66 GB) did not remove
the claw. The claw is present even at frame 0. Root cause: the `zombie.bvh` walk
poses the arms in a forward reach that **2D ARAP cannot foreshorten** on a
detailed character — the arm mesh stretches into a claw regardless of silhouette
separation or mesh density. This is intrinsic to the 2D-puppet method.

## Classification: **ARAP_LIMIT**

- **SEGMENTATION_LIMIT?** No — the U²-Net mask is clean and complete (Phase 7).
- **POSE_LIMIT?** No — the auto-rig skeleton is correct (Phase 7).
- **ARAP_LIMIT?** **Yes** — the 2D ARAP deform cannot represent out-of-plane arm
  motion; the part-aware mask and denser mesh both fail to fix it.

## Decision (per the "IF PART MASK FAILS" branch)

Do not keep tuning L3. Establish the production boundary:

- **L3** (CPU, ₹0): simple / frontal / unoccluded characters whose limbs stay
  roughly in-plane under the driver — Phase 6's char2/char3 class.
- **L4** (VACE diffusion, GPU, owner-gated): arm/torso articulation, detailed
  characters, and any shot whose driver moves a limb out of plane — the Aladdin
  case.

**Eligibility: UNCHANGED.** The Phase-7 `armsAgainstTorso` restriction in
`poseWarpEligible` **stays** (the part-aware mask did NOT earn its removal). A
shot flagged arms-flush is not L3-eligible and routes to L4; if L4 is
unavailable it falls back to the honest still+camera (L1), **never** a torn L3
clip. New regression tests pin this (19/19 pass):
`poseWarpEligible(armsAgainstTorso)` → not eligible → `selectMotionLevel` → L4,
and with no L4 → L1 (not a fake clip).

## The product rule holds

The system never silently ships ugly motion: low-confidence L3 → L4; L4
unavailable → still/depth path (labelled as such, never as character animation).
Phase 8 did **not** loosen any gate on a partial improvement — because there was
no improvement.

## StoryFilm

**NOT RUN for B.** The owner's rule was "run one StoryFilm shot only if B passes
visual inspection." B did not pass (claw unchanged), and Phase 7 already proved
the `probeAsset → shot.clip → 'story' → Remotion 1080×1920` path. Re-rendering an
unchanged clip would add nothing.

## Performance (measured)

| | Baseline (A) | Part-mask (B) | Dense-mesh (D, diagnostic) |
|---|---|---|---|
| Mask processing | — | + ~0.3 s (carve) | — |
| Animation render | 15.2 s | 14.6 s | 56.8 s |
| Peak RAM | 0.66 GB | 0.66 GB | 2.1 GB |

The part-mask adds negligible cost — but buys no quality, so it is not worth
enabling. The dense mesh costs ~4× and also fails.

## What was NOT touched

story-plot, story-still, story-voice, StoryFilm, Remotion, Veo, Wan/VACE, the
MotionProvider contract — all unchanged. The Animated Drawings mesh-density
change was a diagnostic on the scratchpad copy only and was reverted; nothing in
the repo's render path changed. Auth/RLS/money/payout/RazorpayX/OTP/WebRTC/P15/
API keys/story-callback untouched.

## Final report

```
BASELINE ARM:        FAIL (claw)
PART-AWARE ARM:      FAIL (claw unchanged; A/B pixel diff 0.004)
SHOULDER:            PASS (attached, both A and B)
HAND:                FAIL (stretched into the claw)
TORSO:               PASS
LEGS:                PASS
IDENTITY:            PASS
TEMPORAL STABILITY:  PASS_WITH_LIMITS (stable claw, no explosion)
NEW ARTIFACTS:       NONE (B introduced nothing new; it changed nothing)
CPU TIME:            baseline 15.2s vs part-mask 14.6s (+~0.3s carve) — parity
RAM:                 baseline 0.66GB vs part-mask 0.66GB — parity
PART-AWARE MASK:     FAILED (safe + fail-closed, but ineffective — ARAP_LIMIT)
L3 ELIGIBILITY:      UNCHANGED (arms-flush restriction kept)
STORYFILM:           NOT RUN (B did not pass; Phase 7 already proved the path)
L3 FINAL VERDICT:    PASS_WITH_LIMITS (unchanged from Phase 7)
L4 ESCALATION:       route to L4 when armsAgainstTorso OR any out-of-plane limb
                     motion under the driver; L4 unavailable → still+camera (L1),
                     never a torn L3 clip.
NEXT STEP:           benchmark ONE real L4 Wan2.1-VACE clip on this exact Aladdin
                     shot (owner-gated GPU/spend) to confirm L4 clears the claw,
                     then set the L3/L4 router threshold from that evidence.
```
