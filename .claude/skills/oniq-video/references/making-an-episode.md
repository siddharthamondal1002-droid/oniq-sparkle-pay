# Making an episode, end to end

The in-house generator, as actually used to build Episode 2 on 2026-08-08. It
is not a service and there is no button: it is a sequence of steps across two
machines, because the pieces live in different places.

**Who can do what.** The Lovable agent has image generation, text-to-speech and
a full ffmpeg. This container has the repo, Remotion, Chromium and a cut-down
ffmpeg. Neither can do the other's half, so the work alternates. Split it along
that line and say explicitly what the other side must not touch.

Episode 2 took eleven steps, three regenerations of the stills and two full
renders. Budget accordingly.

---

## 1. Write the scene list and the narration

`src/data/originals.ts` — one `Scene` per shot: `stillPrompt` (what the frame
IS) and `motionPrompt` (camera only). `src/data/originalsScript.ts` — one line
of narration per scene id. A test fails the build if the two ever disagree.

On the episode itself:

- `style` — omit for `HOUSE_STYLE`, or set `STORYBOOK_STYLE`. Read the long
  comment above `STORYBOOK_STYLE` before writing a new one; it records five
  faults and the exact wording that caused each.
- `cast` — appearance locks, keyed from each scene's `cast: [...]`. **Not
  optional for anyone who appears twice.** Nothing carries between images, so
  an uncast character is re-invented every single still.
- `bed` — the music prompt, so it can be regenerated.

**Keep any one scene under ~50 seconds of narration.** Past that the Ken Burns
move stops reading as motion and the shot looks frozen. `originalsScript.test.ts`
enforces it against the word-count estimate — before any audio exists, which is
what makes it cheap. Both season finales busted it and were split into the beats
their paragraphs already contained.

## 2. Generate the stills → Lovable

1080×1920, one per scene, into `remotion/public/<ep>/<ep>_sNN.jpg`.

Tell it to read each prompt from `stillPromptFor(scene)` rather than composing
its own — that function resolves style + scene + cast locks, and hand-assembly
is how the three of them drift apart.

**Probe with two images before paying for the full set.** Pick the two extremes
— for Ali Baba that was the lamplit cavern (does the look have depth?) and the
hard-midday hillside (did the palette drag it toward night?). Two images answer
the question that fourteen would.

## 3. Generate the narration → Lovable

`openai/gpt-4o-mini-tts`, voice `ash`, into `remotion/public/<ep>/<ep>_sNN.mp3`.
Text from `narrationFor(sceneId)`, unedited.

**Same voice across the season.** The art may change between episodes; a new
narrator reads as a different show.

## 4. Measure, and write the manifest

```bash
for f in remotion/public/<ep>/*.mp3; do ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"; done
```

Those measured seconds go into `remotion/src/<ep>/manifest.ts`, with a `zoom`
and `pan` per scene following each `motionPrompt`. **Never the word-count
estimate** — it drifts further out of sync with every scene.

Cross-check each measured duration against its own word count. A ratio far from
1.0 means a truncated or mismatched render. Episode 2's sixteen all landed
between 0.88 and 1.18.

## 5. Generate the music bed → Lovable

Into `remotion/public/<ep>/bed.mp3`, from the episode's `bed` prompt.

- **Ask for ≥90 seconds.** A 30s clip means ten loop seams in a five-minute
  episode.
- **Choose the instrument for the mix, not the setting.** Percussive transients
  punch through a duck; sustained textures do not.
- Then **trim the generated fades off**, losslessly, or the loop point drops the
  music into a hole:
  ```bash
  ffmpeg -ss <after the fade-in> -t <length> -i bed.mp3 -c copy bed-trimmed.mp3
  ```
  Episode 2's arrived with a 6s fade-in and a fade-out to −50 dB: a 27.8 dB seam,
  fixed to 3 dB by trimming 173.7s → 166.0s.
- Put the measured length in the manifest as `BED_SECONDS`; the envelope builder
  throws if it drifts from the real file.

## 6. Build the ducking curve

```bash
cd remotion && EPISODE=<ep> node scripts/build-bed-envelope.mjs
```

Writes `src/<ep>/bedGain.json`: one gain per frame, calibrated from the measured
loudness of both the bed and the narration. Read its output — `narration
detected in N% of frames` should match how much of the episode actually talks.
30% for a continuously narrated episode means the detector is mis-calibrated,
not that the episode is quiet.

Re-run after **any** change to the narration or the manifest.

## 7. Write the composition

`remotion/src/<ep>/<Episode>.tsx`. Copy Episode 2's and change the ids. The four
things that must survive:

- `<Audio src={staticFile(...)}/>` **inside every scene Sequence** — the
  narration. Episode 1 shipped with twelve mp3s generated and none mounted.
- The bed at the **root, outside `TransitionSeries`** — inside, it restarts at
  every scene boundary.
- `<Loop durationInFrames={BED_LOOP_FRAMES}>`, **never `<Audio loop />`** — the
  bare attribute type-checks and the renderer ignores it.
- `loopVolumeCurveBehavior="extend"` — otherwise the duck curve restarts each
  loop and ducks against narration that is not there.

Register the composition in `remotion/src/Root.tsx`.

## 8. Render

`remotion/bun.lock` names Lovable's private npm mirror, which 403s elsewhere, so
install in a scratch directory against the public registry:

```bash
cp -r remotion "$SCRATCH/build" && cd "$SCRATCH/build"
rm -f bun.lock package-lock.json .npmrc
npm install --registry=https://registry.npmjs.org --no-audit --no-fund
OUT="$SCRATCH/<ep>.mp4" CONCURRENCY=4 node scripts/render-<ep>.mjs
```

**The Google Fonts problem is fixed and no longer needs a hand-edited Root.**
`remotion/src/index.ts` registers the promo, the promo imports `theme.ts`, and
theme.ts calls `@remotion/google-fonts` `loadFont` **at module scope** — so
bundling the promo alongside an episode makes headless Chromium fetch Space
Grotesk the moment the composition is evaluated, which dies behind the proxy
with `ERR_CERT_AUTHORITY_INVALID` and surfaces as a bare `NetworkError: A
network error occurred` from `selectComposition`. It reads like a Remotion fault
and is not one.

`remotion/src/episodes.ts` is an episodes-only entry point and all three render
scripts already use it. Episodes draw no text and need no remote font. **Never
fix this by disabling certificate verification.**

~10,000 frames takes about 45 minutes. Run it in the background.

`crf: 28` and `audioBitrate: '128k'` are already in the render script and are
not cosmetic: the h264 default produced 330 MB for 4m47s, which cannot stream on
4G. Episode 2 is 33 MB for 5m35s.

## 9. Verify the render before anyone sees it

Size and duration prove nothing about the audio. Check:

- two streams, h264 + aac, and the aac carrying a real bitrate
- per-second RMS across the whole file: no stretch below −45 dB, and no step at
  the bed's loop point
- **an A/B render** if a layer's presence is in doubt — same frames with and
  without it, subtracted. Sample **both sides** of the bed's length; the first
  A/B on Episode 2 ran past it, returned zero, and produced a wrong conclusion.

## 10. Upload and wire up

`get_file_upload_url` → `PUT` the mp4 → hand the `file_id` to the Lovable agent
and ask it to register the asset. Then, yourself:

- add the episode to `RENDERED` in `src/data/lores.ts`, with the **measured**
  runtime
- add its provenance to the comment block at the top — what made it, and from
  what

## 11. Publish, then prove it

`deploy_project`, **after** confirming `latest_commit_sha` has caught up. See
the `oniq-ship` skill: an asset returning 200 is not the same as the page
linking to it, and this exact conflation produced a false "it's live".

---

# The video variant — Episode 3 and after

Episodes 1 and 2 are stills under a Ken Burns move. Episode 3 is real generated
video. Most of the eleven steps above are unchanged; these are the differences,
and `references/assembling-generated-clips.md` is the design behind them.

**Steps 1, 3, 4, 9, 10 and 11 are identical.** The narration is still the clock.

**Step 2 splits in two.** Write a SHOT LIST first — `src/data/ep3Shots.ts` — one
entry per clip, because Veo caps a clip at 10s and a scene runs thirty or forty.
Budget **~8.5 shots per minute** of finished episode; the naive 10s-per-clip
figure is about 30% low, because shots are allocated by weight and none lands on
the ceiling. Episode 3 is 60 shots for 6:55.

Then: a still per SHOT, and a clip per shot generated image-to-video from that
still as `starting_frame`. Not text-to-video — the probe proved Veo ignores the
style prompt entirely and returns cel-shaded anime.

**Most shots should have no face in them.** Coverage, not repeated takes. 39 of
Episode 3's 60 are hands, objects, skies and crowds, and that is the whole
character-consistency strategy.

**Step 6 has no equivalent yet.** Episode 3 ships without a music bed. Adding
one needs nothing new: `audioDuck.ts` is already episode-agnostic.

**Step 7 gains a second layer and loses the camera.** Outer `TransitionSeries`
cross-fades SCENES; an inner one HARD CUTS the shots inside each scene. **No Ken
Burns** — the motion is inside the clip, and a camera move on top is two cameras
fighting.

**Two steps are new:**

```bash
cd remotion
node scripts/measure-ep3.mjs                       # after 4, prints the manifest
bun scripts/ingest-ep3-clips.mjs --from <raw dir>  # before 8
bun scripts/ingest-ep3-clips.mjs --check
```

Ingest fixes all four things wrong with every clip the generator returns —
invented soundtrack, 1088 not 1080, 24fps not 30, and ~10.04s not the
allocation — in one pass, because four passes is four chances to skip one.

**Expect the shot split to refuse to load when the real durations land.**
`src/ep3/shots.ts` throws at module scope if any shot falls outside 1.5–10s, and
on Episode 3 three scenes overflowed and each needed one more shot. That is the
guard working: it fires before a single generation is paid for, and the fix is
local.

**The transfer problem, unsolved.** Sixty clips is over a gigabyte, the repo
rejects anything above 10 MB, and `oniqhub.com` and `*.lovable.app` are both 403
at this container's proxy — so clips generated on Lovable's box cannot be pulled
here. Either they get conformed small enough to commit, or Lovable renders.
Settle this BEFORE generating sixty clips, not after.
