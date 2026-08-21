/**
 * MOTION PROVIDER LAYER — one contract, two engines, an honest fallback.
 *
 * ONIQ already turns a shot's still into a moving clip through ONE path: the
 * worker's generateClip() → story-clip edge fn → Veo 3.1 Fast, DIRECT to
 * Google on the metered GOOGLE_AI_API_KEY (NOT the Lovable gateway — stills and
 * voices go through Lovable; Veo does not, and must stay direct). Veo is superb
 * and expensive: ~$0.15/s, ~₹100 for an 8s clip. The gap this module fills is
 * an economical OPEN-SOURCE motion engine (Wan2.2) beside Veo, so ordinary
 * walking/gesture/talking shots do not each cost ₹100.
 *
 * WHAT THIS MODULE IS. A PURE contract and policy — no network, no GPU, no Deno
 * or Node APIs — so every branch is unit-testable with mocks (owner: "validate
 * the provider contract using local/mock execution if real GPU is
 * unavailable"). It classifies a shot's motion need, orders the providers to
 * try, and runs them with a bounded fallback, returning the SAME clip artifact
 * the rest of the pipeline already consumes (bytes + mime + seconds, which the
 * worker writes to `${stem}.clip.mp4` and hands to probeAsset('clip') and
 * StoryFilm). The concrete engines — the Veo edge call, the Wan GPU call — are
 * INJECTED as each provider's `generate`, so this file commits to no provider,
 * no key and no hardware.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not enable anything, spend anything,
 * or provision a GPU. It does not route Veo through Lovable. It does not touch
 * story-still, story-voice, the actor semantics, StoryFilm or Remotion. Wiring
 * a live provider into the worker, and running a REAL clip, are separate,
 * owner-gated steps (Veo spends metered Google money; Wan needs a GPU host).
 */

/** The motion a shot needs, decided from the movie grammar it already carries. */
export type MotionClass =
  | "STATIC" // nothing moves — existing still
  | "CAMERA_ONLY" // only a camera move — existing still + Ken Burns/parallax
  | "CHARACTER_MOTION" // a person moves, unspecified — needs a real clip
  | "WALKING"
  | "TALKING"
  | "GESTURE"
  | "INTERACTION"; // two characters, or a character + object

/** True where the class needs a temporal clip (a still cannot carry it). */
export function classNeedsClip(cls: MotionClass): boolean {
  return cls !== "STATIC" && cls !== "CAMERA_ONLY";
}

/** The movie-grammar fields a shot already carries (subset of MovieShot). */
export type MotionShot = {
  /** `shot.motion` — subject movement + camera move, authored by story-plot. */
  motion?: string;
  /** `shot.dialogue` — a spoken line, when the beat needs it. */
  dialogue?: { speaker?: string; line?: string } | null;
  /** `shot.vfx` — an atmosphere cue. */
  vfx?: string;
  /** The scene text and narration, for verb detection. */
  still?: string;
  narration?: string;
};

const LOCOMOTION = /\b(walk|walks|walking|walked|run|runs|running|ran|step|steps|stride|strides|approach|approaches|approaching|enter|enters|entering|leave|leaves|leaving|climb|climbs|dance|dances|dancing|chase|chases|flee|flees)\b/i;
const GESTURE = /\b(gesture|gestures|gesturing|wave|waves|waving|reach|reaches|reaching|grab|grabs|hold|holds|lift|lifts|throw|throws|push|pushes|pull|pulls|point|points|pointing|clap|claps|nod|nods|shake|shakes|bow|bows|kneel|kneels|turn|turns|turning|lean|leans|sit|sits|stand|stands|rise|rises)\b/i;
const INTERACTION = /\b(hand(s)? (him|her|them|it)|give|gives|handed|passes|receives|hug|hugs|hugging|fight|fights|help|helps|greet|greets|together|toward each other|face each other|to the (man|woman|boy|girl|child|others?))\b/i;
const SPEECH = /\b(say|says|saying|said|speak|speaks|speaking|talk|talks|talking|tell|tells|shout|shouts|whisper|whispers|sing|sings|call|calls|ask|asks|reply|replies|answer|answers)\b/i;
const CAMERA_ONLY = /\b(push in|pull back|pan|tilt|tracking|crane|dolly|zoom|aerial|establishing|wide shot|slow push)\b/i;

/**
 * Classify ONE shot's motion need from its authored grammar. Conservative and
 * deterministic. Precedence: an explicit spoken line makes it TALKING; else the
 * strongest movement verb wins (interaction > walking > gesture); a shot with
 * only a camera word is CAMERA_ONLY; nothing at all is STATIC. Erring toward
 * the lighter class is deliberate — a missed motion cue costs a still, a false
 * motion cue costs a ₹100 clip.
 */
/** Camera-move phrases, stripped before subject-verb detection so "push in"
 *  and "pull back" (camera) do not read as the hand gestures "push"/"pull". */
const CAMERA_PHRASE =
  /\b(slow\s+)?(push\s*in|pull\s*(back|out)|crane\s*(up|down|rise)?|dolly\s*(in|out)?|zoom\s*(in|out)?|track(ing)?|pan(\s+(left|right|up|down))?|tilt(\s+(up|down))?)\b/i;
const CAMERA_PHRASE_G = new RegExp(CAMERA_PHRASE.source, "gi");

export function classifyShotMotion(shot: MotionShot): MotionClass {
  const text = `${shot.motion ?? ""} ${shot.still ?? ""} ${shot.narration ?? ""}`;
  const hasLine = Boolean(shot.dialogue && (shot.dialogue.line ?? "").trim());
  if (hasLine || SPEECH.test(text)) return "TALKING";

  // Subject-motion is judged on the text WITHOUT its camera vocabulary, so a
  // pure camera move never masquerades as a character gesture.
  const subject = text.replace(CAMERA_PHRASE_G, " ");
  if (INTERACTION.test(subject)) return "INTERACTION";
  if (LOCOMOTION.test(subject)) return "WALKING";
  if (GESTURE.test(subject)) return "GESTURE";

  const motion = shot.motion ?? "";
  if (motion.trim() && CAMERA_PHRASE.test(motion)) return "CAMERA_ONLY";
  if (motion.trim()) return "CHARACTER_MOTION"; // authored motion we could not narrow
  return "STATIC";
}

/** The request a provider is handed. Bytes in, one clip out. */
export type MotionRequest = {
  /** The story-still for this shot, base64 (the starting frame). */
  sourceStillBase64: string;
  sourceMime: string;
  /** The authored motion prompt (composeVideoPrompt output). */
  motionPrompt: string;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "9:16";
  /** Optional narration audio, for providers that lip-sync. */
  audioBase64?: string;
  /** Optional owner actor reference, for providers that accept identity refs. */
  actorReferenceUrl?: string;
  /** The classified need, for a provider that adapts its prompt. */
  motionClass: MotionClass;
};

/** The clip artifact — the SAME shape the worker already turns into shot.clip. */
export type MotionClip =
  | { ok: true; data: string; mime: string; seconds: number; provider: string }
  | { ok: false; reason: string; provider: string; class: "transient" | "permanent" };

/** Static, declarative facts about a provider — cost and hardware, per-engine. */
export type ProviderMeta = {
  name: string;
  kind: "oss" | "premium";
  /** Real money the moment it runs. */
  requiresGpu: boolean;
  /** For premium (Veo), the metered per-second cost; for OSS, GPU $/hr is
   *  separate and measured at deploy — left null until a real host exists. */
  inrPerSecond: number | null;
  /** Where the money goes — kept distinct so accounting never merges them. */
  billing: "google-metered" | "gpu-compute" | "none";
};

/** Veo 3.1 Fast, DIRECT to Google. Premium. ~$0.15/s ≈ ₹12.6/s. */
export const VEO_META: ProviderMeta = {
  name: "veo-3.1-fast",
  kind: "premium",
  requiresGpu: false,
  inrPerSecond: 12.6,
  billing: "google-metered",
};

/** Wan2.2 (TI2V-5B / I2V), self-hosted OSS. GPU-bound; $/s TBD at deploy. */
export const WAN22_META: ProviderMeta = {
  name: "wan2.2-ti2v-5b",
  kind: "oss",
  requiresGpu: true,
  inrPerSecond: null,
  billing: "gpu-compute",
};

/** A provider: its metadata, whether it can run now, and how it generates. */
export type MotionProvider = {
  meta: ProviderMeta;
  /** False when the engine is not deployed/allowed — it is skipped, not tried. */
  available: () => boolean;
  /** The injected engine. Never called when `available()` is false. */
  generate: (req: MotionRequest) => Promise<MotionClip>;
};

export type MotionPolicy = {
  /** Allow the premium (paid) provider at all. Off by default — owner-gated. */
  allowPremium: boolean;
  /** Classes for which premium is worth its cost even when OSS is available. */
  premiumClasses?: MotionClass[];
};

/**
 * The provider order for a shot, most-preferred first. A still-only class
 * returns [] — the caller keeps the existing still/depth path. Otherwise OSS
 * leads (economical); premium (Veo) is appended only when policy allows it, and
 * moved to the FRONT for the classes named premium-worthy. Unavailable
 * providers are dropped here so the runner never starts a dead engine.
 */
export function selectProviderOrder(
  cls: MotionClass,
  providers: MotionProvider[],
  policy: MotionPolicy,
): MotionProvider[] {
  if (!classNeedsClip(cls)) return [];
  const oss = providers.filter((p) => p.meta.kind === "oss" && p.available());
  const premium = policy.allowPremium
    ? providers.filter((p) => p.meta.kind === "premium" && p.available())
    : [];
  const premiumFirst = (policy.premiumClasses ?? []).includes(cls);
  return premiumFirst ? [...premium, ...oss] : [...oss, ...premium];
}

/**
 * Run the ordered providers with a bounded fallback: the first `ok` clip wins;
 * a provider that fails transiently or returns unusable output falls through to
 * the next; when all are spent the result is `{ ok:false }` and the CALLER uses
 * the existing still/depth fallback. A permanent failure (auth/quota/bad
 * request) on one provider still lets the next try — a different engine may not
 * share the fault. NEVER reports a still as a clip: only a real provider clip is
 * `ok:true`.
 */
export async function runMotion(
  req: MotionRequest,
  order: MotionProvider[],
): Promise<{ clip: MotionClip | null; tried: { provider: string; reason: string }[] }> {
  const tried: { provider: string; reason: string }[] = [];
  for (const p of order) {
    let out: MotionClip;
    try {
      out = await p.generate(req);
    } catch (e) {
      out = {
        ok: false,
        reason: String((e as { message?: string })?.message ?? e).slice(0, 200),
        provider: p.meta.name,
        class: "transient",
      };
    }
    if (out.ok) return { clip: out, tried };
    tried.push({ provider: out.provider, reason: out.reason });
  }
  return { clip: null, tried };
}
