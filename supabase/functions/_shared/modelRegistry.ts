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
 * OWNER DIRECTIVE, 2026-09-04b — DIRECT GOOGLE, NOT THE GATEWAY. Given as
 * "make images, Voice, music, documents direct Gemini not via lovable", and it
 * REVERSES point (1) below. Image, text-to-speech and the text/AI models move
 * off ai.gateway.lovable.dev and onto generativelanguage.googleapis.com on
 * GOOGLE_AI_API_KEY — the same route Veo clips and Lyria music already take.
 * Music needs no change; it was already the exception.
 *
 * WHAT THIS CHANGES ABOUT THE BILL, stated plainly because the whole point of
 * the 2026-08-14 rule is that a provider swap is a money decision. These
 * features stop drawing Lovable credits and start drawing the metered Google
 * account, per call, at Google's own rates. The prices in the mapping below
 * were recorded as GOOGLE LIST PRICES and were never what the reseller
 * charged — so on this route they become the relevant numbers rather than a
 * rough sizing. The spend guards, the per-capability ceilings in
 * provider_budget_config and the flat reservations are untouched by this and
 * still apply; what changes is whose account the reservation is spending.
 *
 * Every id used on this route is POST-verified against the direct endpoint
 * before it is written down. A gateway id is NOT a direct id — the gateway
 * prefixes with `google/` and resells a catalogue of its own — so none of the
 * verifications recorded below carry over, and each had to be redone.
 *
 * ---- superseded, kept for the record ----------------------------------
 *
 * OWNER DIRECTIVE, 2026-09-04 — the Google model mapping, and it supersedes
 * the text half of the 2026-08-14 split. The owner named the models and the
 * prices, and answered three questions directly:
 *
 *   1. SUPERSEDED BY 2026-09-04b ABOVE. Read as: every model below ran
 *      through the Lovable gateway on LOVABLE_API_KEY — Lovable credits, not
 *      the metered Google key. Veo clips were untouched and stayed on the
 *      Google key; stills and voice stayed where 2026-08-14 put them, on the
 *      gateway, and only their ids moved.
 *   2. GEMINI BECOMES THE PRIMARY TEXT ENGINE — Flash-Lite for ordinary work,
 *      the Pro tier for the heavier tier. This is a reversal of "text runs
 *      Claude-first" above, and it is the owner's. Asked whether Claude was
 *      to be kept or removed, the owner chose to SWAP THE FAILOVER DIRECTION:
 *      the existing billing-exhaustion fallback stays exactly as it is and
 *      simply points the other way, so Gemini serves and Claude catches. The
 *      outage path is preserved, not deleted — ONIQ still has two engines.
 *   3. MUSIC IS TO BE BUILT, and it is the one exception to (1). The Lovable
 *      gateway does not carry Lyria: its catalogue has no id matching lyria,
 *      music or song (measured 2026-09-04, 33,554-byte response), and
 *      /v1/audio/music 404s from the gateway itself. Told that gateway-for-all
 *      and build-music could not both hold, the owner routed MUSIC ALONE to
 *      the metered Google key — the same route Veo clips already take. So
 *      song generation spends the Google bill; everything else spends credits.
 *
 * The mapping as the owner gave it:
 *
 *   image generation/edit      Nano Banana 2          ~$0.067  / 1K image
 *   image, cheaper tier        Nano Banana 2 Lite     ~$0.0336 / 1K image
 *   full music / song          Lyria 3 Pro             $0.08   / song
 *   text-to-speech             Gemini 3.1 Flash TTS    $20 / 1M output audio tokens
 *   AI                         Gemini 3.1 Flash-Lite   $0.25/M in + $1.50/M out
 *   better AI                  Gemini 3.1 Pro          $2/M in + $12/M out
 *   search grounding           Gemini 3                (no price given)
 *
 * THOSE PRICES ARE RECORDED AS THE OWNER GAVE THEM, and they are not verified
 * here: this environment cannot reach Google's pricing pages (GOOGLE_AI_RESEARCH.md
 * records the same egress block). Two things follow. A Google list price is
 * not what the gateway charges — the gateway is a reseller with its own credit
 * accounting, so these numbers size a decision, they do not settle a bill. And
 * the owner named MARKETING NAMES, not ids; "Nano Banana 2" is a name, the id
 * behind it is what this file must carry. Every id below was POST-verified on
 * the gateway before it was written down, because ListModels cannot validate a
 * name — see the measured table in llm.ts, where a listed model 404'd on every
 * real call for months.
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
  /** Accepts a reference image/frame as input. null = unmeasured here. */
  referenceSupport: boolean | null;
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
/**
 * TEXT, THE ENGINE THAT NOW ANSWERS — owner directive 2026-09-04.
 *
 * Two tiers, both on the Lovable gateway's OpenAI-compatible chat endpoint,
 * both POST-verified there before being written down. `callText` in llm.ts is
 * the only thing that reads them; callers ask for a TIER, never an id, so a
 * later re-tiering is one edit here and not a sweep through fourteen edge
 * functions.
 *
 * The Claude entries below are no longer what serves ONIQ. They are what
 * catches it — see their notes.
 */
export const TEXT_GATEWAY_STANDARD: ModelEntry = {
  id: "google/gemini-3.1-flash-lite",
  provider: "lovable-gateway",
  keyEnv: "LOVABLE_API_KEY",
  usedBy: "llm.ts callText, default tier — every text caller that does not ask for heavy",
  status: "current",
  shutdownOn: null,
  note:
    "The owner's 'AI' row, $0.25/M in + $1.50/M out as the owner gave it — " +
    "a Google list price, not necessarily what the gateway meters. " +
    "POST-verified 2026-09-04: 200, usage in OpenAI shape. Note this id was " +
    "already in the codebase as searchBudget's GEMINI_FAILOVER_MODEL at " +
    "exactly that price, so the owner's row confirmed a number already here.",
  capabilities: {
    modality: "text",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: false,
    commercialUse: null,
    note:
      "Function calling via the OpenAI tools shape. NO Google Search " +
      "grounding and NO Anthropic server tools — the endpoint has no field " +
      "for either, which is why callText refuses to send a search-bound " +
      "caller here rather than letting it answer from memory.",
  },
};

export const TEXT_GATEWAY_HEAVY: ModelEntry = {
  id: "google/gemini-3.1-pro-preview",
  provider: "lovable-gateway",
  keyEnv: "LOVABLE_API_KEY",
  usedBy: "llm.ts callText, tier:'heavy' — story-plot's planner",
  status: "current",
  shutdownOn: null,
  note:
    "The owner's 'Better AI' row, $2/M in + $12/M out as given. The owner " +
    "named 'Gemini 3.1 Pro'; the gateway carries only the -preview id and no " +
    "unsuffixed variant, so preview is what ONIQ can call. POST-verified " +
    "2026-09-04: 200. Preview ids can be withdrawn without a deprecation " +
    "window — null shutdownOn here means unknown, not safe.",
  capabilities: {
    modality: "text",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: false,
    commercialUse: null,
    note: "Same envelope and same grounding limits as the standard tier.",
  },
};

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
  note:
    "The callClaude default, and the tool-use path. AS OF 2026-09-04 THIS " +
    "IS THE CATCHER, NOT THE SERVER: callText sends text to the gateway " +
    "first and reaches Claude when the credit pool is exhausted or the " +
    "gateway is unreachable. It is also still the FIRST choice, not the " +
    "second, for any caller that needs real search — Anthropic server " +
    "tools have no equivalent on the gateway's chat endpoint.",
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
 * No key, no provider, no credit pool: the only cost is this worker's own GPU
 * seconds.
 *
 * NO LONGER THE DEFAULT, 2026-09-01. This entry used to say it "supersedes"
 * the gateway-served google/gemini-2.5-flash-image; the owner directive of
 * 2026-09-01 put that engine back and made it the default, because this one
 * has not drawn a frame on the current endpoint — both films that day died at
 * still 1 with the endpoint stuck `initializing`, before any GPU second was
 * spent. It is reached now by STILL_PROVIDER=in_house and is still the only
 * engine whose stills in-house MOTION can animate, because it is the only one
 * that writes them into the bucket.
 */
export const IMAGE_STILL: ModelEntry = {
  id: "Lightricks/LTX-Video",
  provider: "oniq-gpu-worker",
  keyEnv: null,
  usedBy: "story-still (STILL_PROVIDER=in_house)",
  status: "current",
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
 * IMAGE — the gateway engine, restored 2026-09-01.
 *
 * OWNER DIRECTIVE, 2026-09-01: stills route here and the GPU leaves the still
 * path ("old version back where in-house and Veo both was there without gpu").
 * Whose money: Lovable credits, the same pool VOICE_TTS below already spends.
 *
 * BOTH ENTRIES ARE CURRENT, and that is not an oversight. story-still can run
 * on either engine and picks one from STILL_PROVIDER before it calls anything
 * (_shared/stillRoute.ts); the registry describes what CAN serve a stage, and
 * two things now can. What it must never do is leave a reader unable to tell
 * which one actually ran — that is why every story-still reply carries
 * `provider`, and why this entry exists instead of IMAGE_STILL being quietly
 * edited to say "gateway".
 *
 * The capability differences are real and are reported per request rather than
 * assumed: no seed (so no exact reproduction), no negative-prompt tensor (the
 * terms ride in the ask as a sentence), no reference-strength dial — and a
 * reference IS supported, by inlining bytes this side reads from ONIQ's own
 * bucket, which the 2026-08-20 probe measured holding a character's identity.
 */
export const IMAGE_STILL_GATEWAY: ModelEntry = {
  id: "google/gemini-3.1-flash-image",
  provider: "lovable-gateway",
  keyEnv: "LOVABLE_API_KEY",
  usedBy: "story-still (STILL_PROVIDER=gateway, the 2026-09-01 default)",
  status: "current",
  shutdownOn: null,
  note:
    "The owner's 'Nano Banana 2', 2026-09-04. Replaced " +
    "google/gemini-2.5-flash-image, which Google had marked legacy with this " +
    "as the recommended successor, and which ENGINE_AUDIT.md carried as an " +
    "open question. POST-verified on the gateway before being written down: " +
    "200 with a b64_json image, usage {input 3, output 1120}. No published " +
    "gateway lifecycle found, so shutdownOn stays null — unknown, not safe.",
  capabilities: {
    modality: "text-to-image",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: true,
    audioSupport: false,
    commercialUse: null,
    note:
      "Reference conditioning by INLINED bytes: story-still resolves a " +
      "published canonical character id to a server-owned key, reads that " +
      "object over the bucket's public base, and inlines it as a data: URL. " +
      "A caller never supplies a path, a URL or bytes. No seed and no " +
      "negative-prompt tensor — story-still reports seedHonoured:false and " +
      "negativeApplied:'prompt-text' rather than letting a caller assume " +
      "conditioning it did not get. Writes nothing to a bucket, so the reply " +
      "carries key:null and in-house motion cannot animate its frames.",
  },
};

/**
 * IMAGE, CHEAPER TIER — recorded, deliberately NOT wired.
 *
 * The owner's "Nano Banana 2 Lite" row, at roughly half the list price of the
 * tier above. The gateway lists it and routes it, but the same request body
 * that earns a 200 from `google/gemini-3.1-flash-image` earns a 400 from this
 * id — `upstream_error`, Google's protobuf parser rejecting `prompt` and
 * `modalities` by name. So the id is real and the envelope is different.
 *
 * The working envelope WAS then measured — Google's native `contents` with an
 * explicit role, on the same endpoint:
 *
 *   POST /v1/images/generations
 *   {"model":"google/gemini-3.1-flash-lite-image",
 *    "contents":[{"role":"user","parts":[{"text":"..."}]}]}   200, real JPEG
 *
 * IT IS STILL NOT WIRED, and the measurement is why. The gateway reported
 * usage {input 3, output 1120, total 1123} for this id — byte-for-byte the
 * SAME usage it reported for the full-price `gemini-3.1-flash-image` on the
 * same prompt. The owner's ~50% saving is a Google LIST-price difference; on
 * the gateway both tiers bill the same token count, and no response carries a
 * cost or credits field to contradict that. So switching to the lite tier
 * would buy a cheaper image on Google's price sheet and, as far as anything
 * measurable here shows, exactly nothing on the bill ONIQ actually pays —
 * while giving up whatever quality the full tier has. That is a question for
 * the owner, not a saving to take silently.
 */
export const IMAGE_STILL_GATEWAY_LITE: ModelEntry = {
  id: "google/gemini-3.1-flash-lite-image",
  provider: "lovable-gateway",
  keyEnv: "LOVABLE_API_KEY",
  usedBy: "nothing yet — recorded 2026-09-04, no working request shape",
  status: "unknown",
  shutdownOn: null,
  note:
    "Owner-named cheaper image tier (~$0.0336/1K image against ~$0.067 for " +
    "the tier above, prices as the owner gave them and unverified here). " +
    "Measured 2026-09-04: 200 with a real JPEG on the native `contents` " +
    "envelope, and usage IDENTICAL to the full tier (3 in / 1120 out), so " +
    "the list-price saving is not visible in what the gateway meters.",
  capabilities: {
    modality: "text-to-image",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: null,
    audioSupport: false,
    commercialUse: null,
    note:
      "Takes Google's native `contents` with an explicit role:'user', NOT " +
      "the OpenAI `prompt`/`modalities` fields its full-price sibling takes " +
      "on the same endpoint. Returns JPEG. Reference conditioning unmeasured.",
  },
};

/**
 * VOICE — narration and dialogue.
 *
 * Also the Lovable gateway, same directive, same reasoning.
 */
export const VOICE_TTS: ModelEntry = {
  id: "google/gemini-3.1-flash-tts-preview",
  provider: "lovable-gateway",
  keyEnv: "LOVABLE_API_KEY",
  usedBy: "story-voice, voice-generate (Create — Voice)",
  status: "current",
  shutdownOn: null,
  note:
    "The owner's 'Gemini 3.1 Flash TTS', 2026-09-04, replacing " +
    "google/gemini-2.5-flash-tts. The gateway carries only the -preview id; " +
    "there is no unsuffixed variant to prefer. POST-verified: 200 with a " +
    "RIFF/WAVE, PCM 16-bit mono 24 kHz, on the native contents+speechConfig " +
    "body story-voice already sends. A preview id can be withdrawn without a " +
    "deprecation window, so treat a null shutdownOn here as ignorance, not " +
    "safety — that is exactly what this column is for.",
  capabilities: {
    modality: "text-to-speech",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: true,
    commercialUse: null,
    note:
      "Text-to-speech. The 2.5 id answered raw s16le PCM which the worker " +
      "wrapped as WAV; this id answers a complete RIFF/WAVE container " +
      "(PCM 16-bit mono 24 kHz), and story-voice forks on the mime so both " +
      "shapes stay correct. Prebuilt voice names are unchanged.",
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

/* ===========================================================================
 * DIRECT GOOGLE — owner directive 2026-09-04b, "make images, Voice, music,
 * documents direct Gemini not via lovable".
 *
 * These four are the route the owner asked for. Every id below was
 * POST-VERIFIED against generativelanguage.googleapis.com on
 * GOOGLE_AI_API_KEY before it was written here, because a gateway id is NOT a
 * direct id: the gateway prefixes with `google/` and resells a catalogue of
 * its own, so none of the gateway verifications above carry over. The measured
 * status, byte count and part types are in each note — a listing was not
 * accepted as evidence for any of them, per CLAUDE.md.
 * ======================================================================== */

/**
 * IMAGE, DIRECT. What Create — Image calls, and the reference-image path.
 *
 * The reference answer is the one worth noting: the SAME id accepts an
 * inlineData jpeg part placed BEFORE the text part and returns an edited
 * image. That is measured, not inferred from a doc, and it is what makes
 * "attach a reference image" offerable at all — the gateway's OpenAI-shaped
 * /images/generations endpoint had no field for it.
 */
export const IMAGE_DIRECT: ModelEntry = {
  id: "gemini-3.1-flash-image",
  provider: "google-direct",
  keyEnv: "GOOGLE_AI_API_KEY",
  usedBy: "image-generate (Create — Image)",
  status: "current",
  shutdownOn: null,
  note:
    "The owner's 'Nano Banana 2' on the DIRECT API, owner directive " +
    "2026-09-04b. POST-verified 2026-09-04 on " +
    "generativelanguage.googleapis.com/v1beta with Google's native contents " +
    "envelope and generationConfig.responseModalities:['IMAGE']: 200, " +
    "3,329,851 bytes, one inlineData part of mimeType image/jpeg. Two " +
    "siblings also answered 200 and are NOT wired — " +
    "gemini-3.1-flash-image-preview (3,339,779 bytes) and " +
    "gemini-3-pro-image-preview (4,842,458 bytes, a heavier tier). No " +
    "published shutdown date found, so shutdownOn stays null — unknown, not " +
    "safe.",
  capabilities: {
    modality: "text-to-image",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: true,
    audioSupport: false,
    commercialUse: null,
    note:
      "REFERENCE IMAGE MEASURED, 2026-09-04: an inlineData image/jpeg part " +
      "placed before the text part, prompt 'make the wall green', returned " +
      "200 with 2,405,500 bytes and one image/jpeg part back. So a person " +
      "can attach a picture and ask for a change to it. No seed and no " +
      "negative-prompt tensor on this surface either — same limits as the " +
      "gateway entry, and the same rule about not letting a caller assume " +
      "conditioning it did not get.",
  },
};

/**
 * VOICE, DIRECT. What Create — Voice calls.
 *
 * THE 400 THAT WAS NOT A DEAD ID. This id first answered 400
 * INVALID_ARGUMENT and looked like the usual "listed but not callable" trap.
 * It was not: the bare `responseModalities:['AUDIO']` body is simply not its
 * accepted shape, and adding `speechConfig` with a prebuilt voice turned the
 * same id into a 200. Worth recording because the reflex on a 400 here is to
 * strike the id off, and that would have been wrong.
 */
export const VOICE_TTS_DIRECT: ModelEntry = {
  id: "gemini-3.1-flash-tts-preview",
  provider: "google-direct",
  keyEnv: "GOOGLE_AI_API_KEY",
  usedBy: "voice-generate (Create — Voice)",
  status: "current",
  shutdownOn: null,
  note:
    "Owner directive 2026-09-04b. POST-verified 2026-09-04 direct with " +
    "generationConfig {responseModalities:['AUDIO'], speechConfig: " +
    "{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Charon'}}}}: 200, " +
    "144,129 bytes, inlineData 'audio/l16; rate=24000; channels=1', base64 " +
    "length 143,360. WITHOUT speechConfig the same id returns 400 " +
    "INVALID_ARGUMENT. gemini-2.5-flash-preview-tts also answers 200 " +
    "(165,311 bytes) and is recorded as the fallback; gemini-3.1-flash-tts " +
    "and gemini-3.1-pro-tts-preview are both 404 and do not exist.",
  capabilities: {
    modality: "text-to-speech",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: true,
    commercialUse: null,
    note:
      "Returns RAW 24 kHz mono L16 PCM with NO WAV HEADER — a header has to " +
      "be prepended before anything will play it. The mime spelling differs " +
      "between ids ('audio/l16; rate=24000; channels=1' here, " +
      "'audio/L16;codec=pcm;rate=24000' on the 2.5 fallback), so the rate " +
      "must be parsed case-insensitively rather than string-matched.",
  },
};

/**
 * TEXT, DIRECT — the ordinary tier. What Document/AI and callText run on.
 */
export const TEXT_DIRECT_STANDARD: ModelEntry = {
  id: "gemini-3.1-flash-lite",
  provider: "google-direct",
  keyEnv: "GOOGLE_AI_API_KEY",
  usedBy: "_shared/llm.ts callText primary (Document, AI, all text)",
  status: "current",
  shutdownOn: null,
  note:
    "Owner directive 2026-09-04b, moving the owner's 'Gemini 3.1 Flash-Lite' " +
    "off the gateway. POST-verified 2026-09-04 direct: 200, 738 bytes, one " +
    "text part. Same marketing name as TEXT_GATEWAY_STANDARD above; the id " +
    "differs only by the gateway's `google/` prefix, which is exactly why " +
    "each route has to be verified separately.",
  capabilities: {
    modality: "text",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: false,
    commercialUse: null,
    note:
      "NO SEARCH TOOL on this route, the same limit the gateway chat " +
      "endpoint has. A caller that needs real sources still goes to Claude " +
      "(TEXT_TOOLS) — a search-less engine invents its citations, which is " +
      "the finding the 2026-09-04 directive already records.",
  },
};

/** TEXT, DIRECT — the heavier tier, for work the lite tier handles badly. */
export const TEXT_DIRECT_HEAVY: ModelEntry = {
  id: "gemini-3.1-pro-preview",
  provider: "google-direct",
  keyEnv: "GOOGLE_AI_API_KEY",
  usedBy: "_shared/llm.ts callText, heavy tier",
  status: "current",
  shutdownOn: null,
  note:
    "Owner directive 2026-09-04b. The owner's 'Gemini 3.1 Pro'. " +
    "POST-verified 2026-09-04 direct: 200, 1,388 bytes, one text part.",
  capabilities: {
    modality: "text",
    durationsSec: null,
    aspectRatios: [],
    referenceSupport: false,
    audioSupport: false,
    commercialUse: null,
    note: "As TEXT_DIRECT_STANDARD: no search tool on this route.",
  },
};

/** Everything, for the registry test and for anything that wants to report. */
export const MODEL_REGISTRY: ModelEntry[] = [
  TEXT_GATEWAY_STANDARD,
  TEXT_GATEWAY_HEAVY,
  IMAGE_STILL_GATEWAY_LITE,
  TEXT_PRIMARY,
  TEXT_TOOLS,
  TEXT_FALLBACK,
  IMAGE_STILL,
  IMAGE_STILL_GATEWAY,
  VOICE_TTS,
  VIDEO_CLIP,
  VIDEO_CLIP_FALLBACK,
  IMAGE_DIRECT,
  VOICE_TTS_DIRECT,
  TEXT_DIRECT_STANDARD,
  TEXT_DIRECT_HEAVY,
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
