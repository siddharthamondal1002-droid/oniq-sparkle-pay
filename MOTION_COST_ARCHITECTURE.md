# ONIQ motion cost architecture (Phase 4)

**The question:** can ONIQ make *any character + a reusable motion driver → real
walking/gesture/talking* **without** running a large diffusion model for every
shot? **Answer: YES for the majority of shots, NO for a minority** — and the
split is decided per shot by a cost/quality tier selector. Diffusion becomes a
refinement layer for the shots that truly need it, not the engine for all of
them.

## The six tiers (cheapest first)

| Level | Engine | Compute | GPU? | Marginal cost /5s shot (modeled, UNVERIFIED until benchmarked) |
|---|---|---|---|---|
| **0 STATIC** | still only | — | no | ₹0 |
| **1 CAMERA** | still + Ken Burns / parallax / VFX (existing in-house) | CPU | no | ₹0 (in the render already) |
| **2 RIG** | measured 2D rig puppet — **11 demo characters only** | CPU | no | ₹0 |
| **3 POSE_WARP** | **Meta Animated Drawings** — auto-rig + BVH retarget + ARAP render, **arbitrary** stylised character | **CPU** | **no** | ~₹0.5–1.5 (extra runner minutes; CPU latency UNVERIFIED) |
| **4 DIFFUSION** | Wan2.1-VACE 1.3B, pose-conditioned | GPU | **yes** | ~₹5–15 + a GPU host (hourly/serverless) |
| **5 PREMIUM** | Veo 3.1 Fast (direct Google) | paid API | no (their GPU) | **~₹100** (8s clip) |

**Only levels 4 and 5 cost real compute/money.** 0–3 run on the CPU the render
already uses. Code: `src/lib/motionCost.ts` (`LEVELS`, `selectMotionLevel`) and
`src/lib/motionProvider.ts` (`ANIMATED_DRAWINGS_META` — the one OSS engine with
`requiresGpu: false`).

## The cost breakthrough (why this matters for ONIQ)

ONIQ's stills are **storybook illustrations** (the worker prompts "Gentle,
family-friendly animated storybook illustration") — which is **exactly the art
style Animated Drawings animates well** (it is uncanny only for *photoreal*,
which ONIQ is not). So a large share of ONIQ's body-motion shots can run at
**LEVEL 3 on CPU for ~₹0**, provided the shot is framed full-body/frontal.

A 43-shot, 5-minute film, tiered instead of all-diffusion:

| Mix (illustrative) | Tier | Motion cost |
|---|---|---|
| 10 static/establishing | L0/L1 | ₹0 |
| 15 simple body motion (full-body illustrated) | **L3 CPU** | ~₹0–22 |
| 10 talking | L3 mouth-warp / MuseTalk if needed | ~₹0–small |
| 6 complex (non-frontal / occluded / hands) | L4 diffusion | ~₹30–90 |
| 2 hero cinematic | L4 (or L5 Veo) | ~₹10–30 (L4) / ₹200 (Veo) |
| **Total motion (avoiding Veo)** | | **~₹40–140** |

vs **all-Veo**: 43 × ₹100 = **₹4,300**. vs **all-VACE-L4**: 43 × ~₹10 = **₹430**.
Tiering cuts motion cost by **~70–95%** versus running diffusion (or Veo) on
every shot. **Per 1-minute movie** (~8–9 shots, ~1 diffusion shot): **~₹5–25**
marginal motion cost on top of the existing ₹31.5 gen + ₹6 render + ₹3 infra
(so ~₹45–65 total, vs ~₹900 all-Veo). *All figures modeled, flagged UNVERIFIED
until a real GPU/CPU benchmark — per the "don't fabricate a cost" rule.*

## Shot policy (which tier per shot)

| Shot | Tier | Escalation |
|---|---|---|
| STATIC | L0/L1 | — |
| CAMERA-only | L1 | — |
| Simple gesture / walk, **full-body frontal illustrated** | **L3** | → L4 if a QC gate rejects L3 |
| Demo-cast character (11 rigs) | L2 | → L4 |
| Talking | L3 mouth-warp | → MuseTalk/L4 if needed |
| Complex interaction / non-frontal / occluded / tight framing / hands | L4 | → L5 |
| Premium/hero cinematic | L5 (Veo) | keeps L4/L3 as backup |

`selectMotionLevel(shot, caps, policy)` returns the chosen level **and** a
cheapest→dearest escalation ladder a QC gate climbs on a miss. Honest fallback:
motion called for but nothing available → **still + camera (L1), never a fake
clip**.

## LEVEL 3 engine — Meta Animated Drawings (the CPU tier)

`facebookresearch/AnimatedDrawings`. Single image → auto-segment → auto-rig →
retarget a **BVH** motion → **ARAP** 2D mesh render → MP4. **CPU-only feasible**
(TorchServe CPU). **MIT for code AND weights** — commercial-clean. (Repo
archived read-only 2025-09; usable, unmaintained.)

- **Serves:** stylised / storybook / illustrated, **frontal, full-body,
  unoccluded, single humanoid**, planar walk/gesture/dance. Genuinely good (ARAP
  gives real limb bend, not a flat cutout).
- **Consumes BVH** (3D joint rotations), **not** DWPose 2D keypoints → its driver
  library is **BVH clips**, distinct from the diffusion tier's pose-video drivers.
  (No turnkey DWPose→BVH exporter ships in-repo; keep a BVH library directly.)
- **Eligibility gate (the router's branch condition):** frontal + full-body +
  unoccluded + single stylised humanoid. Pass → L3 (cheap CPU). Fail on any axis
  → L4 diffusion.

## What forces diffusion (L4 VACE) — L3 cannot serve

1. Non-frontal / ¾ / side / back framing. 2. Occlusion / self-occlusion.
3. Tight framing (portrait / half-body / close-up — no full skeleton).
4. Large out-of-plane motion (turning toward/away, foreshortening).
5. Multi-character / character tightly embedded in scene. 6. Expressive
hands/fingers. 7. Convincing **talking** (see below). *(Photoreal also forces
diffusion, but ONIQ is illustrated, so that axis rarely bites.)*

## MotionDriverRegistry design (two representations)

- **L3 drivers = BVH clips** (`walk.bvh`, `wave.bvh`, …) — Animated Drawings'
  native input. CC0 / public-domain / permissively-licensed motion capture only
  (e.g. CMU MoCap BVH is usable); license recorded per clip.
- **L4 drivers = pose-video → DWPose sequence** — VACE's control input.
- Both keyed by `motionClass` in `remotion/fixtures/motion-drivers/registry.json`
  (12 classes). `usableDriverClasses()` reports 0 until real, licensed driver
  assets are added (no false capability). **No driver media in git.**

## Pose-cache design (extract once, reuse for every character)

`src/lib/motionCost.ts`: `poseCachePath(driver)` = `driver.mp4 → driver.pose.json`;
`makePoseCache(extractor)` memoises so **DWPose runs at most once per driver** and
every character reuses the `PoseSequence` (character A/B/C + WALK_01 → one
extraction; concurrent first-gets dedupe). **Paid per driver, not per character.**
Extraction is **CPU** (onnxruntime/rtmlib). The BVH library needs no extraction
at all (already skeletal).

## GPU-only stage identification

**GPU is required ONLY for:** L4 VACE diffusion, L5 is Google's own GPU, and (if
adopted) MuseTalk/SadTalker lip-sync. **Everything else is CPU:** motion
classification, driver selection, DWPose pose extraction, the pose cache,
Animated Drawings (segment/rig/retarget/ARAP render), the existing
Remotion/film-look/QC/upload. So "GPU required" is **false for the pipeline** —
true only for the diffusion refinement of the shots that need it.

## Talking

Keep **Rhubarb → the 11 demo rigs**. For arbitrary characters: a CPU landmark
mouth-warp (crude "lip-flap", fine for stylised) at L3, or **MuseTalk (MIT,
GPU)** / **SadTalker (Apache-2.0, GPU, real-face)** at L4 when quality is needed.
**Never Wav2Lip commercially** (non-commercial weights). No CPU-only,
commercially-clean, *convincing* talking option exists — flagged honestly.

## Recommended production architecture

```
SHOT → motion classifier → selectMotionLevel(caps, policy)
  L0/L1  still + camera/parallax            (CPU, existing)
  L2     measured rig (demo cast)           (CPU, existing)
  L3     Animated Drawings + BVH driver     (CPU, MIT)      ← the cheap majority
  L4     Wan2.1-VACE 1.3B + DWPose driver   (GPU)           ← the minority
  L5     Veo (direct Google)                (paid)          ← rare hero shots
        → optional lip-sync (MuseTalk/warp) → shot.clip
        → existing StoryFilm → Remotion → film look → QC → movie
```
Fallback per shot: L3 → L4 → L5 → still (bounded, never a still-as-clip). Veo
stays direct-to-Google; stills+voice stay Lovable. Nothing in StoryFilm/Remotion/
story-plot/story-still/story-voice changes.

## The decisive answer

**Can ONIQ animate an arbitrary character with a reusable driver WITHOUT
per-shot diffusion? YES for the L3-eligible subset — which, because ONIQ's art
is storybook-illustrated, is LARGE when shots are framed full-body/frontal.**
The cheapest complete system is the tiered selector above: **CPU (L0–L3) for the
majority, GPU diffusion (L4) for the minority that L3 provably cannot serve, Veo
(L5) for rare hero shots.** Which shots get downgraded to the cheap tier — a
user-visible quality/spend decision — is the **owner's** call; this document is
the input to it, not the decision. **No GPU has been provisioned and nothing has
been spent.**

## Phase-5 REAL CPU test (done) — L3_ACCEPT_WITH_LIMITS

One real CPU walk was produced and inspected. **GPU=0, API cost ₹0.**

- **Character:** Meta Animated Drawings example `char1` (an illustrated humanoid,
  frontal, full-body — the same stylised class as ONIQ stills). **Not** a
  specific ONIQ still (see limits).
- **Driver:** `zombie.bvh` (FAIR MIT) — a forward-walking locomotion clip, trimmed
  to 150 frames.
- **Pipeline that ran:** char_cfg + rig → BVH retarget (PCA) → **ARAP 2D mesh
  deform** → **headless OSMesa** GL render → frames → mp4. All CPU.
- **Measured (4-core CPU):** ~24 s wall for a 150-frame / 4.5 s clip (~16.6
  render-fps); **CPU 36.7 s user + 18 s sys**; **peak RSS 669 MB**; output h264
  **500×500 @ 33.3 fps, 4.5 s**, ~170 KB.
- **Visual (frames 0/25/50/75/99):** the character **takes strides (legs
  alternate/lift), swings its arms, leans, and translates across the frame**
  (real locomotion — not camera/parallax). **Identity stable** throughout; no
  missing limbs, no exploding geometry. Mild 2D-puppet warping of the torso/arms
  (expected for an ARAP paper-puppet).
- **Verdict: L3_ACCEPT_WITH_LIMITS.** Good-enough "storybook puppet" motion at
  near-zero CPU cost — a strong fit for ONIQ's illustrated aesthetic — with these
  limits:
  1. Proven on Animated Drawings' example character, **not** yet on a real ONIQ
     still (the container can't reach Supabase storage).
  2. **The auto-rig half is unproven here** — `char1` came pre-annotated; turning
     an ARBITRARY ONIQ still into a rig needs the heavier char-analysis stack
     (Detectron2 + mmpose + TorchServe), which was not installed.
  3. 2D-puppet limits hold: only frontal / full-body / unoccluded / single
     subject; some limb warping. Everything else escalates to L4.

Reproduce with `remotion/scripts/l3_animate_reference.py` (deps + OSMesa noted in
its header). This is a reference/proof script, **not** wired into production.

## Real-test status

- **Mock/CPU-contract proofs (done, on branch):** tier selector + escalation +
  pose-cache (extract-once-reuse) + provider ordering (CPU pose-warp leads) —
  34/34 tests.
- **BLOCKED on a real run (owner-gated):** a real VACE-1.3B GPU clip (L4). No
  claim any diffusion output exists until that produces inspected frames.

## Phase-6 update — the auto-rig half is PROVEN (GOOD-WITH-LIMITS)

Phase 5's open gap (auto-rigging an *arbitrary* still, not a pre-annotated one)
is now closed on **CPU, ₹0**. The real Animated Drawings char-analysis stack
(mmdet-2.28 detector + mmpose-0.29 pose, `mmcv-full` **compiled from source**
because the OpenMMLab/PyTorch wheel hosts are network-blocked here) auto-rigged
**3 distinct characters** from raw drawings — detector >0.998, keypoint conf
0.87-0.91, skeletons anatomically correct on all 3 — then a **single shared walk
driver** (`zombie.bvh`) drove them: **2 of 3 produced clean upright walks; 1
collapsed at the ARAP mesh stage** despite a correct-looking skeleton. Pose cache
proven at runtime (1 parse, 2 hits). Verdict **GOOD-WITH-LIMITS**: one motion
library drives many auto-rigged characters cheaply for the majority; a minority
need a POST-render QC gate (`l3RenderQc` in `src/lib/motionCost.ts`) that catches
the collapse and escalates to L4. Full write-up: **`MOTION_GENERALIZATION.md`**;
reference runner: `remotion/scripts/autorig_reference.py`. No model weights in git.
