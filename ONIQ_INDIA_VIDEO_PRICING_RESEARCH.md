# ONIQ India video pricing — market research

Research pass, 2026-08-23. **No production change, no provider call, ₹0 spent.**

## Evidence quality — read this before the numbers

The loop asked for authoritative sources and forbade blogs and snippets. Here is
what this environment could actually reach:

| source class                                      | reachable?            | usable as                     |
| ------------------------------------------------- | --------------------- | ----------------------------- |
| **Google Vertex AI pricing** (`cloud.google.com`) | **YES — HTTP 200**    | **VERIFIED provider pricing** |
| Google AI Studio pricing (`ai.google.dev`)        | no — egress `000`     | —                             |
| **Runway** (`runwayml.com`, `dev.runwayml.com`)   | **no — egress `000`** | **`PRICING_OPEN`**            |
| HeyGen, Canva, InVideo pricing pages              | no — egress `000`     | —                             |
| Web search                                        | yes                   | **`MARKET SIGNAL` only**      |

So this report has **one tier of hard evidence (Google) and one tier of soft
signal (search results, which resolved almost entirely to SEO/affiliate blogs)**.
Nothing below is presented as proven willingness-to-pay, because nothing
available here could prove it.

## MARKET SIGNAL — Indian AI-video pricing (weak evidence)

From search results only. **Every figure is a blog's claim, not a vendor page**,
and several sources are affiliate-style comparison sites with an incentive to
quote competitors high.

| product   | claimed India price                                | normalised                                       |
| --------- | -------------------------------------------------- | ------------------------------------------------ |
| Canva Pro | ₹499/mo                                            | the mass-market anchor most creators already pay |
| VEED      | from ₹520/mo, Pro ₹1,068                           | mid                                              |
| FluxNote  | ₹830/mo                                            | mid                                              |
| InVideo   | ~₹1,200/mo annual; AI ₹2,075/mo                    | high                                             |
| Pictory   | ₹2,075/mo                                          | high                                             |
| HeyGen    | ₹2,400/mo; a 30 s HD video ≈ ₹83 on a ₹19,999 plan | premium                                          |

Sources: [truefan.ai HeyGen pricing](https://www.truefan.ai/blogs/heygen-pricing-in-rupees) ·
[truefan.ai InVideo alternatives](https://www.truefan.ai/blogs/invideo-alternatives-india-2026) ·
[frameloop.ai pricing comparison](https://frameloop.ai/blog/ai-video-generator-pricing-compared) ·
[fluxnote.io India guide](https://fluxnote.io/guides/best-ai-video-generator-india-2026)

**The one genuinely useful normalisation:** HeyGen's own claimed effective rate
is **≈ ₹83 per 30-second video — about ₹166 per accepted minute** — from a
₹19,999/month plan. That is the closest thing here to a per-minute competitor
benchmark, and it sits _above_ every price point the brief proposed.

### Payment-behaviour signal

UPI has made small digital purchases frictionless, and one source puts the
self-serve band that converts without sales contact at **₹199–₹2,999**; another
notes that omitting UPI costs ~70% of domestic sales.

Sources: [Outlook Respawn on in-app purchases](https://respawn.outlookindia.com/gaming/gaming-guides/more-than-a-game-how-in-app-purchases-reflect-new-indian-economy) ·
[ownstreet.in digital product guide](https://ownstreet.in/blog/digital-product-store-india-2026-guide) ·
[transactbridge on UPI monetisation](https://www.transactbridge.com/blog/payment-solution-for-live-streaming-social-video-chat-apps)

**`OPEN`:** no primary willingness-to-pay study for ₹49/₹79/₹99/₹149 was
reachable. The brief's psychological price ladder is **untested**, and this
report cannot test it. Treat the ladder as a hypothesis to A/B, not a finding.

## The finding that decides the pricing question

It does not come from market research. It comes from arithmetic on **verified**
Google prices, and it is blunt:

### Every candidate price in the brief is below the cost of external video.

Minimum GST-inclusive **₹ per accepted minute** to clear a 26% margin, at
`MAX_ATTEMPTS = 2`, as a function of first-pass QA acceptance:

| route                                   | 50%     | 60%     | 70%     | 80%    | 90%    | 100%   |
| --------------------------------------- | ------- | ------- | ------- | ------ | ------ | ------ |
| **ONIQ in-house** (measured ₹37.55/min) | **139** | **116** | **100** | **89** | **79** | **72** |
| Veo 3.1 Lite 720p, no audio             | 542     | 452     | 388     | 341    | 303    | 273    |
| Veo 3.1 Lite 720p, **with audio**       | 899     | 750     | 644     | 564    | 502    | 452    |
| Veo 3.1 Fast 720p, with audio           | 1,793   | 1,495   | 1,282   | 1,123  | 998    | 899    |
| Veo 3.1 720p, with audio                | 7,156   | 5,964   | 5,113   | 4,475  | 3,978  | 3,581  |

**₹49–₹299 is an in-house price band.** Not a Google band. The cheapest Google
route needs **₹273/min even at a perfect 100% first-pass acceptance rate**, and
₹542/min at a plausible 50%.

### So the real design question is: how many external seconds does each price buy?

External seconds affordable inside a **60-second** film, Veo 3.1 Lite 720p
no-audio, 26% margin, `MAX_ATTEMPTS = 2`:

| ₹/min    | 50%  | 60%  | 70%  | 80%  | 90%  | 100%     |
| -------- | ---- | ---- | ---- | ---- | ---- | -------- |
| ₹49      | 0.0  | 0.0  | 0.0  | 0.0  | 0.0  | 0.0      |
| ₹79      | 0.0  | 0.0  | 0.0  | 0.0  | 0.0  | 2.1      |
| **₹99**  | 0.0  | 0.0  | 0.0  | 2.5  | 5.3  | 8.1      |
| ₹129     | 0.0  | 2.3  | 5.9  | 9.6  | 13.3 | 17.0     |
| **₹149** | 1.6  | 5.8  | 10.1 | 14.4 | 18.7 | **22.9** |
| ₹199     | 9.0  | 14.8 | 20.5 | 26.3 | 32.1 | 37.8     |
| ₹249     | 16.4 | 23.7 | 31.0 | 38.2 | 45.5 | 52.7     |
| ₹299     | 23.9 | 32.6 | 41.4 | 50.1 | 58.9 | 60.0     |

With **audio** on the Google clips, halve those figures again.

## What this says about each candidate price

**₹49 — do not launch it.** It buys **zero** external seconds at any acceptance
rate, and at 50% acceptance it does not even clear 26% on a fully in-house film
(the in-house floor is ₹139 there). It is below cost in the bad case.

**₹79 — in-house only, and thin.** Viable only if acceptance is high and the
film is 100% in-house. No headroom for a single Veo shot.

**₹99 — viable as an in-house tier, marginal as a hybrid.** It clears the
in-house floor once acceptance is ≥70%. It buys **2.5–8 external seconds per
minute** — i.e. _one_ Veo hero shot in a 60-second film, and only if acceptance
is good. This is exactly where the brief's ₹99 hypothesis lands: **defensible,
but only because ONIQ's engine is in-house.** It is not a Veo price.

**₹149 — the safest default.** Clears the in-house floor at every acceptance
rate down to 50%, and buys **10–23 external seconds** per minute — two to three
Veo hero shots. It is the lowest price that is safe under a _pessimistic_
acceptance assumption, which matters because **nobody has measured acceptance
yet**.

**₹199–₹299 — real cinematic headroom**, up to a fully-external minute at ₹299.
Also the band that the one competitor normalisation (HeyGen ≈ ₹166/min) and the
₹199–₹2,999 self-serve conversion signal both sit inside.

## Recommendation — and it is conditional, deliberately

**MARKET SIGNAL, not proof.** With acceptance unmeasured, the honest
recommendation is a ladder whose cheap end is in-house and whose expensive end
pays for Google:

| tier                  | ₹/accepted minute | what it actually is                                                        |
| --------------------- | ----------------- | -------------------------------------------------------------------------- |
| **Quick**             | **₹79**           | 100% in-house. No external seconds.                                        |
| **Creator** (default) | **₹149**          | In-house + up to ~15 s of Veo Lite hero shots.                             |
| **Pro**               | **₹249**          | In-house + up to ~38 s external, audio optional.                           |
| **Cinematic**         | **₹499**          | Mostly/fully external; the only tier that can afford Veo audio throughout. |

**Why not ₹99 for Creator:** ₹99 only clears the floor if acceptance ≥70%, and
that is an unmeasured assumption. If real acceptance is 50–60%, ₹99 sells
in-house minutes at a loss the moment a single Veo shot enters. ₹149 survives the
pessimistic case. **Move Creator to ₹99 once acceptance is measured at ≥70%** —
that is a data-gated price cut, not a guess.

**Why not ₹299 for Creator:** it exceeds the mass-market anchor (Canva ₹499/mo
covers a month of daily social output) and gives up the low-friction UPI
impulse band for headroom the default tier does not need.

**Why Cinematic is ₹499, not ₹299:** ₹299 cannot afford a full minute of Veo
Lite _with audio_ at any acceptance rate below 100% — the table above tops out at
35.8 external seconds. Pricing Cinematic at ₹299 would promise premium
generation the price cannot buy.

## Uncertainties, stated

1. **First-pass QA acceptance is unmeasured.** Every row above is parametric in
   it. This is the single most valuable number ONIQ does not have.
2. **Runway pricing is `PRICING_OPEN`** — the domain is unreachable here, and
   there is **no Runway integration in the repository at all**. Runway cannot be
   priced, routed or benchmarked from this environment.
3. **The `1 count` unit** on Google's page is not defined in the fetched text.
   It is read as _per second of generated video_, corroborated by the brief's own
   independently-stated $0.03/s for Veo 3.1 Lite 720p matching the page's
   $0.03/count row exactly. Strong, but not verbatim — flagged rather than
   assumed.
4. **Competitor figures are blog claims**, not vendor pages.
5. **₹/USD is taken as 84** from the in-repo cost model, not re-verified today.
