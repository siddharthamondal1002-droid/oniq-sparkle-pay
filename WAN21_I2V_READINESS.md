# Wan2.1-I2V-14B-480P readiness — code-complete, GPU-gated

**Date:** 2026-08-22 · **Loop:** open-weight character-motion provider ·
**Verdict: WAN_GPU_VALIDATION_REQUIRED.** Everything runnable without a GPU is
done and tested; nothing was fabricated; ₹0 spent.

## Hardware gate — MEASURED (this environment)

| Check | Result |
|---|---|
| `nvidia-smi` | not found |
| `/dev/nvidia*` | none |
| PyTorch | not installed |
| Host | 4 CPU cores, 15 GB RAM |
| Free disk | ~11 GB (fixed session allowance) |
| Authorized GPU spend | **none** |

A 14-billion-parameter video diffusion model cannot be downloaded (~28 GB+
weights vs ~11 GB disk), loaded (weights exceed 15 GB RAM), or inferred (no
GPU, and CPU inference of a 14B DiT is not a real validation) here. Phases
4–6 of the loop are therefore executed on the GPU host per the procedure
below — never simulated.

## Model + license facts (recorded, with sources)

- **Model:** `Wan-AI/Wan2.1-I2V-14B-480P` (official Hugging Face repo).
  `huggingface.co` is egress-blocked from this environment (proxy 403,
  measured), so the **official GitHub repository
  `github.com/Wan-Video/Wan2.1` is the primary source fetched** (2026-08-22).
- **CODE_LICENSE:** Apache-2.0 (repository license header).
- **MODEL_LICENSE:** "The models in this repository are licensed under the
  Apache 2.0 License." — README, verbatim.
- **COMMERCIAL_USE:** permitted (Apache-2.0). **REDISTRIBUTION /
  MODIFICATION:** permitted with license preservation (Apache-2.0 §4).
- **GENERATED_CONTENT / RESTRICTIONS:** the README adds an accountability
  clause (no unlawful/harmful content, no misinformation, no targeting of
  vulnerable groups) — a use policy, not a commercial restriction.
- **ATTRIBUTION:** Apache-2.0 NOTICE/license retention on redistribution of
  code/weights; none required on generated video.
- **Revision pin:** the exact checkpoint revision could NOT be recorded from
  here (HF blocked). **First step on the GPU host:** record
  `huggingface-cli download Wan-AI/Wan2.1-I2V-14B-480P --revision main` and
  the resolved commit hash into the run record. UNKNOWN until then.
- **VRAM:** not stated per-variant in the fetched README text. Community
  measurements (secondary, unverified): ~40 GB-class comfortable at 480P;
  consumer 24 GB possible with `--offload_model True`; single-digit VRAM only
  under heavy quantization at large speed cost. **Measured on the host, never
  assumed.**

## What landed in code (pure, fail-closed, additive)

- `src/lib/wanProvider.ts` — `WAN21_I2V_META` (role `i2v`, `requiresGpu`,
  `billing: gpu-compute`, price honestly `null`), `WAN21_I2V_RUN` (official
  task/size/frames/fps/license pinned), `buildWanI2vArgs` (the exact
  `generate.py` argv, movement-only prompt, recorded seed, explicit
  `--offload_model`), `makeWanI2vProvider(runner)` — unavailable with no
  injected GPU runner, structured transient/permanent misses, never inline
  bytes.
- `src/lib/__tests__/wanProvider.test.ts` — 14 tests: default OFF, dropped
  from selection when unavailable, fail-closed miss reasons, additive
  ordering beside Veo (OSS leads, premium appended, never replaced),
  exception → structured transient, exact argv, identity-free prompt, and
  separation pins (motionProvider.ts — L3R's frozen home — carries no Wan
  code; the worker still speaks only to story-clip).
- NOT wired into the story worker: the worker's clip stage stays Veo-only
  until a GPU host exists. The provider fabric is where Wan lives; the
  motion contract's FAILED/FALLBACK vocabulary already covers any provider.

## The GPU-day procedure (exact, so the run is an execution, not a design)

1. **Host:** one 40 GB-class GPU (A100 40GB / L40S) preferred; RTX 4090 24 GB
   acceptable with `--offload_model True`. Record GPU, driver, CUDA, torch.
2. **Acquire:** official repo + checkpoint; record revision hash; weights in
   a cache outside git.
3. **Load test:** pipeline components load; record peak RAM/VRAM.
4. **Smoke:** any non-production image, smallest clip; verify decode + frame
   count. No motion claims.
5. **Fixture:** the proven ONIQ walking actor — branch `val-motion-98952740`,
   `frames/f_013.20.png` (the Veo validation's walking character at clip
   start). Record its SHA-256 and dimensions before use; never alter it.
6. **WALK experiment:** `buildWanI2vArgs` verbatim with
   prompt "a person walking forward, natural gait, full body", seed 20260822,
   81 frames @ 16 fps, 832*480. Record inference time, peak VRAM, output
   hash/size.
7. **Validation:** decode first/early/middle/late/final frames; judge
   CHARACTER_MOVED / identity / anatomy / temporal per the Veo-validation
   discipline; run the aliveness gate (`temporalAliveness`) on sampled
   frames — static output must fail it.
8. **Then** GESTURE and TURN/REACH with the same fixture, one variable at a
   time; a small deterministic seed set for robustness; measured ₹/clip from
   the host's actual hourly price.

## Cost posture

Veo Select baseline (measured 2026-08-22): ₹706 list for 56 video-seconds.
Wan's ₹/clip is **UNKNOWN** — GPU pricing is not invented here; it is the
host's hourly rate × measured inference time, recorded on the day.

## The one authorization needed

Provision ONE GPU host meeting §GPU-day step 1 (or grant existing approved
compute). Until then Wan remains: code-complete, tested, default OFF,
unreachable in production, and honest about every UNKNOWN.
