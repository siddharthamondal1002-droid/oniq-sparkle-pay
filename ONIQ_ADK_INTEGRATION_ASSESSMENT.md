# ONIQ × Google ADK — integration assessment

Research gate, 2026-08-24. **Nothing installed. No dependency added. No
production change. No API spend on ADK.**

---

## Headline

**ONIQ's search problem is real, expensive, and does not need ADK to fix.**

The loop's §12 critique is correct and I can evidence it exactly:
`supabase/functions/smart-scout/index.ts` is
`USER QUERY → CLAUDE → guess/search`, with `claude-opus-5` doing intent
parsing, retrieval, price extraction, cross-checking and ranking inside one
model call, using up to **11 Anthropic server-side web searches per query**.

**Measured cost of that design, at authoritative published rates:**

| scenario   | searches | $/query | ₹/query    |
| ---------- | -------- | ------- | ---------- |
| light      | 3        | $0.165  | **₹15.76** |
| typical    | 6        | $0.250  | **₹23.89** |
| at the cap | 11       | $0.400  | **₹38.24** |

At 10,000 queries/month that is **₹158,000–₹382,000/month**, and since the
owner's 2026-08-20 directive made every paid feature free, **all of it is
unrecovered**.

**ADK would not reduce that number. Changing the architecture would.** The
saving comes from separating retrieval from generation — which ONIQ can do in
its existing TypeScript, today, without adopting a framework.

## The decisive structural constraint

|                 |                                                                   |
| --------------- | ----------------------------------------------------------------- |
| ONIQ AI runtime | **Supabase Edge Functions = Deno**, 400 s wall-clock ceiling      |
| ADK runtime     | Python, TypeScript, Go, Java — npm/Node-shaped for the TS flavour |
| verdict         | ADK is a **harness**. ONIQ is not missing a harness.              |

ADK supplies an agent loop, a tool registry and a deployment story. ONIQ's
defect is not "no agent loop" — it is that one capability (search) is welded to
one model and one provider. Adding a framework around that does not unweld it;
rewriting the capability does.

`PROVISIONAL` — the ADK catalog pages (`adk.dev/integrations`,
`google.github.io/adk-docs`) are **egress-blocked from this container**, so the
per-integration table below is built from what could be reached plus ONIQ-side
evidence. The language list (Python/TypeScript/Go/Java) comes from a search
result, not from Google's own page. **Anything marked PROVISIONAL must be
confirmed against Google's documentation before adoption.**

## What ONIQ already has, measured

| capability         | ONIQ today                            | evidence                                              |
| ------------------ | ------------------------------------- | ----------------------------------------------------- |
| retry with backoff | **none**                              | 0 files match `retryWithBackoff`                      |
| circuit breaker    | **none**                              | 0 files match `circuitBreaker`                        |
| request timeout    | **1 file** uses `AbortSignal.timeout` | grep across `supabase`, `src`, `remotion`             |
| rate limiting      | 17 files                              | mostly per-user app limits, not provider backpressure |
| attempt caps       | 5 files                               | `MAX_ATTEMPTS` / `maxRetries`                         |
| provider routing   | `_shared/modelRegistry.ts` + `llm.ts` | capability → model → provider already exists          |
| observability      | `console.*` only                      | no structured provider/latency/cost record            |

So ONIQ genuinely is thin on resilience and observability. That is the honest
case _for_ something. Whether that something is ADK is a separate question.

## The four defects worth fixing, none of which require ADK

### 1. Search is Claude-as-retriever — REPLACE (biggest win)

`smart-scout` uses `tools: [{type: "web_search_20250305", max_uses: 11}]` with
`model: "claude-opus-5"`. Prices, ratings and availability are read out of pages
**by the model**, which is exactly what §13 forbids. It does mitigate this with a
cross-check requirement and a `cross_checked` field, which is better than
nothing — but the architecture still routes retrieval through generation.

**Target, per §12/§13:** query → intent → search API → extract → normalise →
rank in code → _optional_ cheap synthesis. A retrieval API plus Haiku 4.5
($1/$5 per MTok) for synthesis replaces Opus 5 plus 11 billed searches.
**Order-of-magnitude cost reduction, and prices stop being model-authored.**

### 2. Stale server-tool variant — one-line fix

ONIQ sends `web_search_20250305`. On Opus 5 the current variant is
**`web_search_20260209`** with dynamic filtering, and code execution is **free**
when used alongside it. ONIQ is on a current model using the older tool.

### 3. Site lists are prose, not policy — structural fix

The system prompt names shopping sites in prose ("Amazon.in, Flipkart, Meesho,
JioMart…"). The web-search tool takes **`allowed_domains`**. Today the site list
is a _suggestion to a model_; it could be an _enforced retrieval scope_. That is
the §12 "SOURCE RETRIEVAL" step done properly, and it costs nothing.

### 4. Quota exhaustion is invisible — found live today

The v2 Veo benchmark hit **`HTTP 429 RESOURCE_EXHAUSTED`** on 18 consecutive
submits: a **daily Veo quota** on `GOOGLE_AI_API_KEY`. `story-clip` handles 404,
400, 401/403 and a generic `!ok → 502`, but has **no 429 branch** — so quota
exhaustion surfaces as "Could not start that clip", indistinguishable from a
real fault, and would burn retries against a wall that will not move until the
window rolls over.

## §11 — was Google ever "fundamentally broken"? No.

| suspected cause          | verdict                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| secret resolution        | **NO** — all four secrets PRESENT in the deployed edge env                  |
| endpoint                 | **NO** — `generativelanguage` reachable, `models.list` HTTP 200             |
| model                    | **NO** — Lite, Fast and Standard all live on the key                        |
| authenticated generation | **NO** — real clips produced, 461,532 and 565,788 bytes                     |
| routing                  | **PARTLY** — Gemini text fallback fires only on Anthropic credit exhaustion |
| **quota**                | **YES, and this is new** — daily Veo cap, hit today, unhandled              |

Google was never broken. Two real things exist: a **too-narrow text failover
predicate** and an **unhandled daily quota**. **Neither is solved by ADK.**

## §8 — model / tool / provider separation

The desired split is right and ONIQ is **already half-way there**:
`modelRegistry.ts` maps capability → model → provider (`anthropic`,
`google-direct`, `lovable-gateway`). What is missing is that **search does not
go through it** — smart-scout calls Claude directly with a bundled tool.

**The fix is to put search behind the registry ONIQ already owns**, not to
import a second routing system. Two routers is worse than one.

## §9 — never let a framework pick the provider

An agent framework that can select tools can select _expensive_ tools. ONIQ has
just measured what an unbounded provider choice costs (₹38/query at the search
cap; a Veo Standard clip at $0.40/s is 8× Lite). **The router must stay
ONIQ-owned and cost-checked.** That is an argument for keeping ADK _out_ of the
provider decision even if it is adopted elsewhere.

## §16 — the comparison table

| area                 | ONIQ current                | ADK option                                                     | benefit                                                 | cost                                   | risk                                                | complexity | **verdict**                                                                                                                  |
| -------------------- | --------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- | --------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Search**           | Opus 5 + 11 web_search hops | ADK SEARCH integrations `PROVISIONAL`                          | retrieval/generation split                              | new API + per-query fee, far below ₹24 | medium — new dependency                             | high       | **EXPERIMENT** — but do the _architecture_ first, without ADK                                                                |
| **Provider routing** | `modelRegistry.ts`          | ADK agent/tool router                                          | none — ONIQ already has one                             | duplicate routers                      | **high** — framework could pick expensive providers | high       | **REJECT**                                                                                                                   |
| **Resilience**       | almost nothing              | ADK RESILIENCE `PROVISIONAL`                                   | real gap exists                                         | —                                      | low                                                 | medium     | **KEEP** ONIQ's, add ~40 lines of retry/backoff/circuit-breaker in TS. A framework is not needed for `for (attempt of 1..n)` |
| **Observability**    | `console.*` only            | ADK OBSERVABILITY (AgentOps, Arize AX, Freeplay) `PROVISIONAL` | genuine gap; would answer "which provider fired"        | vendor fee                             | medium — third-party sees prompts                   | medium     | **EXPERIMENT** — but a structured log line costs nothing and answers the same question                                       |
| **MCP**              | none                        | ADK MCP                                                        | clean tool abstraction _if_ ONIQ has many tools         | runtime overhead                       | medium                                              | medium     | **REJECT for now** — ONIQ has ~2 external tool surfaces; MCP solves an N-tools problem ONIQ does not have                    |
| **Video**            | Veo direct, owner-gated     | ADK as generator                                               | none                                                    | added indirection                      | **high** — would obscure the cost gate just built   | high       | **REJECT**                                                                                                                   |
| **Google APIs**      | direct REST, working        | ADK GOOGLE                                                     | none — direct calls work and are verified               | —                                      | low                                                 | low        | **KEEP**                                                                                                                     |
| **Evaluation**       | ONIQ's own gates            | ADK EVALUATION `PROVISIONAL`                                   | ONIQ's gates are already domain-specific and calibrated | —                                      | low                                                 | medium     | **KEEP**                                                                                                                     |

## §18 — the twelve answers

1. **Which ADK integrations are actually useful?** On present evidence, at most
   two categories: OBSERVABILITY and possibly SEARCH. Everything else duplicates
   something ONIQ has or adds risk. `PROVISIONAL` pending the catalog.
2. **Which could improve search?** The SEARCH category — but the _win is the
   architecture_, not the framework. A plain search API in existing TypeScript
   captures nearly all of it.
3. **Which could improve Google reliability?** **None.** Google is reachable,
   authenticated and generating. The two real issues are a narrow failover
   predicate and a daily quota — both ONIQ-side code.
4. **Which could improve provider routing?** **None that should.** ONIQ already
   routes; a second router is a regression.
5. **Which could improve resilience?** ADK has primitives, but ONIQ's gap is so
   basic (no backoff at all) that ~40 lines of TypeScript closes it.
6. **Which could improve observability?** This is ADK's strongest case. It is
   also the case a structured log line answers for free.
7. **Which could reduce cost?** None directly. **Cost falls by changing the
   search architecture**, which is framework-independent.
8. **Which are unnecessary?** MCP, GOOGLE, EVALUATION, CODE, CONNECTORS, DATA,
   and anything touching video routing.
9. **Should ONIQ adopt ADK?** **No — not now.** ONIQ is Deno-on-edge; ADK is a
   Node/Python-shaped harness for a problem ONIQ does not have. Adopting it
   would add a dependency, a runtime mismatch and a second router, while leaving
   the ₹24/query search cost untouched.
10. **Smallest useful adoption, if any?** One **offline experiment** on a branch:
    a retrieval-first search path (search API → extract → rank → Haiku
    synthesis) measured head-to-head against smart-scout on the same queries,
    for cost and result quality. **Do it without ADK first.** Only if that
    proves out and ONIQ then wants many more tools does MCP/ADK earn a look.
11. **Can Claude, Google, Runway and in-house sit behind one capability router?**
    **Yes, and they nearly already do** — `modelRegistry.ts` is that router.
    The work is to move search behind it and add a cost check, not to replace it.
12. **Can ADK be introduced without disrupting production?** Technically yes,
    behind a flag on a branch. But "can" is not "should": nothing measured here
    says it would improve cost, reliability, or routing.

## Recommended order of work — none of it is ADK

1. **Add a 429 branch to `story-clip`** distinguishing quota exhaustion from
   rate limiting. Found live today; smallest and most concrete.
2. **`web_search_20250305` → `web_search_20260209`** and add `allowed_domains`
   for the shopping sites currently listed in prose.
3. **Prototype retrieval-first search on a branch** and measure it against
   smart-scout. This is where the ₹158k–₹382k/month sits.
4. **Add structured provider logging** — one JSON line per provider call with
   provider, model, latency, outcome, tokens. Answers "which provider fired"
   without a vendor.
5. **Widen `isAnthropicBillingExhaustion`** to a `shouldFailover()` covering
   429/5xx/timeout — recommended earlier, still not applied, still needs a live
   test.

Items 1, 2, 4 and 5 are small, in-repo, and independent of any framework
decision. **All five are recommendations, not changes: nothing was modified.**

## §15 — security posture, unchanged

No recommendation here moves a secret. `GOOGLE_AI_API_KEY` and
`RUNWAY_API_KEY` stay server-side; a retrieval API key would be one more
edge-function secret under the same rules. **Any ADK observability vendor would
see prompt content, which is a data-sharing decision for the owner and not an
engineering one** — flagged, not assumed.

## What is NOT established

- The ADK catalog itself. `adk.dev` and `google.github.io` are egress-blocked
  here; the per-integration name/pricing/licence/maturity table §1 asked for
  **could not be built from Google's own documentation** and is not invented.
- Whether ADK-TypeScript runs under Deno at all.
- Any ADK pricing.

Those three gaps are why the recommendation is "not now" rather than "never":
**the case against adoption rests on ONIQ's architecture and runtime, which are
measured, not on ADK's catalogue, which is not.**
