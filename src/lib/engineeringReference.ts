/**
 * CHARACTER ENGINEERING REFERENCE LAYER (owner loop, 2026-08-23).
 *
 * Machine-readable form of the two frozen ONIQ character-engineering
 * posters (ENG-001 light detail sheet, ENG-002 dark detailed layer;
 * registered on the evidence branch, generation_allowed=false), reconciled
 * against measured ONIQ pipeline evidence. The reference hierarchy is
 * absolute here:
 *
 *   REAL DECODED PIXELS > MOTION_STANDARD > frozen validation evidence >
 *   anatomy/scene references > THESE POSTERS > proposals.
 *
 * So every value in this file carries a provenance tag: MEASURED means the
 * number comes from ONIQ's own experiments and IS what the pipeline
 * enforces; REFERENCE_ONLY means the posters illustrate it but no ONIQ
 * evidence backs it, and it must never become a hard gate from here. Where
 * a poster CONTRADICTS measured evidence, the measured value stands and
 * the conflict is recorded in DISCREPANCIES — pinned by test so the
 * contradiction cannot silently disappear.
 *
 * This layer is analysis/reference only. Selecting a reference never
 * generates anything: USER REQUEST → ANALYSIS → EXPLICIT GENERATION
 * ACTION, same as the scene layer in videoEngineering.ts.
 *
 * Self-contained (no imports) for the same worker type-stripping reason as
 * shotDirector.
 */

export type Provenance = "MEASURED" | "REFERENCE_ONLY";

export type GateClass =
  | "PRE_RENDER_GATE"
  | "POST_RENDER_GATE"
  | "DIAGNOSTIC_ONLY"
  | "REFERENCE_ONLY"
  | "STRESS_TEST";

// ---------------------------------------------------------------------------
// MEASURED constants — the numbers the pipeline actually enforces today.
// Changing any of these is a production change and needs owner approval.
// ---------------------------------------------------------------------------

/**
 * The accepted experimental walking correction: SOURCE-BVH knee damping,
 * both knees symmetrically, the six knee rotation channels only, wrap-safe
 * toward frame 0. Everything in `mustNotAlter` is untouched by it — that
 * list is the acceptance condition, not documentation.
 */
export const KNEE_DAMPING = {
  scale: 0.5,
  layer: "SOURCE_BVH",
  appliedTo: ["RightLeg", "LeftLeg"],
  channels: 6,
  symmetric: true,
  mustNotAlter: ["hips", "ankles", "root translation", "timing", "stride timing", "ARAP mesh", "segmentation", "mapping"],
  provenance: "MEASURED" as Provenance,
} as const;

/** Production aliveness gate. The ENG-002 poster prints 0.70 — see DISCREPANCIES; 0.75 stands. */
export const ALIVENESS_MIN = 0.75;

/** Pre-render eligibility, exactly as the shipped gate computes it. */
export const ELIGIBILITY = {
  fillPctMax: 90,
  borderContact: "REJECT",
  connectedComponentsMax: 1,
  coreJointsOnSilhouette: ["shoulder", "hip", "knee", "foot"],
  kptConfMeanMin: 0.7,
  provenance: "MEASURED" as Provenance,
} as const;

/**
 * Mesh density, from the Batch-5 series (urchin fixture, measured render
 * time/RSS): GRID40 default; GRID60/80 separate thin SOLID limbs; density
 * does NOT rescue thin INK STROKES (~2–4 px, adchar4) and does NOT rescue
 * the M3 bare-thin-shin crossing warp (grid80 measured null/worse on
 * m3_ancient_scribe) — those are different mechanisms than mesh-pitch
 * merging.
 */
export const MESH_DENSITY = {
  default: 40,
  grids: [30, 40, 60, 80],
  thinSolidLimbRecovery: [60, 80],
  rescuesThinInkStrokes: false,
  rescuesBareThinShinWarp: false,
  provenance: "MEASURED" as Provenance,
} as const;

/**
 * Limb classes. The posters classify by width alone (≥5 px solid, 2–5 px
 * recoverable, <2 px stroke); measured ONIQ evidence splits by RENDERING
 * STYLE first — see DISCREPANCIES.
 */
export const LIMB_CLASSES = [
  { cls: "SOLID_LIMB", note: "filled artwork, width ≥ ~5 px — default pipeline", provenance: "MEASURED" },
  { cls: "THIN_SOLID_LIMB", note: "filled artwork, thin — GRID60/80 separation measured (urchin)", provenance: "MEASURED" },
  { cls: "THIN_INK_STROKE", note: "outline strokes ~2–4 px — STRESS_FAIL, density does NOT rescue (adchar4)", provenance: "MEASURED" },
  { cls: "BARE_THIN_SHIN", note: "exposed thin bare lower legs — crossing-phase warp under knee050; clothing coverage is the protective factor (M3 scribe)", provenance: "MEASURED" },
] as const;

/** Walking-cycle phase names (both posters; matches the pipeline's cycle). */
export const WALK_PHASES = [
  "contact",
  "down",
  "passing",
  "up",
  "opposite_contact",
  "opposite_down",
  "opposite_passing",
  "opposite_up",
  "recovery",
] as const;

/** Motion grammar promotion — measured, mirrors MOTION_STANDARD. */
export const MOTION_PROMOTION = {
  walking: "PRIMARY",
  idle: "SECONDARY",
  turn: "UNPROMOTED",
  wave: "EXCLUDED",
  reach: "UNPROMOTED",
  provenance: "MEASURED" as Provenance,
} as const;

/** Camera-relative body-motion lanes (both posters agree with evidence). */
export const CAMERA_LANES = [
  { lane: "frontal", supported: true },
  { lane: "near_frontal", supported: true },
  { lane: "three_quarter", supported: false },
  { lane: "profile", supported: false },
  { lane: "rear", supported: false },
] as const;

export const CLASSIFICATIONS = ["PRODUCTION_READY", "CONDITIONAL", "STRESS_TEST", "GATE_REJECT"] as const;

/**
 * Fail-closed fallback: every rejection resolves to the still/parallax
 * path and reports a structured MOTION_CONTRACT reason — no new gate may
 * end anywhere else.
 */
export const FALLBACK = {
  action: "STILL_PARALLAX",
  contract: "MOTION_CONTRACT",
  reasons: [
    "low_confidence",
    "border_contact",
    "disconnected_components",
    "core_joint_outside_silhouette",
    "thin_ink_stroke",
    "bare_thin_shin_warp",
    "temporal_instability",
    "aliveness_below_min",
    "identity_drift",
    "geometry_failure",
    "unsupported_camera_lane",
  ],
  provenance: "MEASURED" as Provenance,
} as const;

/**
 * Determinism status of this layer: the metadata itself is byte
 * deterministic (pure constants); rendered pixels remain PER_HOST /
 * PER_CPU_CLASS per the standing evidence-backed policy, which this layer
 * records and does NOT redefine. Frozen fixture hashes are not touched.
 */
export const DETERMINISM = {
  metadata: "byte-deterministic",
  renders: "PER_HOST / PER_CPU_CLASS (standing policy, unchanged)",
  rebaseline: "NEVER automatic",
} as const;

// ---------------------------------------------------------------------------
// Gate mapping — every engineering category maps to exactly ONE class.
// REFERENCE_ONLY entries must never be enforced from this file.
// ---------------------------------------------------------------------------

export const GATE_MAPPING: Record<string, GateClass> = {
  // enforced before any render
  silhouette_fill_ratio: "PRE_RENDER_GATE",
  border_contact: "PRE_RENDER_GATE",
  connected_components: "PRE_RENDER_GATE",
  core_joint_containment: "PRE_RENDER_GATE",
  landmark_confidence: "PRE_RENDER_GATE",
  camera_lane: "PRE_RENDER_GATE",
  // enforced on decoded pixels
  temporal_aliveness: "POST_RENDER_GATE",
  pixel_review: "POST_RENDER_GATE",
  identity_preservation: "POST_RENDER_GATE",
  geometry_integrity: "POST_RENDER_GATE",
  foot_contact: "POST_RENDER_GATE",
  // measured NOT predictive alone — recorded, never a reject rule
  interior_hole_metrics: "DIAGNOSTIC_ONLY",
  limb_width_map: "DIAGNOSTIC_ONLY",
  // poster-illustrated, no ONIQ measurement behind the numbers
  proportion_table: "REFERENCE_ONLY",
  dof_rotation_limits: "REFERENCE_ONLY",
  knee_angle_phase_curve: "REFERENCE_ONLY",
  foot_contact_cm_thresholds: "REFERENCE_ONLY",
  texture_deformation_budget: "REFERENCE_ONLY",
  temporal_px_thresholds: "REFERENCE_ONLY",
  character_environment_contact: "REFERENCE_ONLY",
  // measured stress classes
  thin_solid_limb: "STRESS_TEST",
  thin_ink_stroke: "STRESS_TEST",
  bare_thin_shin: "STRESS_TEST",
  clothing_topology_risk: "STRESS_TEST",
  hair_topology_risk: "STRESS_TEST",
};

// ---------------------------------------------------------------------------
// Poster-vs-evidence discrepancies — measured behavior stands; pinned by
// test so these records cannot silently vanish.
// ---------------------------------------------------------------------------

export const DISCREPANCIES = [
  {
    topic: "quality score threshold",
    poster: "ENG-002 prints output quality targets 'Score ≥ 0.70'",
    measured: "the production aliveness gate is ≥ 0.75 (necessary, never sufficient)",
    resolution: "0.75 stands",
  },
  {
    topic: "thin-limb classification",
    poster: "both posters classify by width alone (2–5 px 'recoverable via GRID60/80', <2 px stroke)",
    measured:
      "rendering style decides, not width alone: thin SOLID limbs are rescued by density (urchin); thin INK STROKES ~2–4 px are NOT (adchar4); and bare thin shins warp at crossings regardless of density (M3 scribe, grid80 measured null)",
    resolution: "solid-vs-stroke (and bare-shin) classes stand; width is diagnostic",
  },
  {
    topic: "degrees-of-freedom / rotation-limit tables",
    poster: "both posters print per-joint DOF and min/max/preferred angle tables",
    measured: "ONIQ has never validated these numbers; the retarget uses projected source-BVH angles with knee damping only",
    resolution: "tables recorded REFERENCE_ONLY; no joint-limit clamp is introduced",
  },
  {
    topic: "foot-contact metric units",
    poster: "cm-based clearance/penetration thresholds (e.g. > 2.5 cm good)",
    measured: "the pipeline has no physical-unit calibration; foot contact is judged on decoded pixels",
    resolution: "cm thresholds REFERENCE_ONLY; pixel review stands",
  },
] as const;

// ---------------------------------------------------------------------------
// Frozen reference registry (metadata only — masters live on the evidence
// branch, generation_allowed = false).
// ---------------------------------------------------------------------------

export const ENGINEERING_REFERENCE_REGISTRY = [
  {
    id: "ENG-001",
    sha256: "fc0ea82faccf3d436c8870f328657db9c5c4999ad27f602e8d8aa8c09c33fe18",
    title: "Advanced Character Engineering Reference (Engineering Detail Images)",
    category: "ENGINEERING/CHARACTER",
  },
  {
    id: "ENG-002",
    sha256: "84588b3ad10a2a7bf9b5832e1eccfd7900c8fe7a0bd71c52c87f24e3640cfb69",
    title: "Advanced Character Engineering Reference (Detailed Engineering Layer)",
    category: "ENGINEERING/CHARACTER",
  },
] as const;

/** User-facing category shelves of the Engineering Reference feature. */
export const ENGINEERING_CATEGORIES = [
  "ANATOMY",
  "SKELETON",
  "PROPORTIONS",
  "JOINTS",
  "WALK CYCLE",
  "FOOT CONTACT",
  "SILHOUETTE",
  "MESH",
  "CLOTHING",
  "HAIR",
  "TEMPORAL MOTION",
  "CAMERA",
  "QUALITY",
  "FALLBACK",
] as const;

// ---------------------------------------------------------------------------
// The character engineering profile schema (conceptual JSON shape from the
// posters, typed). Identity-free by construction: no ethnicity, gender,
// occupation, location or costume field exists — a profile describes
// STRUCTURE, and the user's character stays authoritative.
// ---------------------------------------------------------------------------

export type LandmarkQuality = {
  visibility: number;
  confidence: number;
  silhouette_inside: boolean;
  occluded: boolean;
  estimated: boolean;
};

export type CharacterEngineeringProfile = {
  character_id: string;
  proportions: Partial<
    Record<
      | "body_height"
      | "head_height"
      | "shoulder_width"
      | "torso_length"
      | "pelvis_width"
      | "upper_arm_length"
      | "forearm_length"
      | "hand_length"
      | "upper_leg_length"
      | "lower_leg_length"
      | "foot_length"
      | "foot_width"
      | "ankle_width"
      | "wrist_width"
      | "knee_width",
      number
    >
  >;
  landmarks: Record<string, [number, number]>;
  landmark_quality: Record<string, LandmarkQuality>;
  skeleton: { topology: string; enabled_joints: string[] };
  motion: { walking: boolean; idle: boolean; turn: boolean; wave: boolean; reach: boolean };
  silhouette: {
    fill_ratio: number;
    border_contact: boolean;
    connected_components: number;
    holes: number;
    hole_area_px: number;
  };
  limbs: { minimum_width_px: number; limb_class: (typeof LIMB_CLASSES)[number]["cls"] };
  mesh: { grid: number };
  camera: { lane: (typeof CAMERA_LANES)[number]["lane"] };
  quality: { aliveness: number | null; pixel_review: "PASS" | "FAIL" | "PENDING" };
  classification: (typeof CLASSIFICATIONS)[number] | null;
  fallback: { action: string; reason: string | null; contract: "MOTION_CONTRACT" } | null;
  generation_allowed: false;
};

export function engineeringProvenanceFor(
  ids: readonly string[],
): { ok: true; refs: { reference_id: string; reference_sha256: string; reference_category: string }[] } | { ok: false; reason: string } {
  const refs = [];
  for (const id of ids) {
    const hit = ENGINEERING_REFERENCE_REGISTRY.find((r) => r.id === id);
    if (!hit) return { ok: false, reason: `unknown engineering reference id: ${id}` };
    refs.push({ reference_id: hit.id, reference_sha256: hit.sha256, reference_category: hit.category });
  }
  return { ok: true, refs };
}
