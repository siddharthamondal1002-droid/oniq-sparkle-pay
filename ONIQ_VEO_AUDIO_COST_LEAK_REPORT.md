# Veo audio cost leak — the fix does not exist on this API surface

Probed live 2026-08-24. **The Phase 1 change cannot be made as specified.** No
code was changed, because changing it would have shipped something that 400s.

---

## Headline

```
PARAMETER generateAudio      = REJECTED by veo-3.1-lite AND veo-3.1-fast (HTTP 400)
SIX ALTERNATE SPELLINGS      = ALL REJECTED (HTTP 400)
ACCEPTED PARAMETER KEYS      = aspectRatio, durationSeconds, resolution, sampleCount
VEO 3.1 LITE AUDIO TRACK     = PRESENT ANYWAY (aac)
VEO 3.1 FAST AUDIO TRACK     = PRESENT ANYWAY (aac)
AUDIO LEAK CLOSABLE AT REQUEST LAYER = NO
```

**I have to correct my own recommendation from the previous report.**
`ONIQ_VEO_TIER_AND_AUDIO_FINDING.md` said turning `generateAudio: false` on
"costs ONIQ nothing it currently uses" and called it "not a trade-off; it is a
leak". The leak is real and the renderer really does discard the audio — but
**the fix I proposed is not available**, and that recommendation should not be
acted on. This report supersedes it.

## What was actually measured

Every call below was a real request against the production key, made
server-side from an environment that holds the secret. No key was printed.

### The parameter does not exist here

| parameter sent | model | HTTP | Google's message |
| --- | --- | --- | --- |
| `generateAudio: false` | lite | **400** | ``\`generateAudio\` isn't supported by this model.`` |
| `generateAudio: false` | fast | **400** | ``\`generateAudio\` isn't supported by this model.`` |
| `generate_audio` | lite | **400** | not supported |
| `audioGeneration` | lite | **400** | not supported |
| `enableAudio` | lite | **400** | not supported |
| `addAudio` | lite | **400** | not supported |
| `withAudio` | lite | **400** | not supported |
| `generateSpeech` | lite | **400** | not supported |
| `sampleCount: 1` | lite | **200** | accepted — control, proves the probe shape was valid |

**₹0 was spent on the eight rejections.** A 400 at request validation never
reaches generation, which is exactly why the parameter was probed before the
benchmark rather than after it.

### Lite returns audio too

One Lite clip, submitted with **no** audio-related parameter at all:

```
duration = 4.000000     size = 565788
codec_name=h264   codec_type=video
codec_name=aac    codec_type=audio
```

So video-only is not selectable on either model. The earlier Fast clip
(461,532 bytes) had the same shape. **Both tiers return an audio track that
ONIQ's renderer then mutes** at `StoryFilm.tsx:205`, `StoryFilm.tsx:494` and
`story-worker.mjs:2004`.

## Why stripping it afterwards does not help

`ffmpeg -an` on the conform pass removes the track from the file. It does not
remove it from the invoice — the provider has already generated and billed it
by the time ONIQ has the bytes. **Post-download stripping saves storage, not
money.** It should not be described as closing the leak.

## The question this raises, and it is now the pivotal one

Google's tier table prices Veo 3.1 with and without audio separately
($0.03 vs $0.05 for Lite; $0.08 vs $0.10 for Fast). **If audio cannot be
declined on the Gemini API, then the no-audio rates may not be reachable on
ONIQ's current API surface at all** — in which case the real rates are:

| tier | rate ONIQ can actually get here | rate the pricing model assumed |
| --- | --- | --- |
| Lite | **$0.05/s** (audio) | $0.03/s (no audio) |
| Fast | **$0.10/s** (audio) | $0.08/s (no audio) |

`DERIVED, not measured.` I have not seen a billing statement. It follows from
Google's own tiering plus the measured fact that audio always comes back, but
the invoice is the only thing that settles it.

**The cheap decisive step is to read the bill, and only the owner can.** Open
the Google Cloud / AI Studio billing detail for 2026-08-23–24, find the Veo
line items for the clips generated during this verification, and check the unit
rate. That is a two-minute lookup that resolves a figure the entire price
ladder rests on, and it costs nothing.

## Options, all of which are owner decisions

Per `CLAUDE.md`, the API surface a feature runs on and what the account's money
buys are the owner's calls. **Nothing was changed.**

1. **Read the invoice first.** Costs nothing, settles the $0.03-vs-$0.05
   question, and every other option depends on the answer. This is the one I
   recommend doing before anything else.
2. **Accept the audio rate and switch tier only.** Lite is half of Fast on the
   same surface ($0.05 vs $0.10), so the Lite/Fast decision still carries a 2x
   saving regardless of how the audio question resolves. That decision is what
   the benchmark is measuring.
3. **Move the clip stage to Vertex AI**, where `generateAudio` is a supported
   parameter. This is a real migration — different endpoint, different auth
   (service account rather than an API key), different quota — and it is only
   worth costing out if the invoice confirms ONIQ is paying the audio premium.
   **Not started, not recommended without step 1.**

## What did NOT change

No production code was modified. `story-clip` still sends
`{aspectRatio, durationSeconds, resolution}`, which is now confirmed to be a
valid parameter set — adding `generateAudio` to it would have broken every clip
with a 400, and the existing strip-on-400 fallback only covers `resolution` and
`durationSeconds`, so it would not have caught it.

**That is the concrete harm this probe avoided**, and it is the reason the
parameter was tested against the live API before being written into a request
builder.
