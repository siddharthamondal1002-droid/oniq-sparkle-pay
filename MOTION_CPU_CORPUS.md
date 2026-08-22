# MOTION_CPU_CORPUS — the 6-character generalization run (zero-GPU loop 2)

2026-08-22, in-container CPU, main `b96fd848`. Continues `MOTION_AMPLITUDE.md`
(the arm-damped fix) with the adversarial corpus, the graded-damping
falsification, the grammar probe, determinism, the production-validator
cross-check, and the measured eligibility envelope now encoded in
`src/lib/arapProvider.ts`.

## The corpus (existing approved sheet art only)

Auto-rig: `autorig_reference.py` stack (AD MaskRCNN + pose, CPU) with ONE
measured substitution — the classical AD threshold mask returned 100% fill on
ALL SIX painterly crops (it only ever worked on white-paper drawings), so the
silhouette mask is rembg u2netp, the fix proven on the Aladdin fixture.
Renders: zombie-walk driver, arm-damped retarget, ~500x500, 200 frames.

| character | adversarial trait | det | kpt mean/min | bbox fill | core joints off-mask | walk verdict (pixels) |
|---|---|---|---|---|---|---|
| aladdin (hand-rig) | control | — | — | 57.0% | none (elbow only) | **PASS** 0 artifacts |
| aladdin (auto-rig) | full-auto cross-check | 0.995 | 0.86/0.57 | 57.0% | none (hand only) | **PASS** 0 artifacts |
| morgiana | different style, akimbo arm | 0.992 | 0.87/0.67 | 51.7% | none | **PASS** 0 artifacts |
| mother | long robe, clasped hands, long sleeves | 0.991 | 0.81/0.54 | 74.8% | none | **FAIL** — edge-on sliver collapse |
| fisherman | elderly thin, raised arm | 0.983 | 0.78/0.39 | 53.4% | left_shoulder, left_foot | **FAIL** — crushed strip |
| magician | dark robes + staff prop | 0.894 | 0.77/0.54 | 60.2% | right_knee, right_foot | **FAIL** — pathological solve (300s+600s timeouts, no output) |
| lampJinni | nonhuman, no legs (smoke tail) | 0.998 | 0.74/0.47 | 67.3% | none | **FAIL** — body halved/folded |

Rig success rate: 7/7 produced a skeleton; walk success rate on pixels:
**3/7 clean, 4/7 fail** (2 distinct characters clean; aladdin counted once).

## Root-cause work (Phase 10 discipline — hypotheses recorded either way)

- REFUTED: "arm-damped mapping causes the collapse" — mother and fisherman
  collapse identically (mother worse) under the STOCK retarget.
- REFUTED: "any joint outside the mask predicts collapse" — the clean
  aladdin rigs each carry one non-core joint outside.
- SUPPORTED (n=6, provisional): two separable classes cover every failure —
  merged-blob silhouette (bbox fill > ~65%: mother 74.8, lampJinni 67.3 vs
  clean 51-57) and core joints (shoulder/hip/knee/foot) off the silhouette
  (fisherman, magician). Encoded as `arapCharacterEligible` with the corpus
  as test fixtures; thresholds are PROVISIONAL until a wider corpus.

## Graded damping FALSIFIED; wave FALSIFIED

- BVH arm rotations scaled toward frame 0 at s=0.6/0.4/0.2: all three pin
  the arms in the zombie clip's outstretched rest pose — wing-tent shirt +
  blades at every level (the driver's frame-0 IS the artifact pose). The
  binary hang-down mapping stays the only artifact-free setting.
- wave_hello + stock retarget: near-static output with the sleeve blade;
  the PRODUCTION gate itself scores it 0.51 < 0.75 → FROZEN→DISCARD. WAVE
  stays out of the grammar. The provider grammar remains WALKING only.

## Determinism, validator cross-check, performance

- Two independent renders of the same walk: **identical SHA-256**
  (`c56f9565d847…`). The pipeline is deterministic.
- The real `motionRuntime.temporalAliveness` over the corpus: clean walks
  7.49-8.57 ALIVE; wave 0.51 DISCARD — but the three collapses scored
  3.60-10.12 "ALIVE" too. **A changing-pixel metric is necessary, never
  sufficient** — `l3RenderQc`'s fill floor (4%) catches mother/fisherman
  (1.82%) blind, and the lampJinni fold class (7.24% fill) is caught only
  by the pre-render eligibility gate. Defense in depth is mandatory.
- Cost/perf (4-core reference container): 21.8-87.7 s per clip (scales with
  character pixel area), peak RSS 1.05-1.17 GB, GPU 0, API spend ₹0.
  Veo Select comparison: ₹12.6/s ≈ ₹100 per 8 s clip. CPU incremental cost
  is runner-minutes, not rupees: at GitHub's private-repo Actions rate
  (~$0.008/min, 2-core — slower than this 4-core reference) a clip is
  roughly ₹1-3 of runner time; on included minutes it is ₹0 marginal. The
  one-time env build (mmcv compiled from source, ~30-40 min) argues for a
  prebuilt runner image before any production wiring. Exact worker-runner
  pricing: UNKNOWN until the owner names the runner plan.

## The prospective round — the gate predicting BEFORE rendering

Three more cast characters were rigged, gated FIRST, and only then rendered:

- **princess** (long layered coat, clasped hands): fill 77.6% → gate REJECT,
  blob class. Rendered anyway as the validation: she collapses into the
  exact mother-class edge-on sliver. **The gate's prediction held on real
  pixels** — its first prospective confirmation.
- **captain** (bulky, dark boots on stone base): u2netp mask dropped the
  legs (5 core joints off-mask → REJECT); full u2net kept the stone base
  (78.8% fill → REJECT). SEGMENTATION_LIMITED — two measured mask attempts,
  both correctly rejected. Not rendered.
- **aliBaba** (woodaxe prop): left shoulder/arm off-mask → REJECT. Not
  rendered.
- **magician** second attempt at 600 s uncontended: killed at timeout with
  zero output. PATHOLOGICAL confirmed (900 s across two attempts vs
  22-88 s for every healthy render); consistent with its core-joints-off
  gate rejection.

Cast survey final: 9 sheet characters + 1 hand-rig assessed. Clean walks: 3
renders, 2 distinct characters. Every failure carries a measured, named
cause, and the gate rejected every character that failed or would fail.

## GENERALIZATION v2 (2026-08-22, main 2545ef43) — the root cause found

The corpus grew to 24 assessed inputs (6 MIT AD example drawings, the two
jinn sheets, four alternate/side poses, two ep4 production stills, plus
the v1 ten). What it found rewrites the v1 conclusions:

**THE BORDER-CUT ROOT CAUSE.** Every pathological outcome — five solver
hangs (adchar1, adchar2, ringJinni, fisherman_staff at 300 s; magician at
900 s) and the v1 sliver/fold collapses — had its mask CUT AT THE CROP
BORDER (>=3 edges touched; clean renders <=2; AD's own bundled rigs 0).
The tight detector-bbox crop was the defect. Proof chain: my border-cut
adchar2 rig hangs while AD's padded rig of the SAME drawing renders in
41 s with the same retarget; re-rendering the SAME rigs with a 24 px
margin fixed 8 of 10 pathological characters, including full intact walks
from mother (74.8% fill) and princess (77.6%) — **the v1 "merged-blob
fill > 65%" rule is FALSIFIED as a mechanism** (it proxied border-cut
robes). autorig_reference.py now pads every crop; the eligibility gate
enforces border non-contact, keeps core-joints-on-silhouette, adds the
measured rig-confidence floor (0.70: clean walks >= 0.77, the crushed
jarJinni 0.61, failed side views ~0.60), and retains fill only as a 90%
degenerate-segmentation ceiling. Also falsified and recorded: mask
boundary complexity as a hang predictor (perim²/area does not separate),
and single-model segmentation — the classical mask wins on white-paper
drawings, u2netp on painterly art; the pipeline now measures BOTH per
character and keeps whichever holds more core joints on-silhouette
(adchar1/2/4 go from 4-5 core joints outside to zero under classical).

**Confusion matrix (padded, best-mask, real pixels).** Admitted 11:
clean 9 — aladdin_auto, morgiana, adchar1 (the historic "char1 collapse"
now walks), adchar2, adchar3, fisherman_staff, and WITH LIMITS the robed
mother, princess, lampJinni (hem-sway walks; legless jinn sways — no true
gait to give). Residual false accepts 2: adchar4 (stick figure thinner
than the ~24 px mesh pitch — no cheap metric separates it yet; canary
human review is the backstop) and none other; jarJinni, ringJinni,
adchar5/6, side views, ep4s02 all correctly rejected or detector-refused.
Safe-direction false rejects: ringJinni (marginal-but-intact, conf 0.66)
and possibly magician (renders geometry-intact padded; conf/joints keep
it out — recorded as UNKNOWN quality).

**Frozen-path regression: 3/3 hash-identical** (aladdin hand + auto,
morgiana) after every experiment — the proven walks never moved.

**IDLE is the second pixel-passed grammar.** Derived deterministically
from the MIT walk by `bvh_idle_reference.py` (rotations scaled toward
frame 0, root pinned): s=0.10 FAILED the production aliveness gate (0.43 —
correctly discarded, recorded); s=0.25 passed pixels (aliveness 0.94,
grounded feet, stable identity, visible weight shift). WAVE remains
excluded (near-static + blade, 0.51). TURN/REACH: UNKNOWN, not attempted.

**Chaos, at the render level: 5/5 fail safely.** Empty mask, all-white
mask, impossible joint, missing mask, malformed motion path — every one
exits non-zero with no output file; with the provider contract's tested
miss handling, no garbage clip has a path into a film.

The acceptance standard for all of this is the owner-supplied reference
poster, translated to measurable terms in `docs/CPU_MOTION_VISUAL_SPEC.md`.

## Standing verdicts

Provider classification (this loop's Phase 11/19): **CHARACTER-DEPENDENT /
PROMISING** — real, deterministic, artifact-free CPU walking is proven on 2
distinct auto-rigged cast characters plus the hand-rigged control, and every
observed failure is caught by cheap measurable gates that resolve to the
mandatory still fallback. NOT production-ready: 2 clean characters is below
the ≥3 bar, thresholds are n=6-provisional, and the worker has no runner
host. All artifacts stay in scratchpad; no weights, no MP4s, no frame dumps
in git (working agreement).
