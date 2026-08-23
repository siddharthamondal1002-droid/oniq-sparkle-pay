/**
 * VIDEO GENERATOR — ENGINEERING MODE (owner loop, 2026-08-23).
 *
 * The frozen ONIQ scene-reference library (val-charlib `scene_refs/`, v1.0)
 * indexes scene, camera, composition, lighting, time, weather, season,
 * material, depth, story-beat and negative-example vocabulary. This module
 * turns that taxonomy into STRUCTURED generator parameters for the Story
 * pipeline, with three hard rules learned from measured pipeline evidence:
 *
 * 1. ONE AUTHORITATIVE WEATHER (owner, 2026-08-21). Weather overlays derive
 *    from a shot's own words via `vfxKindFor` — so the ONLY weather words
 *    this module ever emits are the canonical trigger words for the class
 *    the user chose, and every OTHER vocabulary (lighting, mood) is chosen
 *    to be INVISIBLE to both `vfxKindFor` and `ambienceFor`, exactly like
 *    shotDirector's palette. Pinned by test.
 * 2. HONEST SUPPORT LEVELS. The still→clip pipeline cannot move a camera on
 *    a still; a video model may or may not honor a lens word. Every
 *    dimension carries a measured support level; nothing is presented as a
 *    control when it is only a suggestion (loop §6).
 * 3. FAIL CLOSED. Unknown values are rejected with a structured reason, and
 *    the intent block is DROPPED whole rather than truncating the user's
 *    own words when the 5000-char prompt budget would overflow (loop §23).
 *
 * Self-contained on purpose (no imports), like shotDirector/particleField:
 * the story worker imports src/lib files directly under Node type-stripping,
 * and a dependency-free module stays importable from every side of the
 * pipeline. Tests import the real classifiers and pin invisibility.
 *
 * The user's chosen character stays authoritative (loop §11): nothing here
 * names ethnicity, gender, occupation or identity.
 */

/** How faithfully the pipeline can honor a dimension today. */
export type SupportLevel =
  | "structured" // enforced deterministically by existing pipeline code
  | "plan-mediated" // reaches the plan model as words; downstream code then honors what the plan echoes
  | "prompt-advisory" // reaches the image/video model as words; not enforced
  | "provider-dependent"; // only some providers/stages can honor it at all

/**
 * Support map, from the audit of the shipped pipeline (2026-08-23):
 * shot size + lighting are decorated deterministically (shotDirector);
 * weather earns a particle overlay from the still's own text (vfxKindFor →
 * particleField); ambience/score are chosen from the same text (soundStage);
 * everything else rides the plan or the image prompt as language. Camera
 * MOTION exists only at the movie-grade clip stage (image-to-video), never
 * on the drawn still.
 */
export const DIMENSION_SUPPORT: Record<string, SupportLevel> = {
  environmentType: "plan-mediated",
  sceneScale: "plan-mediated",
  depth: "prompt-advisory",
  shotSize: "structured",
  cameraAngle: "prompt-advisory",
  cameraMotion: "provider-dependent",
  composition: "prompt-advisory",
  lighting: "structured",
  timeOfDay: "plan-mediated",
  weather: "structured",
  season: "plan-mediated",
  material: "prompt-advisory",
  mood: "prompt-advisory",
  storyBeat: "plan-mediated",
  motion: "structured",
  physicsFx: "provider-dependent",
  output: "structured",
  quality: "structured",
};

// ---------------------------------------------------------------------------
// Vocabularies — drawn from the frozen scene library's own panels (SCN-001/
// 002/006/007/009/010 section inventories, scene_refs index) and bounded to
// what the pipeline can carry.
// ---------------------------------------------------------------------------

export const ENVIRONMENT_TYPES = [
  "interior",
  "urban exterior",
  "rural",
  "village",
  "nature",
  "historical",
  "fantasy world",
  "science-fiction world",
  "professional workplace",
  "scientific",
  "transport hub",
  "recreational",
  "cultural space",
  "special location",
] as const;

export const SCENE_SCALES = ["human scale", "vehicle scale", "building scale", "city scale", "landscape scale"] as const;

export const DEPTH_EMPHASES = [
  "strong foreground interest",
  "layered depth to the far background",
  "shallow subject-plane focus",
  "deep background vista",
] as const;

export const CAMERA_ANGLES = [
  "eye level",
  "low angle",
  "high angle",
  "overhead",
  "over-the-shoulder",
  "point-of-view",
  "Dutch angle",
] as const;

/** Clip-stage only (image-to-video). Never decorates a still. */
export const CAMERA_MOTIONS = ["static", "pan", "tilt", "dolly", "truck", "crane", "arc", "handheld"] as const;

export const COMPOSITIONS = [
  "rule-of-thirds composition",
  "centered composition",
  "golden-ratio composition",
  "leading lines",
  "symmetrical framing",
  "asymmetrical balance",
  "frame within a frame",
  "generous negative space",
  "reflection composition",
] as const;

/**
 * Lighting words. Every entry MUST be invisible to vfxKindFor AND
 * ambienceFor (pinned by test) — same contract as shotDirector's palette:
 * no lantern/candle/torch/moonlit/starlit/sunbeam/haze/mist/smoke, no
 * ember-adjacent warmth words, nothing the sound stage would read as a
 * place or a time.
 */
export const LIGHTING_STYLES = [
  "three-point studio lighting",
  "soft key light with gentle fill",
  "strong rim light",
  "backlit silhouette lighting",
  "high-key brightness",
  "low-key contrast",
  "hard directional light",
  "soft diffused light",
  "cool ambient light",
  "warm window light",
] as const;

export const TIMES_OF_DAY = [
  "pre-dawn",
  "sunrise",
  "morning",
  "late morning",
  "midday",
  "afternoon",
  "golden hour",
  "sunset",
  "dusk",
  "evening",
  "night",
  "late night",
] as const;

/**
 * Weather choices and the overlay class each one's canonical wording earns
 * from vfxKindFor (measured against the shipped trigger table, pinned by
 * test). `null` = no particle overlay exists for it — the words still reach
 * the image model (prompt-advisory), and that honesty is the point.
 */
export const WEATHER_VFX: Record<string, "rain" | "snow" | "dust" | null> = {
  sunny: null,
  cloudy: null,
  overcast: null,
  rain: "rain",
  "heavy rain": "rain",
  thunderstorm: "rain",
  snow: "snow",
  blizzard: "snow",
  fog: null,
  wind: null,
  "dust haze": "dust",
};
export const WEATHERS = Object.keys(WEATHER_VFX);

/**
 * The phrase actually emitted for each weather. Needed because the trigger
 * table is boundary-anchored: bare "thunderstorm" earns NOTHING (mid-word
 * "storm" fails \b — measured 2026-08-23), so its phrase must carry a real
 * trigger word. Every phrase's measured class equals WEATHER_VFX — pinned
 * by test against the live classifier.
 */
export const WEATHER_PHRASE: Record<string, string> = {
  sunny: "sunny weather",
  cloudy: "cloudy weather",
  overcast: "overcast weather",
  rain: "rain",
  "heavy rain": "heavy rain",
  thunderstorm: "a thunderstorm, heavy rain",
  snow: "falling snow",
  blizzard: "a blizzard",
  fog: "thick fog",
  wind: "strong wind",
  "dust haze": "a dust haze",
};

/**
 * Seasons, with the overlay class the season WORD ITSELF would earn if the
 * plan echoes it into a still ("winter" is a snow trigger — measured). Used
 * to warn on weather/season combinations that would fight each other.
 */
export const SEASON_VFX: Record<string, "rain" | "snow" | "dust" | null> = {
  spring: null,
  summer: null,
  monsoon: "rain",
  autumn: null,
  winter: "snow",
  "dry season": null,
  "harvest season": null,
  "festival season": null,
};
export const SEASONS = Object.keys(SEASON_VFX);

export const MATERIALS = [
  "concrete",
  "brick",
  "stone",
  "wood",
  "metal",
  "glass",
  "water surfaces",
  "grass",
  "snow-covered ground",
  "ice",
  "mud",
  "fabric",
  "leather",
  "ceramic",
  "asphalt",
  "rust",
  "weathered surfaces",
] as const;

/** Mood words — vfx- and ambience-invisible, pinned by test. */
export const MOODS = [
  "peaceful tone",
  "dramatic tone",
  "mysterious tone",
  "melancholy tone",
  "hopeful tone",
  "tense tone",
  "playful tone",
  "grand cinematic tone",
] as const;

export const STORY_BEATS = [
  "introduction",
  "establishing",
  "conflict build-up",
  "rising action",
  "turning point",
  "climax",
  "falling action",
  "resolution",
  "epilogue",
] as const;

/**
 * The ONIQ motion grammar, verbatim from MOTION_STANDARD evidence. Only
 * motions with measured pipeline proof are promoted; a reference
 * illustration promotes nothing (loop §12).
 */
export const MOTION_GRAMMAR = [
  { motion: "walking", rank: "PRIMARY", evidence: "knee-damped source-BVH driver, damping 0.50 — accepted experiment", kneeDamping: 0.5 },
  { motion: "idle", rank: "SECONDARY", evidence: "accepted regime s = 0.25" },
  { motion: "turn", rank: "TERTIARY", evidence: "render-derived" },
  { motion: "wave", rank: "UNPROMOTED", evidence: "no accepted pipeline proof" },
  { motion: "reach", rank: "UNPROMOTED", evidence: "no accepted pipeline proof" },
] as const;

// ---------------------------------------------------------------------------
// The frozen reference registry — METADATA ONLY. The masters live frozen on
// the evidence branch (scene_refs/, generation_allowed=false); selecting a
// reference attaches its identity to the request, it never copies or
// regenerates the image (loop §19).
// ---------------------------------------------------------------------------

export type SceneReference = {
  id: string;
  sha256: string;
  title: string;
  category: string;
};

export const SCENE_REFERENCE_REGISTRY: readonly SceneReference[] = [
  { id: "SCN-001", sha256: "11e1c05a3de7a609fdc13139a0b63aff57ddfac80345f4f9d4a19cda4632f86c", title: "Scene Reference Library (Ultra Edition)", category: "SCENES/ENGINEERING" },
  { id: "SCN-002", sha256: "d751fafb09a776ce8f2bda0ca45c2cde3172753aae158ec52634b5c71da9fb21", title: "Scene Reference Library (Mega Edition)", category: "SCENES/ENVIRONMENTS" },
  { id: "SCN-006", sha256: "0e0a44663db388117f2568131389936d16a2131d82bbd3000be091c17cdb583a", title: "Scene Reference Library (Global Edition)", category: "SCENES/ENVIRONMENTS" },
  { id: "SCN-007", sha256: "57de71265a9821974b3cef49bb79cff4a1033cb795694ef68b52d05e5315975e", title: "Scene Reference Library (Ultra Edition v2.0)", category: "SCENES/ENGINEERING" },
  { id: "SCN-009", sha256: "ee19e51e581531d85689a6dd09a8de196b86576f94787cd3c9559b4a4cea7b9f", title: "VISTA Global Reference (Master Edition)", category: "SCENES/SPECIALIZED" },
  { id: "SCN-010", sha256: "59ece0090ee22b9570e3f5a5bf0361ad09569e674ce09a40a777064b641a8714", title: "Scene Reference Library (Ultra Edition, infographic)", category: "SCENES/PRODUCTION" },
] as const;

export type ReferenceProvenance = {
  reference_id: string;
  reference_sha256: string;
  reference_category: string;
};

/** Fail-closed: an unknown id is an error, never a silently-empty record. */
export function provenanceFor(ids: readonly string[]): { ok: true; refs: ReferenceProvenance[] } | { ok: false; reason: string } {
  const refs: ReferenceProvenance[] = [];
  for (const id of ids) {
    const hit = SCENE_REFERENCE_REGISTRY.find((r) => r.id === id);
    if (!hit) return { ok: false, reason: `unknown reference id: ${id}` };
    refs.push({ reference_id: hit.id, reference_sha256: hit.sha256, reference_category: hit.category });
  }
  return { ok: true, refs };
}

// ---------------------------------------------------------------------------
// The structured shot intent and its serialization.
// ---------------------------------------------------------------------------

export type ShotIntent = {
  environmentType?: string;
  sceneScale?: string;
  depth?: string;
  cameraAngle?: string;
  composition?: string;
  lighting?: string;
  timeOfDay?: string;
  weather?: string;
  season?: string;
  materials?: readonly string[];
  mood?: string;
  storyBeat?: string;
  /** Frozen-library reference ids to carry as provenance. */
  referenceIds?: readonly string[];
};

export type IntentValidation = {
  ok: boolean;
  /** Hard failures — the intent must not be applied. */
  errors: string[];
  /** Honest advisories — applied, but the user should know. */
  warnings: string[];
};

const inList = (v: string | undefined, list: readonly string[]) => v === undefined || list.includes(v);

/**
 * Validation is fail-closed on vocabulary (an unknown value is a typo or an
 * injection, not a preference) and advisory on physics: a weather and a
 * season whose trigger classes disagree ("rain" in "winter") are allowed —
 * the reference library shows such scenes — but the one-authoritative-
 * weather rule means the still's WORDS decide, so the conflict is surfaced.
 */
export function validateShotIntent(intent: ShotIntent): IntentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!inList(intent.environmentType, ENVIRONMENT_TYPES)) errors.push(`unknown environmentType: ${intent.environmentType}`);
  if (!inList(intent.sceneScale, SCENE_SCALES)) errors.push(`unknown sceneScale: ${intent.sceneScale}`);
  if (!inList(intent.depth, DEPTH_EMPHASES)) errors.push(`unknown depth: ${intent.depth}`);
  if (!inList(intent.cameraAngle, CAMERA_ANGLES)) errors.push(`unknown cameraAngle: ${intent.cameraAngle}`);
  if (!inList(intent.composition, COMPOSITIONS)) errors.push(`unknown composition: ${intent.composition}`);
  if (!inList(intent.lighting, LIGHTING_STYLES)) errors.push(`unknown lighting: ${intent.lighting}`);
  if (!inList(intent.timeOfDay, TIMES_OF_DAY)) errors.push(`unknown timeOfDay: ${intent.timeOfDay}`);
  if (!inList(intent.weather, WEATHERS)) errors.push(`unknown weather: ${intent.weather}`);
  if (!inList(intent.season, SEASONS)) errors.push(`unknown season: ${intent.season}`);
  if (!inList(intent.mood, MOODS)) errors.push(`unknown mood: ${intent.mood}`);
  if (!inList(intent.storyBeat, STORY_BEATS)) errors.push(`unknown storyBeat: ${intent.storyBeat}`);
  for (const m of intent.materials ?? []) {
    if (!(MATERIALS as readonly string[]).includes(m)) errors.push(`unknown material: ${m}`);
  }
  if (intent.referenceIds && intent.referenceIds.length > 0) {
    const prov = provenanceFor(intent.referenceIds);
    if (!prov.ok) errors.push(prov.reason);
  }
  if (intent.weather && intent.season) {
    const w = WEATHER_VFX[intent.weather];
    const s = SEASON_VFX[intent.season];
    if (s !== null && s !== undefined && w !== s) {
      warnings.push(
        `"${intent.season}" itself earns the ${s} effect if the plan echoes it — with weather "${intent.weather}" the shot's own words decide (one-authoritative-weather rule)`,
      );
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Serialize the intent to the compact prose block the plan model reads.
 * Deterministic: same intent, same text, key order fixed. Empty intent →
 * empty string (the default is byte-for-byte the existing behavior).
 */
export function describeShotIntent(intent: ShotIntent): string {
  const parts: string[] = [];
  if (intent.storyBeat) parts.push(`story beat: ${intent.storyBeat}`);
  if (intent.environmentType) parts.push(`setting: ${intent.environmentType}`);
  if (intent.sceneScale) parts.push(intent.sceneScale);
  if (intent.timeOfDay) parts.push(intent.timeOfDay);
  if (intent.weather) parts.push(WEATHER_PHRASE[intent.weather] ?? intent.weather);
  if (intent.season) parts.push(intent.season);
  if (intent.lighting) parts.push(intent.lighting);
  if (intent.composition) parts.push(intent.composition);
  if (intent.cameraAngle) parts.push(`${intent.cameraAngle} viewpoint`);
  if (intent.depth) parts.push(intent.depth);
  if (intent.materials && intent.materials.length > 0) parts.push(`visible materials: ${intent.materials.join(", ")}`);
  if (intent.mood) parts.push(intent.mood);
  if (parts.length === 0) return "";
  return `Cinematic intent — ${parts.join("; ")}.`;
}

/** The pipeline-wide prompt ceiling (claim RPC, story-plot, verbatim gate). */
export const PROMPT_BUDGET = 5000;

export type AttachResult = {
  prompt: string;
  applied: boolean;
  /** Set when not applied: why the prompt went out unchanged. */
  reason?: "empty-intent" | "invalid-intent" | "prompt-budget";
};

/**
 * Append the intent to the user's prompt, fail-closed: an invalid intent or
 * a budget overflow returns the user's words UNTOUCHED with the reason
 * recorded — never a truncated hybrid (loop §23).
 */
export function attachIntentToPrompt(prompt: string, intent: ShotIntent, budget: number = PROMPT_BUDGET): AttachResult {
  const text = describeShotIntent(intent);
  if (text === "") return { prompt, applied: false, reason: "empty-intent" };
  if (!validateShotIntent(intent).ok) return { prompt, applied: false, reason: "invalid-intent" };
  const joined = `${prompt}\n\n${text}`;
  if (joined.length > budget) return { prompt, applied: false, reason: "prompt-budget" };
  return { prompt: joined, applied: true };
}
