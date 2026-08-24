// videoAudio — what sound a generated shot has, and who paid for it.
//
// ============================================================================
// THE FINDING THAT DECIDES THIS FILE
// ============================================================================
//
// ONIQ calls Veo on `generativelanguage.googleapis.com/v1beta` — the Gemini
// Developer API (AI Studio). Google's own SDK, @google/genai 2.18.0, in
// `generateVideosConfigToMldev`:
//
//   if (getValueByPath(fromObject, ['generateAudio']) !== undefined) {
//     throw new Error('generateAudio parameter is only supported in Gemini
//       Enterprise Agent Platform mode, not in Gemini Developer API mode.');
//   }
//
// The Agent Platform converter, twenty lines later, maps it through:
//
//   setValueByPath(parentObject, ['parameters', 'generateAudio'], fromGenerateAudio);
//
// So on ONIQ's CURRENT SURFACE THERE IS NO WAY TO ASK VEO NOT TO GENERATE
// AUDIO. This matches the live probe of 2026-08-24, where all six spellings of
// the parameter returned 400 and Lite handed back an AAC track anyway.
//
// Three consequences, and they invert the obvious intuition:
//
//  1. VIDEO_ONLY IS NOT ACHIEVABLE on this surface. Requesting it is a wish,
//     not a setting; the audio is generated and billed either way.
//  2. THE AUDIO IS ALREADY PAID FOR. At the margin, native audio on this
//     surface is FREE — the money left the account the moment the clip was
//     generated. Discarding it is therefore the only actual waste, which is
//     exactly the invariant: never pay for audio and then throw it away.
//  3. THE CHEAPER VIDEO-ONLY TIER IS A DIFFERENT SURFACE. Reaching it means
//     moving ONIQ's video calls to the Gemini Enterprise Agent Platform — a
//     provider-and-account change, and therefore an OWNER DECISION under
//     CLAUDE.md, not an engineering one.
//
// ============================================================================
// WHY ONIQ MUTES TODAY, AND WHY THAT IS NOT SIMPLY A BUG
// ============================================================================
//
// remotion/src/story/StoryFilm.tsx renders every clip `muted`, with the reason
// written next to it: "Veo writes its own soundtrack and the narration below is
// the film's only voice." That is a real architectural constraint, not an
// oversight. ONIQ Stories are NARRATION-AS-CLOCK: the narration wav defines how
// long each shot lasts, and character dialogue is TTS'd and concatenated into
// that same wav. Unmuting a narrated shot does not add richness — it adds a
// SECOND, unsynchronised voice reading different words over the first.
//
// So the fix is not "unmute everything". It is to decide, per shot, which of
// the three audio architectures the scene actually wants, and to RECORD the
// decision — including recording, explicitly, when native audio is discarded
// and why.

export type AudioMode = "VIDEO_ONLY" | "ONIQ_SOUND" | "VEO_NATIVE_AUDIO";

/**
 * WHICH GOOGLE SURFACE, in Google's own words.
 *
 * `google-agent-platform` is what the SDK's error string calls it — "Gemini
 * Enterprise Agent Platform" — and it is the same thing the SDK's internal
 * converter still names `...ToVertex` and the client option still spells
 * `vertexai: true`. One product, two names, and the error message is the one a
 * reader will actually hit, so that is the one used here.
 */
export type ProviderSurface =
  "google-ai-studio" | "google-agent-platform" | "runway" | "lovable-gateway";

/**
 * Can this surface be told whether to generate audio?
 *
 * VERIFIED 2026-08-24 against @google/genai 2.18.0's own request converters —
 * not from documentation prose, and not from a guess about what Vertex does.
 */
export const SURFACE_SUPPORTS_AUDIO_PARAM: Record<ProviderSurface, boolean> = {
  "google-ai-studio": false,
  "google-agent-platform": true,
  runway: false,
  "lovable-gateway": false,
};

/**
 * Parameters the Gemini Developer API accepts for video generation, read off
 * the same converter. Anything not on this list is rejected by the SDK before
 * it reaches the wire, and 400s if sent by hand — which is how story-clip's
 * strip-on-400 ladder came to exist.
 */
export const AI_STUDIO_VIDEO_PARAMS = [
  "sampleCount",
  "durationSeconds",
  "aspectRatio",
  "resolution",
  "personGeneration",
  "negativePrompt",
  "enhancePrompt",
  "lastFrame",
  "referenceImages",
] as const;

/** Rejected outright on the Gemini Developer API. `generateAudio` is here. */
export const AI_STUDIO_REJECTED_VIDEO_PARAMS = [
  "outputGcsUri",
  "fps",
  "seed",
  "pubsubTopic",
  "generateAudio",
  "mask",
  "compressionQuality",
  "labels",
  "resizeMode",
] as const;

// ---------------------------------------------------------------- resolution
export type ResolvedAudio = {
  /** What the shot asked for. */
  requested: AudioMode;
  /** What it will actually get on this surface. */
  effective: AudioMode;
  /** Could the surface honour the request exactly? */
  achievable: boolean;
  /** Does the provider generate (and bill for) audio regardless? */
  providerAudioBilled: boolean;
  /** Must ONIQ keep the provider's audio track in the final mix? */
  preserveProviderAudio: boolean;
  /**
   * Set when provider audio exists and will NOT be used. Never empty when
   * audio is discarded — a silent discard is the thing being banned.
   */
  discardReason?: string;
  /** One line for the ledger's `detail` and for the architecture report. */
  note: string;
};

export function resolveAudioMode(requested: AudioMode, surface: ProviderSurface): ResolvedAudio {
  const canAsk = SURFACE_SUPPORTS_AUDIO_PARAM[surface];

  // The surface can be told. Everything is achievable and nothing is wasted.
  if (canAsk) {
    if (requested === "VEO_NATIVE_AUDIO") {
      return {
        requested,
        effective: requested,
        achievable: true,
        providerAudioBilled: true,
        preserveProviderAudio: true,
        note: `${surface}: generateAudio=true requested and preserved`,
      };
    }
    return {
      requested,
      effective: requested,
      achievable: true,
      providerAudioBilled: false,
      preserveProviderAudio: false,
      note: `${surface}: generateAudio=false — no provider audio generated or billed`,
    };
  }

  // The surface cannot be told. Audio is generated and billed no matter what.
  if (requested === "VEO_NATIVE_AUDIO") {
    return {
      requested,
      effective: "VEO_NATIVE_AUDIO",
      achievable: true,
      providerAudioBilled: true,
      preserveProviderAudio: true,
      note: `${surface}: no audio parameter exists; native audio is generated anyway and IS used`,
    };
  }

  // VIDEO_ONLY and ONIQ_SOUND both mean "do not use the provider's audio".
  // On this surface that audio still gets made and still gets billed, so the
  // honest record is: requested X, got audio, discarded it, here is why.
  const why =
    requested === "VIDEO_ONLY"
      ? "scene calls for silence; provider audio cannot be declined on this surface"
      : "ONIQ narration is the film's clock and its only voice — a second unsynchronised voice would collide";
  return {
    requested,
    effective: requested,
    // The AUDIO OUTCOME is achievable (the track is dropped); what is not
    // achievable is avoiding the charge. Saying `false` here is what stops a
    // caller believing it selected the cheap tier.
    achievable: false,
    providerAudioBilled: true,
    preserveProviderAudio: false,
    discardReason: why,
    note: `${surface}: billed WITH audio regardless; track discarded — ${why}`,
  };
}

// ---------------------------------------------------------------- the router
/**
 * What the router gets to look at. Deliberately the ONIQ shot's own fields
 * plus the scene text — no model call, no extra spend, and no second router.
 */
export type ShotAudioSignals = {
  /** ONIQ TTS narration is mounted on this shot. */
  hasNarration: boolean;
  /** ONIQ TTS dialogue is concatenated into the shot's audio. */
  hasOniqDialogue: boolean;
  /** An ONIQ ambience bed or score plays under this shot. */
  hasOniqAmbience: boolean;
  /** The motion/vfx/dialogue prompt text the shot will be generated from. */
  promptText: string;
};

/** Spoken words in the scene itself — the strongest pull toward native audio. */
const SPEECH = /\b(says?|said|speaks?|shouts?|whispers?|calls? out|replies|asks?|sings?)\b|["“”']/i;

/** Sound that must land on the same frame as the picture. */
const SYNC_SFX =
  /\b(explosion|explodes?|crash(es|ing)?|smash(es|ing)?|shatter|gunshot|thunder|slam|footsteps?|clatter|splash|door|knock|applause|hoof|gallop)\b/i;

/** Environmental sound with no frame-accurate requirement. */
const AMBIENT =
  /\b(rain|wind|waves?|forest|market|crowd|traffic|fire|crackl|birds?|river|storm|bazaar)\b/i;

/** The scene is meant to be quiet. */
const SILENT = /\b(silent|silence|soundless|no sound|wordless|mute)\b/i;

export type AudioRouting = {
  mode: AudioMode;
  /** Why, in one line. Recorded on the ledger row — never inferred later. */
  because: string;
};

/**
 * Infer the audio architecture a shot wants.
 *
 * THE ORDER MATTERS AND IT IS NOT "richest wins".
 *
 * ONIQ audio comes first because it is a HARD collision, not a preference: a
 * shot whose length is defined by a narration wav, with ONIQ's own TTS dialogue
 * inside it, cannot also carry Veo's voice track. That is two people saying
 * different words at once, and no mix fixes it.
 *
 * Only a shot with NO ONIQ voice is free to take the provider's audio — and
 * then the question is whether the scene has sound that must be frame-accurate
 * (native audio's real advantage) or merely atmospheric (which ONIQ's own
 * ambience beds already do, under ONIQ's control).
 */
export function inferAudioMode(s: ShotAudioSignals): AudioRouting {
  const text = s.promptText ?? "";

  if (s.hasNarration || s.hasOniqDialogue) {
    return {
      mode: "ONIQ_SOUND",
      because: s.hasOniqDialogue
        ? "ONIQ already voices this shot's dialogue; a provider voice track would double it"
        : "narration is this shot's clock and its only voice",
    };
  }

  if (SILENT.test(text)) {
    return { mode: "VIDEO_ONLY", because: "the scene asks for silence" };
  }

  if (SPEECH.test(text)) {
    return {
      mode: "VEO_NATIVE_AUDIO",
      because: "the shot contains speech, which only synchronised native audio can lip-match",
    };
  }

  if (SYNC_SFX.test(text)) {
    return {
      mode: "VEO_NATIVE_AUDIO",
      because: "the shot has sound that must land on the same frame as the picture",
    };
  }

  if (AMBIENT.test(text)) {
    // Atmosphere is the one case where ONIQ's own pipeline is genuinely better:
    // its beds are level-controlled, faded at the seams, and consistent across a
    // whole film, where a per-clip generated bed changes character every cut.
    return {
      mode: s.hasOniqAmbience ? "ONIQ_SOUND" : "VEO_NATIVE_AUDIO",
      because: s.hasOniqAmbience
        ? "atmosphere only — ONIQ's own ambience bed is level-controlled and consistent across the film"
        : "atmosphere with no ONIQ bed to carry it",
    };
  }

  // Nothing in the scene asks for sound. Not silence-by-default: silence
  // BECAUSE nothing was found, which is a different claim and is recorded as one.
  return {
    mode: "VIDEO_ONLY",
    because: "no speech, synchronised effect or atmosphere found in the shot",
  };
}

/**
 * The end-to-end decision for one shot: what it wants, what the surface can
 * do, and what the ledger should record.
 */
export function planShotAudio(s: ShotAudioSignals, surface: ProviderSurface) {
  const routing = inferAudioMode(s);
  const resolved = resolveAudioMode(routing.mode, surface);
  return { ...resolved, because: routing.because };
}

// ---------------------------------------------------------------- verification
/**
 * What the finished media must look like for each mode. The request parameter
 * is NOT evidence — on this surface it cannot even be sent — so acceptance is
 * decided by probing the actual streams.
 */
export type MediaProbe = {
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  videoSeconds: number;
  audioSeconds: number;
  /** Peak/mean dBFS. A track present at -91 dB is silence with extra steps. */
  audioPeakDb?: number;
};

export type MediaVerdict = { ok: boolean; failures: string[] };

/** How far video and audio may differ before the mix is wrong, in seconds. */
export const AV_DRIFT_TOLERANCE_S = 0.25;

/** Below this, an "audio track" is not audio. Measured on ep1's silent build. */
export const SILENCE_FLOOR_DB = -60;

export function verifyFinalMedia(mode: AudioMode, p: MediaProbe): MediaVerdict {
  const failures: string[] = [];
  if (!p.hasVideoStream) failures.push("no video stream");
  if (!(p.videoSeconds > 0)) failures.push("video has no duration");

  if (mode === "VIDEO_ONLY") {
    // ONIQ deliberately adding its own bed is a different mode; here, quiet.
    if (p.hasAudioStream) failures.push("VIDEO_ONLY but an audio stream is present");
  } else {
    if (!p.hasAudioStream) {
      failures.push(`${mode} but there is no audio stream`);
    } else {
      if (typeof p.audioPeakDb === "number" && p.audioPeakDb <= SILENCE_FLOOR_DB) {
        failures.push(`${mode} but the audio track is silent (${p.audioPeakDb} dBFS)`);
      }
      if (Math.abs(p.audioSeconds - p.videoSeconds) > AV_DRIFT_TOLERANCE_S) {
        failures.push(
          `audio ${p.audioSeconds}s vs video ${p.videoSeconds}s exceeds ${AV_DRIFT_TOLERANCE_S}s drift`,
        );
      }
    }
  }
  return { ok: failures.length === 0, failures };
}
