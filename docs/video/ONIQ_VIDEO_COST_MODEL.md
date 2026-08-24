# ONIQ_VIDEO_COST_MODEL

**Denominated in USD.** Acceptance for external tiers is **UNMEASURED**, so no
final figure is claimed · **Date** 2026-08-24

---

## 0. Currency discipline (owner directive, 2026-08-24)

Google's published USD price is the canonical provider-cost input. This document
is USD throughout. **No FX rate appears in any routing, ceiling or acceptance
calculation**, and none is stored in the ledger — enforced by
`src/lib/__tests__/currencyDiscipline.test.ts`, which fails the build if an FX
identifier or a rupee figure appears in `financialLedger.ts`, `videoRouting.ts`,
`videoAudio.ts`, `searchGuard.ts`, `searchBudget.ts`, `story-clip/index.ts` or
the ledger migration. That barrier is proved to fail by injection, not merely
asserted.

The three stored metrics are `usd_per_generated_second`, `usd_per_attempt`,
`usd_per_accepted_second`. INR appears **only** in §8, once, clearly labelled.

## 1. Raw generated second — USD

| Surface / tier                    | with audio  | video only  | reachable from ONIQ today          |
| --------------------------------- | ----------- | ----------- | ---------------------------------- |
| Gemini API, Veo 3.1 Lite 720p     | **$0.05/s** | —           | yes                                |
| Gemini API, Veo 3.1 Fast 720p     | **$0.10/s** | —           | yes — this is what story-clip runs |
| Agent Platform, Veo 3.1 Lite 720p | $0.05/s     | **$0.03/s** | **no** — different surface         |
| Agent Platform, Veo 3.1 Fast 720p | $0.10/s     | **$0.08/s** | **no** — different surface         |
| Runway gen4_turbo                 | UNVERIFIED  | UNVERIFIED  | no                                 |

Provenance `OWNER_SUPPLIED_2026_08_24` for the Google rows. Independent
re-verification was **not possible in this session** — `ai.google.dev` is
blocked by the container's egress policy. The _surface split_ — which column is
reachable — is verified from Google's own SDK, not supplied.

Note the video-only column is blank for the Gemini API rows on purpose:
`usdPerSecondVideoOnly: null` means "this tier exists in Google's table and
cannot be bought from here", which is a more useful statement than a missing row.

## 2. Surface comparison — USD only

Computed by `compareGoogleSurfaces()`, asserted in
`src/lib/__tests__/currencyDiscipline.test.ts`:

| Tier | Seconds | Gemini API | Agent Platform video-only | Difference | Reduction |
| ---- | ------- | ---------- | ------------------------- | ---------- | --------- |
| Lite | 1       | $0.05      | $0.03                     | $0.02      | **40%**   |
| Lite | 8       | $0.40      | $0.24                     | $0.16      | 40%       |
| Lite | 60      | **$3.00**  | **$1.80**                 | **$1.20**  | **40%**   |
| Fast | 1       | $0.10      | $0.08                     | $0.02      | **20%**   |
| Fast | 8       | $0.80      | $0.64                     | $0.16      | 20%       |
| Fast | 60      | $6.00      | $4.80                     | $1.20      | 20%       |

**Worth noticing:** the absolute saving is the same $0.02/s on both tiers, so the
_percentage_ is much better on Lite (40%) than on Fast (20%). A surface move is
therefore worth most to a Lite-heavy routing mix — which is the mix the routing
work in this loop is trying to produce anyway.

These figures do not appear in INR anywhere in the routing or pricing model.

## 3. The number that decides everything

```
usd_per_accepted_second = usd_per_generated_second x E[attempts] / P(accept)
```

`E[attempts]` for a ladder that stops on success or at 3 attempts.
`usdPerAcceptedSecond()` returns **null** when acceptance has not been measured —
a hopeful default there is exactly how a benchmark gets skipped.

| P(accept) | E[att] | Lite $/accepted s | Fast $/accepted s |
| --------- | ------ | ----------------- | ----------------- |
| 0.40      | 1.96   | 0.2450            | 0.4900            |
| 0.50      | 1.75   | 0.1750            | 0.3500            |
| 0.60      | 1.56   | 0.1300            | 0.2600            |
| 0.6531    | 1.47   | 0.1123            | 0.2247            |
| 0.70      | 1.39   | 0.0993            | 0.1986            |
| 0.80      | 1.24   | 0.0775            | 0.1550            |
| 0.90      | 1.11   | 0.0617            | 0.1233            |
| 1.00      | 1.00   | 0.0500            | 0.1000            |

**This is a sensitivity table, not a result.** Neither tier's acceptance has been
measured — the benchmark is blocked. The row to read is unknown.

What it already proves, and what a list price cannot: **Lite at 40% acceptance
($0.2450) is more expensive per accepted second than Fast at 90% ($0.1233)**,
despite being half the list price. A cheaper tier that fails more is not cheaper,
and only this metric says so. That comparison is asserted as a test.

## 4. External seconds in a 60-second film — USD

Generation floor, acceptance = 1.0 (the best case that can possibly happen):

| External mix          | Floor |
| --------------------- | ----- |
| none                  | $0.00 |
| 10 s Lite             | $0.50 |
| 20 s Lite             | $1.00 |
| 10 s Lite + 10 s Fast | $1.50 |
| 20 s Lite + 10 s Fast | $2.00 |

At an _assumed_ 65.31% acceptance, 10 accepted Lite seconds cost **$1.123** —
2.2× the floor. The multiplier, not the list price, is what a price has to cover.

## 5. In-house

In-house is the routing default because it is roughly **two orders of magnitude**
cheaper per second than any external tier, and because `motionCost.ts` decides
in-house-vs-external on **capability**, not on price — so no FX and no rate
enters that decision.

Measured first-pass acceptance: **65.31%**.

Its cost has an awkward property worth stating plainly: **it is measured in
rupees.** The owner measured ₹31.50 per finished minute of stills and voices, and
render compute is priced in USD. Comparing in-house against an external tier
therefore _requires_ an FX rate — which is precisely why that comparison is a
**reporting and pricing** activity (§8, and ONIQ_INDIA_VIDEO_PRICING), never a
routing input.

## 6. Filtered generations

Whether Google bills a generation that returns HTTP 200 with no samples is
**UNKNOWN**. Both bounds are carried; the conservative one reserves.

|                          | 8 s Lite, 2 filtered | 8 s Fast, 2 filtered |
| ------------------------ | -------------------- | -------------------- |
| LOWER_BOUND (not billed) | $0.00                | $0.00                |
| CONSERVATIVE (billed)    | $0.80                | $1.60                |

## 7. What is still unmeasured

- Lite and Fast acceptance, per motion class → the benchmark
- Google's price, independently verified → egress blocked here
- Runway, everything → 0 successful calls
- filtered-generation billing → no published rule, no invoice access

## 8. INR APPENDIX — reporting only

> **FX source** Alpha Vantage realtime `CURRENCY_EXCHANGE_RATE` USD→INR
> **FX timestamp** 2026-08-24T01:58:55Z
> **Rate** 1 USD = 95.68329394 INR
>
> This rate is used **only** to render the figures below for a human reader. It
> is not stored, not persisted in the ledger, and does not influence
> `chooseTier()`, provider routing, spend ceilings, acceptance arithmetic or
> provider selection. Re-verify before quoting these numbers on another date.

| USD value                                  | Converted INR value |
| ------------------------------------------ | ------------------- |
| Lite $0.05 / generated second              | ₹4.78               |
| Fast $0.10 / generated second              | ₹9.57               |
| Lite 60 s, Gemini API $3.00                | ₹287.05             |
| Lite 60 s, Agent Platform video-only $1.80 | ₹172.23             |
| Difference $1.20                           | ₹114.82             |
| In-house 60 s accepted @65.31% ≈ $0.90     | ₹86.22              |
| 60 s in-house + 10 s Lite accepted ≈ $1.87 | ₹179.35             |

**A separate stale rate exists in the repository.** `src/lib/storyCostModel.ts`
carries `inrPerUsd: 84` — 13.9% below the rate above, unsourced and with no
refresh behind it. It is a _pricing_ artefact (the published chart is
rupee-denominated) and is fenced off: no decision module may import it, asserted
by test. It multiplies exactly one term, the render-compute line; the dominant
in-house cost is owner-measured in rupees and touches no FX at all. Replacing it
needs a verified rate and is the owner's call.
