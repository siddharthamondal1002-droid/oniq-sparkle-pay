# L3R — zero-GPU rigid-part character puppet (Phase 10)

**The question:** can ONIQ make the REAL Aladdin walk by moving **independent
articulated parts** instead of deforming the whole silhouette as one ARAP mesh —
so the arm/hand **claw** (the confirmed ARAP_LIMIT) never forms — with **no GPU**?
**Answer: YES, PASS_WITH_LIMITS.** The claw is RESOLVED; identity, legs and arms
all work; the cost is minor puppet joint seams. **GPU=0, API cost ₹0, no VACE, no
Veo, no full movie.**

## What ran (all CPU, same inputs as Phase 7–9)

Same real character `remotion/public/sheets/aladdin.jpg` (front pose), same
`zombie.bvh` WALK driver — nothing new generated, nothing modified.

```
U²-Net foreground (Phase 7) + auto-rig joints (Phase 7)
  → geometric part extraction: 14 rigid RGBA parts (voronoi over bones,
    feathered joint overlap) — SAFETY: only partitions existing foreground,
    never invents pixels; fail-closed to PART_EXTRACTION_UNCERTAIN
  → hierarchy TORSO → head / arms(upper→fore→hand) / legs(thigh→shin→foot)
  → the SAME zombie.bvh → per-frame in-plane joint swing angles
  → hierarchical affine FK + CPU alpha compositing → frames → MP4
```
No diffusion, no CUDA, no cloud. Scripts:
`remotion/scripts/l3r_puppet_reference.py`, `…/bvh_to_joint_angles_reference.py`.

## Part extraction & driver — verified

- **14/14 parts extracted** (head, torso, upper/fore arm ×2, hand ×2, thigh/shin
  ×2, foot ×2) — none below the fail-closed threshold. Static reassembly rebuilds
  Aladdin pixel-faithfully (no gaps).
- **Driver reused, not modified:** the zombie walk yielded a real gait —
  thighs swing ~48°, shins ~72°, arms ~31–46°, head ~30° peak-to-peak.

## A/B — L3 ARAP vs L3R (measured, same still + driver)

| | L3 ARAP (Phase 8) | **L3R rigid puppet** |
|---|---|---|
| ARM | **FAIL — torn claw** every frame | **PASS — rigid, swings cleanly** |
| HAND | FAIL (stretched into claw) | PASS (recognizable; minor seam) |
| LEGS | ok | **PASS — real stride/lift** |
| TORSO | distorted lean | PASS (stable) |
| IDENTITY | held | **PASS (held)** |
| TEMPORAL | stable claw | PASS (stable; minor joint seams) |
| Claw | **PRESENT** | **RESOLVED** |

Rigid parts **cannot** ARAP-stretch, so the claw is structurally impossible. The
remaining artifact is the opposite failure mode — small **joint seams / partial
detach** when a limb swings far (biggest when a leg lifts high). Larger joint
overlap (a wide torso margin kept behind the limbs) cut those seams markedly.
Not catastrophic: no limb flies off, torso doesn't tear, face is stable, identity
holds → **PASS_WITH_LIMITS** per the phase's own bar.

## Performance (measured, CPU)

| Stage | Time / RAM |
|---|---|
| Part extraction | ~2 s |
| Driver→angles | <1 s |
| Animation + composite (149 frames, 720×1280) | ~115 s wall (~110 s CPU) |
| Peak RAM | ~2.0 GB |
| GPU | **0** · API cost **₹0** |

(The 720×1280 full-canvas warpAffine per part per frame is the cost; a tighter
per-part bbox warp would cut this materially — an optimization, not a blocker.)

## StoryFilm integration — PASS (real path, one shot)

The L3R MP4 went through the REAL pipeline: `probeAsset('clip')` (present,
4.48 s ≥ 4.4 s min → PASS) → `shot.clip` → the actual `'story'` Remotion
composition → **1080×1920, 132 frames**, movie title card + ONIQ watermark burned
in, 15.9 s. The L3R clip drops into the EXACT `shot.clip` slot Veo/L3-ARAP use.
**No silent still substitution.**

## Verdict & router

- **L3R VERDICT: PASS_WITH_LIMITS.** **L4 NECESSITY: LOWERED** — a large class of
  full-body, frontal, in-plane shots can get usable articulated CPU motion with
  **no claw and no GPU**, so VACE is no longer required for them.
- **Recommended router** (L3R inserted, fail-closed, NOT globally enabled):

```
L0 static · L1 camera/parallax · L2 demo rigs
L3  ARAP pose-warp        — simple in-plane, arms clear of torso
L3R rigid-part puppet     — the ZERO-GPU escalation when ARAP is unsafe
                            (arms-against-torso / articulation) AND all parts
                            extract confidently (Phase 10)   ← NEW
L4  VACE 1.3B (GPU)       — out-of-plane / occlusion / complex hands /
                            multi-character / where L3R quality is insufficient
L5  Veo (premium, hero)
```
Fail-closed (`selectProviderOrder` orders warp → **rigid-puppet** → diffusion →
premium; `rigidPuppetEligible` escalates on `PART_EXTRACTION_UNCERTAIN` /
out-of-plane / occlusion / multi-character; `runMotion` never ships a
still-as-clip). L4 unavailable → L3/L3R if eligible, else still — never a torn or
broken clip.

## Code (branch only — NOT on main, NOT globally enabled)

- `src/lib/motionProvider.ts`: `role` gains `"rigid-puppet"`; `RIGID_PUPPET_META`
  (CPU, cpu-runner billing); `rigidPuppetEligible` (fail-closed); ordering places
  the puppet between pose-warp and diffusion. `billing` union gains `cpu-runner`
  (already used by pose-warp).
- `src/lib/__tests__/motionProvider.test.ts`: +6 L3R tests (meta, ordering,
  eligibility, fail-closed uncertainty, out-of-plane/occlusion/multi escalation,
  runMotion flow + no-still-as-clip). **61/61 motion tests pass.**
- `remotion/scripts/l3r_puppet_reference.py`, `bvh_to_joint_angles_reference.py`:
  the reference engine (proof only; not wired to production; no media in git).

## Honest limits

1. **In-plane only.** A frontal rigid puppet driven by a forward walk does
   in-plane limb swing, not true 3D foreshortened stride — reads as a stylised
   marionette walk, not photoreal locomotion. Out-of-plane motion still needs L4.
2. **Joint seams** remain when a limb swings far (mitigated by overlap, not
   eliminated) — the 2D cut-out puppet's characteristic artifact.
3. One character, one motion — a broader sweep (more cast, more drivers, hands
   articulation, tighter-bbox speedup) would refine the eligibility rule.

## Final report

```
L3 ARAP:          FAIL — claw
L3R:              PASS_WITH_LIMITS
PART EXTRACTION:  PASS (14/14; fail-closed gate)
ARM:              PASS (rigid, no claw)
HAND:             PASS (minor seam)
LEGS:             PASS (real stride)
IDENTITY:         PASS
TEMPORAL:         PASS (minor joint seams)
PUPPET ARTIFACT:  MINOR (joint seams on large swing)
CPU:              ~110 s (149 frames)   RAM: ~2.0 GB   RUNTIME: ~115 s wall
GPU:              0        API COST: ₹0
MOTIONCLIP:       PASS
STORYFILM:        PASS (real 'story' comp, 1080×1920, 132 frames, no fallback)
L3R VERDICT:      PASS_WITH_LIMITS
L4 NECESSITY:     LOWERED
RECOMMENDED ROUTER: L0·L1·L2·L3(ARAP)·L3R(rigid,zero-GPU)·L4(VACE)·L5(Veo), fail-closed
FILES:            src/lib/motionProvider.ts, src/lib/__tests__/motionProvider.test.ts,
                  remotion/scripts/l3r_puppet_reference.py,
                  remotion/scripts/bvh_to_joint_angles_reference.py, MOTION_RIGID_PUPPET.md
TESTS:            61/61 motion tests pass (6 new L3R)
MAIN:             unchanged      WORKING TREE: clean
NEXT STEP:        optimize the compositor (tighter per-part bbox warp to cut the
                  ~115s/clip) and widen the L3R sweep (more cast + drivers) to
                  finalize the L3R eligibility rule before any production wiring.
```
