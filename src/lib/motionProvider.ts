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
  /** The finer driver class (WALK/RUN/WAVE/…), for a motion-transfer provider
   *  to pick its driver. Optional — the transfer provider derives a coarse one
   *  from motionClass when absent. */
  driverClass?: MotionDriverClass;
};

/** The clip artifact — the SAME shape the worker already turns into shot.clip.
 *  Carries EXACTLY ONE of `data` (base64, the edge/Veo path) or `videoPath` (a
 *  file, the GPU-backend path); the worker handles both. */
export type MotionClip =
  | { ok: true; data?: string; videoPath?: string; mime: string; seconds: number; provider: string }
  | { ok: false; reason: string; provider: string; class: "transient" | "permanent" };

/** Static, declarative facts about a provider — cost and hardware, per-engine. */
export type ProviderMeta = {
  name: string;
  kind: "oss" | "premium";
  /** The engine shape: pose-warp (CPU 2D auto-rig + retarget, no diffusion),
   *  motion-transfer (diffusion driver-conditioned), i2v (image-to-video), or
   *  premium (paid API). Sets the preference order per shot. */
  role: "pose-warp" | "motion-transfer" | "i2v" | "premium";
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
  role: "premium",
  requiresGpu: false,
  inrPerSecond: 12.6,
  billing: "google-metered",
};

/** Wan2.2 (TI2V-5B / I2V), self-hosted OSS. GPU-bound; $/s TBD at deploy. */
export const WAN22_META: ProviderMeta = {
  name: "wan2.2-ti2v-5b",
  kind: "oss",
  role: "i2v",
  requiresGpu: true,
  inrPerSecond: null,
  billing: "gpu-compute",
};

/** Motion Mirror (Wan2.1-VACE) motion-TRANSFER, self-hosted OSS. GPU-bound.
 *  Drives ONIQ's own character still with a reference motion video — the
 *  economical primary for ordinary body action. $/s measured at deploy. */
export const MOTION_MIRROR_META: ProviderMeta = {
  name: "motion-mirror-wan2.1-vace",
  kind: "oss",
  role: "motion-transfer",
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
/** Ordinary body action is a good fit for motion TRANSFER (a driver exists);
 *  complex/generative shots lean on i2v. Decides the OSS sub-order. */
function classPrefersTransfer(cls: MotionClass): boolean {
  return cls === "WALKING" || cls === "GESTURE" || cls === "TALKING";
}

export function selectProviderOrder(
  cls: MotionClass,
  providers: MotionProvider[],
  policy: MotionPolicy,
): MotionProvider[] {
  if (!classNeedsClip(cls)) return [];
  const avail = providers.filter((p) => p.available());
  const oss = avail.filter((p) => p.meta.kind === "oss");
  // CPU pose-warp is the cheapest OSS engine → always leads (it fails over to
  // the diffusion engines for shots it cannot serve). Among the diffusion
  // engines, ordinary action → transfer first, complex → i2v.
  const warp = oss.filter((p) => p.meta.role === "pose-warp");
  const transfer = oss.filter((p) => p.meta.role === "motion-transfer");
  const i2v = oss.filter((p) => p.meta.role === "i2v");
  const diffusion = classPrefersTransfer(cls) ? [...transfer, ...i2v] : [...i2v, ...transfer];
  const ossOrdered = [...warp, ...diffusion];
  const premium = policy.allowPremium ? avail.filter((p) => p.meta.kind === "premium") : [];
  const premiumFirst = (policy.premiumClasses ?? []).includes(cls);
  return premiumFirst ? [...premium, ...ossOrdered] : [...ossOrdered, ...premium];
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

// ── MOTION TRANSFER (Motion Mirror / Wan2.1-VACE architecture) ───────────────
//
// A different shape from text/image-to-video: instead of asking a model to
// INVENT body mechanics, motion transfer takes ONIQ's already-correct character
// still and drives it with a reference MOTION video — a "driver". The driver
// supplies movement ONLY, never identity: ONIQ's still already fixes who the
// character is (age/gender/ethnicity/occupation/clothing/role), so the driver
// just says "walk". Modelled on Motion Mirror (halli75/motion-mirror,
// Wan2.1-VACE): character image → segmentation → pose (DWPose, body+hands+face)
// → VACE conditioning → video → audio mux. Those GPU stages live behind
// MotionBackend; nothing here imports torch, provisions a GPU, or touches
// StoryFilm / Remotion / story-plot / story-still / story-voice.

/** WHAT a character does — the movement a driver supplies. */
export type MotionDriverClass =
  | "WALK" | "RUN" | "TURN" | "SIT" | "STAND" | "WAVE" | "POINT"
  | "TALK" | "CARRY" | "LOOK_AROUND" | "DANCE" | "FIGHT" | "CUSTOM";

/**
 * The finer driver class for a shot, from the SAME movie grammar the still and
 * clip already use. null for still-only shots (STATIC / CAMERA_ONLY) — those
 * never get a driver. The current shot's own words choose the movement; no
 * stored actor metadata is consulted (ACTOR ASSET ≠ PERMANENT BIOGRAPHY).
 */
export function classifyMotionDriver(shot: MotionShot): MotionDriverClass | null {
  const cls = classifyShotMotion(shot);
  if (!classNeedsClip(cls)) return null;
  if (cls === "TALKING") return "TALK";
  const t = `${shot.motion ?? ""} ${shot.still ?? ""} ${shot.narration ?? ""}`
    .toLowerCase()
    .replace(CAMERA_PHRASE_G, " ");
  if (/\b(run|runs|running|ran|sprints?|sprinting)\b/.test(t)) return "RUN";
  if (/\b(walk|walks|walking|walked|steps?|stride|strides|approach\w*|enter\w*|leav\w*|climb\w*)\b/.test(t)) return "WALK";
  if (/\b(danc\w+)\b/.test(t)) return "DANCE";
  if (/\b(fight\w*|punch\w*|strike\w*)\b/.test(t)) return "FIGHT";
  if (/\b(wave|waves|waving)\b/.test(t)) return "WAVE";
  if (/\b(point|points|pointing)\b/.test(t)) return "POINT";
  if (/\b(turns?|turning)\b/.test(t)) return "TURN";
  if (/\b(looks? (around|behind|back)|glanc\w+)\b/.test(t)) return "LOOK_AROUND";
  if (/\b(sit|sits|sitting|kneel\w*)\b/.test(t)) return "SIT";
  if (/\b(stand|stands|standing|rises?|rising|gets? up)\b/.test(t)) return "STAND";
  if (/\b(carry|carries|carrying|hold\w*|lift\w*)\b/.test(t)) return "CARRY";
  return "CUSTOM";
}

/** The coarse fallback when only the broad class is known. */
function coarseDriver(cls: MotionClass): MotionDriverClass | null {
  if (!classNeedsClip(cls)) return null;
  if (cls === "WALKING") return "WALK";
  if (cls === "TALKING") return "TALK";
  if (cls === "GESTURE") return "WAVE";
  return "CUSTOM";
}

/** A reference motion clip: movement only, no identity. */
export type MotionDriver = {
  id: string;
  motionClass: MotionDriverClass;
  /** Path/ref to the driver clip (a fixture today; a real reference later). */
  driverVideo: string;
  durationSeconds: number;
  fps: number;
  aspectRatio: "9:16";
  /** Provenance of the MOVEMENT (never the character). */
  source: string;
  license: string;
};

/** The first driver in the registry matching the class, or null. */
export function selectMotionDriver(
  driverClass: MotionDriverClass,
  registry: MotionDriver[],
): MotionDriver | null {
  return registry.find((d) => d.motionClass === driverClass) ?? null;
}

/** What a motion-transfer backend is handed — the common benchmark contract
 *  every candidate engine is evaluated against. Still + driver in, clip out. */
export type MotionTransferInput = {
  characterStillBase64: string;
  characterMime: string;
  driver: MotionDriver;
  /** The classified need, so a backend can tune conditioning. */
  motionClass: MotionClass;
  durationSeconds: 4 | 6 | 8;
  aspectRatio: "9:16";
  /** Target render size, "WxH" (e.g. "480x832" for the VACE 1.3B path). */
  resolution?: string;
  /** Narration for the optional lip-sync stage (TALK shots). */
  audioBase64?: string;
  /** Whole-body conditioning toggles (Motion Mirror conditions all three). */
  conditioning?: { body?: boolean; hands?: boolean; face?: boolean };
};

/** The backend's result — a file on disk (GPU backends write one), with the
 *  measured facts a caller needs. The owner's benchmark contract. */
export type MotionResult =
  | {
      ok: true;
      videoPath: string;
      durationSeconds: number;
      fps: number;
      provider: string;
      metadata?: Record<string, unknown>;
    }
  | { ok: false; reason: string; provider: string; class: "transient" | "permanent" };

/**
 * The inference host. `mock` proves the DATA PATH with no GPU; `local-gpu` and
 * `remote-gpu` are the real backends added later. The Story Worker stays
 * CPU/orchestration only — a real backend runs OUT of process (a GPU worker or
 * API), never by installing torch/CUDA/Wan weights into the ordinary worker.
 */
export type MotionBackend = {
  kind: "mock" | "local-gpu" | "remote-gpu";
  available: () => boolean;
  run: (input: MotionTransferInput) => Promise<MotionResult>;
};

/**
 * The mock backend: exercises still → driver → MotionResult → MotionClip →
 * (shot.clip) without a GPU. It fabricates NO pixels and claims NO real motion —
 * `videoPath` is a `mock://` sentinel, not a file, so nothing downstream can
 * mistake it for a real clip. A real backend writes a real mp4 and returns its
 * path in exactly this shape. This is the local/mock validation the directive
 * calls for; a real walking clip waits on a GPU host.
 */
export function mockBackend(): MotionBackend {
  return {
    kind: "mock",
    available: () => true,
    run: (input) =>
      Promise.resolve({
        ok: true as const,
        videoPath: `mock://motion-transfer/${input.driver.id}/${input.durationSeconds}s`,
        durationSeconds: input.durationSeconds,
        fps: input.driver.fps,
        provider: MOTION_MIRROR_META.name,
        metadata: { mock: true, driver: input.driver.id, motionClass: input.motionClass },
      }),
  };
}

/**
 * A motion-transfer MotionProvider bound to a backend and a driver registry. It
 * picks the driver for the shot (fine class if given, else coarse), and fails
 * over cleanly — no matching driver → a PERMANENT miss so runMotion falls to
 * the next provider (Wan i2v, then Veo, then the caller's still/depth). Never
 * substitutes a driver from a different movement.
 */
export function makeMotionTransferProvider(
  backend: MotionBackend,
  registry: MotionDriver[],
  meta: ProviderMeta = MOTION_MIRROR_META,
): MotionProvider {
  return {
    meta,
    available: () => backend.available(),
    generate: (req) => {
      const driverClass = req.driverClass ?? coarseDriver(req.motionClass);
      if (!driverClass) {
        return Promise.resolve({
          ok: false as const,
          reason: "still-only shot has no motion driver",
          provider: meta.name,
          class: "permanent" as const,
        });
      }
      const driver = selectMotionDriver(driverClass, registry);
      if (!driver) {
        return Promise.resolve({
          ok: false as const,
          reason: `no driver in registry for ${driverClass}`,
          provider: meta.name,
          class: "permanent" as const,
        });
      }
      return backend
        .run({
          characterStillBase64: req.sourceStillBase64,
          characterMime: req.sourceMime,
          driver,
          motionClass: req.motionClass,
          durationSeconds: req.durationSeconds,
          aspectRatio: req.aspectRatio,
          audioBase64: req.audioBase64,
          conditioning: { body: true, hands: true, face: true },
        })
        .then((r): MotionClip =>
          r.ok
            ? {
                ok: true,
                videoPath: r.videoPath,
                mime: "video/mp4",
                seconds: r.durationSeconds,
                provider: meta.name,
              }
            : { ...r, provider: meta.name },
        );
    },
  };
}

/**
 * THE WINNER (Phase-3 engine comparison, MOTION_ENGINE_MATRIX.md): official
 * Wan2.1-VACE 1.3B, used DIRECTLY — not the Motion Mirror wrapper. It runs the
 * same (character image + pose-video driver) contract NATIVELY (VACE R2V+V2V),
 * at native 480×832, on ~8 GB VRAM (12 GB is the safe production floor), under
 * Apache-2.0 for BOTH code and weights — the cleanest license in the set, with
 * no InsightFace and, crucially, none of the CC-BY-NC-SA distill LoRA that
 * contaminates Motion Mirror's 1.3B path. Same MotionBackend contract; the real
 * backend runs OUT of process on a GPU host (owner-gated).
 */
export const VACE_1_3B_META: ProviderMeta = {
  name: "wan2.1-vace-1.3b",
  kind: "oss",
  role: "motion-transfer",
  requiresGpu: true,
  inrPerSecond: null,
  billing: "gpu-compute",
};

/** The winner's provider factory — a motion-transfer provider on VACE 1.3B. */
export function makeVaceMotionProvider(
  backend: MotionBackend,
  registry: MotionDriver[],
): MotionProvider {
  return makeMotionTransferProvider(backend, registry, VACE_1_3B_META);
}

// ── L4 VACE RUN SPEC — the exact, owner-gated GPU invocation (Phase 9) ─────────
//
// This is DATA + a pure arg builder. It runs NOTHING here: no torch, no CUDA, no
// GPU, no spend. A GPU host injects a runner that executes these args OUT of
// process (per the MotionBackend design) and returns the produced mp4. Kept in
// code so "the exact command/backend required" is versioned, not a doc guess.

export type VaceRunSpec = {
  /** Minimum VRAM that runs the 1.3B path (GB). 8 verified, 12 the safe floor. */
  minVramGb: number;
  recommendedVramGb: number;
  /** Native portrait size for the 1.3B path — no re-crop for ONIQ's 9:16. */
  resolution: "480x832";
  /** Where the Apache-2.0 weights live on the GPU host. */
  ckptDir: string;
  task: "vace-1.3B";
};

/** The verified minimum config (MOTION_ENGINE_MATRIX.md): 8 GB VRAM runs it,
 *  12 GB is the safe production floor. Fits RTX 3060 12 GB / T4 16 GB / 4090. */
export const VACE_1_3B_RUN: VaceRunSpec = {
  minVramGb: 8,
  recommendedVramGb: 12,
  resolution: "480x832",
  ckptDir: "./models/Wan2.1-VACE-1.3B",
  task: "vace-1.3B",
};

/**
 * Build the EXACT `generate.py` args for ONE shot: reference image = IDENTITY,
 * pose-control video = MOTION, plus a MOTION-ONLY prompt. Identity comes ONLY
 * from the reference image; the prompt describes movement, never the character's
 * permanent biography (ACTOR ASSET ≠ PERMANENT BIOGRAPHY). There is no character/
 * appearance parameter here BY DESIGN, so an actor's traits can never leak into
 * the motion prompt.
 */
export function buildVaceArgs(a: {
  spec: VaceRunSpec;
  /** Path on the GPU host to the character still (identity). */
  refImagePath: string;
  /** Path on the GPU host to the pose-control video derived from the driver. */
  poseControlPath: string;
  /** Movement description only (e.g. "a person walking forward"). */
  motionPrompt: string;
  /** Frame count (worker-measured), and where to write the mp4. */
  frames: number;
  saveFile: string;
}): string[] {
  return [
    "generate.py",
    "--task", a.spec.task,
    "--size", a.spec.resolution.replace("x", "*"),
    "--ckpt_dir", a.spec.ckptDir,
    "--src_ref_images", a.refImagePath,
    "--src_video", a.poseControlPath,
    "--frame_num", String(a.frames),
    "--prompt", a.motionPrompt,
    "--save_file", a.saveFile,
  ];
}

/**
 * The out-of-process GPU runner a real backend delegates to. `ready()` is true
 * ONLY when a GPU host with ≥ minVramGb is actually reachable; `exec` runs the
 * args and returns the produced mp4. No such runner exists in the CPU worker, so
 * the backend below is unavailable there — and unavailability means the provider
 * misses and the caller falls to the still, NEVER a fabricated clip.
 */
export type VaceGpuRunner = {
  ready: () => boolean;
  exec: (args: string[], input: MotionTransferInput) => Promise<{ videoPath: string; fps: number }>;
};

/**
 * A real GPU motion-transfer backend (local-gpu / remote-gpu). Injecting `null`
 * (or a runner whose `ready()` is false) yields an UNAVAILABLE backend — the
 * fail-closed default everywhere a GPU is not provisioned. It imports no torch
 * and provisions nothing; all GPU work is the injected runner's, out of process.
 */
export function gpuVaceBackend(
  spec: VaceRunSpec,
  runner: VaceGpuRunner | null,
  kind: "local-gpu" | "remote-gpu" = "remote-gpu",
): MotionBackend {
  return {
    kind,
    available: () => runner?.ready() === true,
    run: async (input) => {
      if (!runner || !runner.ready()) {
        return {
          ok: false as const,
          reason: "no GPU host configured for VACE 1.3B (>=8GB VRAM required)",
          provider: VACE_1_3B_META.name,
          class: "permanent" as const,
        };
      }
      const args = buildVaceArgs({
        spec,
        refImagePath: `ref://${input.driver.id}`,
        poseControlPath: `pose://${input.driver.id}`,
        motionPrompt: motionOnlyPrompt(input.motionClass),
        frames: Math.round(input.durationSeconds * input.driver.fps),
        saveFile: `clip://${input.driver.id}.mp4`,
      });
      const out = await runner.exec(args, input);
      return {
        ok: true as const,
        videoPath: out.videoPath,
        durationSeconds: input.durationSeconds,
        fps: out.fps,
        provider: VACE_1_3B_META.name,
        metadata: { backend: kind, resolution: spec.resolution, args },
      };
    },
  };
}

/** A movement-only prompt from the classified motion — never actor biography. */
export function motionOnlyPrompt(cls: MotionClass): string {
  switch (cls) {
    case "WALKING":
      return "a person walking forward, natural gait, full body";
    case "TALKING":
      return "a person speaking, subtle upper-body movement";
    case "GESTURE":
      return "a person gesturing with the arms, natural motion";
    case "INTERACTION":
      return "a person interacting, natural full-body motion";
    case "CHARACTER_MOTION":
      return "a person moving naturally, full body";
    default:
      return "natural human motion";
  }
}

/**
 * THE CHEAP TIER (Phase 4, MOTION_COST_ARCHITECTURE.md): Meta Animated Drawings
 * — single character image → auto-segment → auto-rig → retarget a BVH motion →
 * ARAP 2D render. The ONLY OSS motion engine that runs **CPU-only** (no GPU),
 * MIT for BOTH code and weights, commercial-clean. It suits ONIQ's storybook-
 * illustrated stills (it is uncanny only for photoreal, which ONIQ is not). It
 * consumes BVH motion, not a pose-video — so its driver library is BVH clips,
 * distinct from the diffusion tier's pose-video drivers. Serves frontal /
 * full-body / unoccluded / single stylised humanoids; other framings escalate
 * to the diffusion tier. requiresGpu:false is the whole point.
 */
export const ANIMATED_DRAWINGS_META: ProviderMeta = {
  name: "animated-drawings",
  kind: "oss",
  role: "pose-warp",
  requiresGpu: false,
  inrPerSecond: null,
  billing: "cpu-runner",
};

/** A MotionDriverRegistry is just the drivers; helpers keep lookups honest. */
export type MotionDriverRegistry = MotionDriver[];

/** The drivers matching a class (usually 0 or 1). */
export function driversForClass(
  registry: MotionDriverRegistry,
  cls: MotionDriverClass,
): MotionDriver[] {
  return registry.filter((d) => d.motionClass === cls);
}

/**
 * Which driver classes the registry can actually drive TODAY — a driver counts
 * only when it has a real, non-placeholder video and a real license. The
 * descriptors shipped now are placeholders (no video, license "TBD-*"), so this
 * is empty until real CC0/permissive drivers are added — an honest "nothing is
 * wired yet", never a false capability.
 */
export function usableDriverClasses(registry: MotionDriverRegistry): MotionDriverClass[] {
  const usable = registry.filter(
    (d) =>
      d.driverVideo &&
      !/\bTBD\b|placeholder/i.test(d.license ?? "") &&
      !/\bTBD\b|placeholder/i.test(d.source ?? ""),
  );
  return [...new Set(usable.map((d) => d.motionClass))];
}
