# The classic 60-second film — the recipe that actually works

OWNER DIRECTIVE, 2026-09-12: _"Learn, record and use it exactly for making
videos."_ This is that recipe, taken from a single measured run rather than
from anyone's memory of how the pipeline is supposed to behave.

**The run it is taken from**: job `a2c0788b`, GitHub Actions `story worker`
run **166**, 2026-09-12 09:47:08 → 10:00:12 UTC. Delivered
`stories/a2c0788b-….mp4`, 60.1s over 9 shots. It is the film listed in the app
as "INTERNAL MOTION TEST", and the name is the one misleading thing about it —
see the warning at the bottom.

## What it produces

Nine AI stills, each held for a few seconds under a Ken Burns camera move over
two parallax depth planes, with a dust VFX layer, per-shot director lighting,
in-house narration, and a film-look grade over the whole thing. **No generated
video anywhere.** The sense of motion is entirely camera and parallax.

## The exact switch state

This is the part to copy. Every value was read from the worker's own env dump
at 09:48:09, not inferred:

    STORY_MOVIE          (unset)   -> MOTION_STAGE=off. THE ONE THAT DECIDES.
    STILL_PROVIDER       (not passed in the workflow at all)
                                   -> DEFAULT_STILL_PROVIDER = "gateway"
    STORY_LOCAL_TTS      only      -> Piper, on the runner. No cloud voice.
    STORY_VOICE          Charon    -> present and UNUSED, because TTS is local-only
    STORY_ACTOR_REFS     on
    IN_HOUSE_MOTION      on        -> irrelevant while STORY_MOVIE is unset
    ONIQ_GPU_HEALTHY     on        -> irrelevant, same reason
    ONIQ_WORKER_IMAGE    on        -> irrelevant, same reason
    CONCURRENCY          2

    job row:  grade = movie   requested_seconds = 60   no_watermark = true

**`STORY_MOVIE` unset is not an oversight — it is the recipe.** Setting it is
what turns the motion stage on and takes you off this path entirely. The three
`on` switches beneath it look like they enable in-house motion and do nothing
while `STORY_MOVIE` is blank; do not read them as the state of the feature.

## The measured budget

Nine shots are derived from 60 seconds; you do not choose the count.

    PREPARE            147.8s   plot, 9 voice clips, 9 stills, depth, vfx
    PREFLIGHT            0.5s   timeline 60.0s vs 60s requested
    RENDER             555.0s   1800 frames in 387.2s (0.155x realtime)
                                + film-look grade 135.5s
    OUTPUT_VALIDATE      0.08s
    UPLOAD               3.8s
    FINALIZE             3.7s
    ------------------------------------------------------------------
    total              711.0s   ~11.9 minutes of wall time per 60s of film

Timeline split: narration 23.6s + visual hold 36.4s = 60.0s. The narration is
the clock; the hold is what the camera move fills.

Plan for **roughly twelve minutes of runner time per finished minute of film**,
and remember the whole job is one GitHub Actions job — a 300s film is not
twelve minutes, it is nearer an hour, and the runner has a job timeout.

## What it costs

    Lovable credits   9 gateway stills + 1 plot text call.  THE REAL COST.
    USD ledger        $0.00 — measured, zero rows in the render window
    GPU               $0.00 — the GPU is not on this path at all
    Veo / Runway      $0.00 — never called
    GitHub Actions    ~14 billable minutes for the render job
    user video-time   0 seconds charged

**The credits are invisible to every guard ONIQ has.** Gateway calls bill
credits, not dollars, so they write no `provider_spend_ledger` row, never touch
the `$100` TEXT ceiling, and raise no watchdog alert. On 2026-09-12 the pool
drained through the afternoon with no warning: cloud voice exhausted at 14:32,
image credits at 15:48, and the Lovable agent itself refused a message shortly
after. A film costs an unknown number of credits and you find out by a job
failing.

## Verifying a run did what you think

Read the worker's own line at the top of PREPARE. It is one grep and it names
all three facts:

    movie grade: MOTION_STAGE=off MOTION_PROVIDER=none MOTION_ENGINE=none
                 — stills and camera only (STORY_MOVIE unset)

and the contract at the end of PREPARE:

    MOTION_CONTRACT: 0 clip-validated, 0 rig-sourced, 0 failed, 9 fallback
    MOTION_CONTRACT: 9x no motion provider enabled (owner-gated)

Nine fallback of nine shots is this recipe running correctly. Anything else
means a different path ran.

## Two things this run also proved, worth not rediscovering

**`STILL_KEY=unnamed STILL_STORE=still-store-403` on every shot is expected
here and harmless.** The worker tries to put each gateway still into the
`oniq-gpu` bucket so in-house motion could animate it by key; the R2 credential
is not scoped to write that bucket, so it 403s. On this path nothing needs the
key, so the film is unaffected. It only matters the day you turn motion on.

**The job was dispatched twice** — runs 166 and 167 both fired at 09:47:07 for
one job. 167 found it already claimed and its render step lasted 2 seconds. Do
not read two runs as two films, and do not count the second one's minutes as
work.

## The name is wrong and the film is the proof

It is called "INTERNAL MOTION TEST" and it tested no motion: `gpu_video_jobs`
has no row for it, `provider_spend_ledger` has never had a `GPU` row, and the
contract says 9 fallback. **A film that renders is not evidence the engine you
meant to test ran.** Check the MOTION_CONTRACT line, not the Watch button.
