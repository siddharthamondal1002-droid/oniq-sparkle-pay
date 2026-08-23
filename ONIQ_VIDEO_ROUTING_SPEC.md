# ONIQ video routing spec

**Status: specified, NOT implemented.** Two inputs are still missing, and
building a router on them would be guesswork — see the bottom of this file.

## The rule, derived from measured cost

Cost per accepted second, `MAX_ATTEMPTS = 2`, at the measured acceptance rates:

| route                      | @65.31 % | @100 % |
| -------------------------- | -------- | ------ |
| in-house                   | ₹0.96    | ₹0.63  |
| Veo 3.1 Lite 720p no-audio | ₹3.86    | ₹2.52  |
| Veo 3.1 Lite 720p audio    | ₹6.43    | ₹4.20  |

In-house is **4× cheaper** than the cheapest external route. That ratio is the
routing rule:

1. **Every shot starts in-house.** Default, not fallback.
2. Escalate to external **only** on a measurable predicate that in-house cannot
   serve — the levels already in `motionCost.ts` (0 STATIC · 1 CAMERA · 2 RIG ·
   3 POSE_WARP · 4 DIFFUSION · 5 PREMIUM).
3. Spend the tier's external budget on the **highest-value** shots first; when
   it is exhausted the remaining shots stay in-house rather than the film
   failing.
4. Cheapest external model that clears the requirement: Lite no-audio → Lite
   audio → Fast. Veo 3.1 full is Cinematic only.
5. **Runway = `UNAVAILABLE_FOR_THIS_EXPERIMENT`** — not integrated, pricing
   unverified, domains egress-blocked. Declared slot, dropped from selection,
   structured miss. No invented price, no invented capability.

## Retry — bounded by spend, per shot

Not a global attempt count. Re-running one failed 8-second Veo Lite shot costs
₹20; re-running a whole minute costs ₹66. A retry proceeds only if
`remaining_job_budget`, `remaining_daily_budget` **and** `remaining_user_budget`
all cover it. Otherwise: **stop**, release the reservation, charge ₹0.

## AUTO mode

`AUTO` picks the cheapest route satisfying the quality contract. **A route with
no measured evidence is marked unavailable rather than guessed.** Today that
means AUTO can select in-house (measured) and, once benchmarked, Veo Lite.
Runway is unavailable.

## Why this is not implemented yet

1. **External acceptance has never been measured.** In-house is now measured
   (65.31 % → 100 % trimmed); the Veo Lite rate is `OPEN`, and the router's
   escalation economics depend on it.
2. **No provider keys exist in this container** — `GOOGLE_API_KEY`,
   `GEMINI_API_KEY`, `LOVABLE_API_KEY` and `RUNWAY_API_KEY` are all absent, so
   the Phase-10 Lite benchmark could not run here regardless of authorisation.
