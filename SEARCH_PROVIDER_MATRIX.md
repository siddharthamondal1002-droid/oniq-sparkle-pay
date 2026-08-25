# SEARCH_PROVIDER_MATRIX

**Date** 2026-08-24 · **HEAD** `3081774e` · **Provider spend for this document** $0

This matrix is the artefact §1 of the universal-search loop requires **before**
production behaviour changes. It is deliberately mostly empty, and the empty
cells are the finding.

---

## 0. What ONIQ's search actually is today

Measured from the repository, not assumed:

**ONIQ has exactly one search provider, and it is not a search engine.** All
four searching edge functions — `smart-scout`, `ting`, `health-scan`,
`hotel-scout` — pass Anthropic's server-side tool:

```
tools: [{ type: "web_search_20250305", name: "web_search", max_uses: N }]
```

Anthropic performs the search server-side and returns
`web_search_tool_result` blocks. ONIQ never talks to a search engine, never
sees a SERP, and never chooses a search index.

Consequences that shape everything below:

- **There are zero third-party search adapters.** Verified by direct search for
  `api.bing.microsoft.com`, `api.search.brave.com`, `duckduckgo.com`,
  `serpapi.com`, `google.serper.dev`, `customsearch.googleapis.com` and Gemini
  grounding across `supabase/` and `src/` — **0 files each**.
- **There are no credentials for any search provider.** The only secrets the
  searching path reads are `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`,
  `GOOGLE_MAPS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY`, `RAZORPAY_*`.
- **There is no search cache**, no URL canonicaliser, no deduplicator, no
  cross-provider ranker, and no citation normaliser. §7, §8, §9 and part of §3
  describe things that do not exist rather than things needing repair.
- What _does_ exist, and works: the spend ledger (`admit` → call → `settle`),
  per-capability ceilings, fail-closed admission, and a per-request cost
  record. That is the foundation a gateway would sit on, and it is real.

## 1. Why every provider row below says UNVERIFIED

§2 requires each provider be verified **from official documentation**. From
this container that is impossible. Measured, not assumed — every official
documentation host returns `000` (proxy `403 CONNECT`):

```
api.search.brave.com              BLOCKED
learn.microsoft.com               BLOCKED
developers.google.com             BLOCKED
ai.google.dev                     BLOCKED
docs.anthropic.com                BLOCKED
serpapi.com                       BLOCKED
google.serper.dev                 BLOCKED
duckduckgo.com                    BLOCKED
programmablesearchengine.google.com  BLOCKED
```

`WebSearch` works, but it returns **third-party blogs and comparison sites**,
not primary sources. Those are not acceptable evidence for pricing, rate
limits, retention rules or licence terms — the four facts that decide what the
owner's money buys and what ONIQ is legally permitted to do with the results.

To make the risk concrete rather than abstract: secondhand reporting found via
`WebSearch` claims Brave removed its free Search API tier in favour of metered
billing, and that the previous free tier's terms **prohibited using responses
for AI inference** — precisely how ONIQ would use them. That claim may be
accurate or stale; the point is that a licence restriction of that kind is
exactly what must come from the provider's own terms page, and writing it into
this matrix as fact from a blog would be the failure mode §2 exists to prevent.

**No provider is marked ENABLED. None may be, on this evidence.**

## 2. The matrix

Status vocabulary is §2's. `UNVERIFIED` is added because the loop's five
statuses all assert knowledge this container cannot obtain, and inventing one
would be worse than admitting the gap.

| Provider                         | Status      | Credential                  | Verified from official docs?                             |
| -------------------------------- | ----------- | --------------------------- | -------------------------------------------------------- |
| **Anthropic `web_search`**       | **ENABLED** | `ANTHROPIC_API_KEY` present | Behaviour verified **empirically in production** (below) |
| Google Search / Gemini grounding | UNVERIFIED  | none                        | ✗ host blocked                                           |
| Bing Search API                  | UNVERIFIED  | none                        | ✗ host blocked                                           |
| Brave Search API                 | UNVERIFIED  | none                        | ✗ host blocked                                           |
| DuckDuckGo                       | UNVERIFIED  | none                        | ✗ host blocked                                           |
| Google Programmable Search       | UNVERIFIED  | none                        | ✗ host blocked                                           |
| Serper / SerpAPI                 | UNVERIFIED  | none                        | ✗ host blocked                                           |

Anthropic's row is ENABLED on **measured production evidence**, not on
documentation: a real search on 2026-08-24 admitted, called, settled and
recorded a true cost. That is a stronger basis than a doc page, and it is the
only row with any evidence at all.

Every other row needs three things this container cannot supply:

1. **A credential** — each is a paid commercial signup. Which search providers
   ONIQ pays for is a business decision under
   `CLAUDE.md § Business decisions are the owner's`.
2. **Official pricing and rate limits** — from the provider, not a blog.
3. **Licence terms** — specifically whether results may be used for AI
   inference, how long they may be cached, and what attribution is required.
   §7 says "cache only what the provider permits"; that sentence is
   unimplementable until someone has read the permission.

## 3. ONIQ does not scrape. Documented third-party APIs are permitted.

**Scoped by owner directive, 2026-08-25.** The original rule said scraping was
out and read, in practice, as barring any provider whose own index was built by
scraping. That was broader than intended and it blocked a retrieval provider the
owner wants. The rule is now stated at the level it was meant for — what ONIQ
itself does.

**ONIQ-operated scraping is prohibited.** No fetching of search-result HTML, no
browser automation against a search engine, no bypassing anti-bot or access
controls, no unofficial endpoints. That part is unchanged and stays.

**Documented third-party search APIs are permitted**, when all of the
following hold:

- ONIQ calls the provider's documented API;
- ONIQ does not scrape search-result HTML;
- ONIQ does not bypass provider controls;
- provider attribution/provenance is preserved where required;
- provider use is financially accounted for;
- provider credentials are stored as secrets, never in source or logs.

**Serper is an external API provider, not an ONIQ scraper.** ONIQ posts to
`https://google.serper.dev/search` with a header credential and reads JSON. It
is worth being exact about the two separate facts, because collapsing them is
how a record becomes misleading in either direction: ONIQ performs no scraping,
**and** Serper's underlying index is built from Google's result pages. The
provenance is acknowledged, not concealed, and the owner has made the call
knowing it.

DuckDuckGo still has no official commercial search API, so it remains
`UNVERIFIED` — that entry was never about the reseller clause.

## 4. The gate that stops this loop before the architecture

§18 is an economic gate: **MAX_ACTUAL_COST ≤ $0.50 for all real admitted
requests**, and "if any admitted request exceeds $0.50: FAIL / STOP / DO NOT
DEPLOY."

The only real admitted SEARCH request ONIQ has ever recorded, an hour before
this document:

```
request cf859373-…   estimated_usd 0.445625   actual_usd 0.530683   SETTLED
```

**$0.5307 > $0.50 → the economic gate FAILS on the system as it stands**,
before a single new provider is added. Per the loop's own termination
condition, that is STOP → FIX → TEST → AUDIT, and no deployment.

Adding six providers on top of a cost model already proven to under-reserve
would multiply an unfixed accounting defect across six budgets. The fix comes
first, and its three options are an owner decision (ONIQ_AI_FINANCIAL_CONTROL
§9d): raise `request_usd_cap`, cut search depth, or accept per-request
overruns and rely on the daily ceiling.

## 5. What was built instead, and what was not

**Built** (no spend, no deploy, no provider calls):

- this matrix;
- `OVER_CAP` marking in the ledger — §10 requires that an actual exceeding the
  ceiling be recorded and **not disguised**. Until now an overrun settled
  silently: the $0.5307 row looks identical to a compliant one. That is a real
  defect this loop correctly identified, and it is fixable without any
  provider.

**Not built, deliberately:**

- provider adapters — no credentials, no verified terms, nothing to test
  against. Adapters written against guessed request shapes and invented
  pricing would look like progress and be fiction;
- the router, cache, deduplicator, ranker — each needs ≥2 working providers to
  be meaningful, and there is one;
- §17's 100-search test battery and §19's per-provider sweep — both require
  providers that do not exist yet, and would spend real money to measure a
  single-provider system twice;
- §20's staged rollout — the gate says do not deploy.

## 6. What unblocks this, in order

1. **Owner decides the request-ceiling question** (task #140). Everything
   downstream inherits it.
2. **Owner chooses which providers ONIQ pays for**, and supplies credentials as
   Supabase secrets.
3. Verify each chosen provider's pricing, limits and licence terms from its own
   documentation — from an environment that can reach it, or by the owner
   pasting the terms.
4. Then, and only then, the adapter → router → cache → dedup → rank → cite
   architecture in §3–§9 becomes buildable and testable rather than notional.

**Nothing in this document was verified by calling a provider. Provider spend
for this work: $0.**
