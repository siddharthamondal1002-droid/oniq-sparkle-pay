# ONIQ video router + pricing — technical report

2026-08-23. **Design and economics. No production change, no provider call, no
credit moved, ₹0 spent. `generation_allowed` stays `false`.**

Companion documents: `ONIQ_VIDEO_PAID_STRUCTURE_AUDIT.md` (commit `fae59508`,
branch `claude/video-paid-structure-audit`) and
`ONIQ_INDIA_VIDEO_PRICING_RESEARCH.md`.

## CURRENT STATE — re-checked at today's HEAD

The prior audit still holds. Confirmed again this pass:

- **Supabase/Postgres, not Firebase.** Credit accounting runs in
  `security definer` functions under `select … for update` row locks.
- **`claim_story_seconds` charges nothing.** Since the 2026-08-20 FREE FOR ALL
  directive, every job is inserted `seconds_charged = 0`, and
  `has_entitlement` is `select true`. **No user is billed for anything today.**
- **The global daily ceiling is dead** — `story_global_usage` is read under
  `for update` and never written; the capacity refusal is gone.
- **No QA state and no ACCEPTED state.** `ready` means "bytes uploaded".
- **Wired external video is Veo 3.1 Fast** (`veo-3.1-fast-generate-preview`),
  and it is **OFF** — `STORY_MOVIE` unset on every production dispatch.
- **TTS is `google/gemini-2.5-flash-tts` via the Lovable gateway.**
- **There is no Runway integration anywhere in the repository.** Not a client,
  not a model id, not a config row.

## §2/§3 — Provider verification

### Google — VERIFIED

Source: **https://cloud.google.com/vertex-ai/generative-ai/pricing/**, fetched
**2026-08-23**, HTTP 200, parsed from the page's own pricing table.

| model        | output        | res               | USD / unit             |
| ------------ | ------------- | ----------------- | ---------------------- |
| Veo 3.1      | Video + Audio | 720p, 1080p       | **0.40**               |
| Veo 3.1 Fast | Video + Audio | 720p              | **0.10**               |
| Veo 3.1 Fast | Video only    | 720p / 1080p / 4k | **0.08 / 0.10 / 0.25** |
| Veo 3.1 Lite | Video + Audio | 720p / 1080p      | **0.05 / 0.08**        |
| Veo 3.1 Lite | Video only    | 720p / 1080p      | **0.03 / 0.05**        |
| Veo 3        | Video + Audio | 720p, 1080p       | 0.40                   |
| Veo 3 Fast   | Video + Audio | 720p              | 0.10                   |
| Veo 2        | Video         | 720p              | 0.50                   |

**Unit caveat.** The page states `$X / 1 count` and does not define `count` in
the text retrieved. It is read as **per second of generated video**, corroborated
because the brief independently gives Veo 3.1 Lite 720p as ≈ $0.03/generated
second and the page's Lite 720p video-only row is exactly $0.03. Recorded as
`unit_confidence: corroborated`, not `verbatim`.

**Correction to the repository.** `story-clip/index.ts` comments price Veo 3.1
Fast at **$0.15/s**. Google's current page says **$0.10/s with audio, $0.08/s
video-only at 720p**. The in-repo figure is stale and should not be used for
costing.

### Runway — `PRICING_OPEN`

`runwayml.com`, `dev.runwayml.com` and `docs.dev.runwayml.com` all return `000`
(egress-blocked). **No Runway price was verified, so none is recorded.** Gen-4
Turbo, Gen-4.5 and Act-Two are all `PRICING_OPEN`. Per §39 no unverified provider
price enters code.

Combined with the absence of any Runway integration, **Runway cannot be priced,
routed, benchmarked or costed from this environment.** It gets a router slot that
is _unavailable by default_, exactly as `wanProvider.ts` handles Wan.

### TTS

Current: `google/gemini-2.5-flash-tts` via Lovable — billed in Lovable credits,
not a metered Google key. `cloud.google.com/text-to-speech/pricing` returns 200
but truncated before its table in two fetch attempts → **`PRICING_OPEN`**. In the
economics below, TTS rides inside the measured in-house ₹37.55/finished-minute
figure, which already includes voices.

## §11 — Cost per ACCEPTED second

The metric the loop correctly insists on. With per-attempt acceptance `a` and
`MAX_ATTEMPTS = n`:

```
E[attempts]  = Σ(k=1..n) k·a·(1-a)^(k-1) + n·(1-a)^n
P(success)   = 1 - (1-a)^n
₹/accepted s = ₹/generated s × E[attempts] / P(success)
```

At `n = 2`:

| route                      | ₹/generated s | a=50% | 70%   | 90%   | 100%  |
| -------------------------- | ------------- | ----- | ----- | ----- | ----- |
| **in-house** (measured)    | **0.626**     | 1.25  | 0.89  | 0.70  | 0.63  |
| Veo 3.1 Lite 720p no-audio | 2.52          | 5.04  | 3.60  | 2.80  | 2.52  |
| Veo 3.1 Lite 720p audio    | 4.20          | 8.40  | 6.00  | 4.67  | 4.20  |
| Veo 3.1 Fast 720p audio    | 8.40          | 16.80 | 12.00 | 9.33  | 8.40  |
| Veo 3.1 720p audio         | 33.60         | 67.20 | 48.00 | 37.33 | 33.60 |

**In-house is 4× cheaper than the cheapest Google route and 54× cheaper than
Veo 3.1 with audio.** That ratio, not brand preference, is what should drive the
router.

## §7/§8/§9 — Tiers and routing

Tiers are named by result, never by provider. The user never sees "Veo".

| tier                    | ₹/accepted min | external budget | what it buys                                |
| ----------------------- | -------------- | --------------- | ------------------------------------------- |
| **Quick**               | ₹79            | **0 s**         | 720p, in-house only, fast, ordinary scenes  |
| **Creator** _(default)_ | ₹149           | ~10–23 s        | 720p, in-house + a few generated hero shots |
| **Pro**                 | ₹249           | ~16–53 s        | 720p, harder motion, more external coverage |
| **Cinematic**           | ₹499           | full minute     | 720p, external throughout, audio affordable |

### `resolve_video_route()` — the contract

```
in : duration_s, tier, audio, budget_inr?, character_importance,
     motion_complexity, scene_complexity, idempotency_key
out: [{ shot_id, source: 'in-house'|'google'|'runway',
        model, resolution:'720p', audio_mode,
        est_provider_cost_paise, route_reason }],
     customer_price_paise, external_seconds, in_house_seconds,
     max_provider_cost_paise, quote_id, quote_expires_at
```

**Routing rule, derived from the cost ratio above, not from taste:**

1. Start every shot **in-house**. It is the default, not the fallback.
2. Escalate a shot to external **only** when a measurable predicate says
   in-house cannot serve it — complex articulated motion, generative
   environment, camera moves the parallax rig cannot express, expression work
   beyond the rig. These predicates already exist in `motionCost.ts` /
   `motionProvider.ts` as levels 0–5.
3. Spend the tier's external budget on the **highest-value** shots first
   (character-important, motion-complex), and stop when the budget is exhausted
   — remaining shots stay in-house rather than the film failing.
4. Choose the **cheapest external model that clears the shot's requirement**:
   Veo 3.1 Lite no-audio → Lite audio → Fast. Veo 3.1 full is reserved for
   Cinematic.
5. **Runway is a declared-but-unavailable slot.** With no integration and no
   verified price it is dropped from selection and reports a structured miss —
   never silently substituted.

**Not hard-coded** as "Creator = Veo, Pro = Runway". The router picks on cost,
capability and budget, exactly as §9 requires.

## §12/§13 — Retry and spend bound

**`MAX_ATTEMPTS = 2`**, and here is the derivation rather than the assumption.
At ₹149/min with the 26% margin preserved — i.e. after GST, the Razorpay fee,
infra **and** the mandated margin — **₹81.01 remains for generation per sold
minute**.

| mix                                    | cost of one full pass | attempts affordable |
| -------------------------------------- | --------------------- | ------------------- |
| 100% in-house                          | ₹37.55                | **2.16**            |
| 45 s in-house + 15 s Veo Lite no-audio | ₹65.96                | **1.23**            |

So **2 is the ceiling a fully in-house minute can fund, and a hybrid minute
cannot even fund two full passes.** That is not an argument against retrying —
it is why retries must be bounded by **spend**, per shot, rather than by a
global attempt count: re-running one failed 8-second Veo shot costs ₹20, while
re-running the whole minute costs ₹66. `MAX_ATTEMPTS = 2` applies **per shot**,
under the job's `max_provider_cost` ceiling.

**This bound is provisional and must be recomputed once acceptance is measured.**

**`max_provider_cost_paise` is set at quote time and enforced by the worker.**
Before each external attempt: if `spent + next_attempt_cost > max_provider_cost`,
**stop** — no further attempts, job fails, reservation released, user charged ₹0.

## §14 — Global ceiling, restored

The current ceiling is dead (read, never written). The replacement must be:

- **atomic** — `insert … on conflict do nothing` then `select … for update` on
  the day row, then a conditional `update` in the same transaction;
- **applied on every path** — free, paid, in-house and external, because the
  free path is precisely the one that bypasses it today;
- **denominated in spend, not seconds** — a second of Veo 3.1 costs 54× a second
  in-house, so a seconds ceiling does not bound money;
- **server-authoritative** — the ceiling lives in `story_config`, and no client
  input reaches it.

Per-user daily and per-period limits are restored the same way.

## §15–§19 — Billing state machine

```
REQUEST → QUOTE → CONFIRM → RESERVE → GENERATE → QA ─┬─ PASS → ACCEPTED → COMMIT → DELIVER
                                                      └─ FAIL → retry (< MAX) → GENERATE
                                                             └─ exhausted → RELEASE → ₹0
```

- **RESERVE** reuses today's debit, relabelled: `credit_state = 'reserved'`.
  It stays the admission control — without it a user queues unlimited work.
- **COMMIT** is one `security definer` function that, in a single transaction
  under a row lock, verifies ownership → status → QA verdict → reservation →
  commits the credit → marks accepted → issues the delivery entitlement.
  Idempotent: a second worker's commit is a no-op.
- **RELEASE** replaces "refund" pre-acceptance.
- **Quote immutability**: the quote is a server row with `quote_id`,
  `pricing_version`, `expires_at`. The client sends `quote_id`, never a price.
- **Charging basis**: `accepted_duration_seconds × customer_price_per_second`.
  Never attempts, clips, frames or provider seconds.
- **Idempotency**: a client-supplied `request_id`, unique-indexed per user.

## §18 — The two registries, kept apart

```
provider_pricing(provider, model, resolution, audio, cost_per_second_micros,
                 currency, verified_at, source_url, unit_confidence,
                 pricing_version)      -- Google rows VERIFIED; Runway ABSENT
customer_pricing(tier, price_per_second_paise, currency, effective_from,
                 pricing_version)      -- ₹ per ACCEPTED second
```

Never joined into one table, never mixed in one column. `PROVIDER_GENERATION_COST`
and `USER_CREDIT_COST` are different quantities.

## §36 — The twenty answers

1. **₹/second** — Creator **₹2.48/accepted second** (₹149/min ÷ 60).
2. **10 s** — ₹25. 3. **30 s** — ₹75. 4. **60 s** — **₹149**.
3. **Quick** ₹79/min. 6. **Creator** ₹149/min. 7. **Pro** ₹249/min.
4. **Cinematic** ₹499/min.
5. **Google model** — **Veo 3.1 Lite 720p** as the workhorse (no-audio $0.03/s
   where ONIQ supplies the voice, audio $0.05/s where native audio earns its
   place); Veo 3.1 Fast only for Pro; Veo 3.1 full only for Cinematic.
6. **Runway model** — **`OPEN`.** Unreachable and unintegrated. No recommendation
   can be made honestly.
7. **In-house when** — always by default; every shot starts there.
8. **Google when** — a measurable predicate says in-house cannot serve the shot
   _and_ the tier's external budget still has room.
9. **Runway when** — `OPEN`.
10. **Cheapest acceptable route** — in-house, at **₹0.63–₹1.25 per accepted
    second**.
11. **Cost per accepted second** — in-house ₹0.63–₹1.25; Veo Lite no-audio
    ₹2.52–₹5.04; both parametric in acceptance.
12. **Expected margin** — 26% by construction at every tier; **realised margin is
    `OPEN` until acceptance is measured.**
13. **Most attractive Indian price** — ₹99 is the most attractive _number_;
    **₹149 is the most attractive price ONIQ can currently stand behind.**
14. **Too low** — **₹49**, unambiguously. Below the in-house floor at 50%
    acceptance and buys zero external seconds at any rate.
15. **Unnecessarily high** — ₹299 _for the default tier_. Right for Pro/Cinematic,
    wrong for Creator.
16. **Default tier** — **Creator**.

## §35/§39 — Status

`generation_allowed = false` · `productionEligible 0/1000` ·
`two_leg_fraction = DIAGNOSTIC_ONLY` · no migration written, applied or deployed ·
no provider called · no credit moved · no secrets · **₹0 API, ₹0 GPU.**

## Remaining `OPEN` items — what blocks implementation

1. **First-pass QA acceptance rate — unmeasured.** Every price, the retry bound
   and the router's budget all depend on it. **Measuring it requires an
   acceptance gate that does not yet exist**, and measuring the _external_ rate
   additionally requires paid Google calls, which are an owner spend decision.
2. **Runway — `PRICING_OPEN` + no integration.** Cannot be routed or costed.
3. **§10 benchmarking — not run.** It requires real paid Google and Runway
   generation. §35 forbids uncontrolled provider calls and `CLAUDE.md` makes
   spending owner money a question, not an engineering call. **No acceptance
   rates, artifact rates or latency figures are reported, because none were
   measured. None were invented.**
4. **TTS pricing — `PRICING_OPEN`.**
5. **The `1 count` unit** — corroborated, not verbatim.

**Because of (1) and (3), the router and billing machine are specified here but
not implemented.** Building a router that selects on unmeasured quality, and
pricing tiers on an unmeasured acceptance rate, would be exactly the fabrication
this loop forbids. The order that unblocks everything is: **acceptance gate →
measure first-pass rate on in-house output (free) → set the retry bound and
Creator's price from data → then implement routing, and only then consider paid
external benchmarking as a separate owner-approved spend.**

---

## ONIQ INDIA LAUNCH PRICE — executive conclusion

```
DEFAULT QUALITY          720p
DEFAULT TIER             Creator
PRICE                    ₹2.48 / accepted second
60-SECOND PRICE          ₹149
PROVIDER ROUTING         In-house first, always; Google Veo 3.1 Lite 720p for
                         shots in-house cannot serve, inside a per-tier budget;
                         Runway OPEN (unreachable, unintegrated)
EXPECTED PROVIDER COST   ₹0.63–₹1.25 / accepted second in-house
                         ₹2.52–₹5.04 / accepted second Veo 3.1 Lite no-audio
EXPECTED MARGIN          26% by construction; realised margin OPEN
FIRST-PASS ACCEPTANCE    OPEN — never measured; no acceptance gate exists
MAX RETRIES              2 per shot, under a per-job spend ceiling
USER CHARGE ON FAILURE   ₹0
```

### Why ₹149 is the right India-first price

**Because ONIQ's engine is in-house, and that is the whole advantage.** In-house
costs ₹0.63–₹1.25 per accepted second against ₹2.52–₹5.04 for the cheapest
Google route. A price band of ₹49–₹299 is only reachable by a product that
generates most of its seconds itself. ₹149 sells that advantage at a price no
pure-API competitor can match — the one competitor rate this research could
normalise, HeyGen at ≈₹166 per accepted minute, sits _above_ it.

**Why not cheaper.** ₹99 is the more attractive number and I am not recommending
it _yet_. It only clears the in-house floor when first-pass acceptance is ≥70%,
and **acceptance has never been measured**. If it is really 50–60%, ₹99 sells
below cost the moment one Veo shot enters the film. ₹49 is worse and
unambiguous: it is under the in-house floor in the bad case and buys **zero**
external seconds at any acceptance rate. **₹99 should be a data-gated price cut**
— measure acceptance, and if it lands ≥70%, cut to ₹99 with evidence.

**Why not more expensive.** ₹299 for the default exceeds the mass-market anchor
Indian creators already pay (Canva Pro ₹499/month for a month of output) and
spends the low-friction UPI impulse band on headroom the default tier does not
need. ₹199–₹499 is right for Pro and Cinematic, where the external seconds are
actually consumed.

### The honest caveat

Two of this loop's inputs could not be obtained here, and both bear on the final
number: **Runway is unreachable and unintegrated**, and **§10's benchmark was not
run** because it requires real paid Google and Runway generation, which §35
forbids and which is an owner spend decision under `CLAUDE.md`. **No acceptance
rate, artifact rate or latency figure is reported, because none was measured.**
Every price above is therefore parametric in acceptance and stated as such.

**The cheapest thing that unblocks all of it costs ₹0:** build the acceptance
gate and measure first-pass acceptance on in-house output. That single number
sets Creator's price, the retry bound and the router's budget at once.
