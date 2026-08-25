/**
 * RETRIEVAL-FIRST FALLBACK — owner loop, 2026-08-25.
 *
 * The architecture exists because of a number: across four Gemini models and
 * twelve scout-shaped queries, three calls issued a search, forty-nine rows
 * came back, and ONE named a source that had actually been retrieved. Asking a
 * model to retrieve AND report is asking it to mark its own homework.
 *
 * So ONIQ retrieves, and the model may only repeat what it was handed. These
 * tests are mostly about the near-misses, because those are what actually get
 * through: a real domain, a syntactically perfect URL, a plausible product
 * path. Every one of them looks completely ordinary and none of them is
 * evidence that anything was retrieved.
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_ONLY_INSTRUCTION,
  type EvidencePackage,
  MAX_RETRIEVAL_CALLS,
  RETRIEVAL_FIRST_FORBIDS_GROUNDING,
  SERPER_ENDPOINT,
  SERPER_MAX_RESULTS,
  SERPER_UNIT_USD,
  buildQueries,
  domainOf,
  gatherEvidence,
  isRetrievedUrl,
  normalizeSerperResults,
  priceSupportedByEvidence,
  renderEvidence,
  retrievalFirstBudget,
  retrievalReservationUsd,
  serperProvider,
  validateAgainstEvidence,
} from "../../../supabase/functions/_shared/webRetrieval.ts";
import {
  GEMINI_FAILOVER_MODEL,
  type SearchBudget,
  worstCaseUsd,
} from "../../../supabase/functions/_shared/searchBudget.ts";

const NOW = "2026-08-25T06:00:00.000Z";

/** A package with two real, distinct sources — what "retrieved" looks like. */
const EVIDENCE: EvidencePackage = {
  sources: [
    {
      title: "Tata Salt 1kg",
      url: "https://www.bigbasket.com/pd/126906/tata-salt-1-kg-pouch/",
      domain: "bigbasket.com",
      snippet: "Tata Salt Iodised, 1 kg pouch — Rs 28",
      retrievedAt: NOW,
    },
    {
      title: "Tata Salt 1 kg",
      url: "https://blinkit.com/prn/tata-salt/prid/12345",
      domain: "blinkit.com",
      snippet: "Tata Salt 1 kg at ₹30 delivered in 10 minutes",
      retrievedAt: NOW,
    },
  ],
  queries: ["price of Tata Salt 1kg"],
  callsMade: 1,
  retrievedAt: NOW,
};

// ============================================================ PHASE 5 shape
describe("retrieval-first removes retrieval from the model", () => {
  it("forbids native grounding on this path", () => {
    // Leaving it on would give the model a second source of "evidence" ONIQ
    // never saw and cannot validate — and bill for it.
    expect(RETRIEVAL_FIRST_FORBIDS_GROUNDING).toBe(true);
  });

  it("zeroes the model's own search budget, so grounding cannot be reserved", () => {
    const b: SearchBudget = {
      maxSearches: 6,
      maxProviderCalls: 1,
      maxLlmCalls: 1,
      maxInputTokens: 40_000,
      maxOutputTokens: 3_000,
      maxWallClockMs: 120_000,
      maxEstimatedUsd: 0.5,
    };
    expect(retrievalFirstBudget(b).maxSearches).toBe(0);
    // And therefore the Gemini leg reserves tokens only — retrieval is
    // accounted separately, never folded in as a grounded query.
    expect(worstCaseUsd(GEMINI_FAILOVER_MODEL, retrievalFirstBudget(b))).toBeCloseTo(
      40_000 * 2.5e-7 + 3_000 * 1.5e-6,
      10,
    );
  });

  it("the instruction forbids each measured failure by name", () => {
    for (const rule of [
      /NEVER invent a URL/,
      /NEVER construct a product or listing URL from a domain/,
      /NEVER name a source you were not given/,
      /NEVER present a remembered price as a retrieved one/,
      /insufficient_evidence/,
    ]) {
      expect(EVIDENCE_ONLY_INSTRUCTION).toMatch(rule);
    }
  });

  it("renders every source with its exact url, so the model can copy it", () => {
    const rendered = renderEvidence(EVIDENCE);
    expect(rendered).toContain("EVIDENCE SOURCE 1");
    expect(rendered).toContain("https://www.bigbasket.com/pd/126906/tata-salt-1-kg-pouch/");
    expect(rendered).toContain(`retrieved_at: ${NOW}`);
  });

  it("says so plainly when nothing was retrieved", () => {
    expect(renderEvidence({ ...EVIDENCE, sources: [] })).toBe("EVIDENCE SOURCES: none retrieved.");
  });
});

// ============================================================ PHASE 8 queries
describe("ONIQ writes the queries and owns the ceiling", () => {
  it("never exceeds the retrieval ceiling", () => {
    expect(MAX_RETRIEVAL_CALLS).toBe(6);
    expect(buildQueries("x", 99).length).toBeLessThanOrEqual(MAX_RETRIEVAL_CALLS);
  });

  it("is deterministic, so the billable count is known before spending", () => {
    expect(buildQueries("Tata Salt 1kg")).toEqual(buildQueries("Tata Salt 1kg"));
    expect(buildQueries("  Tata   Salt 1kg ")).toEqual(buildQueries("Tata Salt 1kg"));
  });

  it("returns nothing for an empty ask rather than searching for nothing", () => {
    expect(buildQueries("   ")).toEqual([]);
  });
});

// ============================================================ PHASE 2 adapter
describe("the Serper adapter is documented-API only, and inert without a key", () => {
  it("posts to Serper's documented JSON endpoint, not a result page", () => {
    // ONIQ does not scrape. The provenance of what Serper SELLS is recorded
    // separately — see the module header and §13 of the financial control doc.
    expect(SERPER_ENDPOINT).toBe("https://google.serper.dev/search");
    expect(SERPER_ENDPOINT).not.toMatch(/google\.com\/search/);
  });

  it("is not configured, because ONIQ holds no Serper credential", () => {
    const p = serperProvider(undefined);
    expect(p.configured).toBe(false);
  });

  it("returns not-configured rather than a silent empty result", async () => {
    const out = await serperProvider(undefined).search("anything", 5);
    expect(out).toEqual({ ok: false, reason: "not-configured" });
  });

  it("normalises results and never manufactures a missing field", () => {
    const rows = normalizeSerperResults({
      organic: [
        { title: "A", link: "https://bigbasket.com/p/1", snippet: "s" },
        { link: "https://blinkit.com/p/2" }, // no title, no snippet
        { title: "no link at all" },
        { title: "bad url", link: "not-a-url" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      title: "A",
      url: "https://bigbasket.com/p/1",
      domain: "bigbasket.com",
      snippet: "s",
    });
    // Absent stays absent — null, not "" and not an invented string.
    expect(rows[1].title).toBeNull();
    expect(rows[1].snippet).toBeNull();
  });

  it("bounds the result count and does not paginate", () => {
    const many = {
      organic: Array.from({ length: 50 }, (_, i) => ({ link: `https://x.test/${i}` })),
    };
    expect(normalizeSerperResults(many).length).toBeLessThanOrEqual(SERPER_MAX_RESULTS);
  });

  it("makes exactly ONE attempt — a retry is unaccounted spend", async () => {
    let calls = 0;
    const p = serperProvider("k", async () => {
      calls += 1;
      return new Response("nope", { status: 500 });
    });
    expect(await p.search("q", 5)).toEqual({ ok: false, reason: "provider-error" });
    expect(calls).toBe(1);
  });

  it("sends the key in a header, never in the URL", async () => {
    let seenUrl = "";
    let seenKey: string | null = null;
    const p = serperProvider("secret-key", async (url, init) => {
      seenUrl = String(url);
      seenKey = new Headers(init?.headers).get("X-API-KEY");
      return new Response(JSON.stringify({ organic: [{ link: "https://a.test/1" }] }), {
        status: 200,
      });
    });
    await p.search("q", 5);
    expect(seenUrl).not.toContain("secret-key");
    expect(seenKey).toBe("secret-key");
  });
});

// ============================================================ PHASE 3 + 12 money
describe("retrieval is a reserved, counted, billable unit", () => {
  it("prices 1, 2 and 6 calls exactly", () => {
    const p = { unitUsd: SERPER_UNIT_USD };
    expect(retrievalReservationUsd(p, 1)).toBeCloseTo(0.001, 10);
    expect(retrievalReservationUsd(p, 2)).toBeCloseTo(0.002, 10);
    expect(retrievalReservationUsd(p, 6)).toBeCloseTo(0.006, 10);
  });

  it("cannot reserve beyond the ceiling even if asked to", () => {
    expect(retrievalReservationUsd({ unitUsd: SERPER_UNIT_USD }, 999)).toBeCloseTo(0.006, 10);
  });

  it("FAILS CLOSED on an unpriced provider rather than inventing a rate", () => {
    expect(retrievalReservationUsd({ unitUsd: null })).toBeNull();
  });

  it("the combined worst case sits far inside the $0.50 ceiling", () => {
    // hotel-scout is the widest thing ONIQ runs.
    const stay: SearchBudget = {
      maxSearches: 0,
      maxProviderCalls: 1,
      maxLlmCalls: 1,
      maxInputTokens: 20_000 + 11 * 14_000,
      maxOutputTokens: 6_000,
      maxWallClockMs: 180_000,
      maxEstimatedUsd: 0.5,
    };
    const gemini = worstCaseUsd(GEMINI_FAILOVER_MODEL, retrievalFirstBudget(stay));
    const retrieval = retrievalReservationUsd({ unitUsd: SERPER_UNIT_USD })!;
    expect(gemini + retrieval).toBeLessThanOrEqual(0.5);
    // And retrieval is genuinely present, not a tokens-only reservation.
    expect(retrieval).toBeGreaterThan(0);
  });
});

describe("gathering stops rather than storming", () => {
  const provider = (results: unknown[], fail?: "provider-error" | "timeout") => ({
    name: "fake",
    configured: true,
    unitUsd: SERPER_UNIT_USD,
    calls: 0,
    async search() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).calls += 1;
      if (fail) return { ok: false as const, reason: fail };
      return { ok: true as const, results: results as never };
    },
  });

  it("deduplicates by URL across queries", async () => {
    const p = provider([
      { title: "a", url: "https://x.test/1", domain: "x.test", snippet: null },
      { title: "dup", url: "https://x.test/1", domain: "x.test", snippet: null },
    ]);
    const out = await gatherEvidence(p, ["q1", "q2"], NOW);
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.evidence.sources).toHaveLength(1);
    expect(out.ok === true && out.evidence.callsMade).toBe(2);
  });

  it("never runs more than the ceiling, however many queries it is handed", async () => {
    const p = provider([{ title: null, url: "https://x.test/1", domain: "x.test", snippet: null }]);
    const out = await gatherEvidence(
      p,
      Array.from({ length: 20 }, (_, i) => `q${i}`),
      NOW,
    );
    expect(out.ok === true && out.evidence.callsMade).toBe(MAX_RETRIEVAL_CALLS);
  });

  it("refuses when the provider is unconfigured", async () => {
    const out = await gatherEvidence(serperProvider(undefined), ["q"], NOW);
    expect(out).toEqual({ ok: false, reason: "retrieval-not-configured" });
  });

  it("refuses when the provider cannot be priced", async () => {
    const out = await gatherEvidence({ ...serperProvider("k"), unitUsd: null }, ["q"], NOW);
    expect(out).toEqual({ ok: false, reason: "retrieval-unpriced" });
  });

  it("stops on a provider error instead of retrying", async () => {
    const p = provider([], "provider-error");
    const out = await gatherEvidence(p, ["q1", "q2", "q3"], NOW);
    expect(out).toEqual({ ok: false, reason: "retrieval-provider-error" });
    expect(p.calls).toBe(1);
  });
});

// ============================================================ PHASE 14 A–G
describe("PHASE 14 — the source contract, case by case", () => {
  const BB = "https://www.bigbasket.com/pd/126906/tata-salt-1-kg-pouch/";
  const BL = "https://blinkit.com/prn/tata-salt/prid/12345";

  it("A. a URL Serper never supplied → REJECT", () => {
    const v = validateAgainstEvidence(
      [{ source_domain: "bigbasket.com", url: "https://www.bigbasket.com/pd/999999/other/" }],
      EVIDENCE,
    );
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.violations).toContain("url-not-retrieved");
  });

  it("B. an invented amazon.in/dp/B0XXXXXXX → REJECT", () => {
    const v = validateAgainstEvidence(
      [{ source_domain: "amazon.in", url: "https://www.amazon.in/dp/B0XXXXXXX" }],
      EVIDENCE,
    );
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.violations).toContain("url-not-retrieved");
  });

  it("C. a REAL retrieved domain with a URL that was not retrieved → REJECT", () => {
    // The subtle one. bigbasket.com IS in the evidence; this URL is not.
    // A domain alone does not prove a source was retrieved.
    const v = validateAgainstEvidence(
      [{ source_domain: "bigbasket.com", url: "https://www.bigbasket.com/pd/000000/invented/" }],
      EVIDENCE,
    );
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.violations).toContain("url-not-retrieved");
  });

  it("D. a retrieved URL carrying a price the evidence does not support → REJECT", () => {
    const v = validateAgainstEvidence(
      [{ source_domain: "bigbasket.com", url: BB, price_inr: 999 }],
      EVIDENCE,
      {
        requirePriceSupport: true,
      },
    );
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.violations).toContain("price-unsupported");
  });

  it("E. one source while claiming a two-source cross-check → REJECT", () => {
    const v = validateAgainstEvidence([{ source_domain: "bigbasket.com", url: BB }], EVIDENCE, {
      claimsCrossCheck: true,
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.violations).toContain("cross-check-unsupported");
  });

  it("F. two retrieved sources with supported prices → ACCEPT", () => {
    const v = validateAgainstEvidence(
      [
        { source_domain: "bigbasket.com", url: BB, price_inr: 28 },
        { source_domain: "blinkit.com", url: BL, price_inr: 30 },
      ],
      EVIDENCE,
      { claimsCrossCheck: true, requirePriceSupport: true },
    );
    expect(v.ok).toBe(true);
    expect(v.ok === true && v.rows).toHaveLength(2);
  });

  it("G. no evidence at all → REJECT before any row is examined", () => {
    const v = validateAgainstEvidence(
      [{ source_domain: "amazon.in", url: "https://amazon.in/x" }],
      {
        ...EVIDENCE,
        sources: [],
      },
    );
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.violations).toEqual(["no-evidence"]);
  });

  it("a domain that contradicts its own retrieved URL → REJECT", () => {
    const v = validateAgainstEvidence([{ source_domain: "blinkit.com", url: BB }], EVIDENCE);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.violations).toContain("domain-mismatch");
  });

  it("a domain-only row is allowed only if that domain was retrieved", () => {
    expect(validateAgainstEvidence([{ source_domain: "bigbasket.com" }], EVIDENCE).ok).toBe(true);
    const bad = validateAgainstEvidence([{ source_domain: "croma.com" }], EVIDENCE);
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.violations).toContain("domain-not-retrieved");
  });

  it("never repairs — offending claims are reported, not rewritten", () => {
    const v = validateAgainstEvidence(
      [{ source_domain: "amazon.in", url: "https://www.amazon.in/dp/B0XXXXXXX" }],
      EVIDENCE,
    );
    expect(v.ok === false && v.offending.join(" ")).toMatch(/B0XXXXXXX/);
    expect(v.ok === false && "rows" in v).toBe(false);
  });
});

describe("supporting checks", () => {
  it("exact-URL identity, not host similarity", () => {
    expect(isRetrievedUrl("https://blinkit.com/prn/tata-salt/prid/12345", EVIDENCE)).toBe(true);
    expect(isRetrievedUrl("https://blinkit.com/prn/tata-salt/prid/99999", EVIDENCE)).toBe(false);
  });

  it("reads a price out of a snippet however the currency is written", () => {
    const bb = EVIDENCE.sources[0];
    const bl = EVIDENCE.sources[1];
    expect(priceSupportedByEvidence(28, bb)).toBe(true);
    expect(priceSupportedByEvidence("₹30", bl)).toBe(true);
    expect(priceSupportedByEvidence(31, bl)).toBe(false);
    // No price claimed is not a violation.
    expect(priceSupportedByEvidence(null, bb)).toBe(true);
    // A price with no source behind it is.
    expect(priceSupportedByEvidence(28, undefined)).toBe(false);
  });

  it("rejects hosts that only look right", () => {
    expect(domainOf("https://bigbasket.com.evil.test/p")).toBe("bigbasket.com.evil.test");
    expect(domainOf("not-a-url")).toBeNull();
    expect(domainOf("")).toBeNull();
  });
});
