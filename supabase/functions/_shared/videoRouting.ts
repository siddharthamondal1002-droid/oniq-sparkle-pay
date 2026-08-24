// videoRouting — what a generated second costs, who generates it, and what
// happens when it fails.
//
// THIS IS NOT A SECOND ROUTER. src/lib/motionCost.ts already decides the CHEAPEST
// LEVEL that makes a shot perform (0 STATIC → 1 CAMERA → 2 RIG → 3 POSE_WARP →
// 4 DIFFUSION → 5 PREMIUM), and levels 0–3 are in-house CPU work that costs no
// provider money. This module only picks up at LEVEL 5 — once that ladder has
// already concluded external generation is required — and answers three
// questions the level ladder does not: which external TIER, what it costs, and
// what to do when it comes back wrong.

import type { AudioMode, ProviderSurface } from "./videoAudio.ts";

// ============================================================================
// PRICE BOOK
// ============================================================================
//
// PROVENANCE IS A FIELD, NOT A FOOTNOTE. Every rate carries where it came from
// and when, because the last time this codebase priced video it used $0.15/s —
// a figure that was right for a tier ONIQ had stopped calling — and the whole
// movie-grade chart was built on it.
//
// THE SURFACE IS PART OF THE PRICE. Veo's published table has a video-only
// column and a with-audio column, but the video-only column is only REACHABLE
// where `generateAudio` can be sent, and that is the Agent Platform, not the
// Gemini Developer API ONIQ calls today (see videoAudio.ts for the SDK
// evidence). `usdPerSecondVideoOnly: null` means "this tier exists in the table
// and cannot be bought from here", which is a different and more useful
// statement than a missing row.
//
// ============================================================================
// CURRENCY DISCIPLINE (owner directive, 2026-08-24)
// ============================================================================
//
// EVERY FIGURE IN THIS MODULE IS USD, AND THERE IS NO FX RATE ANYWHERE IN IT.
// Google's published USD price is the canonical provider-cost input; an FX rate
// is a second, independently-moving number, and letting one into a routing
// decision means the router's answer changes on a day when nothing about the
// providers changed. Tier selection, spend ceilings, acceptance arithmetic and
// provider selection are all USD-only by construction.
//
// If an INR figure is needed for a report, it is converted AT REPORTING TIME,
// from a separately verified rate, and printed with its source and timestamp
// beside it. `src/lib/__tests__/currencyDiscipline.test.ts` fails the build if
// an FX rate, an INR symbol or an INR-denominated field appears in this module,
// the ledger module, or the ledger migration.

export type RateProvenance =
  /** Supplied by the owner, who sees the actual bill. */
  | "OWNER_SUPPLIED_2026_08_24"
  /** Read from the provider's own published page in this container. */
  | "VERIFIED_FROM_PROVIDER"
  /** No trustworthy figure. Anything with this provenance CANNOT generate. */
  | "UNVERIFIED";

export type VideoRate = {
  surface: ProviderSurface;
  provider: string;
  model: string;
  resolution: "720p";
  /** USD per generated second when audio is generated too. */
  usdPerSecondWithAudio: number | null;
  /** USD per generated second with audio declined. Null ⇒ not reachable here. */
  usdPerSecondVideoOnly: number | null;
  provenance: RateProvenance;
  note?: string;
};

/**
 * 720p only. The Indian launch model is 720p and multi-resolution economics
 * are not opened until 720p's are stable (owner, §26).
 */
export const VIDEO_RATES: VideoRate[] = [
  {
    surface: "google-ai-studio",
    provider: "google",
    model: "veo-3.1-lite-generate-preview",
    resolution: "720p",
    usdPerSecondWithAudio: 0.05,
    usdPerSecondVideoOnly: null,
    provenance: "OWNER_SUPPLIED_2026_08_24",
    note:
      "The video-only column is the Agent Platform's. On the Gemini Developer " +
      "API `generateAudio` is rejected by the API itself, so only the " +
      "with-audio rate can actually be bought.",
  },
  {
    surface: "google-ai-studio",
    provider: "google",
    model: "veo-3.1-fast-generate-preview",
    resolution: "720p",
    usdPerSecondWithAudio: 0.1,
    usdPerSecondVideoOnly: null,
    provenance: "OWNER_SUPPLIED_2026_08_24",
    note: "Same surface constraint as Lite. This is the model story-clip runs today.",
  },
  {
    surface: "google-agent-platform",
    provider: "google",
    model: "veo-3.1-lite",
    resolution: "720p",
    usdPerSecondWithAudio: 0.05,
    usdPerSecondVideoOnly: 0.03,
    provenance: "OWNER_SUPPLIED_2026_08_24",
    note:
      "NOT THE SURFACE ONIQ CALLS. Reaching $0.03/s means moving video to the " +
      "Gemini Enterprise Agent Platform — a provider-and-account change, and " +
      "therefore an owner decision.",
  },
  {
    surface: "google-agent-platform",
    provider: "google",
    model: "veo-3.1-fast",
    resolution: "720p",
    usdPerSecondWithAudio: 0.1,
    usdPerSecondVideoOnly: 0.08,
    provenance: "OWNER_SUPPLIED_2026_08_24",
    note: "NOT THE SURFACE ONIQ CALLS.",
  },
  {
    surface: "runway",
    provider: "runway",
    model: "gen4_turbo",
    resolution: "720p",
    // 5 credits/second is documented in runway.server.ts; what a credit COSTS
    // is not, and a credit is not a dollar until someone reads the invoice.
    usdPerSecondWithAudio: null,
    usdPerSecondVideoOnly: null,
    provenance: "UNVERIFIED",
    note:
      "5 credits/s, USD-per-credit unverified, and no ONIQ server-side call has " +
      "ever succeeded (video_jobs has 0 rows). Cannot be selected.",
  },
];

/** The surface ONIQ's video calls actually go to today. */
export const ACTIVE_VIDEO_SURFACE: ProviderSurface = "google-ai-studio";

export function findRate(model: string, surface = ACTIVE_VIDEO_SURFACE): VideoRate | undefined {
  return VIDEO_RATES.find((r) => r.model === model && r.surface === surface);
}

/**
 * USD for one clip. THROWS rather than guessing.
 *
 * An unpriced model is one ONIQ cannot budget for, and returning 0 would let it
 * generate for free on paper — which is precisely how a spend guard becomes
 * decoration. The throw is what makes "NO UNPRICED MODEL CAN GENERATE" true.
 */
export function videoUsd(
  model: string,
  seconds: number,
  audio: AudioMode,
  surface = ACTIVE_VIDEO_SURFACE,
): number {
  const rate = findRate(model, surface);
  if (!rate) throw new Error(`no rate for ${model} on ${surface}`);
  if (rate.provenance === "UNVERIFIED") {
    throw new Error(`rate for ${model} on ${surface} is unverified`);
  }
  if (!(seconds > 0)) throw new Error(`invalid duration ${seconds}`);

  // The BILLED rate, not the requested one. If the surface cannot decline
  // audio, a VIDEO_ONLY request is still billed with audio, and reserving the
  // cheaper number would under-reserve every single clip.
  const wantsVideoOnly = audio !== "VEO_NATIVE_AUDIO";
  const videoOnly = rate.usdPerSecondVideoOnly;
  const perSecond = wantsVideoOnly && videoOnly !== null ? videoOnly : rate.usdPerSecondWithAudio;
  if (perSecond === null) throw new Error(`no usable rate for ${model} on ${surface}`);
  return perSecond * seconds;
}

// ============================================================================
// TIER SELECTION
// ============================================================================

export type ExternalTier = "LITE" | "FAST" | "RUNWAY";

export type TierChoice = {
  tier: ExternalTier | null;
  model: string | null;
  /** Null when nothing is selectable — the caller must not generate. */
  reason: string;
};

/**
 * Quality evidence for one motion class, from a FROZEN benchmark.
 *
 * There is deliberately no default. A tier is chosen on measured acceptance or
 * it is not chosen: "Lite is probably fine" is how a benchmark gets skipped.
 */
export type TierEvidence = {
  motionClass: string;
  /** Fraction of first attempts that pass every QA gate. Null = not measured. */
  liteAcceptance: number | null;
  fastAcceptance: number | null;
  /** Blind review? The 2026-08-24 review was NOT — MODELS={A:lite,B:fast}. */
  blind: boolean;
  benchmarkId: string;
};

/**
 * Pick the cheapest external tier whose MEASURED acceptance clears the bar.
 *
 * The bar is a fraction of accepted first attempts, and the comparison is on
 * cost per ACCEPTED second — a tier that is half the price and fails twice as
 * often is not cheaper. Escalating to Fast requires evidence that Fast is
 * actually better FOR THAT MOTION CLASS, because the one thing the 2026-08-24
 * run did establish is that Fast does not fix everything Lite gets wrong: the
 * two clips that returned empty returned empty on BOTH tiers.
 */
export function chooseTier(
  ev: TierEvidence | null,
  qualityBar: number,
  surface = ACTIVE_VIDEO_SURFACE,
): TierChoice {
  if (!ev) {
    return { tier: null, model: null, reason: "no benchmark evidence for this motion class" };
  }
  if (ev.liteAcceptance === null && ev.fastAcceptance === null) {
    return { tier: null, model: null, reason: `benchmark ${ev.benchmarkId} measured neither tier` };
  }

  const lite = VIDEO_RATES.find((r) => r.surface === surface && /lite/.test(r.model));
  const fast = VIDEO_RATES.find((r) => r.surface === surface && /fast/.test(r.model));

  if (lite && ev.liteAcceptance !== null && ev.liteAcceptance >= qualityBar) {
    return {
      tier: "LITE",
      model: lite.model,
      reason: `Lite accepted ${(ev.liteAcceptance * 100).toFixed(0)}% on ${ev.motionClass}, at or above the ${(qualityBar * 100).toFixed(0)}% bar`,
    };
  }
  if (fast && ev.fastAcceptance !== null && ev.fastAcceptance >= qualityBar) {
    return {
      tier: "FAST",
      model: fast.model,
      reason: `Lite below bar on ${ev.motionClass}; Fast measured ${(ev.fastAcceptance * 100).toFixed(0)}%`,
    };
  }
  // Runway is never the answer to "both Google tiers failed" until it has been
  // verified end to end. An unverified provider is not a fallback.
  return {
    tier: null,
    model: null,
    reason: `neither tier clears the bar on ${ev.motionClass}; Runway is unverified and cannot be selected`,
  };
}

// ============================================================================
// FAILURE CLASSIFICATION
// ============================================================================
//
// "Lite failed → try Fast" is the escalation that wastes the most money,
// because most failures are not about model capability. The 2026-08-24 run had
// two prompts return HTTP 200 with no samples on BOTH tiers — a responsible-AI
// filter, which a more expensive model does not fix and will bill for again.

export type FailureClass =
  | "MOTION_COMPLEXITY"
  | "CONTENT_FILTERED"
  | "BAD_PROMPT"
  | "BAD_REFERENCE"
  | "PROVIDER_OUTAGE"
  | "QUOTA_EXHAUSTED"
  | "BUDGET"
  | "UNKNOWN";

export type FailureSignal = {
  httpStatus?: number;
  /** Provider message or operation error text. */
  detail?: string;
  /** done:true, no error, no video — the generated-then-filtered shape. */
  emptyOutput?: boolean;
  /** Set when the clip generated but failed ONIQ's own motion/prompt QA. */
  qaFailure?: "MOTION" | "ADHERENCE" | "TECHNICAL" | "AUDIO";
  /** True when the same prompt+reference already failed on another tier. */
  failedOnOtherTier?: boolean;
};

export function classifyVideoFailure(s: FailureSignal): FailureClass {
  const d = s.detail ?? "";
  if (s.httpStatus === 429 || /RESOURCE_EXHAUSTED/i.test(d)) return "QUOTA_EXHAUSTED";
  if (s.httpStatus === 503 || s.httpStatus === 500 || s.httpStatus === 502)
    return "PROVIDER_OUTAGE";
  if (s.emptyOutput || /third.?party|prohibited|safety|filtered|violat|blocked/i.test(d)) {
    return "CONTENT_FILTERED";
  }
  if (s.httpStatus === 400 && /prompt/i.test(d)) return "BAD_PROMPT";
  if (s.httpStatus === 400 && /image|reference|frame/i.test(d)) return "BAD_REFERENCE";
  if (s.qaFailure === "MOTION" || s.qaFailure === "ADHERENCE") return "MOTION_COMPLEXITY";
  if (s.qaFailure === "TECHNICAL" || s.qaFailure === "AUDIO") return "BAD_PROMPT";
  return "UNKNOWN";
}

export type EscalationAction =
  | { action: "RETRY_SAME"; because: string }
  | { action: "ESCALATE_TIER"; because: string }
  | { action: "FIX_PROMPT"; because: string }
  | { action: "FIX_REFERENCE"; because: string }
  | { action: "WAIT"; because: string; retryAfterSeconds?: number }
  | { action: "STOP"; because: string };

/**
 * What to do about a failed shot.
 *
 * ESCALATE_TIER is returned for exactly one failure class, and only when the
 * shot has not already failed on the other tier. Everything else either fixes
 * the input, waits, or stops — and stopping is a legitimate answer: a shot that
 * cannot be generated becomes a still, which in a movie is a shot, not a hole.
 */
export function escalationFor(cls: FailureClass, s: FailureSignal = {}): EscalationAction {
  switch (cls) {
    case "MOTION_COMPLEXITY":
      if (s.failedOnOtherTier) {
        return {
          action: "STOP",
          because: "already failed on the other tier — a third generation buys nothing",
        };
      }
      return {
        action: "ESCALATE_TIER",
        because: "motion complexity is the one thing a stronger tier can fix",
      };
    case "CONTENT_FILTERED":
      // Measured: the same two prompts returned empty on Lite AND Fast.
      return {
        action: "FIX_PROMPT",
        because:
          "a responsible-AI refusal is about the request, not the model — a costlier tier refuses too",
      };
    case "BAD_PROMPT":
      return { action: "FIX_PROMPT", because: "the provider named the prompt" };
    case "BAD_REFERENCE":
      return { action: "FIX_REFERENCE", because: "the provider named the starting frame" };
    case "PROVIDER_OUTAGE":
      return {
        action: "WAIT",
        because: "provider-side fault, not a model choice",
        retryAfterSeconds: 30,
      };
    case "QUOTA_EXHAUSTED":
      return { action: "STOP", because: "a daily quota does not clear by retrying" };
    case "BUDGET":
      return { action: "STOP", because: "the ledger refused; there is no tier that is free" };
    default:
      return { action: "RETRY_SAME", because: "unclassified — one retry, then stop" };
  }
}

// ============================================================================
// FILTERED-OUTPUT BILLING
// ============================================================================
/**
 * Does Google bill a generation that returned HTTP 200 with no samples?
 *
 * UNKNOWN, and it must stay unknown until an invoice says otherwise. Anthropic
 * publishes the equivalent rule for web search ("if an error occurs during web
 * search, the web search will not be billed"); Google publishes no such line
 * for a responsible-AI filtered video, and this container cannot reach an
 * invoice.
 *
 * So the economics are computed BOTH ways and the conservative one is the one
 * that reserves. Treating an uncertain failed generation as free is how a
 * filter-heavy prompt set silently becomes a bill.
 */
export type FilteredBilling = "BILLED" | "NOT_BILLED" | "UNKNOWN";
export const FILTERED_OUTPUT_BILLING: FilteredBilling = "UNKNOWN";

export function filteredCostBounds(
  model: string,
  seconds: number,
  filteredAttempts: number,
  surface = ACTIVE_VIDEO_SURFACE,
): { lowerBoundUsd: number; conservativeUsd: number } {
  const per = videoUsd(model, seconds, "VEO_NATIVE_AUDIO", surface);
  return {
    // If Google does not bill filtered generations.
    lowerBoundUsd: 0,
    // If it does. This is the figure that must reserve and the figure that
    // must appear in any price built on this pipeline.
    conservativeUsd: per * filteredAttempts,
  };
}

// ============================================================================
// THE THREE CANONICAL USD METRICS
// ============================================================================
//
// These are the only cost figures allowed to influence a routing decision, and
// all three are USD. There is deliberately no INR equivalent in this module:
// see CURRENCY DISCIPLINE at the top.

/** USD for one GENERATED second at the rate that will actually be billed. */
export function usdPerGeneratedSecond(
  model: string,
  audio: AudioMode,
  surface = ACTIVE_VIDEO_SURFACE,
): number {
  return videoUsd(model, 1, audio, surface);
}

/** USD for one ATTEMPT — one submitted generation of `seconds` seconds. */
export function usdPerAttempt(
  model: string,
  seconds: number,
  audio: AudioMode,
  surface = ACTIVE_VIDEO_SURFACE,
): number {
  return videoUsd(model, seconds, audio, surface);
}

/**
 * USD for one ACCEPTED second — the figure the whole routing decision rests on.
 *
 *   usd per accepted second = usd per generated second x E[attempts] / P(accept)
 *
 * A tier at half the price that fails twice as often is not cheaper, and only
 * this number says so. Returns null when acceptance has not been MEASURED:
 * substituting a hopeful default is how a benchmark gets skipped.
 */
export function usdPerAcceptedSecond(
  model: string,
  audio: AudioMode,
  acceptance: number | null,
  maxAttempts = 3,
  surface = ACTIVE_VIDEO_SURFACE,
): number | null {
  if (acceptance === null || !(acceptance > 0) || acceptance > 1) return null;
  return (
    (usdPerGeneratedSecond(model, audio, surface) * expectedAttempts(acceptance, maxAttempts)) /
    acceptance
  );
}

/** Expected attempts for a ladder that stops succeeding-or-at-`maxAttempts`. */
export function expectedAttempts(acceptance: number, maxAttempts = 3): number {
  if (!(acceptance > 0) || acceptance > 1) return maxAttempts;
  let expected = 0;
  let stillFailing = 1;
  for (let k = 1; k <= maxAttempts; k++) {
    expected += k * stillFailing * acceptance;
    stillFailing *= 1 - acceptance;
  }
  return expected + maxAttempts * stillFailing;
}

// ============================================================================
// SURFACE COMPARISON — USD ONLY
// ============================================================================
/**
 * What the two Google surfaces cost for the same work, in USD.
 *
 * The comparison that matters is not Lite-vs-Fast; it is the SAME tier on two
 * surfaces, because one of them can decline audio and the other cannot. No FX
 * appears here and none should: this is a provider-cost comparison, and the
 * decision it informs (whether to move ONIQ's video calls) does not depend on
 * what a dollar is worth in rupees today.
 */
export type SurfaceComparison = {
  seconds: number;
  geminiApiUsd: number;
  agentPlatformVideoOnlyUsd: number;
  differenceUsd: number;
  /** Fraction saved, 0..1. Not a percentage — the caller formats. */
  reduction: number;
};

export function compareGoogleSurfaces(seconds: number, tier: "lite" | "fast"): SurfaceComparison {
  const api = VIDEO_RATES.find((r) => r.surface === "google-ai-studio" && r.model.includes(tier));
  const ap = VIDEO_RATES.find(
    (r) => r.surface === "google-agent-platform" && r.model.includes(tier),
  );
  if (!api?.usdPerSecondWithAudio || !ap?.usdPerSecondVideoOnly) {
    throw new Error(`cannot compare ${tier}: a rate is missing`);
  }
  const geminiApiUsd = api.usdPerSecondWithAudio * seconds;
  const agentPlatformVideoOnlyUsd = ap.usdPerSecondVideoOnly * seconds;
  const differenceUsd = geminiApiUsd - agentPlatformVideoOnlyUsd;
  return {
    seconds,
    geminiApiUsd,
    agentPlatformVideoOnlyUsd,
    differenceUsd,
    reduction: differenceUsd / geminiApiUsd,
  };
}
