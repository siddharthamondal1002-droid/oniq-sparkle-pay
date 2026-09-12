# The classic 60-second film — the recipe that actually works

OWNER DIRECTIVE, 2026-09-12: _"Learn, record and use it exactly for making
videos."_ This is that recipe, taken from a single measured run rather than
from anyone's memory of how the pipeline is supposed to behave.

**The run it is taken from**: job `a2c0788b`, GitHub Actions `story worker`
run **166**, 2026-09-12 09:47:08 → 10:00:12 UTC. Delivered
`stories/a2c0788b-….mp4`, 60.1s over 9 shots. It is the film listed in the app
as "INTERNAL MOTION TEST", and the name is the one misleading thing about it —
see the warning at the bottom.

**REPRODUCED 2026-09-12 18:29 UTC as run 170**, job `b8754257`, same prompt and
same cast refs, on the credits the owner had just topped up. Identical motion
contract (`9 fallback`), identical timeline (60.1s over 9 shots), 22.7 MB
delivered. So this is no longer one run's anecdote: the two runs disagree about
NOTHING except wall time, and that disagreement is recorded in the budget below.

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

**THE JOB ROW IS WHAT SETS `STORY_MOVIE`, THROUGH `story_jobs.motion_mode`.**
`story-dispatch` maps the row onto the dispatch payload, so the path is chosen
per film rather than by a repository variable:

    motion_mode = 'in_house'  ->  story_movie "select" + in_house_motion true
    motion_mode = 'select'    ->  story_movie "select"
    motion_mode = anything else, NULL included  ->  no story_movie
                                                ->  MOTION_STAGE=off

So **NULL is the classic recipe**, and this is the one place copying run 166
misleads: its row says `in_house` while its own env dump says
`STORY_MOVIE (unset)`, because that mapping landed AFTER it dispatched.
Copying that ROW today reproduces the row and not the run — it sends the film
down the GPU path that failed twice on 2026-09-12
(`CheckpointInconsistent`). Run 170 was dispatched with `motion_mode` NULL and
matched run 166 stage for stage. **Reproduce the RUN's measured env, never the
row that happened to precede it.**

**`STORY_MOVIE` unset is not an oversight — it is the recipe.** Setting it is
what turns the motion stage on and takes you off this path entirely. The three
`on` switches beneath it look like they enable in-house motion and do nothing
while `STORY_MOVIE` is blank; do not read them as the state of the feature.

## The measured budget

Nine shots are derived from 60 seconds; you do not choose the count.

    stage              run 166    run 170
    PREPARE             147.8s     133.8s   plot, 9 voice clips, 9 stills,
                                            depth, vfx
    PREFLIGHT             0.5s       0.5s   timeline 60.0s vs 60s requested
    RENDER              555.0s     307.4s   1800 frames at 0.155x vs 0.298x
                                            realtime; grade 135.5s vs 84.4s
    OUTPUT_VALIDATE       0.08s      0.07s
    UPLOAD                3.8s       5.0s
    FINALIZE              3.7s       1.1s
    ---------------------------------------------------------------------
    total               711.0s     447.9s   11.9 min vs 7.5 min per 60s film

Timeline split: narration 23.6s + visual hold 36.4s = 60.0s. The narration is
the clock; the hold is what the camera move fills.

**THE RENDER RATE IS THE RUNNER'S, NOT ONIQ'S — it swung 2x on identical
work.** 0.155x realtime against 0.298x, and the grade 135.5s against 84.4s, for
the same 1800 frames from the same prompt with no change in this repository
between them. So size a film against the SLOW figure and read the fast one as
luck: **~12 minutes of runner time per finished minute**, never 7.5. A 300s
film is nearer an hour than half of one, and the whole job is ONE GitHub
Actions job with a job timeout.

The Piper voice cache is the rest of the gap: run 166 MISSED and wrote 504 MB
after the render, run 170 logged `Cache hit … not saving cache` and paid none
of it. The first film after a cache eviction pays that again.

## What it costs

**3.26 Lovable credits for one 60-second film**, at $0.30 a credit — so **$0.98
a film, about $0.0163 per second of finished video**. Given by the owner
2026-09-12 and recorded AS GIVEN, the way the Google model prices are: nothing
in this container can read a credit balance, so the figure is not independently
measured here.

    Lovable credits   3.26  ->  $0.98     9 gateway stills + 1 plot text call
    USD ledger        $0.00 — measured, zero rows in the render window
    GPU               $0.00 — the GPU is not on this path at all
    Veo / Runway      $0.00 — never called
    GitHub Actions    $0.00 — the repository is PUBLIC, so Actions minutes
                      are free. The usage API reports billable 0 ms on runs
                      166, 167 and 170; an earlier "~14 billable minutes"
                      here was inferred from wall time and is corrected.
    user video-time   0 seconds charged

**KNOWING THE NUMBER DOES NOT MAKE IT VISIBLE.** Gateway calls bill credits,
not dollars, so they write no `provider_spend_ledger` row, never touch the
`$100` TEXT ceiling, and raise no watchdog alert. The $0.98 above is the
owner's arithmetic, not a reading ONIQ can take: a run's cost is knowable only
by asking them. On 2026-09-12 the pool drained through the afternoon with no
warning — cloud voice exhausted at 14:32, image credits at 15:48, and the
Lovable agent itself refused a message shortly after.

**AND THE BALANCE IS BEHIND A PAYWALL THAT IS ITSELF EMPTY.**
`credits--get_my_usage` runs inside an agent turn, and an agent turn costs
credits; `get_workspace` promises a balance in its own description and returns
none — confirmed twice. So "how many films can ONIQ still make" cannot be
answered from here at all, only "what one costs".

**NO COMPARISON IS DRAWN WITH THE MOTION PATH, DELIBERATELY.**
`story-worker.mjs` records Veo Fast 720p with Audio from the August billing
export at **Rs 9.56 per second of generated video**, and this recipe is
**$0.0163 per second of finished film**. Those are different currencies, and
this repo stores no exchange rate on purpose — the ledger is USD and FX never
reaches a decision (owner directive 2026-08-24). Quote each with its own source
and leave the ratio to whoever holds a rate and a date.

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
