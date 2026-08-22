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

**Seam fix — correct next lever (not yet implemented):** PROXIMAL-directional
joint patches (extend each limb only toward its PARENT joint, and/or keep a small
parent-owned disc at each joint drawn under the child) so a swung limb's joint gap
is covered without enlarging the flying distal end. This is the highest-value
remaining L3R item and the NEXT single action.

**Loop status:** L3R still **PASS_WITH_LIMITS** — the compositor is 2.7× faster
with identical (verified) output; the seam/detach limit is unchanged and now
quantified with a repeatable metric. Not production-ready (seams/detach not yet
within a measured band); router stays fail-closed; not globally enabled; not on
main.
