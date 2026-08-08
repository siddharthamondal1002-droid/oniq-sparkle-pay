# Verifying things, and the ways it goes wrong

Habits earned from real failures in this repo. Each one is here because the
obvious alternative produced a confident, wrong answer.

---

## Verify the artifact, not the record of it

A manifest, a commit message, a queue row and a chat log are all claims. Check
the thing itself.

- The episode asset's `size` field said 40,787,362. That was true, and told us
  nothing about whether the bytes served over HTTP matched, or whether the file
  had an audio stream.
- `video_jobs` had **0 rows**, which proved the shipped clips had never come
  from the pipeline everyone assumed made them. Reading the database beat
  reading the commit history.
- A queued `episode_jobs` row looks like progress and is a dead end — nothing
  drains that table.

## A source-level guard cannot see runtime behaviour

`<Audio loop />` is present in the file, type-checks, and the renderer ignores
it. Every mount guard passed while half an episode rendered silent.

Text guards catch "somebody deleted the line". They cannot catch "the framework
does not do what the line says". For that you need to run the thing and measure
the output.

## The A/B difference is the strongest tool for "did X contribute anything"

Render/build twice, once with the element and once without, and subtract.
Identical output means the element contributed nothing. It is unambiguous where
level readings and correlation both failed:

- level readings failed because a 16 dB-quieter layer is invisible next to a
  loud one
- cross-correlation failed outright — at one sample the control scored higher
  than the signal

When a cheap statistical proxy comes back ambiguous, **do not talk yourself into
it**. Reach for the expensive unambiguous test.

## One sample point is not a result

The first A/B ran at t=230s, returned exactly zero, and produced the confident
conclusion "the layer is absent" — reported to the user before being checked.

t=230s was past the 166s length of the audio: the single region where the bug
suppressed the signal completely. Inside 166s the same test measured −42.7 dB.
The layer had been there all along.

**Sample both sides of any boundary you know about** — a file length, a loop
point, a cache TTL, a pagination edge.

## Calibrate against the material, never against a plausible constant

`0.06` of full scale _sounds_ like a reasonable speech threshold. Measured, the
median frame of real narration is `0.024` — the threshold sat above the median
of the thing it was meant to detect, and ducked over 30% of an episode that
talks throughout.

Two general forms:

- **Normalise before thresholding**, so a threshold means the same thing
  regardless of how loud a particular batch arrived.
- **Express intent in the units the domain uses** (dB below the narrator), and
  derive the implementation number from measurement. A raw linear gain is
  meaningless without knowing both signal levels, and a gain hand-tuned to one
  file is wrong for the next.

## Mutate to prove a test bites

A passing test is not evidence until it has been seen to fail. Break the thing
on purpose, watch the test go red, restore, watch it go green.

This session it caught **three vacuous tests of my own**, all of which passed
against broken code:

- searching for `MusicBed` matched the component _definition_, so it passed with
  the element moved somewhere wrong. Fixed by searching the JSX usage
  `<MusicBed`.
- `max − min > 0.1` across a curve with fades to zero was satisfied by the fades
  alone and said nothing about the behaviour under test.
- an assertion about a string literal ran against text with string bodies
  blanked, so it could never match.

## Use versus mention: pick the right view of the source

`src/test/sourceText.ts` exists because this trap has bitten repeatedly, in both
directions. Choosing wrong gives either a false pass or a false fail.

| You are asking                    | Use              | Why                                                       |
| --------------------------------- | ---------------- | --------------------------------------------------------- |
| Is this really called / imported? | `executableText` | Comments AND string bodies out — a comment naming it lies |
| Is this string value present?     | `blankComments`  | Comments out, strings KEPT — the value IS a string        |
| Which line is this grep hit on?   | `blankComments`  | Line numbers preserved                                    |
| Is this module imported?          | `stripComments`  | Strings kept — an import specifier is a string            |

The failure that motivated it: a "this file must not import payments" assertion
ran on text with strings blanked. An import specifier **is** a string literal,
so it was blanked, so the check passed unconditionally and proved nothing.

The mirror image, same day: an assertion for `loopVolumeCurveBehavior="extend"`
ran on `executableText`, which erased the very word it was looking for — and the
raw source would not do either, because the comment above the prop quotes it
verbatim. `blankComments` was the only correct view.

## Say what you did not verify

The music bed could not be checked for vocals by any measurement available. The
syllable-rate proxy came back _worse_ than real speech — the frame-drum pulse
lands in the same 3–8 Hz band — so it discriminated nothing.

The right move was to say so, hand the user the isolated file, and let them
listen. An unverified claim stated as verified is worse than an admitted gap.
