# Veo tier + audio — the shipped path costs 3.33× what every pricing table assumed

Found 2026-08-23 from the first live clip. **Owner decision required. Nothing
was changed.**

---

## The finding

The one 4-second verification clip came back as `h264 720x1280 24fps` **plus an
`aac` audio stream**. `supabase/functions/story-clip/index.ts` sends no
`generateAudio` parameter at all — it sets only `aspectRatio`, `durationSeconds`
and `resolution: "720p"` — so Veo 3.1 generated audio by default and the account
is billed on the **audio** rate.

Combined with `CLIP_MODEL = "veo-3.1-fast-generate-preview"`, the shipped path
is **Fast + audio = $0.10/generated second**. Every cost table I produced
assumed **Lite + no-audio = $0.03/s**.

|                                      | assumed | shipped   |
| ------------------------------------ | ------- | --------- |
| model tier                           | Lite    | **Fast**  |
| audio                                | off     | **on**    |
| USD / generated second               | $0.03   | **$0.10** |
| ₹ / accepted second (MAX_ATTEMPTS=2) | ₹2.52   | **₹8.40** |

**3.33× understated**, and it propagated into every external-seconds figure in
`ONIQ_VIDEO_ACCEPTANCE_BENCHMARK.md` and `ONIQ_VIDEO_ROUTER_PRICING_REPORT.md`.

## Corrected external seconds per 60-second film

In-house at the measured trimmed-window rate (₹0.6258/accepted second, 100 %
acceptance). Each external second replaces an in-house one. 26 % margin, GST
carve-out and Razorpay fee applied as before.

| route                         | ₹/acc s  | ₹99     | ₹149    | ₹199    | ₹249     | ₹299     | ₹499     |
| ----------------------------- | -------- | ------- | ------- | ------- | -------- | -------- | -------- |
| _assumed_ Lite no-audio       | 2.52     | 8.1     | 22.9    | 37.8    | 52.7     | 60.0     | 60.0     |
| Lite **with** audio           | 4.20     | 4.3     | 12.2    | 20.0    | 27.9     | 35.8     | 60.0     |
| Fast no-audio                 | 6.72     | 2.5     | 7.1     | 11.8    | 16.4     | 21.0     | 39.5     |
| **SHIPPED — Fast with audio** | **8.40** | **2.0** | **5.6** | **9.2** | **12.8** | **16.5** | **31.0** |

At ₹149, the headroom is **5.6 external seconds, not 22.9**.

## What does NOT change

The in-house floor is untouched — it is measured, not assumed. **₹107/accepted
minute today, ₹72 after the 121-frame trim**, so the ₹99-needs-the-trim
conclusion and the ₹49-is-not-viable conclusion both stand. What changes is only
how much _external_ video each tier can fund, and ₹499 is no longer a full
minute of external video (31.0 s, not 60).

## The good half

**`veo-3.1-lite-generate-preview` is live on this key** — confirmed in the
enumerated model list, not assumed. The cheap tier the pricing model was built
around is genuinely available. Moving to it, with audio off, would restore the
$0.03/s economics and the 22.9-second headroom at ₹149.

## Owner decision — not mine to make

Per `CLAUDE.md`, choosing a model tier and deciding what the account's money
buys is an owner decision, so **I have changed nothing**. Three options:

1. **Lite + `generateAudio: false`** — $0.03/s, restores every published table.
   Costs whatever quality gap Lite has against Fast, which is **`OPEN`: no
   head-to-head benchmark between the two exists.**
2. **Fast + `generateAudio: false`** — $0.08/s. Keeps the current visual tier
   and drops audio ONIQ may not use.
3. **Leave it** — $0.10/s, and reprice the tiers against the bottom row above.

## ONIQ throws the audio away — MEASURED, and it makes option 2 free

I checked whether the film uses Veo's audio before recommending switching it
off. It does not. The composition mutes it at three sites, deliberately, with
the reason written down at each:

- `remotion/src/story/StoryFilm.tsx:494` — _"Veo video is muted always, so this
  is the only sound a clip has."_
- `remotion/src/story/StoryFilm.tsx:205` — _"Veo video is muted"_
- `remotion/scripts/story-worker.mjs:2004` — _"video is muted always, so the bed
  is the only air a clip has."_

**So every clip buys a generated audio track that the renderer then silences.**
The $0.02/second premium between the no-audio and audio tiers is pure waste on
the current path — not a quality trade-off, not a feature anyone hears.

That collapses the decision. **Turning `generateAudio: false` on costs ONIQ
nothing it currently uses**, and is the rare case where the cheaper option is
also strictly the more correct one. It drops the shipped rate from $0.10 to
$0.08/s — ₹8.40 → ₹6.72 per accepted second — with **zero** change to the
finished film. The Lite-vs-Fast half of the decision is separate and does
involve a real quality question that is still `OPEN`.

It is still an owner decision because it changes what the account's money buys,
so **I have not applied it**. But it is not a trade-off; it is a leak.

## Evidence class

`MEASURED` — the AAC stream in the returned file, the absent `generateAudio`
parameter in shipped source, the enumerated model list, and the three mute sites
in the renderer. `DERIVED` — that the account is billed the audio rate, which
follows from Google's published tiering but was not read off a billing
statement. No invoice was inspected.
