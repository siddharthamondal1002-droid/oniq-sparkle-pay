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

## The audio half has nowhere to go yet

Nothing in ONIQ currently plays a music bed. `Episode1.tsx` and `Episode2.tsx`
mount exactly one `<Audio>` per scene and it is narration. Wiring a soundtrack
in is real work, not a prompt change:

- a second audio layer per scene, or one bed across the episode
- **ducking** under the narration, otherwise the voice is unintelligible — this
  is the part that is easy to skip and impossible to miss once heard
- the bed must survive `TransitionSeries` overlaps without pumping at every
  cross-dissolve
- one more thing that can silently fail to mount, exactly like the twelve
  narration files that were generated and never referenced in Episode 1

**Rights.** A generated bed is ONIQ's own and is fine. Never source a music
track from anywhere else — the reasoning in `watchDirectory.ts` about
third-party media applies to audio identically, and a licensed-sounding
soundtrack is the fastest way to turn an owned episode into a takedown.
