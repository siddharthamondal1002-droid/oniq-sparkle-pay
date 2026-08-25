// geminiSearch — Google Search grounding as ONIQ's search contract.
//
// THE CONTRACT ONIQ'S SEARCH FUNCTIONS HAVE. smart-scout, hotel-scout, ting
// and health-scan all ask Anthropic for exactly one tool,
// `web_search_20250305`, and their system prompts then require every result row
// to carry a real `source_domain`, a working `url`, and — for hotel-scout — a
// cross-check against two independent sources. The tool is what makes those
// requirements answerable. Without it the model is being asked for citations
// it cannot look up.
//
// WHAT THE OLD BRIDGE DID. `translateToolsToGemini` skips any tool with a
// `type` field, which is every Anthropic server tool, so a search-shaped
// request reached Gemini with its tools array EMPTY and its "cite your
// sources" system prompt intact. Nothing logged it. That is the shape that
// invents citations, so this module exists to either translate the tool
// properly or refuse the request.
//
// WHY THE VALIDATOR IS NOT OPTIONAL. The first real grounded call ONIQ ever
// made, 2026-08-25, returned ONE grounding chunk (bigbasket.com) and prose
// asserting TWO prices — the second from Blinkit, which no chunk supported.
// The model did not lie about having searched; it searched once and then
// filled in from memory. So a grounded response is evidence for the sources it
// actually returned and for nothing else, and `dropUnbackedRows` below removes
// the rest rather than passing them to a user as scouted prices.

import { GROUNDING_QUERY_HEADROOM, type SearchBudget } from "./searchBudget.ts";

/** Anthropic's server-side web search tool. The only one ONIQ sends. */
export const ANTHROPIC_WEB_SEARCH = "web_search_20250305";

/** Google's grounding tool, as `generateContent` wants it. */
export const GOOGLE_SEARCH_TOOL = { google_search: {} } as const;

// ------------------------------------------------------------ tool translation
export type ToolTranslation =
  | { ok: true; tools: unknown[]; searchRequired: boolean }
  | { ok: false; reason: "search-tool-untranslatable" };

/**
 * Translate ONIQ's Anthropic tool array for Gemini.
 *
 * Fails CLOSED. A tool ONIQ does not know how to give Gemini is an error, not
 * something to drop quietly — dropping is what produced the invent-the-sources
 * shape. The caller must refuse the request before generation.
 */
export function translateSearchTools(tools: unknown): ToolTranslation {
  if (!Array.isArray(tools) || tools.length === 0) {
    return { ok: true, tools: [], searchRequired: false };
  }
  const out: unknown[] = [];
  let searchRequired = false;
  for (const t of tools) {
    const tt = (t ?? {}) as Record<string, unknown>;
    if (tt.type === ANTHROPIC_WEB_SEARCH) {
      searchRequired = true;
      out.push(GOOGLE_SEARCH_TOOL);
      continue;
    }
    // Any OTHER Anthropic server tool has no verified Gemini equivalent here.
    // Refuse rather than translate it into silence.
    if (typeof tt.type === "string" && tt.type !== "custom") {
      return { ok: false, reason: "search-tool-untranslatable" };
    }
  }
  return { ok: true, tools: out, searchRequired };
}

// ------------------------------------------------------------ reading sources
export type GroundedSource = {
  /** The publisher host, e.g. "bigbasket.com". Google puts it in `title`. */
  domain: string;
  /**
   * Google's redirect, on `vertexaisearch.cloud.google.com`. It is NOT the
   * merchant's product page — Google does not return one — and its terms
   * require serving the redirect unmodified, so ONIQ passes it through as-is
   * and never presents it as a direct listing URL.
   */
  redirectUrl: string;
};

export type GroundingRead = {
  sources: GroundedSource[];
  /** Distinct publisher hosts, lower-cased, for validating claimed rows. */
  domains: Set<string>;
  /**
   * Queries Google reports having run. This is the BILLABLE unit — Google
   * charges per query, and `usageMetadata` does NOT report the count, so
   * settlement has to count them here.
   */
  queryCount: number;
  queries: string[];
};

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Normalise a grounding chunk title to a bare host, or null if it isn't one. */
export function hostFromChunkTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const t = title
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!HOST_RE.test(t)) return null;
  return t;
}

/** Read a Gemini candidate's `groundingMetadata`. Missing fields are empty. */
export function readGrounding(candidate: unknown): GroundingRead {
  const gm = ((candidate ?? {}) as { groundingMetadata?: unknown }).groundingMetadata as
    Record<string, unknown> | undefined;
  const chunks = Array.isArray(gm?.groundingChunks) ? (gm!.groundingChunks as unknown[]) : [];
  const queries = Array.isArray(gm?.webSearchQueries)
    ? (gm!.webSearchQueries as unknown[]).filter((q): q is string => typeof q === "string")
    : [];

  const sources: GroundedSource[] = [];
  const domains = new Set<string>();
  for (const c of chunks) {
    const web = ((c ?? {}) as { web?: unknown }).web as Record<string, unknown> | undefined;
    const host = hostFromChunkTitle(web?.title);
    const uri = typeof web?.uri === "string" ? web.uri : "";
    if (!host || !uri) continue;
    sources.push({ domain: host, redirectUrl: uri });
    domains.add(host);
  }
  return { sources, domains, queryCount: queries.length, queries };
}

// ------------------------------------------------------------ the validator
export type RowVerdict<T> = {
  kept: T[];
  /** Rows naming a domain no grounding chunk returned. Never shown to a user. */
  dropped: Array<{ row: T; claimed: string | null; why: "unbacked" | "no-domain" }>;
};

/**
 * Keep only rows whose claimed source is one Gemini actually received.
 *
 * This is the countermeasure to the measured failure: one grounded source,
 * two prices claimed. A row citing a domain that never appeared in
 * `groundingChunks` is not a weakly-sourced row, it is an unsourced one, and
 * ONIQ's schema presents `source_domain` as where the price came from.
 *
 * Dropping rather than flagging, because the field is load-bearing: a price
 * shown next to a retailer's name IS a claim that the retailer charges it.
 */
export function dropUnbackedRows<T extends Record<string, unknown>>(
  rows: T[],
  grounding: GroundingRead,
  domainKey = "source_domain",
): RowVerdict<T> {
  const kept: T[] = [];
  const dropped: RowVerdict<T>["dropped"] = [];
  for (const row of rows) {
    const raw = row?.[domainKey];
    const claimed =
      typeof raw === "string"
        ? raw
            .trim()
            .toLowerCase()
            .replace(/^www\./, "")
        : null;
    if (!claimed) {
      dropped.push({ row, claimed: null, why: "no-domain" });
      continue;
    }
    // Suffix match so "shop.bigbasket.com" is backed by "bigbasket.com".
    const backed = [...grounding.domains].some((d) => claimed === d || claimed.endsWith(`.${d}`));
    if (backed) kept.push(row);
    else dropped.push({ row, claimed, why: "unbacked" });
  }
  return { kept, dropped };
}

/**
 * Does the surviving evidence meet a cross-check requirement?
 *
 * hotel-scout asks for a top pick verified against two INDEPENDENT sources.
 * Two rows from one domain are one source, so this counts distinct hosts.
 */
export function crossCheckSatisfied(grounding: GroundingRead, minSources = 2): boolean {
  return grounding.domains.size >= minSources;
}

// ------------------------------------------------------------ the fail-closed gate
export type SearchCapability =
  | { ok: true; tools: unknown[]; searchRequired: boolean }
  | { ok: false; reason: "search-required-without-search-tool" | "search-tool-untranslatable" };

/**
 * The assertion PHASE 4 asks for: a search-required request that has no usable
 * search mechanism is rejected BEFORE generation, never answered from memory.
 *
 * `budget.maxSearches > 0` is ONIQ's own statement that this request needs live
 * sources. If the translated tool array cannot carry that, nothing is sent.
 */
export function searchCapabilityFor(tools: unknown, budget: SearchBudget): SearchCapability {
  const t = translateSearchTools(tools);
  if (!t.ok) return { ok: false, reason: t.reason };
  if (budget.maxSearches > 0 && !t.searchRequired) {
    return { ok: false, reason: "search-required-without-search-tool" };
  }
  return { ok: true, tools: t.tools, searchRequired: t.searchRequired };
}

/**
 * Grounded queries to RESERVE for.
 *
 * `google_search` has no `max_uses`, so unlike the Anthropic path the hop
 * budget is not enforced by the provider — Gemini decides. The reservation
 * therefore carries headroom, and settlement uses the count Google reports.
 */
export function groundedQueriesToReserve(budget: SearchBudget): number {
  return budget.maxSearches * GROUNDING_QUERY_HEADROOM;
}

// ------------------------------------------------- the attestation gate
/**
 * MEASURED 2026-08-25, and the reason this gate exists.
 *
 * Twelve scout-shaped queries across FOUR models, each with
 * `tools: [{google_search: {}}]` and ONIQ's real smart-scout system prompt.
 * Every call returned HTTP 200. Three of twelve issued any search at all.
 * Forty-nine result rows came back; ONE named a source that had actually been
 * retrieved.
 *
 * `gemini-3.1-flash-lite` — the model this loop was asked to make safe —
 * scored 0 searches on 3 of 3 and 12 of 12 rows unbacked, behaving exactly
 * like 3.5-flash-lite. amazon.in, flipkart.com, blinkit.com, zeptonow.com,
 * jiomart.com and mi.com prices, every one from memory, every one carrying
 * `source_domain` as though scouted.
 *
 * The lesson worth keeping is that **schema compliance is not sourcing**. The
 * JSON parsed perfectly on all three; a validator that only checked shape
 * would have passed 13 fabricated prices straight through to a user. Only
 * comparing claims against retrieved evidence catches it.
 *
 * `dropUnbackedRows` alone would empty the table and return a technically
 * honest zero-row answer. That is not enough: a response where the model
 * never searched at all is not a weak answer to a search request, it is not
 * an answer to a search request. It is rejected whole.
 */
export const GROUNDING_FABRICATION_EVIDENCE = {
  /** Four models, twelve scout-shaped queries, ONIQ's real system prompt. */
  measured: "2026-08-25",
  perModel: [
    // The failover model. Behaves exactly like 3.5-lite.
    { model: "gemini-3.1-flash-lite", queries: 3, searched: 0, rows: 12, backed: 0 },
    { model: "gemini-3.5-flash-lite", queries: 3, searched: 0, rows: 13, backed: 0 },
    { model: "gemini-3.5-flash", queries: 3, searched: 2, rows: 7, backed: 0 },
    { model: "gemini-3.6-flash", queries: 3, searched: 1, rows: 17, backed: 1 },
  ],
  totalRows: 49,
  totalBacked: 1,
  callsThatSearched: 3,
  callsTotal: 12,
} as const;

export type GroundingVerdict =
  | { ok: true; grounding: GroundingRead }
  | {
      ok: false;
      reason: "no-grounding-evidence" | "insufficient-sources";
      grounding: GroundingRead;
    };

/**
 * Does this response carry enough retrieved evidence to answer a search
 * request at all?
 *
 * `minSources` defaults to 1 — merely "the model actually searched". Callers
 * with a cross-check requirement pass 2.
 */
export function requireGroundingEvidence(candidate: unknown, minSources = 1): GroundingVerdict {
  const grounding = readGrounding(candidate);
  if (grounding.queryCount === 0 && grounding.domains.size === 0) {
    return { ok: false, reason: "no-grounding-evidence", grounding };
  }
  if (grounding.domains.size < minSources) {
    return { ok: false, reason: "insufficient-sources", grounding };
  }
  return { ok: true, grounding };
}

// ---------------------------------------------------- PHASE 6: evidence-bound
/**
 * A whole-response verdict, not a row filter.
 *
 * `dropUnbackedRows` answers "which rows survive". This answers the prior
 * question: "is this response admissible at all". They are different because
 * a response can be individually-plausible row by row and still be inadmissible
 * — most obviously when the model never searched, but also when it cites a URL
 * from nowhere, or claims a two-source cross-check on one source.
 *
 * Nothing here REPAIRS anything. A fabricated URL is not replaced with a
 * guessed one and an unbacked row is not re-attributed to a source that
 * happens to be present. The response either stands on the evidence that came
 * back, or it is refused.
 */
export type EvidenceViolation =
  | "no-evidence-retrieved"
  | "url-not-in-evidence"
  | "domain-not-in-evidence"
  | "cross-check-unsupported";

export type EvidenceVerdict<T> =
  | { ok: true; rows: T[]; grounding: GroundingRead }
  | {
      ok: false;
      violations: EvidenceViolation[];
      grounding: GroundingRead;
      /** For logs. Never rendered — these are the claims that failed. */
      offending: string[];
    };

/**
 * Is a URL one the evidence actually supplied?
 *
 * Google returns its own `vertexaisearch.cloud.google.com` redirect rather
 * than a merchant link, so the only admissible URLs are the redirects that
 * came back, plus anything on a host the evidence named. A URL the model
 * composed itself — `amazon.in/dp/B0XXXX` — is exactly the fabrication this
 * catches, and it looks completely ordinary.
 */
export function urlBackedByEvidence(url: unknown, grounding: GroundingRead): boolean {
  if (typeof url !== "string" || url.length === 0) return true; // absent is not a claim
  if (grounding.sources.some((s) => s.redirectUrl === url)) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return [...grounding.domains].some((d) => host === d || host.endsWith(`.${d}`));
}

export type EvidenceRules = {
  /** Distinct retrieved hosts required. hotel-scout's cross-check needs 2. */
  minSources?: number;
  /** Does the response assert a cross-check it must now justify? */
  claimsCrossCheck?: boolean;
  domainKey?: string;
  urlKey?: string;
};

export function validateEvidenceBound<T extends Record<string, unknown>>(
  candidate: unknown,
  rows: T[],
  rules: EvidenceRules = {},
): EvidenceVerdict<T> {
  const grounding = readGrounding(candidate);
  const violations: EvidenceViolation[] = [];
  const offending: string[] = [];

  // 1. Did anything get retrieved at all? Measured: on three models, six of
  //    nine calls issued no query and answered anyway.
  if (grounding.queryCount === 0 && grounding.domains.size === 0) {
    violations.push("no-evidence-retrieved");
    return { ok: false, violations, grounding, offending };
  }

  const domainKey = rules.domainKey ?? "source_domain";
  const urlKey = rules.urlKey ?? "url";
  const { kept, dropped } = dropUnbackedRows(rows, grounding, domainKey);
  if (dropped.length > 0) {
    violations.push("domain-not-in-evidence");
    for (const d of dropped) offending.push(`${domainKey}=${d.claimed ?? "(absent)"}`);
  }

  for (const row of rows) {
    if (!urlBackedByEvidence(row?.[urlKey], grounding)) {
      violations.push("url-not-in-evidence");
      offending.push(`${urlKey}=${String(row?.[urlKey]).slice(0, 120)}`);
    }
  }

  // 2. A cross-check claim is a claim about the EVIDENCE, so it is checked
  //    against distinct retrieved hosts rather than against row count.
  const minSources = rules.minSources ?? (rules.claimsCrossCheck ? 2 : 1);
  if (grounding.domains.size < minSources) {
    violations.push("cross-check-unsupported");
    offending.push(`sources=${grounding.domains.size} required=${minSources}`);
  }

  if (violations.length > 0) {
    return { ok: false, violations: [...new Set(violations)], grounding, offending };
  }
  return { ok: true, rows: kept, grounding };
}
