# ONIQ CHARACTER-MOTION MASTER STANDARD — reconciliation record (2026-08-23)

Owner directive: the two uploaded ONIQ reference guides are the visual
acceptance specification for all zero-GPU character-motion work; the
previously generated anatomical models are the structural reference
library; measured ONIQ evidence governs engineering constraints; the
repository is the implementation detail. This file reconciles all four,
panel by panel, and records the current decision state.

## Registered references (refs/ on this branch)

| file | sha256 (first 16) | role |
|---|---|---|
| oniq_motion_guide_dark.png | a7497e3bd243d2f8 | acceptance standard |
| oniq_motion_guide_light.png | 378d4c07daac9eec | acceptance standard |
| anatomical_tpose_3view.jpg | (per MANIFEST.sha256) | structural: proportions, joints |
| stylized_turnaround_4view.jpg (+dup) | " | structural: frontal/turn construction |
| ad_skeleton_15joint_mapping.jpg | " | structural: AD 15-joint rig mapping |
| ad_rig_bone_hierarchy.jpg | " | structural: bone hierarchy |
| walk_cycle_frame_strips.jpg | " | structural: gait phases |
| walk_cycle_figure_dynamics.jpg | " | structural: weight shift / dynamics |

Prior poster (sha16 2ae1783955f44a70, 2026-08-22) remains superseded-by/
consistent-with these two; docs/CPU_MOTION_VISUAL_SPEC.md (parked branch
457598ad) already encodes it. 457598ad is NOT modified by this record
(causal attribution preserved: Batch-2 validated that branch as-is).

## Panel-by-panel reconciliation (poster → ONIQ enforcement)

### §1 Input reference — AGREES, enforced
Clean cutout, full/near-full body, frontal, minimal occlusion → detector
must fire + dual-mask selection + 24 px padded crop + border-contact
rejection. Measured: side/back views fail detection (morgiana_side, ep4s02).

### §2 Target motion (WALK primary) — AGREES, measured
Natural gait/weight shift → 11 corpus characters pixel-passed. Natural arm
hang via downward trunk vector → the arm-damped retarget (0/5 artifact
frames vs stock 4/5). Stable identity → structural (ARAP warps source
texture; no generative path). Temporal consistency → aliveness ≥ 0.75.
NEW since Batch 3: the walk's trailing-leg knee excursion is the source
zombie BVH's own (67° at f100, 74° peak); the accepted experimental fix is
knee damping ×0.50 (see decision record below).

### §3 Negative catalogue — AGREES, each mapped
claw/blade/spike → killed by arm-damped retarget (pixel review remains the
recurrence backstop). merged blob / edge-on sliver → border-cut root cause
fixed by padding; l3RenderQc fill ≥ 4% backstop. missing limbs → largest-
component mask. identity drift → structurally impossible. foot slide/float
→ foot-line range ≤ 15% bound (fine-grained per-step check UNKNOWN).
thin-limb merge (urchin class) → NOT fixed by knee damping; remains
STRESS_TEST pending a mesh-density experiment (owner §10).

### §4 Pre-render gates — AGREES with ONE measured divergence
- 4.1 fill ratio: poster says ≤ 65% good / > 65% bad. MEASURED EVIDENCE
  GOVERNS (owner §1: do not replace measured evidence): generalization-v2
  falsified 65% as a collapse mechanism — mother 74.8% and princess 77.6%
  walk cleanly once crops are padded; all v1 "high-fill" collapses were
  border-cut masks. Enforced rule: fill ≤ 90% (degenerate-segmentation
  ceiling only) + mask must not touch the crop border. This stands.
- 4.2 core joints on silhouette: ENFORCED (shoulder/hip/knee/foot on
  best-of-dual-mask) + kpt_conf_mean ≥ 0.70.
- 4.3 connected components: input side ENFORCED (largest-component mask).
- 4.4/4.5 limb/torso visibility: enforced implicitly (detector + core
  joints + conf); no separate explicit gate — adequate on evidence so far.
- 4.6 segmentation quality: dual-mask selection; clean-mask criteria.
- INELIGIBLE → still/parallax fallback with MOTION_CONTRACT reason:
  ENFORCED (fail-closed provider).

### §5 Post-render gates — AGREES; two explicit UNKNOWNs remain
- 5.1 temporal aliveness ≥ 0.75: the production metric — matches exactly.
  Measured necessary-never-sufficient (collapses scored 3.6–12.1): pixel
  review stays mandatory for anything user-facing.
- 5.2 silhouette-fill consistency over time: PARTIAL — fill floor ≥ 4% is
  enforced per-clip; a fill-FLUCTUATION metric is an open follow-up.
- 5.3 geometry integrity: pixel review + fill/foot-line bounds; automated
  spike/tear detector UNKNOWN (open follow-up).
- 5.4 foot contact: foot-line range proxy (≤ 15%); per-step contact
  analysis UNKNOWN.
- 5.5 identity consistency: structural.
- 5.6 determinism: PROVEN — identical SHA-256 across independent renders;
  frozen fixtures re-verified hash-identical after every experiment.

### §6 Motion grammar priority — AGREES exactly
WALKING (primary, PASS) → IDLE (secondary, PASS at s=0.25; s=0.10
falsified 0.43) → TURN (UNKNOWN, no MIT driver) → WAVE (FALSIFIED — 0.51 +
sleeve blade, excluded) → REACH (UNKNOWN). Grammar carries only
pixel-passed motions. No secondary grammar is promoted ahead of WALKING.

### §7 Technical constraints — AGREES exactly
CPU-only (22–88 s / ~1.2 GB per clip), no model weights in git, no API
spend (₹0 across all loops), deterministic, safe fallback.

### §8/§9 Fallback + success definition — AGREES
Fail closed → still/parallax fallback → MOTION_CONTRACT records reason.
Judged by real decoded pixels, never assumptions.

## Current decision record (Batch 3, owner-ratified)

- ROOT CAUSE of the f100 trailing-leg curl: SOURCE BVH. Not ARAP, not
  mesh, not segmentation, not retarget mapping (mappings B/C/D proven
  identity-equivalent, ≤1.3e-4 reconstruction error), not projection
  (0 sign inversions).
- ACCEPTED EXPERIMENTAL FIX: KNEE DAMPING ×0.50, both knees symmetric,
  6 knee rotation channels only, wrap-safe toward frame 0; hips, ankles,
  feet, root translation, timing untouched. Measured: f100 67.0°→40.1°,
  peak 74.4°→43.8°, max transition 12.5→6.3°/frame; hip/thigh/root curves
  bit-identical to control; stride width Δ ≤ 0.6%; aliveness 7.21/8.81;
  clean pixels both characters; urchin class unchanged.
- PRODUCTION STATUS: NOT ADOPTED. Proposed change (pending explicit owner
  approval): promote bvh_knee_damp_reference.py + point
  ARAP_MOTION_GRAMMAR.WALKING at derived://...scale=0.5 + pinning test.
  Adoption changes walk pixels of ALL ARAP characters → the affected
  frozen fixture hashes must be deliberately re-baselined in the same
  change, after decoded-pixel review of every affected fixture (rerun,
  compare, verify knee improvement / no new artifacts / identity / foot
  contact / aliveness / determinism, then document why each hash moved).
  Changed hashes are neither "regression" nor "acceptable" automatically.
- STANDING HOLDS: PR #83 untouched; 457598ad parked (merge recommendation
  stands, separately); no auto-merge/deploy; no Veo; no library scaling;
  Batch-1 controls immutable; urchin stays STRESS_TEST.

## Generation rule going forward

New character references are generated from: these two guides (acceptance)
+ the anatomy library (structure), producing full-body frontal neutral
cleanly-segmentable rig-friendly deformation-safe characters, free of the
§3 negative catalogue, with no fixed ethnicity/nationality/occupation/
location/identity imposed by the references. Every motion experiment is
judged against the guides on decoded real pixels.
