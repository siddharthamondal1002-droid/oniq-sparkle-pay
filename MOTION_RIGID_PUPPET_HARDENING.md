# L3R output-driven hardening (Phase 11)

Phase 10 reported "HAND: PASS". **That was wrong.** Reviewing the actual
`storyfilm_l3r_shot.mp4` frame-by-frame, the hands carried **dark-blue triangular
"blade" artifacts**. Honest Phase-10 status should have been **FAIL_WITH_LIMITS /
NOT production-eligible**. This phase found the root cause, fixed it, added a
fail-closed gate + regression test, ran a multi-character sweep, and regenerated
the real proof. **GPU=0, API cost ₹0, no VACE, no Veo, no full movie.**

## A. Root cause

The artifact is **upstream in part extraction, not deformation.** Phase 10 built
parts by pure voronoi-over-bones with the hand segment **extrapolated INTO the
body** (`beyond(elbow, hand)`). Aladdin's hands rest at the waist, right over the
**dark-blue pants**, so those pants pixels were **closer to the hand/forearm bone
than to the thigh bone** and got assigned to the hand parts. Rigid FK then swung
that contaminated geometry — a narrow, low-fill triangular shape — as the "blade".
Measured on the contaminated parts: perpendicular-corridor overflow ≈ 26–32%,
right-hand fragmentation ≈ 31%, bbox fill as low as ≈ 22%.

## B. Fix (files / functions)

**Extraction (reference engine `remotion/scripts/l3r_puppet_reference.py`):**
1. **Tight per-bone corridors** — a pixel may join a limb only within a
   perpendicular cap ≈ the limb's real thickness (arms 42px, legs 66px, hand/foot
   discs 46/58px); anything beyond falls to the **torso** (drawn underneath,
   safe). This is what excludes the pants (they sit outside the thin arm corridor).
2. **No hand-tip extrapolation** — the hand is a short capped stub at the wrist
   *along the forearm only*, never reaching down into the pants.
3. **Keep-largest-component** per limb part (drops a stray speck; invents nothing).
4. **Hand/forearm structural validation** (geometric only — no colour/identity
   hard-coded): `outsideCorridorFrac`, `fragmentFrac`, `bboxFill`; any part that
   fails ⇒ `PART_EXTRACTION_UNCERTAIN` and the script exits without rendering.

**Router / contract (`src/lib/motionProvider.ts`):**
- `rigidPartHealthy(metrics)` — the same gate in TS: `outsideCorridorFrac ≤ 0.06
  && fragmentFrac ≤ 0.15 && bboxFill ≥ 0.30`. Thresholds justified by the measured
  contrast (contaminated ≈0.30/0.31/0.22 → **reject**; fixed 0.0/0.0/0.58–0.87 →
  accept).
- `rigidPuppetEligible` gains `handsHealthy`; false ⇒ `PART_EXTRACTION_UNCERTAIN`
  ⇒ escalate to L4, never a broken puppet clip.

## C. Before/after evidence (real Aladdin still + zombie.bvh, CPU)

| Region | Phase 10 | **Phase 11** |
|---|---|---|
| Hands | dark-blue triangular **blades** every frame | **clean skin, blades gone** |
| Corridor overflow (arm/hand parts) | ≈ 0.26–0.32 | **0.00** |
| Fragmentation (hand_r) | 0.31 | **0.00** |
| bbox fill (hands) | as low as 0.22 | **0.58–0.87** |
| Claw (ARAP) | resolved (Phase 10) | resolved |
| Residual | — | minor joint seams / slight hand detach on large swings |

Regenerated real StoryFilm shot: `probeAsset` PASS (4.48s ≥ 4.4s) → `'story'`
composition → **1080×1920, 132 frames**, title card + watermark, no fallback.
Frame-by-frame of the composited output: **no blue blades**; hands recognizable;
legs stride; identity stable. Residual minor joint seams remain.

## D. Regression tests

Motion suite **61 → 63** tests (all pass). New, tied to the exact failure:
- `rigidPartHealthy(contaminated hand {0.30,0.31,0.22})` → **false** (would catch
  the `storyfilm_l3r_shot.mp4` artifact); `rigidPartHealthy(fixed {0,0,0.68})` →
  true; per-axis fail-closed.
- unhealthy hands ⇒ `rigidPuppetEligible` false ⇒ `PART_EXTRACTION_UNCERTAIN`.

## E. Runtime (measured, CPU)

Part extraction + validation ≈ 2 s; 149-frame 720×1280 render ≈ 120 s wall
(~115 s CPU), peak RSS ≈ 2.0 GB, ≈ 1.2 fps. GPU 0, ₹0. (Per-part full-canvas
warpAffine dominates; a tighter per-part bbox warp is the pending optimization —
deliberately NOT applied yet so diagnostics stay intact per the directive.)

## F. Multi-character sweep (real ONIQ sheets, CPU, same zombie.bvh)

| Character | Auto-rig | Hand health | Classification |
|---|---|---|---|
| aladdin (male, tunic+pants) | ok (det 0.99) | healthy (fill 0.65) | **PASS_WITH_LIMITS** (rendered + inspected) |
| morgiana (female, tunic) | ok | healthy (fill 0.52) | **PASS_WITH_LIMITS** (rendered + inspected — no blades; minor seams) |
| captain (different silhouette) | ok | healthy (fill 0.62) | **EXTRACTION_OK** (part validation passed; not visually rendered) |
| mother | **auto-rig found no humanoid** | empty parts | **PART_EXTRACTION_UNCERTAIN → escalate L4** |

3/4 extract cleanly with healthy hands; the 4th correctly **fails closed** and
escalates rather than shipping a broken puppet. The corridor fix + health gate
generalise across body types / clothing; the fail-closed path fires on the
character the pipeline can't process.

## G. L3R eligibility rule (implemented, evidence-based)

L3R runs only when ALL hold (`rigidPuppetEligible`, fail-closed):
single character · full/near-full body · **all parts extracted** · **hands healthy**
(`rigidPartHealthy` on every hand/forearm) · in-plane motion (not out-of-plane) ·
unoccluded. Each axis is justified: hand health from the measured contamination
contrast; the rest from Phase 6–10. Thresholds are the measured split, not invented.

## G′. Router behaviour (fail-closed)

- **eligible L3R** → run the CPU rigid puppet (ordering: pose-warp → **rigid-puppet**
  → diffusion → premium).
- **uncertain extraction / unhealthy hands** → `PART_EXTRACTION_UNCERTAIN` → L4.
- **out-of-plane** → L4 (2D puppet can't foreshorten).
- **occlusion** → L4.
- **multi-character** → L4.
- **L4 unavailable** → L3/L3R only if eligible, else the **still/depth** path —
  never a torn/contaminated L3R clip (`runMotion` never ships a still-as-clip).

## H. Final verdict

**L3R = PASS_WITH_LIMITS.** The reported failure (dark-blue triangular hand/forearm
blades from pants contamination) is **RESOLVED** in the regenerated MP4, a
fail-closed health gate now rejects any recurrence, and the sweep shows the fix
generalising with correct escalation. It is **not** a clean PASS: minor joint
seams / slight hand detachment remain on large swings, so L3R stays **NOT
globally enabled** and the router stays fail-closed. Not on main; L4 provider and
the security token-mask unchanged.

**NEXT STEP (one action):** optimize the compositor (tighter per-part bbox warp to
cut the ~120 s/clip and reduce the seams via better joint patches), then re-sweep;
only after seams are measured within an explicit acceptable band consider a
production-wiring proposal for the owner.

---

## Phase 12 — continuous hardening loop (iterations)

Baseline (real Aladdin + zombie.bvh, CPU): render ~120 s / CPU ~115 s / RAM
~2.0 GB / ~1.2 fps; seam metric `holes_mean` 4237 px, `components_mean` 3.62,
`extra_comp_frac` 0.87 (`remotion/scripts/l3r_seam_score_reference.py`).

**Iteration 1 — compositor per-part-bbox warp (P3, KEEP).**
`warpAffine` is O(output size); the compositor warped each part into a full
720×1280 canvas 14×/frame. Now each part warps into only its transformed bbox.
- BEFORE: 120 s / 115 s CPU / 2.0 GB / 1.2 fps.
- AFTER: **~43 s / 39 s CPU / 1.86 GB / ~3.4 fps (2.7×).**
- Output **pixel-equivalent** to the pre-opt render (mean abs diff 0.017,
  sub-pixel) — no quality change, hands still clean, fail-closed validation
  unchanged. **DECISION: KEEP** (commit `5c63c288`).

**Iteration 2 — uniform joint overlap 11→18 (P2, REVERT).**
Goal: close seams / reduce hand-detach. Health gate stayed clean (far_frac ~0,
no contamination) at 14/18/22, but the seam metric got WORSE on detachment:
- overlap 11 (baseline): holes 4237, components 3.62, extra 0.87.
- overlap 18: holes 4070 (slightly better) but **components 5.09, extra 0.95
  (worse)** — symmetric dilation enlarges the DISTAL ends that fling out on
  swing, creating more floating pieces. **DECISION: REVERT** (repo kept at
  overlap 11). Evidence: uniform overlap is the wrong lever.

**Iteration 3 — proximal-directional child extension (P2, REVERT).**
Extend each limb's alpha ONLY near its proximal joint (dilate by a larger kernel
but keep the extra tissue inside a small disc around the pivot), leaving the
distal end at overlap 11 so the flinging end isn't enlarged (iter-2's failure).
Health gate stayed clean at every setting swept (`far_frac` ~0, `PART_EXTRACTION_OK`).
Real render (`L3R_PROX_OVERLAP=16 L3R_PROX_RADIUS=45`):
- holes 4244→**4128** (−2.7%) but **components 3.79→4.90, extra_comp_frac
  0.88→0.94 (+29% detachment)**. Worst-frame (f80) visual A/B: waist seams
  marginally better, no meaningful net gain. **Why:** a patch baked into the
  CHILD rotates WITH the child, so it cannot cover the far side of the wedge that
  opens when the child swings away — instead its far edge peels off as a new
  floating piece. **DECISION: REVERT.**

**Iteration 4 — parent-owned static joint disc (P2, REVERT).**
The complementary lever: bake a small fg-masked disc into the PARENT's sprite at
the shared joint (added AFTER the health gate, so it never affects validation).
It moves with the parent, stays anchored at the joint, and the child (drawn on
top) hides all of it except the exposed wedge. Real render, disc radius sweep:
- R=24: holes 4244→4231, components 3.79→3.99 · R=34: holes 4228, components
  4.13, **holes_max 14151→14775 (worse)** · R=44: holes 4244→**4150** (−2.2%),
  components 3.79→4.08, extra 0.88→**0.93**, holes_max→14892.
- Worst-frame visual A/B: the disc **does** fill the waist/hip white cracks
  (visibly more intact torso), but the detachment metric regresses at every
  radius and larger discs peek past the child silhouette as new pieces. No
  radius is a clean win. **DECISION: REVERT** (kept inert, default-off, in the
  scratchpad engine as a documented dead-end; the repo reference stays clean).

**Structural finding (evidence-backed).** Three mechanistically-distinct
still-coordinate patch levers — symmetric overlap (iter 2), proximal child
extension (iter 3), parent joint disc (iter 4) — each trade a ~2–3% enclosed-hole
reduction for MORE fragmentation. The residual seam/detach is therefore a
**structural floor of rigid-part puppeting, not a tuning bug**: because parts are
rigid, a joint seam is the relative-rotation gap between two rigid pieces, and any
padding fixed in still coordinates either rotates out of place (iter 3) or peeks
out as a new component (iters 2, 4). Closing it cleanly requires geometry that
DEFORMS with the joint angle.

**Iteration 5 — mean-angle articulated joint patch (P2, MARGINAL / not shipped).**
Acting on the iter-2/3/4 finding, this lever DEFORMS with the joint instead of
sitting fixed in still-coords: a small fg-masked patch sampled at each joint,
drawn UNDER both parts, positioned at the joint's live FK location (`cur[child]`)
and rotated to the AVERAGE of the parent+child bone angles — so it points into
the wedge that opens between the two swinging bones. (Compositor blit refactored
into a shared helper first; JBRIDGE=0 verified pixel-identical to baseline, diff
0.0.) Real render:
- R=24: holes 4244→**4206 (−0.9%)**, holes_max 14151→**14001 (−1.1%, better)**,
  **extra_comp_frac 0.879 UNCHANGED**, components 3.79→3.90 (+3%).
- R=34: holes 4154 (−2.1%) but holes_max→14589 and extra→0.893 (worse).
- **This is the first lever that improves the seam metric WITHOUT regressing
  detachment frequency** — the mean-angle mechanism is validated where the three
  padding levers failed. BUT: R=24's gain is sub-1% with a small components
  uptick, and worst-frame A/B (f40/f80/f110) shows **no visible change** — the
  dominant worst-frame artifact is a LARGE detachment (e.g. a sandal flung off
  the shin on a big ankle swing), a gap far wider than a pivot-centred disc can
  span. **DECISION: not shipped** into the engine (sub-1% cosmetic gain doesn't
  clear RULE 7's bar for changing the production-intent compositor); kept
  env-gated (`L3R_JOINT_BRIDGE`, default 0) in the scratchpad as the
  mechanism-validated near-miss. Repo reference stays clean.

**Next distinct lever (recorded, the real build):** a DEFORMING joint bridge
QUAD — a thin quad spanning the parent's distal bone-end to the child's proximal
bone-end, one edge pinned to each part's transform, so it STRETCHES to cover the
large separations a fixed disc can't (the flung sandal/hand) — and/or a LOCAL
per-joint ARAP patch confined to the joint region. Both deform with the
articulation (the property iter 5 proved matters) and both target the large
detachments that actually dominate the worst frames. This is a real engine
change, the next iteration's single action — not another padding/patch sweep,
all of which are now exhausted.

**Iteration 6 — root-cause trace + deforming bridge (P1, diagnosis KEPT / bridge not shipped).**
First traced the "large detachment" against the real render (RULE 1) instead of
guessing. Connected-component analysis of the worst frame (f110): the **main body
is ONE intact 209,717 px component**; the detachments are three small distal
specks (2002 + 1861 + 568 px ≈ 4,400 px, ~2% of body area). FK proven sound —
every adjacent part pair touches at its pivot (min-gap ≤0.3 px), so nothing is
geometrically flung off. The specks are **feathered-threshold breaks at
hard-swung joints** (the left wrist is bent **61.8°** at f110), where two blurred
part edges meet in a thin sub-threshold valley over the white background.
- Built the recorded deforming bridge: a patch anchored by the parent-anchor→
  child-anchor segment, each end carried by its own part's FK. First cut used a
  3-point affine and **blew up** (holes 4244→196,428) — the three joint anchors
  are near-colinear along the straight limb axis, so the affine is degenerate.
  Fixed with a **2-point similarity** (rot+uniform-scale+translation), which is
  well-posed and stretches to span the gap.
- Real render, best result of all six iterations: gap=20 → holes 4244→**4121
  (−2.9%)**, holes_max 14151→**13995**, **extra_comp_frac flat 0.879**; gap=30 →
  holes **3907 (−7.9%)** but extra 0.893. **But** the detached specks are
  **byte-identical** (2002/1861/568) at every gap — the bridge fills interior
  seams yet does NOT merge the distal specks, and worst-frame A/B shows **no
  visible change**. **DECISION: not shipped** (no visible MP4 gain; RULE 1/7);
  bridge kept env-gated (`L3R_BRIDGE_QUAD`) in the scratchpad. Repo reference clean.

**Redirecting finding.** The residual specks are downstream of **aggressive
driver amplitude** (a 62° wrist swing from applying zombie.bvh at full gain) hit
by feathered-threshold breaks — as much a MOTION/retargeting problem as a
compositing one. Every compositing lever (iters 2–6: overlap, proximal
extension, static disc, mean-angle patch, deforming bridge) has now been
exhausted; the only one that helps interior seams at all (the bridge) can't touch
the distal specks. **Next real lever is motion-side:** clamp/retarget the driver
so swing amplitudes stay moderate and in-plane (no 62° wrist), which prevents the
hard-swung feathered break at its source rather than patching pixels after it.
That is a different subsystem (`bvh_to_joint_angles` / driver retarget), the next
iteration's single action.

**Iteration 7 — driver swing-amplitude cap (P2, hypothesis FALSIFIED / REVERT).**
Iter-6 predicted the specks came from aggressive driver amplitude (hands swing
**103–107° p2p**, shins ~75°, feet ~70° — full-gain zombie.bvh distal channels).
Tested directly: cap each bone's p2p by scaling its per-frame delta toward the
bone mean (phase-preserving); distal joints capped tightest (hands 25°, feet 30°).
- Real render: the f110 specks are **essentially unchanged** (2016/1873/572 →
  2018/1873/572); mean detached px/frame only 1524→1409; holes got **WORSE**
  (4244→4478, +5.5%). **Hypothesis falsified** — the specks are NOT caused by
  distal over-swing. **DECISION: REVERT** (env-gated `L3R_SWING_CAP`, default 0).

**Root cause — DEFINITIVE (iter 6–7 trace).** Dumped the worst frame from the
**true un-quantized RGBA** (not the GIF proxy) — same detachment (210,217 main +
[2016,1873,572]), so it is a **real render artifact, not a GIF/metric/threshold
artifact**. Visual: the body is intact (both real sandals on the feet); the
residual is **small floating GHOST FRAGMENTS** — a third "ghost" sandal on the
ground, a sleeve fragment by the left elbow (character-textured, 7/13/57 px from
the body, ~2% of area). Mechanism: rigid transforms preserve connectivity, so a
single part cannot split — a fragment can only orphan when an **entire distal
part is joined to its parent solely through a thin, feathered pivot overlap that
drops out under extreme rotation**. This is why NO lever tried so far fixes it:
compositing padding/patches/bridges (iters 2–6) add material near the joint but
don't *guarantee* a solid parent↔child overlap, and driver amplitude (iter 7) is
the wrong axis entirely.

**Next lever (specified, source-side).** Guarantee a **solid (non-feathered)
parent↔child overlap core** at every shared joint during extraction — e.g. the
parent's alpha always extends a solid disc over the child's proximal end (owned
by the parent, drawn under the child), sized so the overlap can never fall below
threshold under any rotation. Unlike iter-4's feathered disc (which peeked and
regressed) this is a solid connectivity guarantee, not a cosmetic pad; it must be
tuned to add zero visible silhouette (verify on the true PNG, not the GIF). This
is the one untried mechanism that directly prevents orphaning; it is the next
iteration's single action.

**Iteration 8 — TORSO keep-largest-component (P0, ROOT-CAUSE FIX, SHIPPED to reference).**
Mapped each ghost fragment (f110) back to its source part: **all three were
TORSO**. The torso is the fallback bucket (`assign[none_elig]=TORSO_I`) and was
the ONLY part not run through keep-largest-component. So stray feet/hand-region
silhouette pixels outside every limb corridor rode on the torso; in the still
they sit apart from the torso mass (separated by the down legs), and since the
torso barely moves they rendered as **orphan ghost fragments** (a ghost sandal, a
sleeve bit) whenever a real limb swung away. (Rigid transforms preserve
connectivity — a single kept-largest part cannot split — which is why the
compositing/amplitude/core levers iters 2–7 never touched them.)
- **Fix:** run keep-largest-component on the torso too (head stays whole, it is a
  clean blob). The real sandals/hands live on the limb parts, so dropping the
  torso's mis-assigned satellites loses nothing real. Removes, never adds.
- **Real render (true un-quantized PNG, RULE 1):** f110 detached pieces
  **[2016,1873,572] → NONE**; **no frame** in the 149-frame walk has any detached
  component ≥30px (residual "extra components" are all sub-30px AA specks).
  Whole-sequence seam metric: holes **4244→3590 (−15.4%)**, holes_max
  14151→14000, components **3.79→3.17 (−16%)**, extra_comp_frac **0.879→0.604
  (−31%)**. Validation still `PART_EXTRACTION_OK`; character verified complete
  frame-by-frame (both sandals on feet, tunic/pants/hands intact); ~5% faster.
  **DECISION: KEEP — shipped to the repo reference engine** (default, no env
  lever). This is the first Phase-12 change to the extraction engine and the only
  lever that eliminated the actual visible artifact.
- **Sweep re-run (repo reference w/ fix):** aladdin PASS (holes 3590); morgiana
  PASS (holes 2001); captain PASS (holes 729, **components 1.42** — near-single
  component); mother still **PART_EXTRACTION_UNCERTAIN → escalate L4** (fail-closed
  intact). Fix generalises; fail-closed unaffected.

**Loop status:** L3R = **PASS_WITH_LIMITS**, materially improved. The floating
ghost fragments — the actual visible defect — are **eliminated** (root-caused to
torso-fallback satellites, fixed at extraction, verified on the true render, no
detachment ≥30px anywhere in the walk, generalises across the sweep, fail-closed
intact). Seven earlier levers (iters 2–7) were falsified by measurement before the
real cause was found by tracing fragments to their source part; every measurement
was on the real output, never the report. Compositor also 2.7× faster (iter 1).
Residual is now only sub-pixel/AA-scale seam feathering. Still NOT globally
enabled and NOT on main (router stays fail-closed) — the fix ships to the L3R
reference engine only, pending an owner decision on any production wiring.

---

## Phase 13 — owner-gated finalization (iteration 9 + STOP decision)

**Objective:** determine whether the last remaining seam lever (the iter-6
deforming interior bridge) is worth applying on top of the iter-8 reference —
without weakening fail-closed behaviour, raising cost, or destabilising the
engine. Reference under test: `d7fcc681`.

**Bounding analysis first (existing evidence, before any render).** How much of
the remaining `holes_mean` 3590 is a defect at all?
- Source artwork over white (U²-Net mask, no engine): **2,826 px** of enclosed
  background — arm-torso windows, between-legs gap. Legitimate geometry.
- Engine static-pose recomposite (1 frame): **3,064 px** — extraction adds ~240 px.
- Walk mean 3,590 → **seam-attributable excess ≈ 526 px/frame**; per-frame min
  (952) dips BELOW the floor because swinging limbs open/close legitimate windows.
- Peak frame f123 (14,000 px) classified on the render: the 10,003-px region is
  the **legitimate window behind the swung-back right arm** — pose geometry, not
  a seam. Filling it would fabricate tissue where background belongs.

**Iteration 9 — deforming bridge (gap=20) on the iter-8 baseline (paired, deterministic).**
| metric | iter-8 baseline | + bridge gap=20 | verdict |
|---|---|---|---|
| holes_mean | 3589.8 | 3522.1 (−1.9%, −68 px) | noise-scale vs 3,064-px legit floor |
| holes_max | 14000 | 13993 | noise |
| components_mean | 3.168 | **3.463 (+9.3%)** | **WORSE — auto-revert condition** |
| extra_comp_frac | 0.604 | **0.644 (+6.6%)** | **WORSE — auto-revert condition** |
| detached ≥30 px (true PNG f110/f123 + full-sequence scan) | NONE | NONE | tie — regression is the bridge's own sub-30 px feathered-edge specks |
| validation | PART_EXTRACTION_OK | PART_EXTRACTION_OK | tie |
| runtime / RSS | 39.0 s / 1858 MB | 37.9 s / 1861 MB | tie |

KEEP criteria: fails **#6** (−68 px is not materially above noise; iter-6 already
showed this lever produces no visible worst-frame change) and **#7** (the bridge
adds ~40 lines of similarity-transform machinery to a stable engine); automatic
revert conditions fired on components/extra_comp_frac.

**DECISION: STOP — ITERATION 8 (`d7fcc681`) REMAINS THE REFERENCE.** The
interior-seam hypothesis is **falsified**: the remaining hole count is dominated
by legitimate pose geometry (~85% floor), the seam-attributable excess is
~526 px/frame of sub-pixel feathering, and the only lever that reduces it makes
detachment metrics worse while changing nothing visible. The experimental bridge
stays env-gated (default off) in the scratchpad only; the repo reference carries
zero experimental levers (grep-verified).

**Standing character matrix (engine `d7fcc681`, unchanged → iter-8 sweep stands;
aladdin re-validated this phase):**
| Character | Result |
|---|---|
| aladdin | **PASS** (holes 3590, no ≥30 px detachment, re-validated PART_EXTRACTION_OK) |
| morgiana | **PASS** (holes 2001) |
| captain | **PASS** (holes 729, components 1.42) |
| mother | **PART_EXTRACTION_UNCERTAIN → escalate L4** (fail-closed intact) |

**Production boundary:** L3R NOT globally enabled; production router unchanged
and fail-closed; no production configuration touched; no unrelated code modified;
GPU=0; spend ₹0. Motion suite green (26/26). **Milestone surfaced for owner
approval:** the defect that blocked L3R is resolved and the optimisation loop is
closed; any production wiring of L3R is an owner decision.
