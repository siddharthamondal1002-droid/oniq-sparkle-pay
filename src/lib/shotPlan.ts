/**
 * STRUCTURED SHOT PLAN (owner completeness loop, 2026-08-23).
 *
 * The analysis step between reference retrieval and the EXPLICIT
 * generation action: a user's creative request plus the CinematicPanel
 * intent become one structured, provenance-carrying plan object.
 *
 * Three hard properties, pinned by test:
 *  1. BOUNDARY — building a plan is pure analysis. This module performs no
 *     I/O, calls no service, and every plan carries
 *     explicitGenerationRequired: true. Reference retrieval alone never
 *     launches image, video, or story generation.
 *  2. HONESTY — engineering constraints in a plan come only from measured
 *     ONIQ constants (aliveness 0.75, fill<=90/no-border, knee damping
 *     0.50, frontal/near-frontal envelope, grammar statuses). Unknown
 *     grammars plan nothing: TURN/REACH yield REFERENCE_UNCERTAIN, WAVE
 *     is excluded outright. A request matching nothing yields
 *     REFERENCE_UNCERTAIN, never invented constraints (loop §12).
 *  3. IDENTITY-FREE — emotion/posture vocabulary describes body state and
 *     context, never identity; nothing here names ethnicity, gender,
 *     nationality, religion, occupation or location.
 */

import {
  ALIVENESS_MIN,
  CAMERA_LANES,
  ELIGIBILITY,
  ENGINEERING_CATEGORY_MAP,
  engineeringProvenanceFor,
  FALLBACK,
  KNEE_DAMPING,
  retrieveReferenceShelves,
} from "./engineeringReference";
import { provenanceFor, type ReferenceProvenance, type ShotIntent, TIMES_OF_DAY, WEATHERS } from "./videoEngineering";

/**
 * Emotion engineering vocabulary (loop §10): each emotion is a full-body
 * reading — face, gaze, posture, gesture, body state, context — never the
 * face alone. REFERENCE-class descriptors (expression_vol2 + ENG-003 L8);
 * the only MEASURED emotion capability is the worker's expression heads.
 */
export type EmotionReading = {
  emotion: string;
  face: string;
  gaze: string;
  posture: string;
  gesture: string;
  bodyState: string;
  context: string;
};

const E = (
  emotion: string,
  face: string,
  gaze: string,
  posture: string,
  gesture: string,
  bodyState: string,
  context: string,
): EmotionReading => ({ emotion, face, gaze, posture, gesture, bodyState, context });

export const EMOTIONS: readonly EmotionReading[] = [
  E("neutral", "relaxed features", "level", "upright, even weight", "arms at rest", "calm", "baseline reading"),
  E("joy", "smile, lifted cheeks", "open, bright", "lifted chest", "open gestures", "energized", "positive events"),
  E("sadness", "downturned mouth, heavy lids", "lowered", "slumped shoulders", "closed, slow", "drained", "loss, disappointment"),
  E("anger", "furrowed brow, tight jaw", "hard, fixed", "squared, forward-leaning", "clenched, sharp", "tense", "conflict"),
  E("fear", "widened eyes, raised brows", "darting", "recoiled, guarded", "protective", "alert, trembling", "threat"),
  E("surprise", "raised brows, open mouth", "snapped to source", "sudden stillness", "hands raised", "startled", "unexpected events"),
  E("disgust", "wrinkled nose, raised lip", "averted", "leaning away", "warding off", "repelled", "aversion"),
  E("curiosity", "raised brow, slight smile", "tracking, engaged", "leaning in", "reaching, pointing", "attentive", "novelty"),
  E("confusion", "asymmetric brow, parted lips", "searching", "head tilt", "open palms", "hesitant", "ambiguity"),
  E("suspicion", "narrowed eyes", "sidelong", "angled away, guarded", "crossed arms", "wary", "distrust"),
  E("relief", "softened features, exhale", "upward then closed", "releasing tension", "hand to chest", "loosening", "danger passed"),
  E("determination", "set jaw, steady brow", "locked on goal", "forward, planted", "fists, firm strides", "charged", "purpose"),
  E("exhaustion", "hooded eyes, slack features", "downcast, unfocused", "drooping shoulders, heavy steps", "hanging arms", "depleted, slow", "prolonged strain"),
  E("embarrassment", "flushed, grimace", "averted, down", "shrinking", "face-touching", "self-conscious", "social exposure"),
  E("pride", "lifted chin, slight smile", "level, steady", "expanded chest, tall", "hands on hips", "assured", "achievement"),
  E("guilt", "pinched features", "avoiding contact", "bowed head", "wringing hands", "burdened", "wrongdoing"),
  E("hope", "soft brows, faint smile", "toward horizon", "lifting", "open, reaching", "lightening", "possibility"),
  E("despair", "collapsed features", "vacant", "folded, sunk", "covering face", "inert", "hopelessness"),
  E("anticipation", "bright eyes, parted lips", "fixed ahead", "poised on toes", "readying hands", "coiled", "imminent events"),
  E("hesitation", "bitten lip, tense brow", "flicking between options", "half-turned", "half-raised hand", "suspended", "decision points"),
  E("realization", "widening eyes, rising brows", "refocusing", "straightening", "stilled mid-gesture", "arrested", "sudden understanding"),
  E("regret", "tight mouth, distant eyes", "backward, down", "half-turned back", "closing fist", "weighted", "irreversible choices"),
  E("empathy", "mirrored softness", "held on the other", "inclined toward", "offered hand", "attuned", "another's feeling"),
  E("admiration", "lifted features", "upward at subject", "open, still", "unconscious lean", "absorbed", "excellence witnessed"),
  E("impatience", "tight lips, flat brow", "flicking to exits/clock", "shifting weight", "tapping, checking", "restless", "delay"),
];

/** Adjective/verb forms → the emotion entry they indicate. */
const EMOTION_FORMS: Record<string, string> = {
  exhausted: "exhaustion", tired: "exhaustion", weary: "exhaustion",
  happy: "joy", joyful: "joy", sad: "sadness", angry: "anger", furious: "anger",
  afraid: "fear", scared: "fear", surprised: "surprise", disgusted: "disgust",
  curious: "curiosity", confused: "confusion", suspicious: "suspicion",
  relieved: "relief", determined: "determination", embarrassed: "embarrassment",
  proud: "pride", guilty: "guilt", hopeful: "hope", despairing: "despair",
  hesitant: "hesitation", regretful: "regret", empathetic: "empathy",
  admiring: "admiration", impatient: "impatience",
};

export function detectEmotion(request: string): EmotionReading | null {
  const t = request.toLowerCase();
  for (const e of EMOTIONS) {
    if (e.emotion !== "neutral" && new RegExp(`\\b${e.emotion}\\b`).test(t)) return e;
  }
  for (const [form, name] of Object.entries(EMOTION_FORMS)) {
    if (new RegExp(`\\b${form}\\b`).test(t)) return EMOTIONS.find((e) => e.emotion === name) ?? null;
  }
  return null;
}

/**
 * Negative constraints (loop §15) — the measured rejection classes every
 * plan carries. They are review criteria and prompt-avoidance guidance,
 * NEVER generation targets.
 */
export const NEGATIVE_CONSTRAINTS: readonly string[] = [
  "missing limb", "extra limb", "merged limbs", "blade artifact", "spike", "claw artifact",
  "ghosting", "mesh tear", "texture tear", "foot sliding", "foot floating", "identity drift",
  "face distortion", "hair explosion", "clothing explosion", "segmentation failure",
  "border contact", "interior-hole instability", "thin-limb merge", "thin-stroke failure",
  "excessive knee curl", "camera clipping", "lighting inconsistency", "scene continuity failure",
] as const;

/** Motion grammar statuses the planner must respect (measured). */
const GRAMMAR_STATUS: Record<string, "PRIMARY" | "PASS" | "UNKNOWN" | "EXCLUDED"> = {
  walking: "PRIMARY",
  idle: "PASS",
  turn: "UNKNOWN",
  wave: "EXCLUDED",
  reach: "UNKNOWN",
};

const MOTION_STEMS: Record<string, RegExp> = {
  walking: /\b(walk|walks|walked|walking)\b/,
  idle: /\b(idle|idles|idling)\b/,
  turn: /\b(turn|turns|turned|turning)\b/,
  wave: /\b(wave|waves|waved|waving)\b/,
  reach: /\b(reach|reaches|reached|reaching)\b/,
};

function detectMotion(request: string): { motion: string; status: string } | null {
  const t = request.toLowerCase();
  for (const [m, re] of Object.entries(MOTION_STEMS)) {
    if (re.test(t)) return { motion: m, status: GRAMMAR_STATUS[m] };
  }
  return null;
}

export type ShotPlan = {
  ok: true;
  request: string;
  shelves: string[];
  character: { emotionReading: EmotionReading | null; identityFree: true };
  action: string | null;
  emotion: string | null;
  motion: { grammar: string; status: string } | null;
  scene: string | null;
  environment: string[];
  camera: { angle: string | null; lane: string };
  lens: string | null;
  composition: string | null;
  lighting: string | null;
  weather: string | null;
  time: string | null;
  materials: string[];
  engineeringConstraints: string[];
  negativeConstraints: readonly string[];
  referenceProvenance: ReferenceProvenance[];
  fallback: { action: string; contract: string };
  /** The boundary: a plan is analysis. Nothing renders without a further explicit user action. */
  explicitGenerationRequired: true;
};

export type ShotPlanResult = ShotPlan | { ok: false; reason: "REFERENCE_UNCERTAIN"; fallback: { action: string; contract: string } };

const findTerm = (t: string, list: readonly string[]) => list.find((x) => t.includes(x)) ?? null;

/**
 * Compose the structured plan from the request text plus the panel intent.
 * Pure and deterministic; unknown territory yields REFERENCE_UNCERTAIN
 * rather than invented engineering.
 */
export function buildShotPlan(request: string, intent: ShotIntent = {}): ShotPlanResult {
  const t = request.toLowerCase();
  const shelves = retrieveReferenceShelves(request);
  const uncertain = { ok: false as const, reason: "REFERENCE_UNCERTAIN" as const, fallback: { action: FALLBACK.action, contract: FALLBACK.contract } };
  if (shelves.length === 0 && Object.keys(intent).length === 0) return uncertain;

  const motion = detectMotion(request);
  if (motion && motion.status === "UNKNOWN") return uncertain;

  const emotionReading = detectEmotion(request);
  const weather = intent.weather ?? (/\brain|rainy\b/.test(t) ? "rain" : /\bsnow\b/.test(t) ? "snow" : findTerm(t, WEATHERS));
  const time = intent.timeOfDay ?? findTerm(t, TIMES_OF_DAY);

  const constraints: string[] = [
    `temporal aliveness >= ${ALIVENESS_MIN} (necessary, never sufficient — pixel review decides)`,
    `silhouette fill <= ${ELIGIBILITY.fillPctMax}% and no border contact`,
    `rig confidence >= ${ELIGIBILITY.kptConfMeanMin}`,
  ];
  if (motion?.motion === "walking") {
    constraints.push(`knee damping ${KNEE_DAMPING.scale} (both knees, six channels, BVH layer only)`);
  }
  if (motion?.motion === "wave") {
    constraints.push("WAVE is EXCLUDED/FALSIFIED — the plan must not include a wave motion");
  }
  for (const c of ENGINEERING_CATEGORY_MAP) {
    if (shelves.includes(c.category) && c.warning) constraints.push(`${c.category}: ${c.warning}`);
  }

  const sceneRefs = intent.referenceIds ? provenanceFor(intent.referenceIds) : { ok: true as const, refs: [] };
  const engRefs = intent.engineeringReferenceIds ? engineeringProvenanceFor(intent.engineeringReferenceIds) : { ok: true as const, refs: [] };
  if (!sceneRefs.ok || !engRefs.ok) return uncertain;

  const environment: string[] = [];
  if (/\bstreet|city|urban\b/.test(t)) environment.push("urban street");
  if (weather === "rain") environment.push("wet pavement with reflections");
  if (/\bforest\b/.test(t)) environment.push("forest");
  if (/\bfog|foggy\b/.test(t)) environment.push("atmospheric fog depth");

  return {
    ok: true,
    request,
    shelves,
    character: { emotionReading, identityFree: true },
    action: motion ? (emotionReading ? `${emotionReading.bodyState} ${motion.motion}` : motion.motion) : null,
    emotion: emotionReading?.emotion ?? null,
    motion: motion && motion.status !== "EXCLUDED" ? { grammar: motion.motion, status: motion.status } : null,
    scene: intent.environmentType ?? (environment[0] ?? null),
    environment,
    camera: {
      angle: intent.cameraAngle ?? null,
      lane: CAMERA_LANES.filter((l) => l.supported).map((l) => l.lane).join("/"),
    },
    lens: null, // no measured lens control exists; lens language stays palette-advisory
    composition: intent.composition ?? null,
    lighting: intent.lighting ?? (time === "night" && environment.includes("urban street") ? "practical streetlight register (advisory)" : null),
    weather,
    time,
    materials: [...(intent.materials ?? [])],
    engineeringConstraints: constraints,
    negativeConstraints: NEGATIVE_CONSTRAINTS,
    referenceProvenance: [...sceneRefs.refs, ...engRefs.refs],
    fallback: { action: FALLBACK.action, contract: FALLBACK.contract },
    explicitGenerationRequired: true,
  };
}
