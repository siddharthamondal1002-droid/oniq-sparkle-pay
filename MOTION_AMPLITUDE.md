# MOTION_AMPLITUDE — the arm-amplitude experiment (zero-GPU loop, Phase 12)

2026-08-22, in-container CPU experiment on main `b96fd848`. This record
extends `MOTION_ARM_TORSO.md` (mesh-topology analysis) and
`part_aware_mask_reference.py` (part-aware mask: EVALUATED, DID NOT FIX)
with the first intervention that actually eliminated the ARAP claw/blade
artifact in rendered pixels.

## Hypothesis

The Phase-8 claw/blade artifact (`ARAP_LIMIT`) is driven by arm-swing
AMPLITUDE: the FAIR zombie-walk BVH sweeps the arm bones across the torso
region, and because Animated Drawings builds ONE mesh for the whole
character (~24px grid, largest-polygon-only — see MOTION_ARM_TORSO.md),
large arm excursions drag torso/sleeve geometry into spikes. If amplitude
is the driver, reducing it should remove the artifact without touching
mesh, masks, or the renderer.

## Method (one variable)

Fixture: Aladdin front pose (left half of `remotion/public/sheets/aladdin.jpg`,
sheet sha256 first16 `5a1c3529fa88fcbd`), u2netp cutout, hand-pinned
16-joint `char_cfg.yaml`, 518x1207. Driver: FAIR `zombie.bvh` via
`remotion/scripts/l3_animate_reference.py` (OSMesa headless, numpy 1.26.4).

Two renders, identical except the retarget config:

- **baseline** — stock `fair1_ppf.yaml`: elbows/hands driven by the BVH
  arm bones (`Arm→ForeArm`, `ForeArm→Hand`). 77.5s / 200 frames / 1169MB RSS.
- **arm-damped v2** — elbows/hands driven by the DOWNWARD trunk vector
  `(Spine3, Hips)`, i.e. arm amplitude → 0, arms hang and sway only with
  trunk lean. Legs/torso/neck mappings untouched. 75.5s / 1168MB RSS.

Failed first attempt, recorded so nobody repeats it: `(Hips, Spine3)` —
the UPWARD trunk vector — points both arm bones up the trunk and folds
the character over with a giant vertical blade. Tuple order is
(from-joint, to-joint); the driving vector must point the way the limb
should hang.

## Measured result (real decoded pixels, frames f40–f140)

| | baseline | arm-damped v2 |
|---|---|---|
| claw/blade artifact | 4 of 5 inspected frames | **0 of 5** |
| gait (legs alternate, stride) | yes | yes (f100/f120 feet crossing) |
| inter-frame mean abs dLuma, f30–f150 (192x342 gray) | 8.88 | 7.52 |

Aliveness 7.52 is ~85% of baseline and ~10x the production
`CLIP_ALIVENESS_MIN` (0.75) — the damped clip is unambiguously alive,
and every inspected frame is silhouette-clean.

## Verdict

**AMPLITUDE CONFIRMED as the artifact driver; hang-down arms is the
first zero-artifact CPU walk this program has produced.** Cost: ~76s and
~1.2GB RSS per 200-frame 500x500 clip, GPU 0, API spend 0.

Limits, stated plainly:

- Arms are passive (no swing). Storybook-puppet motion, not full acting.
  Intermediate amplitude (e.g. 50%) is NOT expressible in the retarget
  mapping — it is binary per-bone; partial swing needs BVH rotation
  scaling, an untried follow-up.
- Proven on one hand-rigged character. Auto-rig generalization is the
  separate 2/3 end-to-end result in `MOTION_GENERALIZATION.md`.
- Same frontal/full-body/unoccluded/single-subject envelope as
  `l3_animate_reference.py`.

The exact retarget variant is `remotion/scripts/retarget_armdamped_reference.yaml`
(derivation: stock MIT `fair1_ppf.yaml` with the four elbow/hand tuples
remapped to `(Spine3, Hips)` — 8 changed lines). No weights, driver
media, or rendered frames are committed (working agreement).
