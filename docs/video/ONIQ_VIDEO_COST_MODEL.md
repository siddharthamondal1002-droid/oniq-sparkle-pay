# ONIQ_VIDEO_COST_MODEL

**Status** MODELLED. Acceptance for external tiers is **UNMEASURED**, so no
final figure is claimed · **Date** 2026-08-24 · FX **₹95.68329394/USD**
(Alpha Vantage realtime, 2026-08-24T01:58:55Z)

---

## 1. FX correction, first

`src/lib/storyCostModel.ts` carries `inrPerUsd: 84`. The realtime rate is
**₹95.68**. Every USD-denominated cost in the existing chart is understated by
**13.9%**. Nothing in this document uses ₹84.

## 2. Raw generated second

|                                   | $/s        | ₹/s       | reachable from ONIQ today          |
| --------------------------------- | ---------- | --------- | ---------------------------------- |
| Lite 720p, AI Studio (with audio) | 0.05       | **4.784** | yes                                |
| Fast 720p, AI Studio (with audio) | 0.10       | **9.568** | yes — this is what story-clip runs |
| Lite 720p, Vertex (video only)    | 0.03       | 2.870     | **no** — different surface         |
| Fast 720p, Vertex (video only)    | 0.08       | 7.655     | **no** — different surface         |
| Runway gen4_turbo                 | UNVERIFIED | —         | no                                 |

Provenance: OWNER_SUPPLIED_2026_08_24 for the Google rows. Independent
re-verification was **not possible in this session** — `ai.google.dev` is
blocked by the container's egress policy and `cloud.google.com` truncated. The
surface split (which column is reachable) is verified from Google's own SDK.

## 3. In-house

Marginal cost of one finished second, movie grade:

```
stills + voices   ₹31.50 / 60 s          = ₹0.5250 / s   (owner-measured 2026-08-15)
render compute    9 runner-min/min x $0.008 x 95.68 / 60 = ₹0.1148 / s
                                          ─────────────
                                           ₹0.6398 / s
```

**Measured first-pass acceptance: 65.31%.**

## 4. The number that decides everything

```
cost per accepted second = rate x E[attempts] / P(first-pass acceptance)
```

with `E[attempts]` for a ladder capped at 3 attempts.

| P(accept)  | E[att] | Lite ₹/accepted s | Fast ₹/accepted s |
| ---------- | ------ | ----------------- | ----------------- |
| 0.40       | 1.96   | 23.44             | 46.88             |
| 0.50       | 1.75   | 16.74             | 33.49             |
| 0.60       | 1.56   | 12.44             | 24.88             |
| **0.6531** | 1.47   | **10.75**         | **21.50**         |
| 0.70       | 1.39   | 9.50              | 19.00             |
| 0.80       | 1.24   | 7.42              | 14.83             |
| 0.90       | 1.11   | 5.90              | 11.80             |
| 1.00       | 1.00   | 4.78              | 9.57              |

**In-house at its measured 65.31%: ₹1.437 per accepted second.**

The Lite/Fast rows are a **sensitivity table, not a result** — their acceptance
has not been measured, and the row to read is unknown until the frozen benchmark
runs. What the table already shows is that in-house is **7.5× cheaper than Lite
and 15× cheaper than Fast at the same acceptance**, which is why the routing
default is in-house wherever it clears the quality contract.

## 5. 60-second film

Generation floor (acceptance = 1.0, i.e. no retries, the best case that can
possibly happen):

| Mix                                   | Floor   |
| ------------------------------------- | ------- |
| 60 s in-house                         | ₹38.39  |
| 50 s in-house + 10 s Lite             | ₹79.83  |
| 40 s in-house + 20 s Lite             | ₹121.28 |
| 40 s in-house + 10 s Lite + 10 s Fast | ₹169.12 |
| 30 s in-house + 20 s Lite + 10 s Fast | ₹210.56 |

At the **measured** in-house acceptance and an _assumed_ equal 65.31% for Lite:

| Mix                       | Cost per accepted film |
| ------------------------- | ---------------------- |
| 60 s in-house             | **₹86.22**             |
| 50 s in-house + 10 s Lite | **₹179.35**            |

## 6. What a price has to cover

An inclusive price, net of 18% GST carved out (18/118), Razorpay 2% + 18% GST on
the fee (2.36% of price), and ₹3 flat infra:

| Price | Net to ONIQ |
| ----- | ----------- |
| ₹49   | ₹37.37      |
| ₹79   | ₹62.08      |
| ₹99   | ₹78.56      |
| ₹149  | ₹119.75     |
| ₹199  | ₹160.95     |
| ₹249  | ₹202.14     |
| ₹299  | ₹243.33     |
| ₹499  | ₹408.10     |

## 7. The finding this produces

**A 60-second film with 10 seconds of external Lite cannot be sold at ₹149.**
₹179.35 of expected accepted cost against ₹119.75 net is a loss of ₹59.60 per
film, before any margin.

Even the generation FLOOR of that mix (₹79.83, assuming nothing ever needs a
retry) leaves ₹39.92 on a ₹149 sale — a 26.8% gross margin only if acceptance is
literally perfect, which it is not.

The all-in-house 60-second film at ₹86.22 accepted cost supports ₹149
(₹119.75 net, 22.5% of price) and **does not support ₹99** (₹78.56 net — a loss
of ₹7.66).

## 8. Not decided here

Prices are **not** set in this document and `story_price_tiers` is untouched.
Choosing the price points, and choosing how many external seconds a tier may
spend, are owner decisions and they need the benchmark's acceptance numbers
first. See ONIQ_INDIA_VIDEO_PRICING.
