# BATCH 5 REPORT — hole matrix, mesh density, and the ARAP hang root cause (2026-08-23)

## Headline

The two failure classes Batch 4 exposed are now both explained, and one of
them is fully cured with a proven one-line-class fix:

1. **The "solver hang" is not geometry. It is an upstream AnimatedDrawings
   bug** — an unbounded singularity-repair loop whose exit condition can
   never fire: `while np.linalg.det(M) == 0.0` on a ~2,450² float32 matrix
   (det universally under/overflows at that size; measured: EVERY character
   enters the loop) with a `+= 1e-8` diagonal perturbation that is below
   float32 ulp for the w²=10⁶-scaled pin rows. Healthy characters escape
   after ~1 iteration (measured: aladdin k=1); b4_short_woman's A2 matrix
   never escapes → infinite O(n³) loop. Every geometric predictor tested —
   interior-hole size/count (7-variant generated matrix, holes up to
   1,870 px, ALL rendered), contour complexity, min limb width, vertex
   count — is falsified; the trigger is float32 determinant roulette.
2. **The thin-limb merge is mesh-pitch-limited and fixable by density** —
   with a measured boundary: fine mesh rescues thin SOLID limbs, not thin
   INK STROKES.

## SS15 mesh-density series (urchin fixture; AD copy, primary untouched)

| grid | pitch | render | RSS | legs at f100 |
|---|---|---|---|---|
| 30 | ~32 px | 37.1 s | 1125 MB | fully merged strand |
| 40 (today's default) | ~24 px | 38.4 s | 1133 MB | merged (known STRESS FAIL) |
| 60 | ~16 px | 43.4 s | 1153 MB | two legs, partial contact |
| **80** | **~12 px** | **55.1 s** | **1179 MB** | **clean two-leg separation, distinct feet, no tears** |

Aliveness 5.70 ALIVE at 60/80. Corroboration on adchar4: grid 80 does NOT
rescue 2–4 px ink strokes (still ghosts) — the thin-STROKE class stays
STRESS_FAIL. Cost of grid 80: +44% render time, +4% RSS.

## SS14 interior-hole matrix (7 generated variants, one controlled base)

All 7 rigged ELIGIBLE (conf .85-.89) and ALL rendered in 27-39 s — zero
hangs, including maxHole 1,870 px (longskirt), 973 px + 8 px min-width
(small), and the robe (border-reject in gate, rendered for observation).
Combined with the contour-complexity measurement (hang case: 962 outline
points — SIMPLER than clean basma's 1,913), this kills the entire
"interior mask hole" hypothesis. Recorded per SS25 of the master loop.

## The hang root cause — proof chain

1. Stage-instrumented headless build: mesh (1,227 verts) 0.7 s, joint-map
   2.0 s, retarget 1.2 s, then **ARAP.__init__ never returns**.
2. Source: `arap.py` singularity check (above).
3. **Fix A (falsified by pixels):** float64 slogdet check, skip ineffective
   perturbation → healthy path changes ~19k px/frame AND the rescued
   character collapses into a spike-star. The perturbations are
   load-bearing. Rejected.
4. **Fix B (WINNER): identical semantics, bounded iterations (k ≤ 100).**
   - Healthy path: aladdin renders **byte-identical** to the per-host
     control hash (a60f80b7…), k=1 — zero behavior change.
   - Hang case: A1 k=1, A2 k=100 (capped), renders in 36 s, and the
     decoded pixels are a REAL clean walk — identity intact, legs stepping
     naturally below the skirt, aliveness 5.45 ALIVE.

**Recommended production change (owner approval item f):** apply Fix B to
ONIQ's vendored AnimatedDrawings at runner provision (also worth an
upstream PR to facebookresearch/AnimatedDrawings). It is fail-safe: no
character that renders today changes by a byte; characters that today hang
forever instead render and face the normal pixel gates.
b4_short_woman reclassifies HOLD → PRODUCTION_CANDIDATE-pending-fix.

## SS mesh-density + hole matrix classifications

hole_small/medium/large/large_thinankle/longskirt/thinlimbs: STRESS_TEST
(all render; library topology references). hole_robe: STRESS_TEST,
gate-rejected (border) — correct. b5 production trio
(winter_man / layered_woman / older_child): pipeline in flight; results in
CLASSIFICATION.json rev 2.

## 100×100 program status (owner-approved FULL PROGRAM)

- Cost decision: owner selected "Full program now" with the estimate
  150–500 credits / ~1,200–1,600 generated masters in view.
- Round M1 (modern characters, 12) generated + bridged; two flagged by the
  generator for faint brand-like shoe marks — under review, regeneration
  candidates per the no-logo rule.
- Persistent bridge fetch-lib.yml registered on main for the program
  (dispatch-only, inert; removed at program end).
- All four new reference posters registered (d9b2f4f4, b6f68a5d, 56f67289,
  ec0c1c06) beside the earlier five; determinism policy untouched
  (DETERMINISM_SCOPE = PER_HOST / PER_CPU_CLASS; both hash sets kept).

## Costs and safety

Two generation messages this batch (b5 10 images, m1 12 images); ₹0
GPU/API; production main behaviorally unchanged (bridge files only);
PR #83 and 457598ad untouched; no gate weakened; frozen fixture hashes NOT
re-baselined; primary AnimatedDrawings checkout byte-untouched (all solver
work in the AD_meshx experiment copy).
