# ENGINEERING GATE MAPPING (authoritative copy: src/lib/engineeringReference.ts GATE_MAPPING, pinned by test)

PRE_RENDER_GATE: silhouette fill, border contact, connected components,
core-joint containment, landmark confidence, camera lane.
POST_RENDER_GATE: temporal aliveness (≥0.75), pixel review, identity
preservation, geometry integrity, foot contact.
DIAGNOSTIC_ONLY: interior-hole metrics (measured: size alone not
predictive), limb-width map.
REFERENCE_ONLY (never a gate): proportion table, DOF/rotation limits, knee
angle-phase curve, foot-contact cm thresholds, texture deformation budget,
temporal px thresholds, character-environment contact.
STRESS_TEST: thin solid limb, thin ink stroke, bare thin shin, clothing
topology risk, hair topology risk.

Every rejection resolves fail-closed to STILL_PARALLAX with a structured
MOTION_CONTRACT reason (11 enumerated reasons). No gate was added,
weakened, or retuned by this integration.
