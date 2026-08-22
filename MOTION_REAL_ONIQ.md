# Real ONIQ character validation (Phase 7)

**The question:** does the full L3 path work on a REAL ONIQ production still — not
an Animated Drawings example — end to end: general segmentation → auto-rig →
existing walk driver → CPU animation → MP4 → MotionClip → one real StoryFilm shot?
**Verdict: L3_REAL_ONIQ_PASS_WITH_LIMITS.** The pipeline runs end to end on a real
ONIQ character and produces real character motion, but one arm tears at the ARAP
stage. **GPU=0, API cost ₹0, no new paid generation, no Veo, no full movie.**

## Real input (recovered, not generated)

`remotion/public/sheets/aladdin.jpg` — a genuine ONIQ-generated character sheet
(the Aladdin cast art used for the rig work), a front + side turnaround. The
**front (left) pose** was used: a single, full-body, frontal character on a
near-white studio background. No new still was generated. The shipped `sheets/cut/`
pre-cut PNG was **not** used — segmentation was run fresh.

## Stage-by-stage (all measured, CPU)

| Stage | Method | Result | Time | Peak RAM |
|---|---|---|---|---|
| **Segmentation** | U²-Net (rembg `u2netp`, 4.7 MB, onnxruntime) | clean full-body cutout, 34% fg, bbox covers 94.8% of height | load 0.11s + **infer 0.18s** | 458 MB |
| **Auto-rig** | AD detector (mmdet 2.28) + pose (mmpose 0.29), skeleton from scratch | det 0.995, kpt conf mean 0.86 / min 0.57; all joints correct | load 3.59s + det 2.13s + **pose 0.13s** | 1396 MB |
| **Animation** | Animated Drawings ARAP + OSMesa, shared `zombie.bvh` walk | 150-frame walk, real locomotion | **15.2s** | 659 MB |
| **FFmpeg** | gif → h264 mp4 | 500×500, 33.3 fps, 4.5s, 176 KB | ~0.3s | — |
| **MotionClip → StoryFilm** | `probeAsset` → `shot.clip` → real `'story'` Remotion composition | 1080×1920, 132 frames, movie title card + ONIQ watermark, 634 KB | bundle 3.5s + **render 11.5s** | — |

- **Core L3 per-shot path (excl. one-time model loads):** seg 0.18 + det 2.13 +
  pose 0.13 + render 15.2 + ffmpeg 0.3 ≈ **~18 s/shot on CPU** (measured).
  One-time model loads: ~3.7 s (rig) + 0.11 s (seg).
- **GPU = 0. API cost = ₹0.** All figures MEASURED (2026-08-22, 4-core CPU).

## Pixel validation (frames 0/25/50/75/100)

The real ONIQ Aladdin **walks**: legs alternate/stride, torso and body translate
184 px across frame (in-frame every frame, feet grounded ±10 px). NOT camera,
NOT parallax, NOT background — real character locomotion driven by the reused
`zombie.bvh`.

| Check | Result | Note |
|---|---|---|
| Legs move | **PASS** | real stride cycle |
| Torso moves | **PASS** | body translates + leans |
| Head stable | **PASS** | head/face steady |
| Identity recognizable | **PASS** | face, hair, cream shirt, blue pants, sandals all intact |
| Clothing attached | **PASS** | shirt/pants stay on the body |
| Limb explosion | none | no scatter |
| **Hands / arms** | **FAIL** | the left arm (resting flush against the torso) over-stretches into a pointed claw as the driver swings it |
| Temporal stability | PASS_WITH_LIMITS | no explosion, identity holds; the arm artifact is persistent but stable |

The **one** real defect is the left-arm ARAP over-stretch. It is localized (legs,
torso, head, identity all clean), so the character stays recognizable and the
motion reads as walking — but it is major tearing of one limb, not a clean pass.

## Verdict & bottleneck

- **L3 VERDICT: L3_REAL_ONIQ_PASS_WITH_LIMITS**
- **NEXT BOTTLENECK: POSE_WARP_BOTTLENECK.** Segmentation PASS and auto-rig PASS;
  the failure is the ARAP 2D-mesh deform, specifically when an arm hangs **flush
  against the torso** so its silhouette merges into the body. The walk driver then
  swings that arm and the mesh has no clean seam to bend along, stretching it into
  a claw. This is the SAME class as Phase 6's char1 collapse (art the 2D puppet
  can't cleanly deform), now seen on a real ONIQ still with arms-at-sides — the
  most common ONIQ character pose.

**No silent fallback was used.** The clip was NOT swapped for a still or a Veo
clip; the real L3 output was rendered and reported as-is, artifact included.

## Resolution path (evidence-based)

Two honest options for the arm-tear, per the "better segmentation vs L4" decision:

1. **Better silhouette separation** (cheaper, CPU): a part-aware mask that cuts the
   arm from the torso (e.g. a limb-part segmenter, or DensePose/parsing) so the
   ARAP mesh gets a seam to bend the arm along. Might rescue arms-at-sides; keeps
   L3 at ₹0. Unproven — a follow-up.
2. **L4 VACE diffusion** for arms-against-torso shots. Reliable, but GPU + spend
   (owner-gated). This is the correct route if the part-aware mask doesn't fix it.

Recommendation: **route arms-against-torso / arms-flush shots to L4**, keep L3 for
arms-clear-of-body full-body frontal shots, and pursue the part-aware mask as the
cheap experiment before committing GPU.

## L3 eligibility rule (from the evidence) — NOT enabled globally

Route a shot to L3 only when ALL hold (encoded in `poseWarpEligible`, fail-closed):
single character · full/near-full body framing · limbs visible · limited occlusion
· stylised/illustrated · **sufficient resolution** (long side ≥ 384 px; the real
still was 1244 px) · **arms not flush against the torso** (Phase-7 learning — the
arm-tear axis). Everything else escalates to L4. The post-render `l3RenderQc` gate
(Phase 6) is the backstop for collapse/off-frame, but it does NOT yet catch the
arm-tear (the clip passed fill/in-frame/foot checks) — a limb-tear (silhouette
solidity) detector is the open QC follow-up.

## Code (branch only — NOT wired to production, NOT on main)

- `src/lib/motionCost.ts` `poseWarpEligible` — added `longSidePx` (resolution) and
  `armsAgainstTorso` axes from the Phase-7 evidence. Tests in
  `src/lib/__tests__/motionCost.test.ts` (17/17 pass).
- `remotion/scripts/segment_reference.py` — the U²-Net general segmenter
  (reference/proof only; no weights in git).
- Phase-7 auto-rig used `remotion/scripts/autorig_reference.py` (Phase 6) fed with
  the real U²-Net mask; the one-shot StoryFilm render used the real `'story'`
  composition via `@remotion/renderer` (temporary test assets under
  `remotion/public/p7_test/` were removed after the render — never committed).

## Honest limits

1. One character, one pose (arms-at-sides). A broader real-ONIQ sweep (multiple
   cast members, action poses) would sharpen the eligibility rule — a follow-up.
2. The front pose was cropped from a turnaround sheet; a true single-character
   story-shot still would be equivalent input. Segmentation ran on the raw sheet
   crop, not the pre-cut PNG.
3. L4 VACE diffusion remains unrun (owner-gated GPU/spend).

## Final report

```
REAL ONIQ INPUT:   remotion/public/sheets/aladdin.jpg (front pose)
SEGMENTATION:      PASS   (U²-Net / rembg u2netp, CPU, 0.18s, clean cutout)
AUTO-RIG:          PASS   (from scratch; det 0.995, all joints correct)
WALK:              PASS   (real stride/translation, reused zombie.bvh)
IDENTITY:          PASS
BODY:              PASS
HANDS:             FAIL   (left arm ARAP over-stretch — arms flush to torso)
LEGS:              PASS
TEMPORAL STABILITY: PASS_WITH_LIMITS
MOTIONCLIP:        PASS   (probeAsset ok; drops into shot.clip like a Veo clip)
STORYFILM:         PASS   (real 'story' composition, 1080×1920, title+watermark)
GPU:               0
API COST:          ₹0
RUNTIME:           ~18s/shot core (CPU) + ~3.8s one-time model load; StoryFilm render 11.5s
PEAK RAM:          1.4 GB (auto-rig stage; seg 458 MB, render 659 MB)
L3 VERDICT:        L3_REAL_ONIQ_PASS_WITH_LIMITS
NEXT BOTTLENECK:   POSE_WARP_BOTTLENECK (arm-against-torso ARAP tear → part-aware mask, else L4 VACE)
```
