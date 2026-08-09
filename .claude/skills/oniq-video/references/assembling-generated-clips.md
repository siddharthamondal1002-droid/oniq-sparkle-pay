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

## Cuts must land on the language, or the picture reads as lagging

Allocating shots by weight is exact and closes the arithmetic, and it produces
an edit that ignores the script. Weight knows nothing about where the sentences
are, so a cut arrives mid-clause and the new image lands detached from the words
that introduced it. The project owner described episode 3 as "scene matching
with audio is lagging" — it was not sync drift, the file was frame-exact. It was
this.

Measured on ep3's own narration, before the fix: **11 of 44 interior cuts sat
inside a pause; 20 of 44 were more than 0.6s from any pause**, the worst being
the episode's opening cut at 2.18s adrift.

The fix is `snapCutsToPauses` in `src/lib/shotAllocation.ts`, fed by a committed
pause table (`remotion/scripts/measure-ep3-pauses.mjs` →
`remotion/src/ep3/pauses.ts`). It moves the boundaries BETWEEN shots and never
the scene endpoints, so every scene still sums to exactly what it summed to and
nothing downstream shifts. At a one-second budget: 32 of 44 on the beat, mean
miss 0.64s → 0.37s.

Four things that are easy to get wrong here:

- **Snap in TIMELINE space, not generated-frame space.** A shot dissolved into
  contains `SHOT_DISSOLVE_FRAMES` more frames than it OCCUPIES. Pauses are
  measured on the timeline. Snapping the generated counts directly puts a
  dissolve-carrying scene's cuts up to 36 frames out. Strip the overlap, snap,
  add it back.
- **The budget bounds CUT movement, not shot duration.** A shot lies between two
  cuts, so a 30-frame budget can change a shot's length by 60. That looks like a
  breach in a diff and is not. Say so where someone will read it.
- **Snapping needs the RAW clips.** Moving a cut makes the shot on one side
  LONGER, and a conformed clip is trimmed to exactly its allocation — it has no
  spare frames. Raws are ~301 frames against a 300-frame ceiling. Upload raw
  pointers alongside conformed ones from the start; without them a re-cut costs
  a regeneration.
- **Bigger budget is not better.** 1.5s scores 41 of 44 against 31, by moving a
  cut as much as a third of a five-second shot — winning the metric by rewriting
  the pacing the shot list intended.

Two related faults the same measurement pass turned up in ep3, both still open
and both worth checking on any episode:

- **Speech overlapping speech at scene joins.** Narration sits inside each
  scene's Sequence and consecutive Sequences overlap by `TRANSITION_FRAMES`.
  Where the outgoing tail silence plus the incoming head silence is under the
  transition length, both voices play at once — 5 of 15 joins in ep3, up to
  0.13s. Measure head/tail silence per mp3 against `TRANSITION`.
- **Delivery rate that runs the wrong way.** ep3 averages 143 wpm against a 140
  target, but ranges 109 to 178 — and the fastest scene in the episode is the
  coda. Check per-scene wpm, not just the total; a story that accelerates into
  its ending reads as rushed no matter how good the total is.

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

**Keep the RAW generations too, not just the conformed clips.** Same mechanism —
upload, commit a pointer — under `public/ep3/raw/`. They are the only copy of
the frames a re-cut needs, and the box that generates them recycles. Recovering
them after the fact cost an extra round trip that uploading at generation time
would have avoided entirely.

## Getting the clips onto a box that cannot reach the CDN

The dev container has the renderer and **its proxy denies `*.lovable.app`,
`oniqhub.com` and Supabase** — so `--fetch` cannot run on the one machine that
needs the files. GitHub is reachable. `.github/workflows/ep3-clip-transfer.yml`
resolves it: a runner with open egress rebuilds the set from the committed
pointers and publishes it as a **release asset**.

A release asset, not an orphan branch. Pushing 428 MB of mp4 onto a branch works,
but the objects survive deleting the branch and every future clone pays for them.
An asset sits outside git, is one download instead of sixty blobs, and deletes
without a trace. Checksums go INSIDE the tarball so the receiving box can prove
it got every byte. Measured: 428 MB conformed in 6.6s, 970 MB raw in 34s, all 120
checksums clean.

Do not gzip the raws — 970 MB of h264 does not compress and squeezing it costs a
minute of runner time to save nothing.

Do all four in **one ingest script** that also probes each clip and can re-check
measured length against the manifest — the same `--check` shape that catches a
stale bed length today.

## Budget, so nobody starts blind

Episode 3 came out at **60 shots** for 6:54 of narration — 60 starting stills
*and* 60 video generations, sequential because of the concurrency cap, at ~100×
a text call each. Get one full scene working end to end before generating the
rest.

Budget ~8.5 shots per minute of finished episode. The naive 10s-per-clip figure
(43 for seven minutes) is about 30% low, because shots are allocated by weight
and none of them lands on the ceiling.

---

## Two environment traps, both found the expensive way

**The compositor's ffmpeg has no `fps` filter and no `setpts`.** `-vf fps=30`
fails outright on the cut-down build Remotion ships. `-r 30` as an OUTPUT option
goes through the encoder's own frame-duplication path and works. It does have
libx264, the mp4 muxer, `crop` and `scale` — so the whole ingest is one command:

```
ffmpeg -i raw.mp4 -an -vf crop=1080:1920 -r 30 -frames:v <N> \
       -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p out.mp4
```

Verify against a synthetic 24fps 1088×1920 clip before trusting it.

**Dry-run the composition with stand-in clips before generating anything.**
Sixty generations is the expensive way to discover that `Episode3.tsx` cuts in
the wrong place. Build one stand-in per shot from the scene's own still, at the
shot's exact frame count, using a different `crop` per shot so adjacent shots
look different:

```
ffmpeg -loop 1 -framerate 30 -i <scene>.jpg \
       -vf "crop=$((1080-i*90)):$((1920-i*160)):$((i*45)):$((i*60)),scale=1080:1920" \
       -frames:v <N> -an -c:v libx264 -preset ultrafast -crf 30 -pix_fmt yuv420p <shot>.mp4
```

Sixty of those cost 15 MB and about three minutes, and they run through the
real ingest `--check` and the real renderer.

**How to measure a cut when the ffmpeg has no `psnr`, `blend` or `signalstats`.**
It also has no `zoompan`, `drawtext`, `hue` or `eq`. But the rawvideo ENCODER
survives even though the rawvideo MUXER does not, so pipe it through `image2`:

```
ffmpeg -i range.mp4 -vf scale=32:32 -c:v rawvideo -pix_fmt gray -f image2 raw/f%04d.raw
```

That is one 1024-byte file of plain grey pixels per frame, trivially diffable in
Node. Because stand-ins are static, ANY frame-to-frame change is a transition,
so grouping the nonzero frames into bands reads the edit straight off:

```
frames 7747-7758  width 12   <- a dissolve, SHOT_DISSOLVE_FRAMES wide
frames  162-162   width  1   <- a hard cut
```

Episode 3 verified this way: cuts at exactly 162 and 340, three dissolve bands
of exactly 12 frames ending at 7758, 7952 and 8192. Beware single-frame bands
with a delta near 0.2 — that is h264 noise on a static image, not an edit.

**RENDER WITH NODE, NOT BUN.** Under bun a clip-based render dies at frame 0
with `Could not extract frame from compositor` and a 500 from the frame proxy —
reproducibly, at any concurrency, on clips that probe clean. The same
composition renders fine under node. Episodes 1 and 2 never hit it because
stills never call the compositor's frame server; only `OffthreadVideo` does, so
this only bites once an episode is made of video.

`remotion/CLAUDE.md` says to prefer bun for everything, and for everything else
that still holds. The render is the exception, and `render-ep3.mjs` says so at
the top. Its pre-flight needs TypeScript that node cannot import, so it asks bun
for that in a SUBPROCESS and keeps the render itself in node — one script, each
half in the runtime that can do the job. Do not "simplify" that into a second
bun-free script: the version that dropped the pre-flight also dropped the
MEASURED check and the missing-clip check, which are the two things standing
between you and a twelve-thousand-frame render of the wrong thing.

**Bundling an episode with the promo kills the render.** `remotion/src/index.ts`
registers the promo, the promo imports `theme.ts`, and theme.ts calls
`@remotion/google-fonts` `loadFont` **at module scope** — so headless Chromium
fetches Space Grotesk the moment the composition is evaluated, which dies behind
the proxy with `ERR_CERT_AUTHORITY_INVALID`. `selectComposition` then throws a
bare `NetworkError: A network error occurred`, which reads like a Remotion fault
and is not one.

The fix is `remotion/src/episodes.ts`, an episodes-only entry point that all
three render scripts use. Episodes draw no text and need no remote font. **Never
fix this by disabling certificate verification** — that trades a real security
control for a font nothing in the frame renders.
