# remotion — the Story renderer

This directory is the video half of the Story pipeline: the Remotion
compositions and `scripts/story-worker.mjs`, the worker that GitHub Actions
runs to turn one queued job into one finished mp4.

The worker is plain Node with no build step, deliberately. It runs on a CI
runner where the dependency tree is the thing most likely to break, so it has
almost none — three REST calls over `fetch` rather than a client library.

## Dry run — the whole pipeline with the money taken out

```bash
cd remotion
STORY_FIXTURES=fixtures/story/happy-path node scripts/story-worker.mjs
```

That renders a **real film** through the **real worker**: the real still
step-down ladder, the real voice retry and Piper fallback, the real Remotion
render and the real ffmpeg assembly. What it does not do is touch the network.
The finished mp4 lands in `.tmp/dry-<job id>.mp4` so you can watch it.

Until this existed there was no way to test the engine without paying for it.
Runs 65, 66, 67, 69 and 73 each taught us something at full price, and the
lesson is what the scenarios below encode.

### The scenarios

Each directory under `fixtures/story/` is one JSON file describing the job, the
plan, and how each generation call answers, in order. Every one carries a
`_why` naming the production incident it reproduces.

| Scenario           | What it proves                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `happy-path`       | Every call answers first time; a complete film comes out the far end.                    |
| `still-refused`    | Two 422 refusals, then the third ask lands — the documented three-rung step-down.        |
| `voice-quota-dies` | Four 502s on 30/60/90s backoff, then Piper carries the film **and stays switched**.      |
| `gateway-audio`    | A container mime (`audio/wav`) passes through unwrapped instead of being double-wrapped. |
| `no-sample-rate`   | A mime with no `rate=` kills the job with no ladder able to catch it. Reproducing a bug. |
| `clip-refused`     | The clip stage: one 422, one retry, then the poll loop and real motion in the film.      |

`clip-refused` is the only one that needs a flag, because the clip stage is
gated on more than the grade:

```bash
STORY_FIXTURES=fixtures/story/clip-refused STORY_MOVIE=on node scripts/story-worker.mjs
```

`voice-quota-dies` waits out its real backoff, so it takes about three minutes,
and `clip-refused` polls on a real 10s interval. The rest are about a minute
each, nearly all of it Remotion rendering.

Read the run's closing call ledger, not just its last line. Several of the
properties worth having are provable only from a call that **did not happen** —
`voice-quota-dies` scripts a fifth voice answer that succeeds, and the worker
never asks for it, which is how you know the Piper switch held for the
remaining shots rather than drifting back to the cloud.

Selection is **by call ordinal, not by content**, which is what makes a ladder
scriptable — a retry of the same shot consumes the next entry. A list shorter
than the number of calls repeats its last entry, so a fourteen-shot film needs
one line rather than fourteen.

### It refuses to run against anything real

A dry run **has** no credentials — not "ignores the ones it has". With
`SUPABASE_SERVICE_ROLE_KEY` or `STORY_JOB_TOKEN` in the environment it stops
before doing anything:

```
STORY_FIXTURES is set and so is SUPABASE_SERVICE_ROLE_KEY. A dry run must not
be able to reach production at all — it claims no job, writes no row and
uploads nothing. Unset the credential, or unset STORY_FIXTURES.
```

That guard is not decoration. An earlier version of this seam stubbed only the
three billable calls, which meant a dry run with a service key present would
claim a **real queued row**, fill a paying user's film with synthetic PNGs and
sine tones, upload it and mark it ready. Every other route out of the
process — the claim, the status writes, the RPCs, the upload, the callback —
is now stubbed at its own head, and `src/lib/__tests__/storyDryRun.test.ts`
fails the build if any function that calls `fetch` loses its guard.

`STORY_FIXTURES` and `PLAN=` are refused together: `PLAN` renders a plan from
disk down a branch that makes no generation calls at all, so pairing them would
silently exercise nothing.

### Assets are synthetic, not recorded

The stills are procedurally drawn PNGs and the voices are generated tones —
nothing here is a capture of anyone's film. That is a privacy decision, not a
convenience one: the Story lifecycle promises every path ends in `purged`, and
a `fixtures/` directory somebody later commits is the one place that guarantee
would quietly stop holding.

## Rendering a composition directly

```bash
npx remotion studio          # the visual editor
PLAN=path/to/plan.json node scripts/story-worker.mjs   # render a plan from disk
```
