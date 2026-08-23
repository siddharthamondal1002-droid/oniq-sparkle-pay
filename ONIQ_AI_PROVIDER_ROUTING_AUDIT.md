# ONIQ AI provider routing — audit

Static audit of the shipped routing layer, 2026-08-23. **No provider call, no
secret read, ₹0 spent.**

---

## Headline: two of this loop's premises are false, and the third has a real

## kernel worth fixing

| premise                                        | verdict                                                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Google never fires"                           | **FALSE** — Google is the provider for image, TTS **and** video                                                                                                                               |
| "Search triggers video generation"             | **FALSE** — zero code path exists                                                                                                                                                             |
| "Claude is an unexplained global first choice" | **PARTLY FALSE** — Claude is first only for TEXT, and it is explained. But the Gemini fallback trigger is so narrow that Google effectively never fires _for text_, which is the real defect. |

## The capability × provider matrix — MEASURED from `_shared/modelRegistry.ts`

| capability            | model                                | provider              | notes                                          |
| --------------------- | ------------------------------------ | --------------------- | ---------------------------------------------- |
| **TEXT (primary)**    | `claude-opus-5`, `claude-sonnet-4-6` | `anthropic`           | default                                        |
| **TEXT (fallback)**   | `gemini-3.6-flash`                   | **`google-direct`**   | pinned, deliberately not `gemini-flash-latest` |
| **IMAGE**             | `google/gemini-2.5-flash-image`      | **`lovable-gateway`** | **Google**                                     |
| **TTS**               | `google/gemini-2.5-flash-tts`        | **`lovable-gateway`** | **Google**                                     |
| **VIDEO**             | `veo-3.1-fast-generate-preview`      | **`google-direct`**   | `STORY_MOVIE` unset → never runs               |
| **VIDEO (tombstone)** | `veo-3.0-fast-generate-001`          | `google-direct`       | dead id, kept as a marker                      |

**Three of ONIQ's five AI capabilities are already served by Google.** The claim
that Google "never fires" does not survive contact with the registry.

## The real defect — the fallback trigger is one failure mode wide

`_shared/llm.ts:228`, verbatim: _"Gemini fallback — used **ONLY** when Anthropic
returns a specific billing/credit"_ exhaustion. The predicate,
`isAnthropicBillingExhaustion`, requires **all** of:

- HTTP status **exactly 400**
- `error.type === "invalid_request_error"`
- the message matching `/credit balance/i`

**So Gemini is unreachable for text unless Anthropic runs out of money.** It does
**not** fail over on 5xx, timeouts, rate limits, network errors, or overload —
every one of which is a more likely outage than credit exhaustion.

`DERIVED`: that is why it feels as though "Google never fires" for text. It
almost never does, and the cause is a deliberately narrow predicate rather than
a missing integration. **This is the one item here worth fixing**, and it is a
change to one function, not to the router.

**Recommended (not applied):** widen the predicate to a `shouldFailover()`
covering 429, 5xx, and network/timeout errors, keeping billing exhaustion as a
named case. It needs a live test to validate, which this session cannot run.

## Why Claude is first for text, and whether it should stay

`INFERRED from code comments, not from a benchmark.` The registry documents
Claude as the primary and Gemini as a pinned fallback chosen after a real
outage investigation (`llm.ts:242–277` records `gemini-2.5-flash`,
`gemini-2.5-flash-lite`, `gemini-2.5-pro` and `gemini-2.0-flash` all returning
404 on this key, and `gemini-3.6-flash` returning 200).

**Should Claude remain default? `OPEN` — no quality or cost benchmark between
Claude and Gemini exists in this repository.** Answering it needs a live
head-to-head, which requires the credential this session does not have. **I am
not recommending a switch on no evidence.**

## Video routing

Covered in `ONIQ_VIDEO_PROVIDER_ROUTING_AUDIT.md`. In short: Veo **cannot** be
silently selected — the clip stage is gated behind `STORY_MOVIE`, which is unset
on every production dispatch, and the whole stage is skipped.

## Runway boundary

`MEASURED.` `src/lib/runway.server.ts` is server-only and admin-gated
(`requireAdmin` → `is_admin` RPC via the service role). `RUNWAY_API_KEY` appears
in **no** `VITE_`/`NEXT_PUBLIC_`/client/Android/iOS surface. The boundary is
intact and is pinned by a regression test.

## What was NOT done, and why

Phases 3–6 (live authentication, model availability, minimum generation) could
not run: the Supabase project host and `api.dev.runwayml.com` are egress-blocked
and no credential exists in this session. **No provider health value is
reported as `authenticated: true`, because no authenticated request was ever
made.** Per Phase 2's own rule, that would be a lie.

**No provider health endpoint was created.** Adding a diagnostic function is
cheap, but it is only meaningful when it can be _invoked_, and the host that
would run it is unreachable. Writing one now would ship untested code whose
first execution is in production.
