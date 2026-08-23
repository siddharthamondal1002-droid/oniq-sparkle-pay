# ENGINEERING → VIDEO GENERATOR MAPPING (2026-08-23)

Pipeline slot: REFERENCE → ANALYSIS → CHARACTER PROFILE → ELIGIBILITY →
MOTION CONFIG → RENDER → POST-RENDER QC.

- REFERENCE: ENG-001/ENG-002 frozen here (generation_allowed=false);
  metadata registry + fail-closed provenance in
  src/lib/engineeringReference.ts (branch claude/video-generator-engineering).
- ANALYSIS/PROFILE: CharacterEngineeringProfile type +
  src/lib/ENGINEERING_SCHEMA.json — identity-free by construction (no
  ethnicity/gender/occupation/location/costume field exists; pinned by
  test); generation_allowed pinned false in the schema.
- ELIGIBILITY: ELIGIBILITY constants mirror the shipped gate verbatim.
- MOTION CONFIG: KNEE_DAMPING (0.50, BVH layer, do-not-alter list),
  MOTION_PROMOTION (walking PRIMARY, idle SECONDARY, wave EXCLUDED,
  turn/reach UNPROMOTED), MESH_DENSITY policy.
- UI: CinematicPanel engineering mode gains an "Engineering reference
  (provenance)" pick beside the scene pick — provenance metadata only,
  never serialized into the prompt, never auto-generating anything
  (USER REQUEST → ANALYSIS → EXPLICIT GENERATION ACTION).
- QC: gate mapping + fallback constants (see ENGINEERING_GATE_MAPPING.md).

DETERMINISM: layer metadata is byte-deterministic (pure constants);
rendered pixels remain PER_HOST/PER_CPU_CLASS per standing policy —
unchanged, no fixture re-baselined.
