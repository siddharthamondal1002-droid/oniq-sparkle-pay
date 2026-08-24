# ONIQ_INDIA_VIDEO_PRICING

**Status** NOT SET. `paid_pricing_enabled = false`. No price in this document is
proposed as final · **Date** 2026-08-24

---

## 1. Why no price is chosen here

Three inputs a price needs, and their state:

| Input                                | State                                                     |
| ------------------------------------ | --------------------------------------------------------- |
| in-house cost per accepted second    | **MEASURED** — ₹1.437 (65.31% acceptance)                 |
| Lite / Fast acceptance               | **NOT MEASURED** — benchmark blocked                      |
| Google price, independently verified | **NOT VERIFIED** — egress blocked; owner-supplied only    |
| Runway economics                     | **UNVERIFIED** — 0 successful calls, credit price unknown |
| filtered-generation billing          | **UNKNOWN** — both bounds carried                         |

Choosing a price on top of three unknowns would be choosing it on top of a
guess. The owner's own instruction covers this: _the final product price must
cover expected accepted generation cost, not theoretical best-case cost._

## 2. What the arithmetic already rules out

From ONIQ_VIDEO_COST_MODEL:

- **₹99 does not cover an all-in-house 60-second film.** Net ₹78.56 against
  ₹86.22 expected accepted cost — a **loss of ₹7.66** before margin.
- **₹149 does not cover a 60-second film with 10 seconds of Lite.** Net ₹119.75
  against ₹179.35 expected accepted cost — a **loss of ₹59.60**.
- ₹149 **does** cover all-in-house: ₹119.75 net against ₹86.22 leaves ₹33.53,
  or 22.5% of price. Below the house's 26%-net-of-GST standard, so even that is
  not comfortable.

Neither ₹99 nor ₹149 is being preserved because it was previously proposed.
The arithmetic is what disqualifies them.

## 3. The shape a tier list has to take

External seconds are 7.5× (Lite) to 15× (Fast) the cost of in-house seconds at
equal acceptance. So a tier is really **a budget of external seconds**, and the
customer-facing name should describe intent, not machinery:

| Tier      | What the user is choosing | What ONIQ decides internally                   |
| --------- | ------------------------- | ---------------------------------------------- |
| QUICK     | fast, cheerful, short     | in-house only                                  |
| CREATOR   | a finished piece          | in-house + a small external budget             |
| PRO       | key moments really move   | larger external budget, Lite-first             |
| CINEMATIC | the hardest shots too     | Fast permitted where measured quality requires |

Normal users never see Veo, Lite, Fast, Runway, native audio or provider
routing. They choose quality/intent; the router chooses model, audio mode,
provider and retry budget.

## 4. Price points, evaluated against cost only

| Price | Net to ONIQ | Covers 60 s in-house (₹86.22)? | Covers +10 s Lite (₹179.35)? |
| ----- | ----------- | ------------------------------ | ---------------------------- |
| ₹49   | ₹37.37      | no                             | no                           |
| ₹79   | ₹62.08      | no                             | no                           |
| ₹99   | ₹78.56      | **no**                         | no                           |
| ₹149  | ₹119.75     | yes, 22.5%                     | **no**                       |
| ₹199  | ₹160.95     | yes, 37.6%                     | no                           |
| ₹249  | ₹202.14     | yes                            | yes, 9.2%                    |
| ₹299  | ₹243.33     | yes                            | yes, 21.4%                   |
| ₹499  | ₹408.10     | yes                            | yes, 45.8%                   |

These are **cost coverage**, not price recommendations. Willingness to pay,
positioning and competitive pricing are the owner's, and they are not in this
document.

## 5. Defaults that are settled

|                               |                                                   |
| ----------------------------- | ------------------------------------------------- |
| DEFAULT AUDIO                 | **SMART AUDIO** — the three-mode router, per shot |
| DEFAULT RESOLUTION            | **720p** only; 1080p economics not opened         |
| FAILED GENERATION USER CHARGE | **₹0**                                            |
| generation_allowed            | **false**                                         |
| paid_pricing_enabled          | **false**                                         |

## 6. What unblocks a price

1. Google price independently verified for the AI Studio surface.
2. The frozen clean benchmark run → Lite and Fast acceptance per motion class.
3. A production distribution of how many seconds actually route to level 5.
4. The owner's three numbers: `daily_usd_cap`, `request_usd_cap`, `job_usd_cap`
   for VIDEO.

With (1)–(3), `usd_per_accepted_unit` stops being a formula and becomes a
measurement, and the tier budgets fall out of it.
