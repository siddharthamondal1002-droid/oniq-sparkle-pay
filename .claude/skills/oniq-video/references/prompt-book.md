# The synced visual + audio prompt book

Supplied by the project owner, 2026-08-08, as 103 numbered entries of the form:

```
N. [Genre] VISUAL: <shared style prefix> <shot> of a character <action> in a
   <setting> with <lighting>.
   AUDIO: <mood> soundtrack using <instrument>, <tempo> tempo, with
   <ambience> ambience.
```

It is recorded here as the **grammar it was generated from** rather than as
103 near-identical paragraphs. Every entry is one draw from a cross product;
the axes below regenerate any of them and 1.6 million more, and a list of
samples would rot the moment an axis changed. Nothing is lost that a reader
would ever have used.

---

## READ THIS BEFORE USING THE VISUAL PREFIX

**The book's shared prefix is a superseded string. Pasting it verbatim
reintroduces three faults that cost two full regenerations of Episode 2 on
2026-08-08.** It reads:

> Stylised storybook animation still, lush hand-painted 3D-animation feel,
> rounded simplified forms with soft painterly brushwork, saturated jewel
> palette, glowing accents, atmospheric haze, cinematic composition.

That is `STORYBOOK_STYLE` as first written, **minus its negations** — so it is
strictly worse than the version already rejected. Specifically:

| Phrase in the book        | What it actually did                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `saturated jewel palette` | Turned hard-midday scenes into full night. The palette it names is a night palette, so it silently overrides the hour. |
| `glowing accents`         | Put drifting firefly motes over bare rock in daylight.                                                                 |
| _(nothing about people)_  | Re-invented the cast every image — one character was a bearded adult in three shots and a chibi child in a fourth.     |
| _(no negations at all)_   | Drops `no film grain`, `not photorealistic`, `no text`, `no watermark`. The book has none of them.                     |

**The source of truth is `STORYBOOK_STYLE` in `src/data/originals.ts`**, which
fixes all of the above. Call `stillPromptFor(scene)`; never hand-assemble a
prompt from this file. The long comment above that constant explains each fix
and why the obvious wording fails.

Use this page for its **axes**, not its prefix.

---

## Visual axes

Composed as: `<shot> of a character <action> in a <setting> with <lighting>`.

| Axis         | Values                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------ |
| **shot**     | wide shot · panoramic · over-shoulder · low-angle · top-down                               |
| **action**   | walking · running · resting · searching · exploring · watching horizon                     |
| **setting**  | village · city · desert · forest · mountain · sea · cave · ruins · battlefield · sky realm |
| **lighting** | harsh midday · golden glow · moonlit blue · storm dark · fog diffused                      |

5 × 6 × 10 × 5 = **1,500 visual combinations.**

## Audio axes

Composed as: `<mood> soundtrack using <instrument>, <tempo> tempo, with <ambience> ambience`.

| Axis           | Values                                                                            |
| -------------- | --------------------------------------------------------------------------------- |
| **mood**       | epic · dark · dreamy · mysterious · uplifting · tense                             |
| **instrument** | orchestral strings · piano · choir · synth pads · tribal drums · ambient textures |
| **tempo**      | slow · moderate · building · pulsing · fast                                       |
| **ambience**   | wind · rain · thunder · fire crackle · whispers · echo                            |

6 × 6 × 5 × 6 = **1,080 audio combinations.**

---

## Two things the book does not tell you

**The genre tag is decorative.** `[Genre]` never appears in the prompt text and
does not constrain any axis. Entry 7 is tagged `[Horror]` and reads "wide shot
of a character exploring in a city with golden glow / epic soundtrack using
piano" — which is not horror by any reading. Do not treat the tag as a
selector, and do not expect a `[Kids]` entry to be gentler than a `[Horror]`
one. If genre needs to matter, it has to constrain the lighting and mood axes
explicitly, and right now it does not.

**`lighting` and the scene text will fight, and the scene must win.** This is
the same collision that produced the night-drift bug. If a shot list already
says "hard midday" and an axis says `moonlit blue`, you have specified the
scene twice and the generator will pick one. Choose the lighting value that
matches the scene, or drop the axis — never state both.

---

## The audio half — built for Episode 2

This section said "nowhere to go yet" when the book arrived. It was built the
same day; here is what exists and what it cost.

**The bed prompt is data.** `EP2_BED` in `src/data/originals.ts`, alongside
`style`, so a bed can be regenerated rather than being a chat log. Episode 2's
is written to the axes above.

**Pick the instrument for the mix, not the setting.** The obvious choice for
Ali Baba is the book's `tribal drums`, and it is the wrong one: the bed plays
under narration for 88% of the episode at about a sixth of the narrator's
level, and percussive transients punch through a duck in a way sustained
material does not, so every hit pokes out. `ambient textures` carries the same
desert atmosphere with nothing to poke. The axes describe a mood; the mix
decides which value survives.

**Ducking, and how to get its threshold right.** `src/lib/audioDuck.ts`, pure
and tested; `remotion/scripts/build-bed-envelope.mjs` measures the real
narration and writes a per-frame gain array to `bedGain.json`. Two calibration
traps, both found by measuring rather than listening:

- **An absolute threshold is wrong.** 0.06 of full scale sounds like a
  reasonable speech level and is in fact _above the median frame_ of real
  narration (measured: p50 0.024, p90 0.108). It ducked over only 30% of an
  episode that talks throughout. Normalise the envelope to its own 95th
  percentile first, so the threshold is a property of the mix and not of the
  recording gain.
- **Per-frame RMS is too twitchy** to answer "is anyone speaking" — half the
  frames land in the silences inside ordinary speech. Peak-hold ~0.4s before
  thresholding. Detection went 30.8% → 88.3%, which matches the material.

Order: peak-hold **per scene** before laying scenes onto the timeline, so
smoothing never smears one narration into its neighbour's silence; normalise
**across the episode** after, so every scene is judged on one scale. Overlapping
scenes take the **max** of the two narrations — overwriting shows a hole
wherever the incoming line has not started, and the bed swells into it.

**Mount the bed at the composition root, outside `TransitionSeries`.** Inside,
it is restarted and cross-faded at every scene boundary.

**Loop it with `<Loop>`, never with `loop`. This is the expensive one.**
`<Audio loop />` type-checks — `RemotionAudioProps` extends React's native
audio attributes and `loop` is one of them — and the preview honours it. **The
renderer does not.** Episode 2's bed played once for its 166 seconds and the
remaining 169 seconds, more than half the episode, rendered with no music.
Nothing warned. Use:

```tsx
<Loop durationInFrames={BED_LOOP_FRAMES}>
  <Audio src={...} loopVolumeCurveBehavior="extend" volume={(f) => GAIN[f]} />
</Loop>
```

`loopVolumeCurveBehavior="extend"` is not optional. Inside a `Loop` the volume
callback receives the frame relative to the current ITERATION, so the default
replays the first 166 seconds of the duck curve over the second half — ducking
against narration that is not there.

### How to prove audio is actually in a render

Worth its own heading, because the two obvious methods both failed on this bug.

- A **source-level mount guard cannot see it.** The element is in the file.
- **Level measurement cannot see it.** Narration is 16 dB louder than the bed,
  so it dominates every reading and everything looks plausible.
- **Cross-correlating the render against the bed was inconclusive** — at one
  sample the control scored higher than the signal.

What works is an **A/B render**: render the same 150 frames twice, once with
the layer and once without, and subtract. Identical audio means the layer
contributed nothing. It is unambiguous and takes about a minute per side.

**Sample on both sides of any suspected boundary.** The first A/B was run at
t=230s, came back exactly zero, and led to the wrong conclusion that the bed
was absent entirely — 230s is past the bed's own 166s length, the one region
where the bug hid the signal completely. Inside the first 166s it measured
-42.7 dB. One sample point is not a result.

**Attack fast, release slow.** 6 frames down, 36 up. Symmetric timing pumps
between words; the asymmetry is the whole trick, and a test asserts it.

**Rights.** A generated bed is ONIQ's own and is fine. Never source a music
track from anywhere else — the reasoning in `watchDirectory.ts` about
third-party media applies to audio identically, and a licensed-sounding
soundtrack is the fastest way to turn an owned episode into a takedown.
