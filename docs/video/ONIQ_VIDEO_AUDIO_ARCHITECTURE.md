# ONIQ_VIDEO_AUDIO_ARCHITECTURE

**Status** IMPLEMENTED, NOT ACTIVATED · **Date** 2026-08-24 · **Commit** `3cec33fa`

---

## 1. The finding that decides the architecture

ONIQ calls Veo on `generativelanguage.googleapis.com/v1beta` — the **Gemini
Developer API** (AI Studio). Google's own SDK, `@google/genai` 2.18.0,
`generateVideosConfigToMldev`:

```text
if (getValueByPath(fromObject, ['generateAudio']) !== undefined) {
  throw new Error('generateAudio parameter is only supported in Gemini
    Enterprise Agent Platform mode, not in Gemini Developer API mode.');
}
```

Twenty lines later, `generateVideosConfigToVertex` maps it straight through:

```text
setValueByPath(parentObject, ['parameters', 'generateAudio'], fromGenerateAudio);
```

**On ONIQ's current surface there is no way to ask Veo not to generate audio.**
This matches the live probe of 2026-08-24, where all six spellings of the
parameter returned HTTP 400 and Lite returned an AAC track anyway.

Complete accept/reject list for video generation on the Gemini Developer API,
read off the same converter:

| Accepted                                                                                                                                             | Rejected                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `sampleCount`, `durationSeconds`, `aspectRatio`, `resolution`, `personGeneration`, `negativePrompt`, `enhancePrompt`, `lastFrame`, `referenceImages` | `outputGcsUri`, `fps`, `seed`, `pubsubTopic`, **`generateAudio`**, `mask`, `compressionQuality`, `labels`, `resizeMode` |

### Three consequences, and they invert the intuition

1. **VIDEO_ONLY is not achievable here.** Requesting it is a wish, not a
   setting. The audio is generated and billed either way.
2. **The audio is already paid for.** At the margin, native audio on this
   surface is **free** — the money left the account the moment the clip was
   generated. **Discarding it is the only actual waste**, which is exactly the
   invariant: never pay for audio and then throw it away.
3. **The cheaper video-only tier is a different surface.** Reaching $0.03/s
   means moving ONIQ's video calls to Vertex AI — a provider-and-account
   change, and therefore an **owner decision** under CLAUDE.md.

---

## 2. Why ONIQ muted, and why that was not simply a bug

`remotion/src/story/StoryFilm.tsx` rendered every clip `muted`, with its reason
written beside it:

> _"Veo writes its own soundtrack and the narration below is the film's only
> voice."_

That is a real architectural constraint. ONIQ Stories are **narration-as-clock**:
the narration wav defines how long each shot lasts, and character dialogue is
TTS'd and **concatenated into that same wav**. Unmuting a narrated shot does not
add richness — it adds a second, unsynchronised voice reading different words
over the first.

So the fix is not "unmute everything". It is to decide, per shot, which
architecture the scene wants, and to **record the decision** — including
recording, explicitly, when a native track is discarded and why.

---

## 3. The three modes

| Mode                 | Provider audio requested      | Provider audio kept                | When                                                                                |
| -------------------- | ----------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| **VIDEO_ONLY**       | no (where the surface allows) | no                                 | no ONIQ voice, scene genuinely wants silence                                        |
| **ONIQ_SOUND**       | no (where the surface allows) | no                                 | ONIQ narration / TTS dialogue / ambience carries the shot                           |
| **VEO_NATIVE_AUDIO** | yes                           | **yes, mixed into the final film** | no ONIQ voice, and sound that must be frame-locked: speech, an explosion, footsteps |

`resolveAudioMode(requested, surface)` returns, for every combination:
`effective`, `achievable`, `providerAudioBilled`, `preserveProviderAudio`, and —
whenever a track is dropped — a non-empty `discardReason`. A silent discard is
structurally impossible: the field is required by the type and asserted by test.

On `google-ai-studio`, VIDEO_ONLY and ONIQ_SOUND both report
`achievable: false` and `providerAudioBilled: true`. That is deliberate: it stops
any caller believing it selected the cheap tier.

---

## 4. The story-aware router

`inferAudioMode(signals)` in `_shared/videoAudio.ts`. Order matters, and it is
**not** "richest wins":

1. **ONIQ voice present → ONIQ_SOUND.** A hard collision, not a preference.
2. **Scene says silent → VIDEO_ONLY.**
3. **Speech in the scene → VEO_NATIVE_AUDIO.** Only synchronised native audio
   can lip-match.
4. **Frame-locked SFX (explosion, footsteps, thunder, a door) → VEO_NATIVE_AUDIO.**
5. **Atmosphere only** → ONIQ_SOUND **if** an ONIQ ambience bed exists (level
   controlled, faded at the seams, consistent across the whole film), otherwise
   VEO_NATIVE_AUDIO.
6. **Nothing found → VIDEO_ONLY**, recorded as _"no speech, synchronised effect
   or atmosphere found"_ — silence because nothing was found, which is a
   different claim from silence by default.

Worked against the owner's own examples, all asserted in
`src/lib/__tests__/videoSpend.test.ts`:

| Scene                                  | Mode             |
| -------------------------------------- | ---------------- |
| "a silent cinematic shot"              | VIDEO_ONLY       |
| "a man says 'Don't leave me'"          | VEO_NATIVE_AUDIO |
| "an explosion with synchronised sound" | VEO_NATIVE_AUDIO |
| "a woman walking through rain"         | VEO_NATIVE_AUDIO |
| same, with an ONIQ ambience bed        | ONIQ_SOUND       |
| "montage of the city" + narration      | ONIQ_SOUND       |

---

## 5. What changed in the pipeline

- **`story-clip`** takes `audioMode`, resolves it against the active surface,
  records the resolution on the ledger row (`audioRequested`, `audioEffective`,
  `providerAudioBilled`, `discardReason`), and returns the plan to the worker.
  It sends **no** `generateAudio` parameter — the API rejects it, and the
  strip-on-400 ladder would have dropped it silently while the caller believed
  it had opted out.
- **`story-worker.mjs`** routes each shot with `audioPlanFor(shot)` (narration,
  ONIQ dialogue, ambience, and the motion/vfx/dialogue prompt text), threads the
  mode through start _and_ poll, and sets `clip.preserveAudio`.
- **`StoryFilm.tsx`** now reads `muted={!shot.clip.preserveAudio}` with a
  `volume` for the preserved track. The **frozen tail stays muted always** — a
  held frame with a running audio track would replay the clip's sound under a
  still image.

---

## 6. Acceptance is decided on the media, not the request

`verifyFinalMedia(mode, probe)` — because on this surface the request parameter
cannot even be sent, so it is not evidence of anything.

| Mode             | Required                                           |
| ---------------- | -------------------------------------------------- |
| VIDEO_ONLY       | video stream present, **no** audio stream          |
| ONIQ_SOUND       | video + audio, peak above −60 dBFS, drift ≤ 0.25 s |
| VEO_NATIVE_AUDIO | video + audio, peak above −60 dBFS, drift ≤ 0.25 s |

The silence floor exists because Episode 1 once shipped as a 4:47 slideshow with
an audio track present at −91 dBFS. A track at that level is silence with extra
steps.

---

## 7. Open

- **The three modes have not been generated and probed end to end.** The daily
  Veo quota is exhausted and this session holds no Google key, so the media
  verification in §6 is implemented and unit-tested but **not yet run against
  real output**. That is the first thing to do when generation is re-enabled.
- **Whether to move to Vertex** — the only route to a video-only tier — is an
  owner decision, not taken here.
