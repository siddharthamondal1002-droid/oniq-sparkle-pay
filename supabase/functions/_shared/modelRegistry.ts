/**
 * THE MODEL REGISTRY — every model id the Story engine uses, in one file.
 *
 * WHY THIS EXISTS. Before 2026-08-16 the ids were spread across four files:
 * _shared/llm.ts held the text models, story-still and story-voice each held
 * their own gateway id, and story-clip held two Veo ids. Nothing recorded
 * which provider or which key any of them ran on, and nothing recorded when
 * Google intends to switch one off. The consequence is in the table below:
 * story-clip's fallback has been a dead id since 2026-06-30 and the code has
 * gone on retrying against it.
 *
 * WHAT THIS FILE IS NOT. It is not a place to change what ONIQ spends. The
 * provider split here is an OWNER DECISION, recorded 2026-08-14 in CLAUDE.md
 * after an agent moved the Story pipeline onto the metered Google key without
 * asking: stills and voice run on Lovable credits, clips run on the metered
 * Google key, text runs Claude-first with a Gemini fallback. Every id and
 * every provider below is carried over EXACTLY as it was found. Changing one
 * changes a bill, and that is a question, not a refactor.
 *
 * `shutdownOn` IS THE POINT. It is the date Google has published for the id
 * being switched off, and src/lib/__tests__/modelRegistry.test.ts fails the
 * build once today is past it. That turns "somebody has to remember to read
 * the deprecation page" into something the build says out loud. A null means
 * no published shutdown date is known — not that the model is safe forever.
 *
 * SOURCING: see GOOGLE_AI_RESEARCH.md. The dates below came from search
 * summaries of Google's own deprecation pages, because this environment's
 * egress proxy blocks ai.google.dev and docs.cloud.google.com outright. That
 * is second-hand and is labelled as such there; treat a `shutdownOn` as a
 * prompt to go and look, not as gospel.
 */

export type ModelStatus = "current" | "deprecated" | "shutdown" | "unknown";

/**
 * What a provider can actually do — the routing envelope.
 *
 * This is the FIRST brick of a provider-agnostic router: a future selector asks
 * "who can make an 8-second 9:16 clip from a reference frame?" and this is what
 * it reads. The same honesty rule as the rest of the file applies — a field is
 * filled only from EVIDENCE (the call site, or a sourced note), never guessed.
 * A limit this environment cannot verify (Google docs are egress-blocked) is
 * left `null`/`[]` with a note, NOT invented. `capabilityMatrix.test.ts` pins
 * the video envelope against story-clip's own constants so it cannot drift.
 */
export type Modality = "text" | "text-to-image" | "image-to-video" | "text-to-speech" | "retrieval";

/**
 * What a retrieval provider is FOR. smart-scout currently serves all of these
 * from one Opus-5-plus-web_search call; naming them separately is the first
 * step to routing them separately.
 */
export type RetrievalKind =
  | "GENERAL_SEARCH"
  | "PRODUCT_SEARCH"
  | "PRICE_COMPARISON"
  | "LOCAL_SEARCH"
  | "NEWS_SEARCH"
  | "IMAGE_SEARCH"
  | "VIDEO_SEARCH"
  | "GEOCODE";

/**
 * THE DISTINCTION THAT MATTERS, and the one ONIQ currently loses.
 *
 * `RETRIEVES` returns sources it did not author — a URL, a price, a
 * lat/long. Provenance survives, so a downstream layer can record
 * `source`, `retrieved_at` and `raw_price`.
 *
 * `MODEL_MEDIATED` means a model read the page and told you what it said.
 * The answer may be perfectly correct and still has no verifiable
 * provenance, because the value was authored by the model, not extracted
 * from a document ONIQ holds. smart-scout is MODEL_MEDIATED today.
 */
export type RetrievalFidelity = "RETRIEVES" | "MODEL_MEDIATED";

export type Capabilities = {
  modality: Modality;
  /** Retrieval only: what this provider can look up. null = not retrieval. */
  retrievalKinds?: RetrievalKind[] | null;
  /** Retrieval only: whether results carry verifiable provenance. */
  retrievalFidelity?: RetrievalFidelity | null;
  /** Retrieval only: can the CALLER pin which domains are searched? */
  domainRestriction?: boolean | null;
  /**
   * Retrieval only: USD per query at the provider's published rate, or null
   * when unpriced/unverified. Never guessed — an unpriced provider is a
   * provider ONIQ cannot budget for.
   */
  usdPerQuery?: number | null;
  /** Discrete clip durations the provider accepts, in seconds. null = not video. */
  durationsSec: number[] | null;
  /** Aspect ratios the provider emits. [] = unconstrained or unrecorded. */
  aspectRatios: string[];
  /** Accepts a reference image/frame as input. */
  referenceSupport: boolean;
  /** Its OWN output carries audio. (The clip stage is silent — the worker composites audio separately.) */
  audioSupport: boolean;
  /** Cleared for commercial use under the provider ToS, as far as recorded. null = unverified here. */
  commercialUse: boolean | null;
  /** Sourcing / limits, same labelling rule as the rest of the file. */
  note: string;
};

export type ModelEntry = {
  /** The exact string sent to the provider. */
  id: string;
  /** Who serves it, and therefore whose money it spends. */
  provider:
    | "anthropic"
    | "google-direct"
    | "lovable-gateway"
    /** ONIQ's own GPU worker: no provider, no credit pool, only GPU seconds. */
    | "oniq-gpu-worker";
  /**
   * The environment variable holding the credential. Never the value.
   * `null` for an in-house model — there is no credential, because there is
   * no third party to authenticate to.
   */
  keyEnv: string | null;
  /** Where it is called from, so a reader can find the caller. */
  usedBy: string;
  status: ModelStatus;
  /** Google's published switch-off date, ISO yyyy-mm-dd, or null if unknown. */
  shutdownOn: string | null;
  /** Why this id and not another. */
  note: string;
  /** What it can produce — the routing envelope. */
  capabilities: Capabilities;
};

/**
 * TEXT — planning, the shot list, dialogue.
 *
 * Claude first, Gemini as the fallback. Not a Google-only pipeline and never
 * has been; the audit found the fallback path is what kept films rendering
 * through an earlier Gemini text outage.
 */
export const TEXT_PRIMARY: ModelEntry = {
  id: "claude-sonnet-4-6",
  provider: "anthropic",
  keyEnv: "ANTHROPIC_API_KEY",
  usedBy:
    "_shared/llm.ts callClaude, callers that pass model:'claude-sonnet-4-6' (translate, health-scan)",
  status: "current",
  shutdownOn: null,
  // CORRECTED 2026-08-20 against the live client: this is NOT the callClaude
  // default. callClaude defaults to claude-opus-5 (TEXT_TOOLS) — verified in
  // _shared/llm.ts (`opts.model ?? "claude-opus-5"`) and in the successful
  // job 11d02818 run, where story-plot (which passes no model) ran on opus-5.
  // Sonnet-4-6 is selected only when a caller passes it explicitly.
  note: "Anthropic text baseline for callers that opt in explicitly. The pipeline default is TEXT_TOOLS.",
  capabilities: {
    modality: "text",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: false,
    commercialUse: true,
    note: "Text generation — plot, shot list, dialogue. Called via _shared/llm.ts callClaude.",
  },
};

export const TEXT_TOOLS: ModelEntry = {
  id: "claude-opus-5",
  provider: "anthropic",
  keyEnv: "ANTHROPIC_API_KEY",
  usedBy: "_shared/llm.ts callClaude DEFAULT (opts.model ?? this) + tool-calling path",
  status: "current",
  shutdownOn: null,
  // This is the ACTUAL callClaude default (opts.model ?? "claude-opus-5"), so
  // every caller that passes no model runs on it — story-plot, smart-scout,
  // ting, hotel-scout. Kept named TEXT_TOOLS for continuity; the pipeline text
  // default lives here, not in TEXT_PRIMARY.
  note: "The live callClaude default model, and the tool-use path.",
  capabilities: {
    modality: "text",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: false,
    commercialUse: true,
    note: "Text generation, tool-calling path only.",
  },
};

export const TEXT_FALLBACK: ModelEntry = {
  id: "gemini-3.6-flash",
  provider: "google-direct",
  keyEnv: "GOOGLE_AI_API_KEY",
  usedBy: "_shared/llm.ts callGemini",
  status: "current",
  shutdownOn: null,
  note:
    "Pinned, NOT gemini-flash-latest. A moving alias under a fallback changes " +
    "silently and is only discovered mid-outage, when the primary is already down.",
  capabilities: {
    modality: "text",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: false,
    commercialUse: true,
    note: "Text generation, the fallback when Claude is down. Called via _shared/llm.ts callGemini.",
  },
};

/**
 * IMAGE — the still each shot is animated from.
 *
 * ONIQ'S OWN ENGINE since the 2026-08-27 fully-in-house directive: the
 * `image_generate` op on ONIQ's GPU worker, which is LTX-Video over the
 * snapshot baked into that image, sampled at the shortest legal length with
 * frame 0 kept. It is the SAME model id the motion stage uses, because it is
 * literally the same weights opened as a different pipeline class — so there
 * is one model in the image, not two.
 *
 * This entry supersedes the gateway-served google/gemini-2.5-flash-image that
 * ran here under the 2026-08-14 directive. No key, no provider, no credit
 * pool: the only cost is this worker's own GPU seconds.
 */
export const IMAGE_STILL: ModelEntry = {
  id: "Lightricks/LTX-Video",
  provider: "oniq-gpu-worker",
  keyEnv: null,
  usedBy: "story-still",
  status: "active",
  shutdownOn: null,
  note:
    "In-house. Baked into the worker image at build time and loaded with " +
    "local_files_only, so no registry, hub or gateway is reachable at job " +
    "time and no external deprecation applies to it.",
  capabilities: {
    modality: "text-to-image",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: false,
    commercialUse: null,
    note:
      "Text-to-image by way of text-to-video: LTXPipeline at the shortest " +
      "legal frame count, frame 0 kept as a png at the VIDEO canvas so the " +
      "motion stage can animate it without a rescale at the seam. " +
      "referenceSupport is false and that is enforced, not assumed: " +
      "story-still refuses a reference with 422 rather than quietly drawing " +
      "an unconditioned frame.",
  },
};

/**
 * VOICE — narration and dialogue.
 *
 * Also the Lovable gateway, same directive, same reasoning.
 */
export const VOICE_TTS: ModelEntry = {
  id: "google/gemini-2.5-flash-tts",
  provider: "lovable-gateway",
  keyEnv: "LOVABLE_API_KEY",
  usedBy: "story-voice",
  status: "unknown",
  shutdownOn: null,
  note: "No published gateway lifecycle found. Left exactly as found.",
  capabilities: {
    modality: "text-to-speech",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: true,
    commercialUse: null,
    note: "Text-to-speech: story-voice returns s16le PCM the worker wraps as WAV.",
  },
};

/**
 * VIDEO — the clip stage, image-to-video.
 *
 * The one stage on the METERED Google key. $0.15/s list is what
 * storyCostModel.UNIT.usdPerVideoSecond was derived from, so the id and the
 * price chart move together — which is precisely why swapping it is an owner
 * decision and not a tidy-up.
 */
export const VIDEO_CLIP: ModelEntry = {
  id: "veo-3.1-fast-generate-preview",
  provider: "google-direct",
  keyEnv: "GOOGLE_AI_API_KEY",
  usedBy: "story-clip",
  status: "current",
  shutdownOn: null,
  note: "Preview id. storyCostModel's per-second price is derived from this tier.",
  capabilities: {
    modality: "image-to-video",
    // Sourced from story-clip/index.ts: `const DURATIONS = new Set([4, 6, 8])`
    // ("Veo accepts 4, 6 or 8 — there is no 10 on this API and no extend").
    durationsSec: [4, 6, 8],
    // Sourced from story-clip/index.ts: `const ASPECT = "9:16"`.
    aspectRatios: ["9:16"],
    // story-clip requires a starting frame (imageBase64); text-to-video "ignores
    // the style prompt entirely (measured 2026-08-08)", so image-to-video only.
    referenceSupport: true,
    // The clip stage is SILENT motion — the worker composites narration, dialogue,
    // ambience and score separately. Recorded as false to match how ONIQ uses it.
    audioSupport: false,
    commercialUse: null,
    note: "Image-to-video. Envelope pinned to story-clip's DURATIONS/ASPECT by capabilityMatrix.test.ts.",
  },
};

/**
 * THE DEAD FALLBACK, kept visible rather than quietly deleted.
 *
 * story-clip retries on this when the primary answers 404. Google shut the id
 * off on 2026-06-30, so the retry cannot succeed — it spends a round-trip and
 * then falls through to the same 502 it would have returned anyway. The
 * registry test fails on this entry, which is the intended behaviour: the
 * REPLACEMENT is a paid-tier choice (the surviving alternatives are the
 * non-fast preview, which costs more per second, or a GA id on a different
 * platform), so it is the owner's to make and this is how it gets raised.
 */
export const VIDEO_CLIP_FALLBACK: ModelEntry = {
  id: "veo-3.0-fast-generate-001",
  provider: "google-direct",
  keyEnv: "GOOGLE_AI_API_KEY",
  usedBy: "story-clip 404 retry",
  status: "shutdown",
  shutdownOn: "2026-06-30",
  note:
    "DEAD. Deprecated 2026-06-15, shut down 2026-06-30. The 404 ladder in " +
    "story-clip buys nothing while this is the fallback. Replacing it changes " +
    "the per-second price, so it needs an owner decision — see ENGINE_AUDIT.md.",
  capabilities: {
    modality: "image-to-video",
    durationsSec: [4, 6, 8],
    aspectRatios: ["9:16"],
    referenceSupport: true,
    audioSupport: false,
    commercialUse: null,
    note: "Same envelope as VIDEO_CLIP, but status:'shutdown' — the router must never select it.",
  },
};

/** Everything, for the registry test and for anything that wants to report. */
export const MODEL_REGISTRY: ModelEntry[] = [
  TEXT_PRIMARY,
  TEXT_TOOLS,
  TEXT_FALLBACK,
  IMAGE_STILL,
  VOICE_TTS,
  VIDEO_CLIP,
  VIDEO_CLIP_FALLBACK,
];

/**
 * ENGINE VERSION — stamped onto generated assets so a film can be traced back
 * to the code and models that made it.
 *
 * Bump SCHEMA when the story/plan shape changes, PROMPT when the compiled
 * prompt text changes in a way that alters output, ENGINE for anything else.
 * The audit found NO version stamping anywhere in the pipeline: given a
 * finished mp4 there is currently no way to tell which model or prompt built
 * it, which makes a regression impossible to attribute.
 */
export const ENGINE_VERSION = "1.0.0";
export const SCHEMA_VERSION = "1.0.0";
export const PROMPT_VERSION = "1.0.0";

/** The provenance block to record beside any generated asset. */
export function provenance(model: ModelEntry): Record<string, string> {
  return {
    engine_version: ENGINE_VERSION,
    schema_version: SCHEMA_VERSION,
    prompt_version: PROMPT_VERSION,
    model_id: model.id,
    model_provider: model.provider,
  };
}

/**
 * THE ROUTER CORE — the first, deliberately small brick of provider-agnostic
 * routing (the mission's P8). No caller routes through this yet; it exists so a
 * future selector has ONE honest place to ask "who can make this?" instead of
 * hard-coding a model id at the call site. It changes nothing about what ONIQ
 * spends — swapping which provider actually runs is an owner/cost decision, and
 * this only narrows the field to the ones that CAN.
 */
export type Requirement = {
  modality: Modality;
  /** For video: the exact clip length wanted, seconds. */
  durationSec?: number;
  /** e.g. "9:16". */
  aspectRatio?: string;
  /** The request supplies a reference frame that the model must accept. */
  referenceImage?: boolean;
  /** The model's own output must carry audio. */
  audio?: boolean;
};

/** Does one model satisfy a requirement? Pure, side-effect-free, testable. */
export function capabilityMatch(m: ModelEntry, req: Requirement): boolean {
  const c = m.capabilities;
  if (c.modality !== req.modality) return false;
  if (req.durationSec !== undefined) {
    if (!c.durationsSec || !c.durationsSec.includes(req.durationSec)) return false;
  }
  if (req.aspectRatio !== undefined && !c.aspectRatios.includes(req.aspectRatio)) return false;
  if (req.referenceImage === true && !c.referenceSupport) return false;
  if (req.audio === true && !c.audioSupport) return false;
  return true;
}

/**
 * Every non-dead model that can meet the requirement. A `shutdown` model is
 * NEVER returned — that is the whole point of pairing the router with the
 * status field: the dead Veo fallback that story-clip still wastes a round-trip
 * on would be excluded here by construction. Order is registry order; ranking
 * by quality/price/latency is a later brick once those fields are sourced.
 */
export function selectByCapability(req: Requirement): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => m.status !== "shutdown" && capabilityMatch(m, req));
}
