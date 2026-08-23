# ONIQ video cost model

Two registries, never mixed. `PROVIDER_GENERATION_COST` and `USER_CREDIT_COST`
are different quantities.

## PROVIDER_PRICING — verified

Source: `https://cloud.google.com/vertex-ai/generative-ai/pricing/`, fetched
**2026-08-23**, HTTP 200, parsed from the page's own table.

| provider   | model        | res        | audio | USD/unit           | verified   | unit_confidence |
| ---------- | ------------ | ---------- | ----- | ------------------ | ---------- | --------------- |
| google     | veo-3.1-lite | 720p       | no    | **0.03**           | 2026-08-23 | corroborated    |
| google     | veo-3.1-lite | 720p       | yes   | **0.05**           | 2026-08-23 | corroborated    |
| google     | veo-3.1-lite | 1080p      | no    | **0.05**           | 2026-08-23 | corroborated    |
| google     | veo-3.1-lite | 1080p      | yes   | **0.08**           | 2026-08-23 | corroborated    |
| google     | veo-3.1-fast | 720p       | no    | **0.08**           | 2026-08-23 | corroborated    |
| google     | veo-3.1-fast | 720p       | yes   | **0.10**           | 2026-08-23 | corroborated    |
| google     | veo-3.1      | 720p/1080p | yes   | **0.40**           | 2026-08-23 | corroborated    |
| runway     | *            | *          | *     | **`PRICING_OPEN`** | —          | egress-blocked  |
| google-tts | *            | —          | —     | **`PRICING_OPEN`** | —          | page truncated  |

`unit_confidence: corroborated` — the page prints `$X / 1 count` without
defining `count`; it is read as per second, matching the independently-supplied
$0.03/s for Lite 720p exactly. **Not verbatim, and flagged as such.**

**Repository correction:** `story-clip/index.ts` comments say Veo 3.1 Fast is
$0.15/s. It is **$0.10** with audio, **$0.08** video-only. Stale — do not cost
from it.

## Resolution — an unresolved product decision

**ONIQ renders 1080×1920.** Every Remotion composition in `remotion/src/Root.tsx`
is `width={1080} height={1920} fps={30}`, and `storyPreflight.ts` declares
`STORY_WIDTH = 1080, STORY_HEIGHT = 1920`. **ONIQ's product is not 720p.**

That leaves a real cost fork, and it is a product decision, not an engineering
one:

| reading                                                    | Veo tier | Lite no-audio | consequence                        |
| ---------------------------------------------------------- | -------- | ------------- | ---------------------------------- |
| clips are **elements** composited into the 1080×1920 frame | 720p     | **$0.03/s**   | cheaper; clip is upscaled/framed   |
| clips must match delivery resolution                       | 1080p    | **$0.05/s**   | **+67 % on every external second** |

Every figure elsewhere in this loop uses the **720p** reading. If the 1080p
reading is correct, every external-seconds budget shrinks by ~40 %. **`OPEN`.**

## Internal cost

| quantity                             | value                           | class                        |
| ------------------------------------ | ------------------------------- | ---------------------------- |
| stills + voices, per finished minute | ₹31.50                          | MEASURED (owner, 2026-08-15) |
| render compute, budgeted             | 9.00 runner-min/min → ₹6.05     | DERIVED                      |
| **whole film**                       | **₹37.55/finished min**         | in `storyCostModel.ts`       |
| **motion stage, measured today**     | **3.71 runner-min/min → ₹2.49** | **MEASURED, N=49**           |

## Cost per accepted second — the primary KPI

`COST_PER_ACCEPTED_SECOND = total_cost / accepted_seconds`, retries included.
Distinct from `provider_spend / requested_seconds`.

| route                      | @65.31 % (measured, today) | @100 % (measured, trimmed) |
| -------------------------- | -------------------------- | -------------------------- |
| in-house                   | **₹0.96**                  | **₹0.63**                  |
| Veo 3.1 Lite 720p no-audio | ₹3.86                      | ₹2.52                      |
| Veo 3.1 Lite 720p audio    | ₹6.43                      | ₹4.20                      |

External acceptance is **`OPEN`** — the Veo rows assume the in-house rate, which
is a placeholder, not a measurement. They will move once Phase 10 runs.

## Accounting fields to track

`provider_cost` · `internal_cost` · `tts_cost` · `storage_cost` ·
`processing_cost` · `payment_cost` · `tax` · `customer_price` · `refund_amount` ·
`accepted_seconds` · `failed_seconds` · `external_seconds` · `internal_seconds`.

Primary KPI `COST_PER_ACCEPTED_SECOND`; secondary
`EXTERNAL_COST_PER_ACCEPTED_SECOND`.
