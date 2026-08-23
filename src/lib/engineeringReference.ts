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
  {
    id: "ENG-003",
    sha256: "35c00f60678c9ed07a87b3938f2b220afb6557d5a75f0f56954a07ae6efc6356",
    title: "1,000 Engineering Details Reference Library (Global Edition)",
    category: "ENGINEERING/SYSTEM",
  },
  {
    id: "ENG-004",
    sha256: "705e1c37db4fa28efe0ffab9160fbc4cb74e494994e45df5fabbb8de29fa22ea",
    title: "Visual Engineering Reference Atlas — Camera Angles & Lighting Conditions",
    category: "ENGINEERING/CAMERA-LIGHTING",
  },
] as const;

/**
 * The camera/lighting atlas taxonomy (owner 10,000-detail loop,
 * 2026-08-23): built programmatically from ENG-004's 100 camera panels ×
 * 100 lighting panels, frozen on the evidence branch. Metadata only here —
 * the indexes are analysis data, and the poster's own banner applies:
 * REFERENCE ONLY, generation_allowed=false. Values the atlas does not
 * specify are recorded NOT_SPECIFIED in the data, never fabricated.
 */
export const VISUAL_ATLAS_LIBRARY = {
  source: "ENG-004",
  evidenceBranchDir: "engineering_refs/",
  cameraDetails: 5000,
  lightingDetails: 5000,
  cameraPanels: 100,
  lightingPanels: 100,
  cameraLightingMatrix: 10000,
  indexSha256: {
    camera: "180f8683cd902039",
    lighting: "506d361e94f4edd0",
    matrix: "40ef18f588d43423",
  },
  generationAllowed: false,
  productionEnabled: false,
} as const;

/**
 * §11 retrieval: map a user intent's keywords to the reference shelves the
 * analysis layer should surface. Pure, deterministic, fail-closed (unknown
 * words simply contribute nothing) — and retrieval NEVER generates.
 */
const RETRIEVAL_RULES: readonly { match: RegExp; shelves: readonly string[] }[] = [
  { match: /\b(low.angle|high.angle|close.?up|wide|angle|shot|lens|camera|framing)\b/i, shelves: ["CAMERA"] },
  { match: /\b(cinematic|composition|symmetry|thirds)\b/i, shelves: ["CAMERA", "LIGHTING", "SCENE"] },
  { match: /\b(light|lighting|sunset|sunrise|golden|night|noir|rim|backlit|candle|neon|glow)\b/i, shelves: ["LIGHTING"] },
  { match: /\b(rain|rainy|fog|foggy|snow|storm|overcast|weather|mist)\b/i, shelves: ["LIGHTING", "SCENE"] },
  { match: /\b(street|city|urban|forest|village|interior|room|market|environment|scene)\b/i, shelves: ["SCENE", "MATERIAL"] },
  { match: /\b(wet|reflection|surface|material|texture)\b/i, shelves: ["MATERIAL", "LIGHTING"] },
  { match: /\b(walk|walking|run|gait|idle|motion|foot|step)\b/i, shelves: ["MOTION ENGINEERING", "CHARACTER ENGINEERING"] },
  { match: /\b(character|anatomy|body|pose|figure)\b/i, shelves: ["CHARACTER ENGINEERING", "ANATOMY"] },
  { match: /\b(emotional|emotion|expression|face|facial)\b/i, shelves: ["CHARACTER ENGINEERING", "QUALITY"] },
  { match: /\b(quality|artifact|review|gate)\b/i, shelves: ["QUALITY", "FALLBACK"] },
];

export function retrieveReferenceShelves(request: string): string[] {
  const shelves: string[] = [];
  for (const rule of RETRIEVAL_RULES) {
    if (rule.match.test(request)) {
      for (const s of rule.shelves) if (!shelves.includes(s)) shelves.push(s);
    }
  }
  return shelves;
}

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

/**
 * The 1000-detail engineering knowledge library (owner master loop,
 * 2026-08-23). The full data lives in src/lib/engineeringDetails.json
 * (ENG-0001..ENG-1000, exactly 100 per domain) and is frozen with the same
 * content hash on the evidence branch. It is an ANALYSIS/REFERENCE surface:
 * loading, matching or displaying a detail NEVER triggers generation —
 * USER REQUEST → ANALYSIS → EXPLICIT GENERATION ACTION always holds.
 * Invariant carried by the data and pinned by test: ENFORCED requires
 * MEASURED — no assumption is ever promoted to a gate.
 */
export const ENGINEERING_DETAIL_LIBRARY = {
  file: "src/lib/engineeringDetails.json",
  sha256: "4bf25f2fe920082a57a1cc139fb0bf152652de60e11b60b40be344fef3196667",
  total: 1000,
  perDomain: 100,
  domains: [
    { id: "01", title: "CHARACTER ANATOMY", range: ["ENG-0001", "ENG-0100"] },
    { id: "02", title: "SKELETON / JOINTS / RIGGING", range: ["ENG-0101", "ENG-0200"] },
    { id: "03", title: "MOTION / KINEMATICS", range: ["ENG-0201", "ENG-0300"] },
    { id: "04", title: "SEGMENTATION / SILHOUETTE / TOPOLOGY", range: ["ENG-0301", "ENG-0400"] },
    { id: "05", title: "CLOTHING / HAIR / MATERIALS", range: ["ENG-0401", "ENG-0500"] },
    { id: "06", title: "CAMERA / COMPOSITION / SCENE SCALE", range: ["ENG-0501", "ENG-0600"] },
    { id: "07", title: "LIGHTING / COLOR / ATMOSPHERE", range: ["ENG-0601", "ENG-0700"] },
    { id: "08", title: "ENVIRONMENT / SURFACE / PROPS", range: ["ENG-0701", "ENG-0800"] },
    { id: "09", title: "RENDERING / PERFORMANCE / PIPELINE", range: ["ENG-0801", "ENG-0900"] },
    { id: "10", title: "QA / DETERMINISM / FALLBACK / PRODUCTION", range: ["ENG-0901", "ENG-1000"] },
  ],
  evidenceDistribution: { MEASURED: 563, REFERENCE: 398, INFERRED: 24, OPEN: 15 },
  statusDistribution: { ENFORCED: 434, REFERENCE_ONLY: 421, STRESS_TEST: 107, BLOCKED: 32, CANDIDATE: 6 },
} as const;

/**
 * §17 category shelves → library domains, with the honest constraint and
 * warning each shelf carries when surfaced in the generator UI.
 */
export const ENGINEERING_CATEGORY_MAP: readonly {
  category: string;
  domains: readonly string[];
  gates: readonly string[];
  warning: string;
}[] = [
  { category: "CHARACTER ENGINEERING", domains: ["01", "02"], gates: ["landmark_confidence", "core_joint_containment"], warning: "proportion/DOF tables are REFERENCE_ONLY" },
  { category: "MOTION ENGINEERING", domains: ["03"], gates: ["temporal_aliveness", "pixel_review"], warning: "walking PRIMARY; wave EXCLUDED/FALSIFIED; turn/reach UNKNOWN" },
  { category: "ANATOMY", domains: ["01"], gates: ["core_joint_containment"], warning: "identity-free; no character identity fields exist" },
  { category: "RIGGING", domains: ["02"], gates: ["landmark_confidence"], warning: "knee damping 0.50 is the only accepted motion correction" },
  { category: "MESH", domains: ["04"], gates: ["border_contact", "connected_components"], warning: "GRID40 default; density rescues neither ink strokes nor bare-shin warp" },
  { category: "CLOTHING", domains: ["05"], gates: ["pixel_review"], warning: "clothing-coverage effect is OPEN — not a proven gate" },
  { category: "CAMERA", domains: ["06"], gates: ["camera_lane"], warning: "frontal/near-frontal envelope; camera motion is provider-dependent" },
  { category: "SCENE", domains: ["08"], gates: [], warning: "scene references are qualitative; no fabricated measurements" },
  { category: "LIGHTING", domains: ["07"], gates: [], warning: "enforced lighting register must stay weather/ambience-invisible" },
  { category: "MATERIAL", domains: ["05", "08"], gates: [], warning: "artistic material references never become numeric gates" },
  { category: "RENDERING", domains: ["09"], gates: [], warning: "measured envelope only — no extrapolation" },
  { category: "QUALITY", domains: ["10"], gates: ["temporal_aliveness", "pixel_review", "identity_preservation"], warning: "numeric scores are never sufficient; pixels decide" },
  { category: "FALLBACK", domains: ["10"], gates: [], warning: "fail-closed STILL_PARALLAX with MOTION_CONTRACT reason, always" },
] as const;

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
