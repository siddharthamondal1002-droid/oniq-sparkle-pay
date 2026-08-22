# Motion generalization — auto-rig N characters, reuse ONE driver (Phase 6)

**The question:** can the L3 CPU path (Phase 5) **auto-rig DIFFERENT characters**
and drive them all from **ONE reusable motion**, or does each character need its
own hand-tuned rig? **Answer: the auto-rig itself generalizes cleanly; the
downstream 2D-mesh deform does NOT always — so the honest verdict is
GOOD-WITH-LIMITS.** Most characters animate from one shared driver at ~₹0 on CPU;
a minority produce a plausible-looking skeleton that still collapses at render and
must escalate to diffusion. **No GPU, no Veo, no spend — GPU=0, API cost ₹0.**

## What actually ran (all CPU)

Phase 5 proved the RENDER half on a **pre-annotated** character. Phase 5's open
gap was the **auto-rig** half — turning an arbitrary still into a rig without hand
annotation. Phase 6 closes it with the real Animated Drawings char-analysis stack.

- **Auto-rig stack (the model-dependent, novel part):** the two MIT-licensed
  Animated Drawings models — a drawn-humanoid **detector** (mmdet 2.28 MaskRCNN)
  and a drawn-humanoid **pose estimator** (mmpose 0.29 top-down) — run **directly
  in-process on CPU** (no TorchServe daemon, no GPU). `mmcv-full 1.6.2` was
  **compiled from source** because the OpenMMLab prebuilt-wheel host is blocked by
  the container network policy (as is the PyTorch CDN); everything else is PyPI.
  Code: `remotion/scripts/autorig_reference.py`.
- **3 distinct characters**, auto-rigged from raw drawings (their shipped
  annotations were **ignored** — the skeleton was regenerated from scratch):
  a rounded stick figure, a girl with a skirt, and a candy-corn-shaped creature —
  three very different body plans (the same stand-in caveat as Phase 5: these are
  Animated Drawings' own example drawings, not real ONIQ stills, because Supabase
  storage is unreachable from the container and generating new stills would spend
  money the phase barred).
- **ONE shared motion driver** for all three: `zombie.bvh` (FAIR MIT forward
  walk) + `fair1_ppf.yaml` retarget — the **identical** `motion_cfg` +
  `retarget_cfg` for every character. This is the "ONE motion → MANY characters"
  test.
- **Render:** headless OSMesa, same Phase-5 path.

## Result — auto-rig: 3/3 clean. End-to-end walk: 2/3 clean.

### Auto-rig (detection + pose) — GENERALIZES

| Character | Detector score | Keypoint conf (mean / min) | Skeleton placement |
|---|---|---|---|
| char1 (rounded figure) | 0.9984 | 0.903 / 0.858 | joints anatomically correct |
| char2 (girl, skirt) | 0.9989 | 0.914 / 0.881 | joints anatomically correct |
| char3 (candy-corn creature) | 0.9991 | 0.873 / 0.727 | correct **even on the non-standard body** |

All three drawings were detected with >99.8% confidence and got high-confidence
17-keypoint poses; the 15-joint AD skeleton landed on the right body parts in
every case (verified by eye on the joint overlays). **Auto-rig cost:** model load
~3.7 s once; then **~1.9 s detection + ~0.12 s pose per character** on CPU; peak
RSS ~1.4 GB. **No hand annotation, no GPU, ₹0.**

### End-to-end (auto-rig → shared driver → render) — CHARACTER-DEPENDENT

| Character | Mean frame fill | Centroid travel | Stays in frame | Verdict |
|---|---|---|---|---|
| char2 | 8.2% | 214 px | yes | **clean upright walk** |
| char3 | 11.1% | 164 px | yes | **clean upright walk** |
| char1 | 2.3% | (drifts off edge) | **no** | **COLLAPSE** |

char2 and char3 walk convincingly reusing the identical driver — legs alternate,
arms swing, body stays upright and grounded, identity intact. **char1's ARAP mesh
collapsed** into a small crumple that drifted off-frame — even though its auto-rig
skeleton looked correct. Phase 5 rendered the *shipped* char1 (hand-annotated)
cleanly with the same driver, so the collapse is attributable to **subtle
auto-rigged joint-placement differences** interacting badly with char1's
big-looping-arm art at the 2D-mesh-deform stage. This is the real limit: an
auto-rig can look right and still deform wrong.

### Pose cache — extract once, reuse for every character (proven at runtime)

The shared driver was parsed **once**: char1 = **MISS** (0.049 s parse),
char2 = **HIT** (0.0 s), char3 = **HIT** (0.0 s). Paid per DRIVER, not per
character — the runtime analog of `makePoseCache` in `motionCost.ts`. (BVH drivers
need no pose extraction at all; the L4 video-driver path is where DWPose caching
saves real compute.)

## Classification: **GOOD-WITH-LIMITS**

- **UNIVERSAL?** No — char1 collapsed.
- **CHARACTER-DEPENDENT?** Yes, at the mesh-deform stage: art with large closed
  limb loops (or proportions far from the mocap skeleton) can tear the 2D mesh.
- **NOT-VIABLE?** No — 2 of 3 distinct characters produced genuinely good walks
  from ONE driver at ~₹0, and the auto-rig succeeded on all 3.

So: **one motion library can drive many auto-rigged characters cheaply on CPU —
for the majority. A minority need a QC gate that catches the collapse and
escalates to L4 diffusion.** Which is exactly the escalation ladder the Phase-4
architecture already defines.

## What this adds to the code

- **`l3RenderQc(stats)`** in `src/lib/motionCost.ts` — a POST-render gate. Upstream
  `poseWarpEligible` runs before the render and cannot see a collapse; char1 passed
  every upstream check yet collapsed. `l3RenderQc` inspects the produced clip
  (mean fill %, stayed-in-frame, foot-line stability) with thresholds set from
  these real measurements (clean ≈8-11% fill / in-frame; collapse ≈2.3% /
  off-frame) and **escalates a failed L3 to L4** instead of shipping a mangled
  puppet. Fails closed. Tests in `src/lib/__tests__/motionCost.test.ts`.
- **`remotion/scripts/autorig_reference.py`** — the reference in-process CPU
  auto-rig runner (deps + the network-policy workaround in its header). NOT wired
  into production; documents the proven method for a future L3 auto-rig adapter.

## Escalation rule (updated)

```
SHOT → classify motion → selectMotionLevel → if L3 chosen:
  poseWarpEligible(still)   [pre-render]  frontal/full-body/single/stylised? else → L4
  auto-rig (detector+pose)  [CPU]         humanoid found + confident keypoints? else → L4
  render (ARAP, CPU)                      produce the clip
  l3RenderQc(clip stats)    [post-render] mesh held (fill/in-frame/feet)? else → L4  ← NEW, from Phase 6
  → shot.clip → StoryFilm → Remotion → film look → QC → movie
```
The new rung is the post-render QC: it is the gate that would have caught char1.

## Honest limits (unchanged + new)

1. **Stand-in characters, not real ONIQ stills** — Supabase is unreachable from
   the container and generating new stills would spend money the phase barred. The
   three drawings are the same *class* (stylised, full-body, frontal) as ONIQ
   stills; a real-ONIQ-still run remains owner-gated.
2. **Segmentation shortcut in this test** — the character silhouette (mask) came
   from Animated Drawings' shipped mask cropped to the auto-rig bbox, not from a
   general segmenter, because the classical segmenter needs a near-white paper
   background these particular inputs don't have. The production adapter would run
   rembg / SAM / AD's segmenter for the mask; the mask is not the auto-rig's novel
   output (the skeleton is, and that was generated from scratch).
3. **char1's collapse is real and expected to recur** for some art — the reason
   the post-render QC gate exists.
4. 2D-puppet limits from Phase 5 still hold: frontal / full-body / unoccluded /
   single subject; anything else escalates to L4.

Reproduce: `remotion/scripts/autorig_reference.py` (auto-rig) then the Phase-5
render path with the shared `zombie` + `fair1_ppf` configs. Reference/proof only —
**not** wired into production, and **no model weights are committed to git.**
