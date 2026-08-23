# ENGINEERING TAXONOMY — reconciliation (2026-08-23)

Comparison of the ENG-001/ENG-002 poster taxonomy against the existing ONIQ
anatomy/motion/scene taxonomy and shipped pipeline metrics.

ALREADY SUPPORTED (measured, shipped): silhouette fill %, border-contact
reject, connected components, core-joint-on-silhouette, kpt confidence mean
≥0.70, temporal aliveness ≥0.75, knee damping ×0.50 (BVH layer), mesh grid
30/40/60/80 (AD_MESH_GRID, experiment copy), interior-hole metrics
(diagnostic — measured NOT predictive), walking-cycle phases, frontal/
near-frontal camera lanes, PRODUCTION_READY/CONDITIONAL/STRESS_TEST/
GATE_REJECT classification, still/parallax fallback with MOTION_CONTRACT.

NEW CATEGORIES the posters add (registered, not previously in a taxonomy):
proportion measurement table, per-joint DOF/rotation-limit tables, landmark
quality schema (visibility/confidence/inside/occluded/estimated), foot-
contact physical thresholds (cm), texture deformation budget, temporal px
thresholds, clothing/hair topology risk tables, character-environment
contact, limb-width heat map. ALL registered REFERENCE_ONLY or
DIAGNOSTIC_ONLY — none has ONIQ measurement behind its numbers.

TERMINOLOGY CONFLICTS (measured value stands, recorded in code
DISCREPANCIES, pinned by test):
1. ENG-002 "Score ≥ 0.70" vs measured aliveness gate 0.75.
2. Width-only thin-limb classes vs measured solid-vs-ink-stroke distinction
   (+ the M3 bare-thin-shin subclass; grid80 measured null on it).
3. DOF/rotation-limit tables — illustrative; retarget uses projected BVH
   angles + knee damping only; no joint-limit clamp introduced.
4. cm-based foot-contact thresholds — pipeline has no physical calibration;
   pixel review stands.

DUPLICATED CATEGORIES (already covered by scene/anatomy libraries): camera
orientation, walk-cycle strip, negative-example concepts — cross-referenced,
not re-registered.
