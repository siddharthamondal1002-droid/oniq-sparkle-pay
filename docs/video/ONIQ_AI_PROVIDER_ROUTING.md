# ONIQ_AI_PROVIDER_ROUTING

**Status** AUDIT + POLICY. Not yet a live router for TEXT · **Date** 2026-08-24

---

## 1. The complaint, restated fairly

Claude is the unexplained global first provider. `callClaude` defaults to
`claude-opus-5` and thirteen edge functions reach it without any per-capability
reasoning. That is a default, not a decision.

## 2. The order selection should follow

```
CAPABILITY → HEALTH → QUALITY → COST → LATENCY → PROVIDER
```

Neither Google nor Anthropic is entitled to be first. What each is
_demonstrably_ best at is the only argument that should carry.

## 3. Where each provider stands today, on evidence

| Capability        | Provider in use                 | Evidence for it                                                                | Priced?                  |
| ----------------- | ------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
| SEARCH (live web) | Anthropic `web_search_20250305` | only first-party retrieval tool ONIQ has wired; Gemini has none in this bridge | yes — $10/1,000 + tokens |
| TEXT (tools)      | `claude-opus-5`                 | default, **not** a measured choice                                             | yes — $5/$25 per MTok    |
| TEXT (baseline)   | `claude-sonnet-4-6`             | translate, health-scan                                                         | yes — $3/$15 per MTok    |
| TEXT fallback     | `gemini-3.6-flash`              | verified by POST to work on this key                                           | **NO — unpriced**        |
| IMAGE             | Lovable gateway                 | owner directive 2026-08-14                                                     | gateway credits          |
| VIDEO             | Google Veo 3.1 Fast, AI Studio  | only wired video provider                                                      | owner-supplied           |
| TTS               | Lovable gateway                 | owner directive 2026-08-14                                                     | gateway credits          |

## 4. The Google fallback stays OFF

`gemini-3.6-flash` **works** on ONIQ's key — that was verified by POST, and it
is exactly why it is tempting. It is still not routable, for one reason:

> **UNPRICED GOOGLE MODEL → NO PRODUCTION ROUTING.**

`ai.google.dev` is blocked by this container's egress policy, so no Google
price could be fetched or verified in this session. `MODEL_RATES` has no entry,
`estimateSearchUsd` throws, admission refuses `unpriced-model`, and Ting's
Gemini fallback is therefore inert.

**One verified line in `MODEL_RATES` re-enables it.** That line has to come from
someone who can see Google's price.

## 5. The other reason the scouts do not fall back

`translateToolsToGemini` **skips Anthropic server tools**. A billing-exhaustion
fallback silently turned "find live prices across Amazon and Flipkart" into an
answer written from memory, complete with `verified: true` source domains that
were never consulted. smart-scout and hotel-scout now pass
`allowFallback: false`. That is a correctness fix, not a cost one.

## 6. What would make Claude-first an actual decision

A per-capability quality measurement, the same shape as the video benchmark:
identical prompts, identical inputs, blind review, acceptance recorded. None
exists today. Until it does, "Claude for text" is honestly labelled as **an
inherited default with a verified price**, which is strictly better than an
unpriced alternative but is not evidence of superiority.

## 7. What is enforced now

- Every billable caller is either guarded or on a frozen, reasoned list
  (`searchSpendCoverage.test.ts`).
- No unpriced model can spend, in any capability.
- The client never reaches a provider and never reads a provider secret.
