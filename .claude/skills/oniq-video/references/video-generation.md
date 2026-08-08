# The in-house video generator

What ONIQ can actually generate as MOVING video, as opposed to stills. Probed
2026-08-08 with one clip before committing to a pipeline.

## What it is

**`google/veo-3.1-lite`**, via the Lovable AI Gateway, driven by the Lovable
agent's `generate_video` tool. `veo-3.1-fast` and `veo-3.1` exist at higher
cost. This is the tool that produced `lores-firefly-forest.mp4`.

It is **not** the Runway path in `runway.server.ts`. That is the app's own
admin-gated feature, has never been run in production (`video_jobs` is empty),
and is not what the Lovable agent calls.

|                 |                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Max clip length | **10 seconds.** 5 or 10 only. There is no 20s and no extend.                                    |
| Portrait        | Yes, but returns **1088×1920**, not 1080×1920 — macroblock rounding                             |
| Frame rate      | **24fps, fixed.** Episodes are 30fps                                                            |
| Image-to-video  | Yes, via `starting_frame`                                                                       |
| Continue a clip | **No.** No continuation API                                                                     |
| Cost            | ~100× a text call. Rate-limited per minute, small concurrency cap — **sequential, not fan-out** |
| Output size     | ~20 MB per 10s clip at 1080p                                                                    |

Measured on the probe, not quoted from docs: `h264, 1088×1920, 24/1 fps,
duration 10.041667, size 21,178,544`.

## The finding that decides the architecture

**Text-to-video ignores the style prompt.** The probe was given the full
resolved scene prompt — house style, character lock, the lot — and came back
**cel-shaded anime**: flat fills, hard line, nothing like the lush hand-painted
look the image model produces reliably for the same words. Veo has a strong
animation-house default and the style words did not survive it.

Character motion, by contrast, **worked** — the boy's head turned, his posture
shifted, his hands and feet moved. It was genuinely animated, not a push-in.

So the shape of any real-animation pipeline is forced:

> **Generate the still first with the image model, then hand it to Veo as
> `starting_frame`.**

The image model already gives Episode 2's look and honours the cast locks. Veo
inherits the frame and only has to add motion. Text-to-video is not a viable
route to a consistent season.

### And it works — confirmed on episode 3, 2026-08-08

`starting_frame` **holds the style for the whole clip**. The episode 3 pilot
generated a painted still and handed it over; the frame at eight seconds in is
the same lush painterly render as the still, with no cel-shading, no flattening,
colour and haze intact. Motion was real too — crowd figures walked, awnings
lifted, dust turned — rather than a push-in over a static image.

So the architecture above is not merely forced, it is verified. Generate the
still, hand it over, and Veo respects it.

## The IP filter, and it can stop a shot dead

Veo refuses some submissions outright:

```
invalid_request — "The prompt could not be submitted due to the interests of
third-party content providers. Support codes: 35561575"
```

This is a hard refusal, not a degraded result, and **it can fire on the IMAGE**
— not only on the words. Episode 3's `ep3_s01b` hit it: a boy in a souk, in the
house's feature-animation render, from a starting frame the image model had
already produced happily.

### It is NOT deterministic, and that is the whole lesson

`ep3_s01b` was refused repeatedly, then **passed on a plain retry** — same
image, same prompt, nothing changed. So the refusal was a sampling-dependent
moderation hit, not a property of the shot.

> **Treat a filter rejection as retryable, once or twice, before concluding
> anything about a shot.** A single failure must never stop the queue, and must
> never be read as evidence about the artwork.

That mattered enormously here. The refusal looked like a systematic block on
the show's lead character — 26 of 60 shots carry a cast lock, so the obvious
reading was that a third of the episode was unmakeable and the character needed
redesigning. All of that would have been wasted work on one flaky call.

The related discipline: `ep3_s01c` (hands and a spindle, same house render)
passed first time, which is what proved the STYLE was not the trigger. Probe
the cheap, character-free shot first — it separates "the look is banned" from
"this shot is unlucky" for the price of one generation you needed anyway.

Also worth keeping, independent of the flakiness:

- The image model and the video model apply **different policies**. An image
  that generates without complaint can still be refused as a starting frame.
- **Never send the character lock to the VIDEO model.** The lock exists to make
  the still right; once the still exists its job is done. The video call should
  carry the `motion` field alone — no names, no style block. Cheap insurance
  against a name-matching classifier, and it costs nothing.
- **Do not redesign a character to appease this.** ONIQ's cast comes from the
  owner's own Adobe Firefly sheets. Changing them to satisfy someone else's
  classifier discards ONIQ's own IP and breaks continuity with every still
  already approved — and on the one occasion it looked necessary, it wasn't.

## Four things that will bite in assembly

1. **1088 ≠ 1080.** Every clip needs a crop or scale, or the composition gets
   an 8px horizontal offset.
2. **24fps into a 30fps timeline.** Every clip must be conformed. Getting this
   wrong looks like judder, which is easy to dismiss as "the animation".
3. **Clips carry their own audio track.** It must be stripped or muted, or it
   will fight the narration. This is the same class of failure as the two
   audio bugs already shipped.
4. **~20 MB per 10s clip, and the repo rejects files over 10 MB.** Clips cannot
   live in `remotion/public/`. They have to be CDN assets referenced by
   `.asset.json`, which means the renderer is pulling video over the network.

## The arithmetic, before anyone commits

A 7-minute episode at 10s per clip is **43 clips**, each needing its own
starting still — so 43 stills _and_ 43 video generations, run sequentially, at
~100× a text call each, producing ~900 MB of source video.

That is the number to put in front of the owner before starting, not after.
