# KNEE_ASYMMETRY_ANALYSIS

## Classification: **DRIVER_GENERALIZED_ASYMMETRY** — but the multi-character test could not have shown otherwise

### The measurement

| clip | LEFT min | RIGHT min | LEFT mean | RIGHT mean | R−L mean |
|---|---|---|---|---|---|
| control (undamped) | 115.74° @ f126 | 112.28° @ f101 | 169.01° | 156.22° | **−12.79°** |
| corrected (knee 0.50) | 147.23° @ f126 | 140.01° @ f101 | 173.91° | 161.98° | **−11.93°** |

The right knee flexes deeper and carries a lower mean in both clips. Damping
narrows the gap slightly (−12.79° → −11.93°) but does not remove it.

### Why this is DRIVER_GENERALIZED, and the honest caveat

All four characters were driven by the **same BVH file**. The knee interior
angle is computed by forward kinematics from that BVH, so the BVH-domain
statistics are **identical across every character by construction** — measured
and confirmed: all four report L min 115.74 / R min 112.28 (control) and
147.23 / 140.01 (corrected), to 4 dp.

That makes the classification `DRIVER_GENERALIZED_ASYMMETRY` **structurally
true and empirically confirmed**, with a caveat that must not be dropped:

> **The multi-character experiment cannot independently test BVH-domain
> asymmetry.** Adding characters adds no evidence about the angles, because the
> angles do not depend on the character. Four identical numbers are a
> consistency check, not four independent confirmations.

To test whether the asymmetry is a property of *this* driver or of ONIQ's
walking in general, a **different source BVH** would be needed. That is the real
next experiment, and it was not run.

### What is NOT claimed

- Not a biological or anatomical rule.
- Not a property of characters.
- Not a production constraint. `productionEligible` remains 0.
- Not evidence that any other walk driver is asymmetric.

### What the characters DID test: the pixel manifestation

Character-dependent, and materially so:

| character | two-leg fraction min (ctrl → corr) | min leg gap | max-crossing frame | border-contact frames |
|---|---|---|---|---|
| m3_suit_woman | 0.102 → 0.095 | 2 px | 52 | 0 |
| b4_child_girl (bare legs) | 0.198 → 0.197 | 2 px | 67 → 69 | 0 |
| b4_heavy_man (wide trousers) | **0.000 → 0.016** | 0 → 2 px | 117 → 112 | **4** |
| b4_tall_man | 0.129 → 0.129 | 2 px | 52 → 51 | 0 |

Classification of the pixel manifestation: **CHARACTER_SPECIFIC**.

### Two metric findings that matter more than the asymmetry

1. **`two_leg_fraction` is confounded by garment width and is not a valid
   cross-character defect metric.** `b4_heavy_man` scores 0.000 — the worst
   possible — purely because wide dark trousers never show a gap between the
   legs. The pixels show both boots distinct and correctly shaped, no smear, no
   tear. Using this metric as a gate would fail a perfectly good render.
2. **The render envelope is per-character.** The 129-frame window was measured
   from `m3_suit_woman`'s no-border-contact envelope. `b4_heavy_man` contacts
   the border on 4 frames in the same window. The envelope must be measured per
   character, not inherited.

### Phase H — the accepted knee result still holds

Re-verified on pixels for all four characters: control shows the deep knee fold
(right leg at f101, left at f126); corrected reads as a straight natural swing.
The existing acceptance is not weakened. `b4_child_girl` is bare-legged and
showed **no thin-shin crossing warp**, which is a useful negative result for
that open class — though one character is not a fixture, and the class stays
OPEN.

### Phase I — crossing

All four: `LEGITIMATE_PASSING_PHASE_OCCLUSION`. Feet distinct, no smear, no
backward bend, no warp, no mesh tear in every case. High silhouette overlap
alone was **not** treated as crossing-warp.
