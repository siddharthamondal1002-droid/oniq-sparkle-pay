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

### Running them all, and checking what they proved

```bash
cd remotion
python3 scripts/dry_run_all.py               # all six, then check
python3 scripts/dry_run_all.py happy-path    # just one
python3 scripts/dry_run_all.py --check-only  # re-check the last run's logs
```

Sequential, because every scenario uses job id `dry-1` and they would clobber
each other's output — and Remotion already saturates the cores. Films and logs
land in `.tmp/dry-runs/`. About nine minutes for all six.

**The runs are not the check.** Each of these finishes with an exit code and, in
five cases, a playable film — which is not the same claim as "the ladder fired".
A dry run whose still step-down never triggered, or whose clip fixture threw and
quietly fell back to a still, prints an almost identical success. The clip stage
has been broken twice in exactly that way. So every scenario carries an
`_expect` block next to its `_why`, and the script enforces it:

```json
"_expect": {
  "exit": 0,
  "calls": { "still": 3, "voice": 4, "clip": 0, "plot": 1 },
  "log": ["voice retry in 30s", "piper carries the film"],
  "absent": ["story-voice #5"],
  "film": true
}
```

Adding a scenario means writing down what it proves, not editing the checker —
and `storyDryRun.test.ts` fails the build on a scenario that declares nothing.

**`absent` is the important half.** Several properties worth having are
observable only as a call that _did not happen_. `voice-quota-dies` scripts a
fifth voice answer that succeeds, and the worker must never ask for it: asking
would mean the Piper switch stopped holding and the remaining shots went back to
the metered cloud. There is no log line for that — only the absence of one.

`gateway-audio` gets the sharpest assertion available, `same_film_as`: its film
must be **byte-identical** to `happy-path`'s, since the only difference between
them is which branch of `voiceBytesToFile` runs. A double-wrapped wav still
plays — the outer header is valid — so "it rendered" proves nothing. The 44
header bytes decoded as samples are an audible click and a different encode, and
equality is the only assertion that catches it.

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
