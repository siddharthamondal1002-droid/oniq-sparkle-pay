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
