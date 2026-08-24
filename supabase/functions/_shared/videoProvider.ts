// videoProvider — one provider-neutral interface, two Google surfaces behind it.
//
// WHY THIS EXISTS. story-clip currently knows, in its own body, that Veo lives
// at generativelanguage.googleapis.com, that the operation name looks like
// `models/x/operations/y`, and that a finished clip arrives either as base64 or
// as a files/… URI. All true — and all true of ONE SURFACE. The moment a second
// surface is on the table, those facts stop being facts about "video" and
// become facts about a provider, and the story composition layer must not know
// either set.
//
// EVERYTHING HERE IS PURE. Building a request body and normalising a response
// are functions of their arguments; nothing in this file opens a socket, reads
// a secret or spends a cent. That is what makes provider readiness testable
// without credentials, which is the whole point: the Agent Platform adapter can
// be proved correct in shape long before anyone decides to pay for it.
//
// AUTH IS NOT MODELLED HERE ON PURPOSE. A body is safe to log, compare and
// snapshot; a URL with a key in it is not. The transport applies credentials.

import { classifyProviderError } from "./providerError.ts";
import {
  AI_STUDIO_VIDEO_PARAMS,
  type AudioMode,
  type ProviderSurface,
  SURFACE_SUPPORTS_AUDIO_PARAM,
} from "./videoAudio.ts";

// --------------------------------------------------------------- vocabulary
/**
 * How a generation attempt ended, in ONIQ's words rather than a provider's.
 *
 * These are DISTINCT ON PURPOSE (owner directive: a provider failure must not
 * be counted as a visual rejection, and a visual rejection must not be counted
 * as a provider failure). Acceptance economics divide by accepted output; if a
 * timeout were folded in with a bad-looking clip, the denominator would be
 * wrong and every cost-per-accepted-second figure with it.
 */
export type VideoOutcomeKind =
  /** A video came back. Whether ONIQ KEEPS it is a later, separate question. */
  | "GENERATED"
  /** Still running. Poll again. */
  | "PENDING"
  /** Responsible-AI refusal, named by the provider. */
  | "SAFETY_REFUSAL"
  /** done, no error, no sample — generated then filtered. Possibly still billed. */
  | "EMPTY_OUTPUT"
  /** The provider said no in a way that is about the request. */
  | "INVALID_REQUEST"
  /** The provider is unwell: 5xx, breaker open. */
  | "PROVIDER_FAILURE"
  /**
   * A wall with a clock on it — a daily/project quota. Waiting minutes does not
   * help, so this must never be retried inside a job.
   */
  | "QUOTA_EXHAUSTED"
  /**
   * A per-minute limit. SEPARATE FROM QUOTA_EXHAUSTED on purpose: this one does
   * clear on its own, and conflating them either hammers a wall or gives up on
   * a blip. `providerError.ts` splits them on the body, not the 429.
   */
  | "RATE_LIMITED"
  /** Credentials were rejected. Not a fault to retry — a fault to fix. */
  | "AUTHENTICATION_FAILURE"
  /**
   * ONIQ's own side is not set up: a missing env var, no project, no location.
   * Detected BEFORE any socket opens, so it can never cost money.
   */
  | "CONFIGURATION_FAILURE"
  /** No answer in time. AMBIGUOUS — the work may have happened and be billed. */
  | "TIMEOUT"
  /** The clip generated but could not be fetched. Also billed. */
  | "MEDIA_RETRIEVAL_FAILURE"
  /**
   * Genuinely unrecognised. Kept distinct from PROVIDER_FAILURE so "we do not
   * know what this was" never masquerades as a diagnosis.
   */
  | "UNKNOWN_PROVIDER_FAILURE";

/** Every outcome kind, for exhaustiveness tests. */
export const VIDEO_OUTCOME_KINDS: readonly VideoOutcomeKind[] = [
  "GENERATED",
  "PENDING",
  "SAFETY_REFUSAL",
  "EMPTY_OUTPUT",
  "INVALID_REQUEST",
  "PROVIDER_FAILURE",
  "QUOTA_EXHAUSTED",
  "RATE_LIMITED",
  "AUTHENTICATION_FAILURE",
  "CONFIGURATION_FAILURE",
  "TIMEOUT",
  "MEDIA_RETRIEVAL_FAILURE",
  "UNKNOWN_PROVIDER_FAILURE",
] as const;

/**
 * Did this attempt reach the provider, and might it therefore be BILLED?
 *
 * The ledger cares about exactly this. A configuration failure never left the
 * box and may be released; a timeout may well have generated a clip ONIQ is
 * being charged for, so it must SETTLE.
 */
export function mayHaveBeenBilled(kind: VideoOutcomeKind): boolean {
  return (
    kind !== "CONFIGURATION_FAILURE" &&
    kind !== "AUTHENTICATION_FAILURE" &&
    kind !== "RATE_LIMITED" &&
    kind !== "QUOTA_EXHAUSTED" &&
    kind !== "INVALID_REQUEST"
  );
}

/** Did the returned media carry an audio track? */
export type AudioPresence = "PRESENT" | "ABSENT" | "UNKNOWN";

export type VideoGenerationRequest = {
  model: string;
  /** Whole seconds the provider is being asked to generate. */
  seconds: number;
  aspectRatio: string;
  resolution: "720p";
  prompt: string;
  /** Image-to-video starting frame. */
  startFrame?: { base64: string; mimeType: string };
  audioMode: AudioMode;
  negativePrompt?: string;
};

export type VideoGenerationOutcome = {
  kind: VideoOutcomeKind;
  /** Long-running operation handle, when the surface returned one. */
  operationName?: string;
  video?: { mimeType: string; base64?: string; uri?: string };
  /**
   * UNKNOWN until the media is probed. The REQUEST never establishes this —
   * on the Gemini Developer API audio arrives whether it was asked for or not.
   */
  audio: AudioPresence;
  seconds?: number;
  httpStatus?: number;
  /** Short, non-secret provider detail for the ledger and the logs. */
  detail?: string;
};

export type ProviderCapabilities = {
  surface: ProviderSurface;
  /** Can the caller ask this surface NOT to generate audio? */
  canDeclineAudio: boolean;
  /** Generation parameters the surface accepts. */
  acceptedParams: readonly string[];
  /** Does a finished clip arrive by URI needing a second authenticated fetch? */
  mediaByReference: boolean;
};

export interface VideoProvider {
  readonly id: string;
  readonly surface: ProviderSurface;
  capabilities(): ProviderCapabilities;
  /** Environment variable NAMES this surface needs. Never their values. */
  configRequirements(): readonly string[];
  /** Pure. The JSON body of a start request — no URL, no key, safe to log. */
  buildStartBody(req: VideoGenerationRequest): Record<string, unknown>;
  /** Pure. Provider start response → ONIQ vocabulary. */
  normalizeStart(status: number, body: unknown): VideoGenerationOutcome;
  /** Pure. Provider poll response → ONIQ vocabulary. */
  normalizePoll(status: number, body: unknown): VideoGenerationOutcome;
}

// --------------------------------------------------------------- shared bits
const SAFETY = /third.?party|prohibited|safety|filtered|violat|blocked|responsible ai/i;

function textOf(body: unknown): string {
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body ?? {});
  } catch {
    return "";
  }
}

/**
 * HTTP status → ONIQ outcome, for the parts both Google surfaces share.
 *
 * The transport judgement is DELEGATED to `providerError.ts` rather than
 * re-implemented here. That module already knows the one distinction that
 * matters and cost ONIQ a benchmark to learn — a daily quota and a per-minute
 * rate limit both arrive as HTTP 429 and need opposite handling. Duplicating
 * its regexes here would mean two taxonomies drifting apart, and the one in the
 * generation path would be the one nobody updated.
 *
 * Returns null when the response is a success and the body decides the outcome.
 */
function classifyHttp(status: number, detail: string): VideoOutcomeKind | null {
  if (status >= 200 && status < 300) return null;

  const cls = classifyProviderError(status, detail);
  switch (cls.kind) {
    case "PROVIDER_QUOTA_EXHAUSTED":
      return "QUOTA_EXHAUSTED";
    case "PROVIDER_RATE_LIMITED":
      return "RATE_LIMITED";
    case "AUTH_FAILED":
      return "AUTHENTICATION_FAILURE";
    case "CONTENT_FILTERED":
      return "SAFETY_REFUSAL";
    case "INVALID_REQUEST":
      // A 400 naming a safety reason is a refusal about the CONTENT, not a
      // malformed request, and the two must not share a denominator.
      return SAFETY.test(detail) ? "SAFETY_REFUSAL" : "INVALID_REQUEST";
    case "MODEL_UNAVAILABLE":
    case "NETWORK_FAILURE":
      return "PROVIDER_FAILURE";
    case "TIMEOUT":
      return "TIMEOUT";
    default:
      return "UNKNOWN_PROVIDER_FAILURE";
  }
}

/** Pull the first generated video out of a Veo operation response. */
function firstVideo(response: unknown): { mimeType: string; uri?: string; base64?: string } | null {
  const r = (response ?? {}) as {
    generateVideoResponse?: { generatedSamples?: Array<{ video?: Record<string, unknown> }> };
    generatedVideos?: Array<{ video?: Record<string, unknown> }>;
    videos?: Array<Record<string, unknown>>;
  };
  const v =
    r.generateVideoResponse?.generatedSamples?.[0]?.video ??
    r.generatedVideos?.[0]?.video ??
    r.videos?.[0];
  if (!v) return null;
  const uri = typeof v.uri === "string" ? v.uri : undefined;
  const base64 =
    typeof v.bytesBase64Encoded === "string" ? (v.bytesBase64Encoded as string) : undefined;
  if (!uri && !base64) return null;
  return { mimeType: typeof v.mimeType === "string" ? v.mimeType : "video/mp4", uri, base64 };
}

function normalizeOperation(body: unknown): VideoGenerationOutcome {
  const op = (body ?? {}) as {
    done?: boolean;
    error?: { message?: string };
    response?: unknown;
  };
  if (!op.done) return { kind: "PENDING", audio: "UNKNOWN" };
  if (op.error) {
    const msg = op.error.message ?? "generation failed";
    return {
      kind: SAFETY.test(msg) ? "SAFETY_REFUSAL" : "PROVIDER_FAILURE",
      audio: "UNKNOWN",
      detail: msg.slice(0, 300),
    };
  }
  const video = firstVideo(op.response);
  if (!video) {
    // done, no error, no sample. Generated then removed by the RAI pass —
    // a refusal, not a fault, and possibly still billed.
    return { kind: "EMPTY_OUTPUT", audio: "UNKNOWN", detail: textOf(op.response).slice(0, 300) };
  }
  // AUDIO STAYS UNKNOWN. The only honest source is a probe of the actual
  // stream; the request parameter cannot establish it on either surface, and
  // on the Gemini API the parameter does not even exist.
  return { kind: "GENERATED", audio: "UNKNOWN", video };
}

// --------------------------------------------- Gemini Developer API (active)
/**
 * The surface ONIQ calls today: `generativelanguage.googleapis.com/v1beta`,
 * `:predictLongRunning`.
 *
 * It CANNOT be told to skip audio — `generateAudio` is rejected by the API
 * itself (verified against @google/genai 2.18.0). buildStartBody therefore
 * never emits it, whatever audio mode is asked for; refusing to send a
 * parameter that would 400 is not the same as honouring the request, and
 * `resolveAudioMode` is where that difference is recorded.
 */
export class GeminiDeveloperApiProvider implements VideoProvider {
  readonly id = "gemini-developer-api";
  readonly surface: ProviderSurface = "google-ai-studio";

  capabilities(): ProviderCapabilities {
    return {
      surface: this.surface,
      canDeclineAudio: SURFACE_SUPPORTS_AUDIO_PARAM["google-ai-studio"],
      acceptedParams: AI_STUDIO_VIDEO_PARAMS,
      mediaByReference: true,
    };
  }

  configRequirements(): readonly string[] {
    return ["GOOGLE_AI_API_KEY"];
  }

  buildStartBody(req: VideoGenerationRequest): Record<string, unknown> {
    const parameters: Record<string, unknown> = {
      aspectRatio: req.aspectRatio,
      durationSeconds: req.seconds,
      resolution: req.resolution,
    };
    if (req.negativePrompt) parameters.negativePrompt = req.negativePrompt;
    // NO generateAudio. Not an omission — the API rejects it.
    const instance: Record<string, unknown> = { prompt: req.prompt };
    if (req.startFrame) {
      instance.image = {
        bytesBase64Encoded: req.startFrame.base64,
        mimeType: req.startFrame.mimeType,
      };
    }
    return { instances: [instance], parameters };
  }

  normalizeStart(status: number, body: unknown): VideoGenerationOutcome {
    const detail = textOf(body);
    const bad = classifyHttp(status, detail);
    if (bad)
      return { kind: bad, audio: "UNKNOWN", httpStatus: status, detail: detail.slice(0, 300) };
    const name = (body as { name?: unknown })?.name;
    if (typeof name !== "string" || !/^models\/[\w.-]+\/operations\/[\w-]+$/.test(name)) {
      return {
        kind: "PROVIDER_FAILURE",
        audio: "UNKNOWN",
        httpStatus: status,
        detail: "no operation name",
      };
    }
    return { kind: "PENDING", audio: "UNKNOWN", operationName: name, httpStatus: status };
  }

  normalizePoll(status: number, body: unknown): VideoGenerationOutcome {
    const detail = textOf(body);
    const bad = classifyHttp(status, detail);
    if (bad)
      return { kind: bad, audio: "UNKNOWN", httpStatus: status, detail: detail.slice(0, 300) };
    return { ...normalizeOperation(body), httpStatus: status };
  }
}

// ------------------------------------------ Gemini Enterprise Agent Platform
/**
 * The surface with the video-only tier, and the one ONIQ does NOT call.
 *
 * STATIC READINESS ONLY. Everything here is shape: the request body, the
 * response vocabulary, the config it would need. No live call has been made,
 * no credential exists in this environment, and nothing in this class should
 * be read as evidence that the integration works end to end.
 *
 * Its one real difference from the Developer API is the one that matters:
 * `generateAudio` is accepted, so VIDEO_ONLY is genuinely purchasable here —
 * which is what makes $0.03/s reachable at all.
 */
export class GoogleAgentPlatformProvider implements VideoProvider {
  readonly id = "google-agent-platform";
  readonly surface: ProviderSurface = "google-agent-platform";

  capabilities(): ProviderCapabilities {
    return {
      surface: this.surface,
      canDeclineAudio: SURFACE_SUPPORTS_AUDIO_PARAM["google-agent-platform"],
      // The Developer API's list plus what only this surface takes.
      acceptedParams: [
        ...AI_STUDIO_VIDEO_PARAMS,
        "generateAudio",
        "seed",
        "fps",
        "outputGcsUri",
        "compressionQuality",
        "labels",
      ],
      mediaByReference: true,
    };
  }

  configRequirements(): readonly string[] {
    // NAMES only. This function must never read or return a value.
    return ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS"];
  }

  buildStartBody(req: VideoGenerationRequest): Record<string, unknown> {
    const parameters: Record<string, unknown> = {
      aspectRatio: req.aspectRatio,
      durationSeconds: req.seconds,
      resolution: req.resolution,
      // THE WHOLE REASON THIS SURFACE IS INTERESTING. Only VEO_NATIVE_AUDIO
      // asks for audio; the other two modes decline it and are billed the
      // cheaper video-only rate.
      generateAudio: req.audioMode === "VEO_NATIVE_AUDIO",
    };
    if (req.negativePrompt) parameters.negativePrompt = req.negativePrompt;
    const instance: Record<string, unknown> = { prompt: req.prompt };
    if (req.startFrame) {
      instance.image = {
        bytesBase64Encoded: req.startFrame.base64,
        mimeType: req.startFrame.mimeType,
      };
    }
    return { instances: [instance], parameters };
  }

  normalizeStart(status: number, body: unknown): VideoGenerationOutcome {
    const detail = textOf(body);
    const bad = classifyHttp(status, detail);
    if (bad)
      return { kind: bad, audio: "UNKNOWN", httpStatus: status, detail: detail.slice(0, 300) };
    const name = (body as { name?: unknown })?.name;
    if (typeof name !== "string" || name.length === 0) {
      return {
        kind: "PROVIDER_FAILURE",
        audio: "UNKNOWN",
        httpStatus: status,
        detail: "no operation name",
      };
    }
    return { kind: "PENDING", audio: "UNKNOWN", operationName: name, httpStatus: status };
  }

  normalizePoll(status: number, body: unknown): VideoGenerationOutcome {
    const detail = textOf(body);
    const bad = classifyHttp(status, detail);
    if (bad)
      return { kind: bad, audio: "UNKNOWN", httpStatus: status, detail: detail.slice(0, 300) };
    return { ...normalizeOperation(body), httpStatus: status };
  }
}

// --------------------------------------------------------------- selection
export const VIDEO_PROVIDERS: Record<string, VideoProvider> = {
  "google-ai-studio": new GeminiDeveloperApiProvider(),
  "google-agent-platform": new GoogleAgentPlatformProvider(),
};

export function providerForSurface(surface: ProviderSurface): VideoProvider | null {
  return VIDEO_PROVIDERS[surface] ?? null;
}

/**
 * Is a surface configured enough to be worth trying?
 *
 * Presence only — this reads whether a name is set, never what it is set to,
 * and returns the missing NAMES so an operator can act without anyone printing
 * a secret.
 */
export function providerConfigStatus(
  provider: VideoProvider,
  isPresent: (name: string) => boolean,
): { configured: boolean; missing: string[] } {
  const missing = provider.configRequirements().filter((name) => !isPresent(name));
  return { configured: missing.length === 0, missing };
}

/**
 * The configuration gate, as an OUTCOME rather than a thrown error.
 *
 * A missing environment variable must produce a typed refusal, never a request
 * that goes out and fails at the far end. Two reasons, and the second is the
 * expensive one:
 *
 *   1. An unconfigured surface cannot succeed, so calling it is pure latency.
 *   2. A request that LEAVES THE BOX may be billed. A failure ONIQ can predict
 *      for free must never become a failure ONIQ pays to discover.
 *
 * `detail` names the missing variables. Names are safe; values never appear.
 */
export function requireProviderConfiguration(
  provider: VideoProvider,
  isPresent: (name: string) => boolean,
): VideoGenerationOutcome | null {
  const { configured, missing } = providerConfigStatus(provider, isPresent);
  if (configured) return null;
  return {
    kind: "CONFIGURATION_FAILURE",
    audio: "UNKNOWN",
    detail: `PROVIDER_CONFIGURATION_MISSING: ${missing.join(", ")}`,
  };
}
