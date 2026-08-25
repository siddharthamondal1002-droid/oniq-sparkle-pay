// webRetrieval — ONIQ owns retrieval; the model only synthesises.
//
// WHY THIS EXISTS. Across four Gemini models and twelve scout-shaped queries,
// only three calls issued a search at all, forty-nine result rows came back,
// and ONE named a source that had actually been retrieved. The model does not
// decline to search and then say so — it searches nothing and answers anyway,
// in perfect schema, with `source_domain` filled in. Asking a model to both
// retrieve and report is asking it to mark its own homework.
//
// So retrieval moves out of the model. ONIQ builds the queries, calls a
// retrieval provider it controls, assembles an evidence package, and hands the
// model text it may summarise and nothing else. The model's native search
// tooling is switched OFF on this path — see `RETRIEVAL_FIRST_FORBIDS_GROUNDING`.
//
// PROVIDER-AGNOSTIC ON PURPOSE. Which retrieval provider ONIQ pays for is the
// owner's decision under `CLAUDE.md § Business decisions are the owner's`, and
// as of 2026-08-25 ONIQ has no such credential at all. Everything here works
// against the `RetrievalProvider` interface, so a provider choice plugs in
// without reshaping the architecture around it.

import type { SearchBudget } from "./searchBudget.ts";

/**
 * ONIQ's retrieval ceiling per request. The model does not get to loop.
 *
 * Six because that is smart-scout's existing hop budget, so the fallback
 * retrieves no more widely than the primary path is allowed to. Raising it is
 * a spend decision, not a tuning knob.
 */
export const MAX_RETRIEVAL_CALLS = 6;

/**
 * The retrieval-first path and native model grounding are mutually exclusive.
 *
 * Leaving grounding on would reintroduce exactly the failure this module
 * exists to remove: the model would have a second, unaccounted source of
 * "evidence" that ONIQ never saw and cannot validate against, and the ledger
 * would be billed for grounded queries nobody asked for.
 */
export const RETRIEVAL_FIRST_FORBIDS_GROUNDING = true;

// ---------------------------------------------------------------- the shape
/** One retrieved result. Absent fields stay absent — never manufactured. */
export type EvidenceSource = {
  title: string | null;
  /** EXACTLY as the provider returned it. This is the identity of the source. */
  url: string;
  domain: string;
  snippet: string | null;
  /** When ONIQ retrieved it. Freshness is a property of the fetch, not the model. */
  retrievedAt: string;
};

export type EvidencePackage = {
  sources: EvidenceSource[];
  /** The queries ONIQ chose to run. Billable units, one per call. */
  queries: string[];
  /** Retrieval calls actually made. Never exceeds MAX_RETRIEVAL_CALLS. */
  callsMade: number;
  retrievedAt: string;
};

export type RetrievalOutcome =
  | { ok: true; results: Omit<EvidenceSource, "retrievedAt">[] }
  | { ok: false; reason: "not-configured" | "provider-error" | "timeout" | "no-results" };

/** What any retrieval provider must offer. One query in, bounded results out. */
export type RetrievalProvider = {
  name: string;
  /** Absent credential ⇒ `not-configured`, never a silent empty result. */
  configured: boolean;
  /** USD per query. `null` ⇒ unpriceable ⇒ the request must fail closed. */
  unitUsd: number | null;
  search(query: string, limit: number): Promise<RetrievalOutcome>;
};

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** The registrable host of a URL, or null if it is not a usable absolute URL. */
export function domainOf(url: unknown): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return HOST_RE.test(h) ? h : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the queries
/**
 * ONIQ writes the queries, not the model.
 *
 * Deliberately dull: the user's ask, plus a small fixed set of framings. It is
 * not trying to be clever — it is trying to be BOUNDED and reproducible, so
 * the number of billable retrievals is known before any of them run.
 */
export function buildQueries(userQuery: string, max = MAX_RETRIEVAL_CALLS): string[] {
  const base = userQuery.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!base) return [];
  const framings = [base, `${base} price India`, `${base} buy online India`];
  return [...new Set(framings)].slice(0, Math.max(0, Math.min(max, MAX_RETRIEVAL_CALLS)));
}

// ---------------------------------------------------------------- gathering
/**
 * Run the queries, deduplicate by URL, and stamp one retrieval time.
 *
 * Stops at the FIRST provider failure rather than retrying: a retry storm is
 * unaccounted spend, and this path already has a controlled way to say it
 * found nothing.
 */
export async function gatherEvidence(
  provider: RetrievalProvider,
  queries: string[],
  now: string,
  perQueryLimit = 5,
): Promise<{ ok: true; evidence: EvidencePackage } | { ok: false; reason: string }> {
  if (!provider.configured) return { ok: false, reason: "retrieval-not-configured" };
  if (provider.unitUsd === null) return { ok: false, reason: "retrieval-unpriced" };

  const bounded = queries.slice(0, MAX_RETRIEVAL_CALLS);
  const byUrl = new Map<string, EvidenceSource>();
  const ran: string[] = [];

  for (const q of bounded) {
    const out = await provider.search(q, perQueryLimit);
    ran.push(q);
    if (!out.ok) {
      if (out.reason === "no-results") continue;
      return { ok: false, reason: `retrieval-${out.reason}` };
    }
    for (const r of out.results) {
      const domain = domainOf(r.url);
      // A result whose URL will not parse is not evidence of anything.
      if (!domain) continue;
      if (byUrl.has(r.url)) continue;
      byUrl.set(r.url, {
        title: r.title ?? null,
        url: r.url,
        domain,
        snippet: r.snippet ?? null,
        retrievedAt: now,
      });
    }
  }

  return {
    ok: true,
    evidence: {
      sources: [...byUrl.values()],
      queries: ran,
      callsMade: ran.length,
      retrievedAt: now,
    },
  };
}

// ---------------------------------------------------------------- the prompt
/**
 * The instruction that travels with the evidence.
 *
 * Written as prohibitions because the measured failure was not a refusal, it
 * was confident invention. `insufficient_evidence` exists so the model has a
 * way to say "not enough" that is not "make something up" — without it, an
 * answer is the only shape on offer.
 */
export const EVIDENCE_ONLY_INSTRUCTION = [
  "EVIDENCE RULES — these override every other instruction you have been given.",
  "Every external fact you report — a price, a rate, an availability, an offer —",
  "must come from the EVIDENCE SOURCES below and from nothing else.",
  "",
  "- Use ONLY the evidence supplied. You have no search tool and no live access.",
  "- NEVER invent a URL. Only a `url` copied character-for-character from an",
  "  evidence source is permitted.",
  "- NEVER construct a product or listing URL from a domain. A domain is not a URL.",
  "- NEVER name a source you were not given, even if you are confident it stocks",
  "  the item.",
  "- NEVER present a remembered price as a retrieved one.",
  "- If the evidence does not support an answer, return exactly:",
  '  {"insufficient_evidence": true} and nothing else.',
  "- Reporting fewer rows backed by evidence is CORRECT. Filling the gaps is not.",
].join("\n");

/** Render the package the model actually reads. */
export function renderEvidence(evidence: EvidencePackage): string {
  if (evidence.sources.length === 0) return "EVIDENCE SOURCES: none retrieved.";
  const blocks = evidence.sources.map((s, i) =>
    [
      `EVIDENCE SOURCE ${i + 1}`,
      `title: ${s.title ?? "(none)"}`,
      `domain: ${s.domain}`,
      `url: ${s.url}`,
      `snippet: ${s.snippet ?? "(none)"}`,
      `retrieved_at: ${s.retrievedAt}`,
    ].join("\n"),
  );
  return `${EVIDENCE_ONLY_INSTRUCTION}\n\n${blocks.join("\n\n")}`;
}

// ---------------------------------------------------------------- the money
/**
 * Retrieval is a billable unit and it is reserved BEFORE anything runs.
 *
 * `null` from the provider means ONIQ cannot price a retrieval, and an
 * unpriced call is one nobody can budget for — the request fails closed rather
 * than running against a guessed rate.
 */
export function retrievalReservationUsd(
  provider: Pick<RetrievalProvider, "unitUsd">,
  calls = MAX_RETRIEVAL_CALLS,
): number | null {
  if (provider.unitUsd === null) return null;
  const n = Math.max(0, Math.min(calls, MAX_RETRIEVAL_CALLS));
  return provider.unitUsd * n;
}

/**
 * The Gemini leg's budget on the retrieval-first path.
 *
 * `maxSearches` is ZEROED: the model has no search tool here, so reserving
 * grounded queries would reserve for a charge that cannot occur. Retrieval is
 * accounted separately, by `retrievalReservationUsd`.
 */
export function retrievalFirstBudget(b: SearchBudget): SearchBudget {
  return { ...b, maxSearches: 0, maxProviderCalls: 1, maxLlmCalls: 1 };
}

// ------------------------------------------------- the evidence-bound contract
/**
 * Validation against SUPPLIED evidence, which is stricter than validation
 * against grounding metadata — deliberately.
 *
 * On the grounding path, Google returned only its own redirect and a publisher
 * name, so the best available check was "is this domain one that came back".
 * Here ONIQ holds the exact URLs it retrieved, so the check is exact-match, and
 * three of the rules below exist because near-misses look completely ordinary:
 *
 *   a real domain               is not evidence a source was retrieved
 *   a syntactically valid URL   is not evidence a source was retrieved
 *   amazon.in/dp/B0XXXXXXX      is not evidence unless that exact URL came back
 *
 * A model that has been handed amazon.in as a domain will cheerfully produce a
 * plausible product path for it, and every downstream check that only looks at
 * the host will pass.
 */
export type SourceViolation =
  | "no-evidence"
  | "url-not-retrieved"
  | "domain-mismatch"
  | "domain-not-retrieved"
  | "price-unsupported"
  | "cross-check-unsupported";

export type SourceVerdict<T> =
  { ok: true; rows: T[] } | { ok: false; violations: SourceViolation[]; offending: string[] };

export type SourceRules = {
  /** Distinct evidence sources a cross-check claim needs. */
  minSources?: number;
  claimsCrossCheck?: boolean;
  /** Rows carrying a price must have it supported by the snippet. */
  requirePriceSupport?: boolean;
  urlKey?: string;
  domainKey?: string;
  priceKey?: string;
};

/** Is this the EXACT url of something ONIQ retrieved? */
export function isRetrievedUrl(url: unknown, evidence: EvidencePackage): boolean {
  return typeof url === "string" && evidence.sources.some((s) => s.url === url);
}

/**
 * Does the evidence actually contain this price?
 *
 * Digits-only comparison, because a snippet writes money a dozen ways —
 * "₹28", "Rs. 28.00", "INR 28". Matching the digit run avoids both a brittle
 * currency regex and the opposite failure of accepting any number at all.
 */
export function priceSupportedByEvidence(
  price: unknown,
  source: EvidenceSource | undefined,
): boolean {
  if (price === null || price === undefined || price === "") return true; // no claim
  if (!source) return false;
  const hay = `${source.title ?? ""} ${source.snippet ?? ""}`.replace(/[,\s]/g, "");
  const n = typeof price === "number" ? price : Number(String(price).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return false;
  const whole = String(Math.round(n));
  return hay.includes(whole);
}

export function validateAgainstEvidence<T extends Record<string, unknown>>(
  rows: T[],
  evidence: EvidencePackage,
  rules: SourceRules = {},
): SourceVerdict<T> {
  const violations: SourceViolation[] = [];
  const offending: string[] = [];
  const urlKey = rules.urlKey ?? "url";
  const domainKey = rules.domainKey ?? "source_domain";
  const priceKey = rules.priceKey ?? "price_inr";

  if (evidence.sources.length === 0) {
    return { ok: false, violations: ["no-evidence"], offending: [] };
  }

  const byUrl = new Map(evidence.sources.map((s) => [s.url, s]));
  const retrievedDomains = new Set(evidence.sources.map((s) => s.domain));

  for (const row of rows) {
    const url = row?.[urlKey];
    const claimedDomain =
      typeof row?.[domainKey] === "string"
        ? (row[domainKey] as string)
            .trim()
            .toLowerCase()
            .replace(/^www\./, "")
        : null;

    // A row may cite a domain without a URL, but then that domain must be one
    // ONIQ retrieved — a domain alone is the weaker claim, not a free pass.
    if (url === undefined || url === null || url === "") {
      if (!claimedDomain || !retrievedDomains.has(claimedDomain)) {
        violations.push("domain-not-retrieved");
        offending.push(`${domainKey}=${claimedDomain ?? "(absent)"}`);
      }
      continue;
    }

    if (!isRetrievedUrl(url, evidence)) {
      violations.push("url-not-retrieved");
      offending.push(`${urlKey}=${String(url).slice(0, 140)}`);
      continue;
    }

    const source = byUrl.get(url as string)!;
    if (claimedDomain && claimedDomain !== source.domain) {
      violations.push("domain-mismatch");
      offending.push(`${claimedDomain} != ${source.domain}`);
      continue;
    }

    if (rules.requirePriceSupport && !priceSupportedByEvidence(row?.[priceKey], source)) {
      violations.push("price-unsupported");
      offending.push(`${priceKey}=${String(row?.[priceKey])} not in ${source.domain}`);
    }
  }

  const minSources = rules.minSources ?? (rules.claimsCrossCheck ? 2 : 1);
  const distinct = new Set(
    rows
      .map((r) => byUrl.get(r?.[urlKey] as string)?.domain)
      .filter((d): d is string => typeof d === "string"),
  );
  if (rules.claimsCrossCheck && distinct.size < minSources) {
    violations.push("cross-check-unsupported");
    offending.push(`distinct_backed_sources=${distinct.size} required=${minSources}`);
  }

  if (violations.length > 0) {
    return { ok: false, violations: [...new Set(violations)], offending };
  }
  return { ok: true, rows };
}

// ------------------------------------------------------------ Serper adapter
/**
 * Serper — an adapter, NOT an onboarding.
 *
 * PROVENANCE, STATED PLAINLY: Serper resells a scraped Google index. ONIQ does
 * not scrape anything here — this calls Serper's documented JSON endpoint with
 * an API key — but the data on the other side of that endpoint was obtained by
 * scraping Google's result pages, and pretending otherwise would be the kind of
 * quiet misrepresentation this codebase exists to avoid.
 *
 * THAT COLLIDES WITH A RECORDED DIRECTIVE. `SEARCH_PROVIDER_MATRIX.md` §3
 * ("Scraping is out, and stays out") names not just scraping but "an unofficial
 * reseller" as the thing not to build on. Serper is exactly that. So this
 * adapter exists, priced and tested, and is NOT wired to a credential: turning
 * it on requires the owner to either lift §3 or choose a provider with its own
 * index. See docs/video/ONIQ_AI_FINANCIAL_CONTROL.md §13.
 *
 * `SERPER_API_KEY` is absent from ONIQ's secrets as of 2026-08-25, so
 * `configured` is false and every call returns `not-configured` rather than a
 * silent empty result.
 */
export const SERPER_ENDPOINT = "https://google.serper.dev/search";

/**
 * $1 per 1,000 queries. Corroborated-secondary, like every non-Anthropic rate
 * here — no Serper documentation host was read from this container. It is NOT
 * used for a live reservation while the adapter is unconfigured, and it must
 * be re-verified against the provider's own page before it ever is.
 */
export const SERPER_UNIT_USD = 1 / 1000;

export const SERPER_TIMEOUT_MS = 8_000;
export const SERPER_MAX_RESULTS = 5;

type SerperOrganic = { title?: unknown; link?: unknown; snippet?: unknown };

/** Normalise Serper's `organic` array. Missing fields stay null, never invented. */
export function normalizeSerperResults(
  body: unknown,
  limit = SERPER_MAX_RESULTS,
): Omit<EvidenceSource, "retrievedAt">[] {
  const organic = (body as { organic?: unknown } | null)?.organic;
  if (!Array.isArray(organic)) return [];
  const out: Omit<EvidenceSource, "retrievedAt">[] = [];
  for (const raw of organic.slice(0, Math.max(0, limit))) {
    const r = (raw ?? {}) as SerperOrganic;
    const url = typeof r.link === "string" ? r.link : "";
    const domain = domainOf(url);
    if (!domain) continue;
    out.push({
      title: typeof r.title === "string" ? r.title : null,
      url,
      domain,
      snippet: typeof r.snippet === "string" ? r.snippet : null,
    });
  }
  return out;
}

/**
 * Build the adapter. `fetchImpl` is injectable so the contract is testable
 * without a credential and without a network call.
 */
export function serperProvider(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): RetrievalProvider {
  return {
    name: "serper",
    configured: Boolean(apiKey),
    unitUsd: SERPER_UNIT_USD,
    async search(query, limit) {
      if (!apiKey) return { ok: false, reason: "not-configured" };
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), SERPER_TIMEOUT_MS);
      try {
        const res = await fetchImpl(SERPER_ENDPOINT, {
          method: "POST",
          headers: { "X-API-KEY": apiKey, "content-type": "application/json" },
          // `num` bounds the page; there is no pagination and no second call.
          body: JSON.stringify({ q: query, num: Math.min(limit, SERPER_MAX_RESULTS), gl: "in" }),
          signal: ctrl.signal,
        });
        if (!res.ok) return { ok: false, reason: "provider-error" };
        const body = await res.json().catch(() => null);
        const results = normalizeSerperResults(body, limit);
        // ONE attempt. A retry here is unaccounted spend on a metered API.
        return results.length > 0 ? { ok: true, results } : { ok: false, reason: "no-results" };
      } catch (e) {
        return {
          ok: false,
          reason: (e as Error)?.name === "AbortError" ? "timeout" : "provider-error",
        };
      } finally {
        clearTimeout(t);
      }
    },
  };
}
