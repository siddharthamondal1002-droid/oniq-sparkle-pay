# ONIQ-VEO-LITE-VS-FAST-v2 — INCOMPLETE, quota wall

Run 2026-08-24T03:07Z. **2 of 20 generations completed. ~$0.60 spent, not $6.**

```
attempted 20, produced 2, failed 18
outcomes: {"generated": 2, "submit_rejected": 18}
```

All 18 rejections: **HTTP 429 `RESOURCE_EXHAUSTED`** at submit, in 0.1–0.4 s —
the daily Veo quota on `GOOGLE_AI_API_KEY`. No retries were made, by design.

## What this run DID establish

- **The v2 clean inputs work.** All four frozen crop boxes produced single-pose
  720×1280 frames, and `c01_walk` generated on both models from them.
- **`raiMediaFilteredCount` capture is wired** but returned `null` on both
  successes, so it is **untested against an actual filtered result**.
- Both c01 clips tracked cleanly at 96 frames.

| clip                 | drift | hgrow | wchg | lo/up | off  | energy |
| -------------------- | ----- | ----- | ---- | ----- | ---- | ------ |
| `c01_walk__A` (Lite) | 0.041 | +0.05 | 0.35 | 1.53  | 0.18 | 10949  |
| `c01_walk__B` (Fast) | 0.029 | +0.13 | 0.49 | 1.71  | 0.29 | 16612  |

**Neither passes `centroid_x_displacement`** (0.041 and 0.029, min 0.060) — on
the clean input, _neither model walked the character across the ground_ on the
one case that ran. n=1 per model; that is an observation, not a finding.

## What it did NOT establish

**Nothing about Lite vs Fast.** One case out of ten, one generation each,
cannot separate two models. The v2 benchmark is **INCOMPLETE** and must not be
quoted as a comparison.

## The finding that matters more than the benchmark

`GOOGLE_AI_API_KEY` carries a **daily Veo quota**, and it was already near
exhaustion before this run — 21 generations across the day consumed it.

`story-clip` has **no 429 branch**: it handles 404, 400, 401/403 and a generic
`!ok → 502`. Quota exhaustion therefore reaches the worker as "Could not start
that clip", indistinguishable from a real fault — and any retry ladder above it
would burn attempts against a wall that does not move until the window rolls
over. **That is a production defect, found by accident, and it is independent
of the Lite-vs-Fast question.**

Completing v2 requires the quota window to roll over. That is an owner decision,
not mine, and the incomplete run is recorded here rather than quietly re-run.
