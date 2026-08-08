# Assembling generated video clips into an episode

Veo caps a clip at 10 seconds and an episode runs seven minutes, so a scene is
covered by several independently generated clips. This is how they go together.

Three architectures were designed independently against the same audit and
adversarially reviewed. They disagreed about scope and converged on the rules
below — that convergence is the reason to trust them.

---

## Hard cuts INSIDE a scene. Dissolves only BETWEEN scenes.

This inverts the instinct, and it is the most important rule here.

**A cross-dissolve between two independently generated clips of the same
subject is a morph.** You watch one face slide into a slightly different face
over twelve frames. A cut is far better: the eye accepts it instantly and
cannot compare across it. A dissolve also *means* "time passed" — true at a
scene boundary, a lie seven times inside one paragraph.

It is also what makes the arithmetic close. With hard cuts,

```
sum(clip frames in scene i) === SCENE_FRAMES[i]
```

exactly. So `sceneStartFrames`, `layOnTimeline`, `bedGain.json` and all of
`src/lib/audioDuck.ts` keep working **unchanged**. Nested overlaps would make
every one of those subtly wrong, and wrong in a way that compounds through the
episode.

Keep an explicit opt-in (`transitionIn: 'dissolve'`) for the rare place the
script itself jumps in time — in ep3 that is exactly the three beats of S11,
"A house. Then a better house. Then a palace."

## Most shots in a long scene have no face in them

The answer to "49 seconds is five takes of the same man and he changes between
them" is not better prompting. It is **coverage**.

Five near-identical takes of one wide shot read as a glitch, because the eye is
invited to compare them and finds the crowd rearranged and the light moved.
Five *different* shots — a wide, then hands, then a tilt up a wall, then a face
— read as filmmaking, because a change of angle is what a cut is supposed to
look like.

So write long scenes as a shot list with most shots on objects, hands, doors,
skies and crowds. Character-consistency risk drops with the number of frames a
face is actually in.

## Narration stays the clock, and there is ONE trim site per scene

Generate clips slightly long. Trim the **tail of the last clip in each scene**
so the picture lands exactly on the voice. No stretching, no freezes, no
`playbackRate` — those are all visible, and audio-led timing is what has kept
every episode in sync so far.

## The manifest is smart, the composition is dumb

Put the per-clip frame allocation in `manifest.ts` and make it **throw at
module scope** if the arithmetic does not close. That throw fires inside the
webpack bundle (blocking the render) *and* inside
`build-bed-envelope.mjs` (blocking a stale duck curve). Both are stronger than
a vitest test because neither can be skipped.

## Steal the head and tail stills from the clip itself

Where a still sits next to a clip, extract it from **frame 0 and the last shown
frame of that clip** rather than generating it separately. The image before and
after the cut is then the same image, from the same pass, in the same grade —
frame-identical by construction, and it costs no extra generation.

Corollary for Ken Burns beside a clip: ease the move **to identity** (scale 1,
zero translate) at the seam, so the artificial camera comes to rest exactly
where the real one picks up.

---

## The four mechanical traps, all invisible until playback

1. **Clips carry their own audio.** Strip it on ingest. Remotion will happily
   mix a generated soundtrack under your narration.
2. **1088×1920, not 1080.** Crop or scale on ingest, or every shot sits 8px off.
3. **24fps clips in a 30fps timeline.** Conform on ingest. Judder is easy to
   excuse as "the animation".
4. **~20 MB per 10s clip against a 10 MB repo limit.** Clips live on the CDN as
   `.asset.json`, not in `remotion/public/`.

Do all four in **one ingest script** that also probes each clip and can re-check
measured length against the manifest — the same `--check` shape that catches a
stale bed length today.

## Budget, so nobody starts blind

A 7-minute episode is roughly **48 shots**: 48 starting stills *and* 48 video
generations, sequential because of the concurrency cap, at ~100× a text call
each. Get one full scene working end to end before generating the rest.
