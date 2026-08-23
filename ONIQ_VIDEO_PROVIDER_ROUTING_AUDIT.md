# ONIQ video provider routing — audit

## Finding: Veo cannot be silently selected. The premise is false.

`MEASURED`, from `remotion/scripts/story-worker.mjs`:

```js
const clipStage =
  job.grade === "movie" &&
  (process.env.STORY_MOVIE === "on" || process.env.STORY_MOVIE === "select")
    ? process.env.STORY_MOVIE
    : "off";
```

`STORY_MOVIE` is **unset on every production dispatch**, so `clipStage` is
`'off'` and the rented clip stage never executes. The worker's own comment gives
the reason: _"a ₹57 movie sale must never trigger hundreds of rupees of rented
generation."_

Three states, all owner-gated: `on` (every shot attempts a clip), `select`
(spend-guarded — only shots whose grammar calls for character motion and which
no free tier already serves), unset (nothing attempted).

**No silent escalation exists today because no escalation exists today.**

## Current route

Every second of every production film is **in-house**. `IN_HOUSE = 100%`,
`EXTERNAL = 0%` — not by policy preference but because the external stage is
switched off.

## Runway

`src/lib/runway.server.ts` — server-only, admin-gated, `gen4_turbo`, 5/10 s,
ratios including `1280:720` and `720:1280`, `CREDITS_PER_SECOND = 5`. It is an
**admin tool**, not part of the Story pipeline: nothing in the worker or the
edge functions calls it. `RUNWAY = NETWORK_BLOCKED` for testing.

## What the router should become

Specified in `ONIQ_VIDEO_ROUTING_SPEC.md` and **still not implemented**, for the
same reason as before: external acceptance has never been measured, and routing
on an unmeasured rate is guesswork. In-house is measured at **65.31 %**
(100 % trimmed) and costs **₹0.63–0.96 per accepted second**; the cheapest
external route is **₹2.52–3.86**, i.e. **4× more**, so "in-house first" is
already the evidence-backed default.

## Escalation contract (proposed, not applied)

Every escalation must carry: `reason` · `estimated_provider_cost` ·
`budget_check` · `quality_requirement`. An escalation without all four is
refused. Enforced by the per-shot spend bound, not by a global attempt count.
