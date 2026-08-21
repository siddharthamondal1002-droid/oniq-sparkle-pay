# OSS motion-provider licenses

The motion-provider layer (`src/lib/motionProvider.ts`) can drive a self-hosted
open-source engine beside the existing Google-direct Veo path. This records the
licenses of the candidate models and their key dependencies, so a commercial
decision is made against the actual terms, not a demo.

**No model weights live in this repository.** Weights are tens of GB and are
fetched at deploy time on the GPU host, never committed to git. This file tracks
license terms only.

## Primary candidate — Wan2.2 (image-to-video / TI2V)

| Item | License | Commercial SaaS | Notes |
|---|---|---|---|
| Wan2.2 code (`Wan-Video/Wan2.2`) | **Apache-2.0** | **Yes** | Permissive; no revenue/MAU cap. |
| Wan2.2 model weights (TI2V-5B, I2V-14B, S2V-14B) | **Apache-2.0** | **Yes** | Same license on the HF model cards. |

First target is **Wan2.2 TI2V-5B** (the ~8–12 GB, lower-cost checkpoint), **not**
Animate-14B — quality is adequate for ordinary walking/gesture shots at a
fraction of the VRAM/cost. Source: https://github.com/Wan-Video/Wan2.2 ·
https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B

## Optional — audio-driven lip-sync (only where needed)

| Item | License | Commercial SaaS | Notes |
|---|---|---|---|
| MuseTalk (`TMElyralab/MuseTalk`) | **MIT (code)**, commercially-usable weights | **Yes** | Real-time; used only for arbitrary generated characters that the 11-rig lip-sync cannot cover. https://github.com/TMElyralab/MuseTalk |
| LatentSync (`bytedance/LatentSync`) | **Apache-2.0** | **Yes** | Higher lip accuracy alternative to MuseTalk. https://github.com/bytedance/LatentSync |

## Explicitly REJECTED for a paid product (do not adopt)

| Model | Reason |
|---|---|
| Wav2Lip pretrained weights | Trained on LRS2 — **non-commercial**. |
| LivePortrait (default pipeline) | Pulls InsightFace `buffalo_l` — **non-commercial** — unless the face detector is swapped for a permissive one. |
| MimicMotion | **Research/education only** — explicitly no production use. |
| AnimateAnyone / MagicAnimate | Official weights restricted / unreleased. |
| HunyuanVideo family | Tencent Community License — **blocked in EU/UK/South Korea**, discretionary above 100M MAU. |
| CogVideoX weights | Free commercial only up to **1M service visits/month**. |

## Dependency license posture

Standard inference stacks for the accepted models (PyTorch BSD-3, diffusers
Apache-2.0, transformers Apache-2.0, ffmpeg LGPL/GPL as already used) are
compatible. The one recurring trap is **InsightFace** (`buffalo_l` weights,
non-commercial) pulled transitively by some face pipelines — if any lip-sync or
face step introduces it, replace the detector before shipping.

## Hardware note (not a license issue, but a cost one)

OSS ≠ free to run. Every accepted model is **GPU-mandatory** — none runs on the
current CPU-only GitHub Actions worker in usable time. A GPU execution host
(cloud GPU or reserved instance) is required before a real clip can be produced,
and that is an owner-gated spend, tracked separately from Lovable credits
(stills/voice) and Google-metered billing (Veo). See `src/lib/motionProvider.ts`
`ProviderMeta.billing`.
