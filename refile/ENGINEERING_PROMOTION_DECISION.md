# ENGINEERING_PROMOTION_DECISION

## Decision: **PROMOTE NOTHING.** `PRODUCTION_ELIGIBLE = 0`.

Outcome **A** from the loop's own list: the LEFT/RIGHT measurement method is
validated, and the asymmetry is a property of the driver rather than of
characters — with the caveat that the multi-character test could not have
tested it independently (see `KNEE_ASYMMETRY_ANALYSIS.md`).

## What was established

| finding | status |
|---|---|
| The engine distinguishes LEFT from RIGHT knee | **VALIDATED** — distinct landmarks, alternating per-frame minima, swap-test pinned |
| The library's `knee_peak_L/R` labels are INVERTED | **MEASURED** — 140.0° is the RIGHT knee, 147.2° the LEFT |
| Right knee flexes deeper than left under this driver | **MEASURED**, driver-generalized by construction |
| Over-curl removed by knee damping 0.50 | **RE-VERIFIED on pixels, 4/4 characters** |
| Crossing is legitimate occlusion | **RE-CONFIRMED, 4/4 characters** |
| `two_leg_fraction` is garment-confounded | **NEW — blocks it from ever being a cross-character gate** |
| Render envelope is per-character | **NEW — the 129-frame window does not transfer** |

## Why nothing is promoted

1. Promotion needs an owner decision; none has been given.
2. The asymmetry has been tested against exactly **one** source BVH. Whether it
   is a property of ONIQ walking or only of this zombie driver is untested.
3. The two new metric findings say the current pixel metrics are not yet safe as
   gates — `two_leg_fraction` would fail a good render, and an inherited
   envelope would pass a bad one.
4. `SCALE_BRIDGE = NOT_AVAILABLE`, so 697 records remain unvalidatable.

## The driver is untouched

Knee damping **0.50**, six rotation channels, both knees symmetric, source-BVH
layer. No joint clamp, no Euler clamp, no hip/ankle/root/timing/mesh/ARAP/
segmentation change. This loop studied measurement and generalization; it did
not redesign the driver.

## What would justify a future promotion

- Run the same control/corrected pair on a **different source BVH** to test
  whether the asymmetry is driver-specific. CPU-only, ₹0.
- Measure the no-border-contact envelope **per character** before using any
  frame window across the library.
- Replace `two_leg_fraction` with a garment-independent leg-separation metric,
  or scope it per character.
- One authorized physical dimension, to unblock the 697 mm records.

Each is an owner decision, not an engineering default.
