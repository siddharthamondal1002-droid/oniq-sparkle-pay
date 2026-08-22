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

**Loop status:** L3R still **PASS_WITH_LIMITS** — the compositor is 2.7× faster
with verified-identical output (iter 1, kept); the seam/detach limit is now
quantified AND explained (a rigid-method structural floor), with the fix
direction narrowed by experiment: four fixed-in-still-coords padding levers
falsified (iters 2–4), and the deforming mean-angle mechanism validated but too
small alone (iter 5) — pointing to a deforming bridge quad / local-ARAP as the
only remaining seam-closer. Not production-ready (seams/detach not within a
shippable band); router stays fail-closed; not globally enabled; not on main.
Motion suite green.
