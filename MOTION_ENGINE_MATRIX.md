# Motion engine decision matrix (Phase 3)

Goal: ONIQ character still + reference motion/pose → the **same** character
actually moving, identity-preserving, arbitrary characters, lowest-cost
realistic. Five candidates only. All facts from primary sources (repo
READMEs / config / LICENSE via raw.githubusercontent.com); Hugging Face model
cards were egress-blocked → **UNVERIFIED** where noted, never guessed.

| ENGINE | MODEL | VRAM (smallest) | RESOLUTION | INPUT | MOTION CONTROL | IDENTITY | WALKING | HANDS | FACE | LICENSE | COMMERCIAL | LATENCY | ONIQ FIT | DECISION |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Motion Mirror | Wan2.1-VACE 1.3B / 14B-GGUF | **8 GB** (1.3B) | 480×832 ✓ | image + driver **video** | DWPose 133-kpt whole-body | 1.3B drifts / 14B locks | ✓ | ✓ | ✓ | code MIT; **1.3B path adds CC-BY-NC-SA LoRA (NC)** | 1.3B **NO** (NC LoRA); 14B yes | tens of min (offload); /5s UNVERIFIED | good, but NC-LoRA + wrapper deps | **SECONDARY** |
| **Wan2.1-VACE 1.3B (official)** | vace-1.3B | **~8 GB** (8.19 GB ref) | **480×832 native ✓** | image + control **video** (R2V+V2V) | OpenPose/DWPose skeleton (native) | 1.3B tier, some drift (UNVERIFIED) | ✓ | ✓ (DWPose) | ✓ | **Apache-2.0 code+weights** | **YES (clean)** | /5s UNVERIFIED | native contract, cleanest license, fewest deps | **BEST** |
| One-to-All-Animation | 1.3B-v1/v2, 14B | **16 GB** (T4; VRAM UNVERIFIED) | 832×480 ✓ | single image + pose pattern | pose (format UNVERIFIED) | by design; no metric | ✓ | UNVERIFIED | UNVERIFIED | code Apache-2.0; **weights UNVERIFIED** | likely, **weights unconfirmed** | ~5.5 min/5s (T4) | Wan-based, but weights license + format gaps | **EXPERIMENTAL** |
| StableAnimator | SVD-XT + face encoder | **8 GB** (512²) | 512² & 576×1024 (**no 480×832**) | image + **pose PNG sequence** | DWPose skeleton | **best dedicated ID design** | ✓ | ✓ | **strongest** | code MIT; **SVD (Stability CL, $1M gate) + Antelopev2/InsightFace (NC)** | **NO out-of-box** | ~1.7 min/5s (4090) | best identity, license-blocked + wrong aspect | **REJECT** (commercial) — keep as ID benchmark |
| Wan2.2 TI2V-5B | TI2V-5B / I2V-A14B | **24 GB** (5B) / 80 GB (14B) | 720p only (no 480×832) | **image + TEXT** (no driver) | none (S2V separate) | first-frame only | prompt-hallucinated | weak | weak | Apache-2.0 | yes | <9 min/5s 720p | wrong contract, too much VRAM | **REJECT** (not motion-transfer) |

## Winner: official Wan2.1-VACE 1.3B (used directly)

**Why (lowest-cost realistic):**
- **Smallest GPU** — ~8 GB VRAM verified (Wan's 8.19 GB 1.3B reference at 480P); **12 GB recommended production floor**, 8 GB the minimum.
- **Native 480×832 portrait** (config lists `480*832`/`832*480`) — matches ONIQ, no re-crop.
- **The contract exists natively**: VACE R2V (reference image = the ONIQ character) + V2V (OpenPose/DWPose control video = the motion driver) **is** (character image + motion driver). No wrapper needed.
- **Cleanest license in the set: Apache-2.0 code AND weights** — commercial-OK, no revenue gate, no InsightFace, no NC LoRA.

**Can it replace the Motion Mirror wrapper? YES.** Motion Mirror's value-add is packaging (DWPose extraction, rembg/SAM-2 segmentation, GGUF plumbing, `--fast`). Its 1.3B path's real risk is a **CC-BY-NC-SA-4.0 distill LoRA that makes 1.3B output non-commercial**. Going direct to VACE 1.3B keeps the identical reference-image + pose-video contract, the ~8 GB VRAM, and 480×832, and **removes the NC-LoRA contamination** — we re-implement only the DWPose + segmentation pre-pass (CPU-capable, ~350 MB detector).

**Runners-up:**
- **StableAnimator** — best identity architecture (HJB + Face Encoder), but **REJECT for shipping**: runnable stack needs Antelopev2/InsightFace (separate commercial license; free tier non-commercial) + SVD (Stability CL, $1M gate), and has no native 480×832. Keep purely as the identity-quality bar to beat.
- **One-to-All-Animation** — **EXPERIMENTAL**: heavier (16 GB T4), pose format unspecified, and **weights license unconfirmed** (code Apache-2.0) — a real business risk until the HF cards are checked.
- **Wan2.2 TI2V-5B** — **REJECT** for this task: 24 GB, 720p-only, and text-driven (no character+driver contract; motion is prompt-hallucinated, not transferred).

## Pipeline split (winner)
Character still + driver video → **DWPose pose extraction + segmentation (CPU-capable)** → OpenPose control frames → **Wan2.1-VACE 1.3B diffusion (GPU-only)** → ffmpeg audio mux (reuse ONIQ's ffmpeg). Only the diffusion needs the GPU.

## Phase-4 update — tiers, not one engine

The winner above (Wan2.1-VACE 1.3B) is the **diffusion tier (LEVEL 4)**, not the
whole answer. Phase 4 added a cheaper **LEVEL 3** engine that runs on **CPU** for
the majority of shots — **Meta Animated Drawings** (MIT code+weights,
single-image auto-rig + BVH retarget + ARAP render), which fits ONIQ's
storybook-illustrated art. The full 6-tier cost/quality architecture, the shot
policy, the pose cache, and the cost breakdown are in **`MOTION_COST_ARCHITECTURE.md`**.
Net: diffusion (this matrix's winner) is reserved for the shots CPU pose-warp
cannot serve (non-frontal / occluded / tight-framed / hands / talking /
photoreal), not run on every shot.

## Smallest realistic GPU
**8 GB verified minimum, 12 GB recommended production floor.** GPU is required — this is owner-gated spend; no paid service provisioned. See `OSS_MODEL_LICENSES.md` and `src/lib/motionProvider.ts` (`VACE_1_3B_META`, `makeVaceMotionProvider`).
