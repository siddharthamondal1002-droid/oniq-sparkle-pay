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

export type ModelEntry = {
  /** The exact string sent to the provider. */
  id: string;
  /** Who serves it, and therefore whose money it spends. */
  provider: "anthropic" | "google-direct" | "lovable-gateway";
  /** The environment variable holding the credential. Never the value. */
  keyEnv: string;
  /** Where it is called from, so a reader can find the caller. */
  usedBy: string;
  status: ModelStatus;
  /** Google's published switch-off date, ISO yyyy-mm-dd, or null if unknown. */
  shutdownOn: string | null;
  /** Why this id and not another. */
  note: string;
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
  usedBy: "_shared/llm.ts callClaude default",
  status: "current",
  shutdownOn: null,
  note: "The baseline every existing caller relies on. Callers may override per call.",
};

export const TEXT_TOOLS: ModelEntry = {
  id: "claude-opus-5",
  provider: "anthropic",
  keyEnv: "ANTHROPIC_API_KEY",
  usedBy: "_shared/llm.ts tool-calling path",
  status: "current",
  shutdownOn: null,
  note: "Tool-use path only.",
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
};

/**
 * IMAGE — the still each shot is animated from.
 *
 * Runs on the LOVABLE GATEWAY, on Lovable credits, per the 2026-08-14 owner
 * directive. The `google/` prefix is the gateway's addressing, not a Google
 * API id, which is why a Google deprecation does not automatically apply:
 * what Lovable serves under that name is Lovable's to say.
 */
export const IMAGE_STILL: ModelEntry = {
  id: "google/gemini-2.5-flash-image",
  provider: "lovable-gateway",
  keyEnv: "LOVABLE_API_KEY",
  usedBy: "story-still",
  status: "deprecated",
  shutdownOn: null,
  note:
    "Google recommends migrating the DIRECT model off Nano Banana (2.5 Flash " +
    "Image) to gemini-3.1-flash-image or gemini-3-pro-image. This runs through " +
    "the gateway, so the migration is a question for Lovable AND a cost " +
    "question for the owner — see GOOGLE_AI_RESEARCH.md. Not changed here.",
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
