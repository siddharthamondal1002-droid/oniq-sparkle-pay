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

Two related faults the same measurement pass turned up in ep3. Both are fixed
now, and both are worth checking on any episode, because neither shows in a
still frame and neither is obvious on a first listen:

- **Speech overlapping speech at scene joins.** Narration sits inside each
  scene's Sequence and consecutive Sequences overlap by `TRANSITION_FRAMES`.
  Where the outgoing tail silence plus the incoming head silence is under the
  transition length, both voices play at once — 5 of 15 joins in ep3, up to
  0.13s. Measure head/tail silence per mp3 against `TRANSITION`; halving
  `TRANSITION` to 0.25s cleared all fifteen.

  **Measure the OVERLAP WINDOW, not "the longest silence near the join".** Two
  wrong statistics were tried first. Comparing the contiguous audible gap
  against the overlap duration is not the test — double-talk is avoided when
  tail silence PLUS head silence covers the overlap, their union, whereas the
  audible gap is their intersection and is necessarily shorter. And "longest
  silence in a 2s window around the join" is often dominated by an unrelated
  pause inside the scene, which made one join look like it had got worse. The
  test that answers the question is: sample the envelope across exactly
  `[scene B start, scene B start + TRANSITION]` and ask whether any instant is
  silent. Before: two joins had ZERO silent milliseconds across 500ms. After:
  all five had 120–150ms of silence inside a 267ms window.
- **Delivery rate that runs the wrong way.** ep3 averaged 143 wpm against a 140
  target — fine — while ranging 109 to 178, with the fastest scene in the film
  being the coda. Check PER SCENE, never the total. The method and the fix are
  below.

## Words per minute is two measurements wearing one number

Never act on wpm directly. It moves for three unrelated reasons and each wants a
different fix:

1. **How fast the voice articulates** — measure words (or better, syllables) per
   second of SPEECH, with pause time subtracted.
2. **How much it pauses** — pause count per hundred words, and pause share of
   the scene.
3. **How long the words are** — syllables per word. This is the one that makes
   wpm lie, and checking it first is what stops you "fixing" a scene that is
   fine.

On ep3's coda all three were measured before anything was touched. Articulation
was 5.22 syllables per second of speech against an episode mean of 4.41 — 18%
fast, the fastest scene in the film. Pause density was the lowest of any scene,
12.7 per hundred words against a mean of 21. And syllables per word was 1.29,
**exactly the episode mean** — so the voice really was going faster rather than
merely covering more short words. Had that last number come back high, slowing
the scene would have made the ending draggy for no reason at all.

**The fix, when it is genuinely speed:**

```
ffmpeg -i scene.mp3 -filter:a "atempo=<mean rate / measured rate>" \
       -c:a libmp3lame -b:a 64k -ar 24000 -ac 1 out.mp3
```

Re-encode to the SOURCE format. A first pass that promoted 24 kHz / 64 kbps to
44.1 kHz / 128 kbps made the file larger and the episode inconsistent for no
gain.

`atempo` is a time-stretch, not a re-performance. It cannot add the breath a
slower reading would have, and nobody measuring it can hear whether WSOLA left
artefacts on the sibilants. **Regenerating the narration at a slower speaking
rate is the higher-fidelity fix and lands in exactly the same place** — every
downstream number re-derives from the mp3, so swapping it later costs one render
and nothing else. Say which one you did.

**Verify in the RENDERED file, not the mp3.** Extract the scene's span from the
finished episode and measure it there. ep3's coda went 5.58 → 4.57 syllables per
second against a 4.41 mean, measured that way. Checking only the source mp3
would not have caught a mounting or trimming mistake.

**Everything downstream re-derives, so do it in order:** re-measure durations →
update the manifest → regenerate the pause table → let the shot split
recompute → re-conform only the scene's clips → re-render → **update the runtime
label in `lores.ts`**. That last one is easy to forget and ends up as a wrong
number under a play button; ep3 went 6:51 → 6:54.

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

## A derived number that quietly stops being derived

`TRANSITION` is not a free knob and it does not live alone. Changing it moves
four things, and on ep3 each one caught somebody out:

1. **The episode duration**, so `verify-episode.mjs --expect` needs the new
   value. Checking against the old one reads as an alarming 3.5s drift and
   stops a publish for no reason.
2. **The half-render split point**, which must stay on a scene boundary — ep3's
   moved from frame 6184 to 6135.
3. **The runtime label** in `lores.ts`, which is a user-visible string.
4. **Anything that hardcoded the old value.** `measure-ep3.mjs` had
   `Math.round(0.5 * FPS)` written into it, so once `TRANSITION` became 0.25 it
   reported an episode **105 frames shorter than the one that renders** —
   12,317 where the truth was 12,422. It now parses `TRANSITION` out of the
   manifest with a regex, because the script is node and the manifest is
   TypeScript.

That fourth one is the general lesson, and it is worth more than the specific
bug: a number that was derived once and then frozen as a literal is worse than
no number, because it keeps looking authoritative after it stops being true.
Grep for the old value before changing a constant that other files quote.

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

## Getting a FINISHED episode back the other way

**This is step 10 of `making-an-episode.md` and it was already written down.**
It is repeated here with the measured numbers because on the ep3 build it was
not read, and the cost of not reading it was telling the project owner the file
could not be handed over and asking Lovable to re-render forty minutes of work
that was already sitting on disk.

Three routes ARE closed, and finding three closed doors is what made "there is
no route" feel like a conclusion rather than a guess:

- the CDN 403s from the dev container,
- GitHub **release-asset upload is refused for this session type**, even though
  `git push` works and the release API reads fine,
- and a ~100 MB mp4 must not go into git, which is the whole reason the pointer
  architecture exists.

**The route that works:** `mcp__Lovable__get_file_upload_url` returns a presigned
URL on `storage.googleapis.com` — a different host from `*.lovable.app`, and one
the proxy permits. `PUT` the file with the three signed headers it returns, then
pass the `file_id` in the `files` array of `send_message`.

Measured: 104,714,510 bytes, HTTP 200, under seven seconds, against a 250 MB
limit in the returned `x-goog-content-length-range`.

Two lessons, and the second is the one that actually cost time:

1. Check this route BEFORE asking another machine to rebuild an artifact you are
   holding.
2. **Re-read the runbook step you are on before declaring it impossible.** The
   answer was in step 10 the whole time.

## Budget, so nobody starts blind

Episode 3 came out at **60 shots** for 6:54 of narration — 60 starting stills
*and* 60 video generations, sequential because of the concurrency cap, at ~100×
a text call each. Get one full scene working end to end before generating the
rest.

Budget ~8.5 shots per minute of finished episode. The naive 10s-per-clip figure
(43 for seven minutes) is about 30% low, because shots are allocated by weight
and none of them lands on the ceiling.

### What Episode 3 actually cost, as shipped

Plan against these rather than the estimates above; they are measured.

| | |
| --- | --- |
| Narration | 414.7s across 16 scenes, 986 words, 143 wpm |
| Shots | 60, for 6:54 of finished film |
| Generations | 60 stills + 60 clips, sequential |
| Conformed clips | 428 MB (7.1 MB average) |
| Raw generations | 970 MB (~12.4 MB each, 10.0417s at 24fps = 301 frames conformed) |
| Finished file | 12,422 frames, 414.08s, 100 MB at crf 28 (~2.0 Mbps) |
| Render, 4 cores | ~4.5 fps → ~45 min for a full pass |
| Render, 64 cores | ~5 fps single process; ~5 fps EACH for two parallel halves |

The render figure is the surprising one and it is worth internalising: a 4-core
box and a 64-core box render this at the same speed, because the bottleneck is
one ffmpeg encoder. Plan on ~45 minutes per pass and on needing several passes —
the ep3 build did five (control, re-cut, transition fix, coda fix, plus one
abandoned). Every fix after the first render cost a full pass, because there is
no partial re-render — budget for that rather than assuming the first render is
the last.

### What this pipeline does NOT cover yet

Written down because "we can make video now" is an easy thing to believe after
one episode ships, and three parts of it are not true.

**It starts from TEXT, not from a supplied image or video.** Every still is
generated from a prompt in `ep3Shots.ts`. Animating an image somebody hands you
is the Runway path, and `video_jobs` still has **0 rows** — it has never run.
There is no tested route from an uploaded attachment to a finished clip; the
`starting_frame` work documented here always begins from a still this pipeline
generated itself.

**"Any duration" has two hard ceilings, both around a quarter of an hour**, from
ep3's measured rates (~15 MB of finished video per minute, ~105 MB of raw clips
per minute, 8.5 shots per minute):

| limit | bites at |
| --- | --- |
| 250 MB presigned upload — the handoff route | **~16.5 min** of finished video |
| 2 GB per GitHub release asset — the raw bundle | **~19.4 min** |
| 2 GB per release asset — the conformed bundle | ~34 min |
| render at 0.15x realtime, several passes | 30 min of video = **3.3 h per pass** |

Past roughly a quarter of an hour the transfer routes need splitting into parts,
and past that the render needs a bigger machine or an overnight budget. None of
that is built. Below about a minute nothing is known either — the scene/narration
machinery has never been run that small, and the promo path may simply be the
better tool.

**The scripts are episode-3 shaped, not generic.** `measure-ep3.mjs` and
`measure-ep3-pauses.mjs` both hardcode `Array.from({ length: 16 })` and the
`ep3_sNN` naming; `render-ep3.mjs` and `ingest-ep3-clips.mjs` hardcode
`public/ep3`. A fourth episode with a different scene count means editing four
scripts, not re-running them. Parameterising on an `EPISODE` env var — the way
`build-bed-envelope.mjs` already does — is the obvious fix and has not been done.

### Still open on Episode 3

Recorded so nobody assumes the episode is finished business:

- **No music bed.** `audioDuck.ts` is already episode-agnostic; generate
  `public/ep3/bed.mp3`, export `BED_SECONDS`/`BED_LOOP_FRAMES` from the
  manifest, run `EPISODE=ep3 node scripts/build-bed-envelope.mjs`.
- **s01, the opening, is still fast.** 5.20 syllables per second against a mean
  of 4.41 — effectively tied with what the coda was before it was corrected. The
  film's two bookends were its two fastest scenes; only the ending has been
  fixed. Same one-line `atempo` change if anyone wants the opening to settle
  too.
- **Style outliers, from a contact-sheet review of all 60 shots.** s08b (ring
  jinni reads as flat gold filigree), s10b (lamp jinni reads as illustration,
  coolest palette in the film), the wide city mattes s11c/s11f/s12a/s12d/s15a/
  s15b (flatter, cooler, clustered in the third act), and s13a/s13b (hazy, read
  as underexposed). The verdict was "one film with outliers, not three" — but
  it was reached from STILLS, and the s08b/s10b fault is "differs in medium",
  which is a motion-domain problem a sheet cannot see. Treat as provisional.
- **s15 overstays.** Two near-identical palace vistas over 10.2s of narration,
  landing right before the coda where the film wants momentum.

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
