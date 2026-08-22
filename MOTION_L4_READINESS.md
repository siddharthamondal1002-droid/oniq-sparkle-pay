# L4 VACE readiness — the exact L3 failure (Phase 9)

**Goal:** run ONE real Wan2.1-VACE 1.3B clip on the EXACT Phase-8 input (Aladdin
still + the same walk) and A/B it against the L3 arm-claw. **Blocking gate hit:
this environment has NO GPU and no authorized GPU spend.** Per the phase's own
rule ("if no already-authorized GPU is available: STOP BEFORE SPENDING and
report L4 READY — GPU REQUIRED"), I prepared everything to the GPU boundary and
stopped. **Verdict: READY_BUT_GPU_UNAVAILABLE. GPU=0, API cost ₹0, nothing spent.**

## GPU gate — MEASURED

| Check | Result |
|---|---|
| `nvidia-smi` | not found |
| `torch.cuda.is_available()` | **False** (device_count 0) |
| `/dev/nvidia*` | none |
| Host | 4 CPU cores, 15 GB RAM — CPU-only |
| Authorized cloud GPU / spend | **none** |

Wan2.1-VACE 1.3B is a GPU diffusion model. Running it on this CPU box is not a
real validation (it would take hours and risk OOM in 15 GB) and is not what the
phase asks — so it was **not** attempted. No money was spent.

## Minimum GPU config (verified from primary sources, MOTION_ENGINE_MATRIX.md)

- **8 GB VRAM** runs the 1.3B path (Wan's 8.19 GB reference at 480P);
  **12 GB** is the safe production floor. Preference order per the directive:
  **8 GB → 12 GB → 16 GB**; do NOT provision 24 GB+/A100 unless a smaller card is
  proven insufficient.
- Concrete fits: **RTX 3060 12 GB**, **T4 16 GB**, RTX 4090 (24 GB, overkill).
- **Apache-2.0 code AND weights** — commercial-clean, no Veo, no Google, no
  InsightFace, no NC LoRA.

## Exact backend + command (versioned in code, run nothing here)

`src/lib/motionProvider.ts`:
- `VACE_1_3B_RUN` — the spec: `minVramGb 8`, `recommendedVramGb 12`, native
  `480x832`, task `vace-1.3B`, Apache-2.0 weights dir.
- `buildVaceArgs(...)` — builds the exact `generate.py` argv. For this shot:

```
generate.py --task vace-1.3B --size 480*832 --ckpt_dir ./models/Wan2.1-VACE-1.3B \
  --src_ref_images <aladdin_still.png>   # IDENTITY (reference image)
  --src_video <walk_pose_control.mp4>    # MOTION (pose control from the SAME driver)
  --frame_num <measured> --prompt "a person walking forward, natural gait, full body" \
  --save_file <clip.mp4>
```

- `gpuVaceBackend(spec, runner, kind)` — a `remote-gpu`/`local-gpu` `MotionBackend`.
  With no runner (the case here) it is **unavailable**, so the provider misses and
  the caller falls to the still — **never a fabricated clip**. No torch/CUDA is
  imported; all GPU work is the injected runner's, out of process.
- `makeVaceMotionProvider(backend, registry)` (existing) returns the exact
  `MotionClip` the pipeline already consumes (`probeAsset('clip')` → `shot.clip`
  → StoryFilm) — proven in Phase 7 with a real clip.

## Input contract (ACTOR ASSET ≠ PERMANENT BIOGRAPHY)

- **Identity** = the Aladdin still (`--src_ref_images`), the SAME image L3 used.
- **Motion** = a pose-control video derived from the SAME `zombie.bvh` walk (a
  CPU pre-pass renders the driver's skeleton to an OpenPose/DWPose control video),
  so the A/B compares identical motion.
- **Prompt** = movement only (`motionOnlyPrompt(motionClass)`); `buildVaceArgs`
  has **no** character/appearance parameter by design, so an actor's traits can
  never leak into the motion prompt. A regression test pins that the WALKING
  prompt contains no identity words.
- Resolution: minimum practical **480×832** (the phase asks for motion validity,
  not final cinematic quality). Duration: match the L3 clip (~4 s).
- Audio: silent passthrough (pure motion-transfer test — no MuseTalk, no Rhubarb).

## What is MEASURED vs ESTIMATED

- **MEASURED:** no GPU; L3 baseline arm = FAIL (the claw, Phase 8); the provider
  contract, arg builder, fail-closed backend, and router ordering — 45/45 motion
  tests pass on CPU.
- **ESTIMATED (NOT measured — needs the real run):** L4 arm/hand/leg/identity/
  temporal results, whether the claw is resolved, runtime, VRAM peak, output, cost.
  Rough figures (flagged, never presented as measured): ~3–10 min per ~4 s 480×832
  clip on a T4/3060; **~₹5–15/clip** cloud-equivalent (MOTION_COST_ARCHITECTURE.md).
  **No L4 quality claim is made until a real clip is inspected.**

## Router (defined, fails closed — NOT globally enabled)

```
L0 static          → still
L1 camera/parallax → in-house (CPU)
L2 demo rigs       → the 11 measured rigs (CPU)
L3 pose-warp       → Animated Drawings, ELIGIBLE shots only (single/frontal/
                     full-body/in-plane/arms-not-flush) — Phase 6-8
L4 diffusion       → Wan2.1-VACE 1.3B for ARAP-ineligible articulation
                     (arms/torso, out-of-plane limbs, detailed characters) ← this phase
L5 premium         → Veo (hero, owner-gated)
```
Fail-closed (`selectMotionLevel` + `selectProviderOrder` + `runMotion`): L4
unavailable → L3 only when eligible, else the still/depth path. **Never a torn L3
clip just because L4 is down; never a still relabeled as character animation.**

## Final report

```
GPU:            none (CPU-only host: 4 cores / 15 GB RAM)
VRAM:           0 (required: 8 GB min, 12 GB floor)
L3 ARM:         FAIL (claw — Phase 8, measured)
L4 ARM:         NOT RUN (no GPU) — estimated to resolve; unverified
L4 HAND:        NOT RUN          L4 LEGS: NOT RUN
L4 IDENTITY:    NOT RUN          L4 TEMPORAL: NOT RUN
ACTUAL WALK:    NOT RUN
CLAW:           PRESENT in L3; L4 resolution UNVERIFIED (needs the real clip)
RUNTIME:        not measured (est. ~3–10 min/clip on T4/3060)
VRAM PEAK:      not measured (req. ≥8 GB)
OUTPUT:         not produced (no GPU)
MOTIONCLIP:     PASS (contract + arg builder + fail-closed backend, 45/45 tests)
STORYFILM:      NOT RUN (needs a real L4 clip; Phase 7 already proved the path)
ACTUAL COST:    ₹0 (nothing provisioned, nothing spent)
L4 VERDICT:     READY_BUT_GPU_UNAVAILABLE
ROUTER:         L3 eligible→pose-warp; ineligible/arms-torso→L4; L4 down→still (fail-closed)
FILES:          src/lib/motionProvider.ts (VACE_1_3B_RUN, buildVaceArgs,
                gpuVaceBackend, motionOnlyPrompt), src/lib/__tests__/motionProvider.test.ts,
                MOTION_L4_READINESS.md
TESTS:          45/45 motion tests pass (9 new: min-GPU spec, exact args,
                data-path via injected runner, fail-closed→still, ordering)
MAIN:           unchanged (L4 provider stays on claude/resume-3cpm82)
WORKING TREE:   clean
```

## L4 READY — GPU REQUIRED (the one authorization needed)

To run the real A/B: provision ONE **8–12 GB GPU** (RTX 3060 12 GB or T4 16 GB),
download the Apache-2.0 `Wan2.1-VACE-1.3B` weights, run `buildVaceArgs(...)` on
the Aladdin still + the zombie walk's pose-control video, and inspect the clip
against the L3 baseline. **NEXT STEP (one action):** owner authorizes a single
8–12 GB GPU hour (est. ~₹5–15 for one clip); I then run the one clip and report
measured L4 vs L3 — resolving CLAW = RESOLVED / PRESENT with real pixels. No
GPU is provisioned and nothing is spent until that authorization.
