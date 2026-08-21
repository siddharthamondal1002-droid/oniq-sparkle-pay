# OSS motion-provider licenses

The motion-provider layer (`src/lib/motionProvider.ts`) can drive a self-hosted
open-source engine beside the existing Google-direct Veo path. This records the
licenses of the candidate models and their dependencies so a commercial decision
is made against actual terms, not a demo.

**No model weights live in this repository.** Weights are tens of GB and are
fetched at deploy time on the GPU host, never committed to git. This file tracks
license terms only.

**Verification note.** Code-repo `LICENSE` files were read directly from
`raw.githubusercontent.com` and are marked VERIFIED. Hugging Face model-card
licenses could **not** be read (huggingface.co is egress-blocked in this
environment) and are marked **UNVERIFIED** — read the HF card before shipping.

## Primary — Motion Mirror (motion TRANSFER, Wan2.1-VACE)

`halli75/motion-mirror` (v0.4.0a0, alpha). Pipeline: character still + driver
motion video → rembg/SAM-2 segment → DWPose-L whole-body pose (body+hands+face,
via rtmlib/ONNX) → OpenPose skeleton conditioning → **Wan2.1-VACE** diffusion →
ffmpeg audio passthrough. Output background follows the CHARACTER image, not the
driver scene (identity-preserving). Single-person driver videos only.

| Component | License | Commercial SaaS | Status |
|---|---|---|---|
| Motion Mirror code | **MIT** | **Yes** | VERIFIED (LICENSE read) |
| Wan2.1 / Wan2.1-VACE **code** | **Apache-2.0** | **Yes** | VERIFIED (Wan-Video/Wan2.1 LICENSE) |
| Wan2.1-VACE **weights** (1.3B, 14B, 14B-GGUF) | Apache-2.0 (claimed) | Yes (subject to Wan model card) | **UNVERIFIED** (HF blocked) |
| DWPose (pose) code | **Apache-2.0** | Yes | VERIFIED |
| rtmlib (pose wrapper, no mmcv/mmpose) | **Apache-2.0** | Yes | VERIFIED |
| YOLOX detector | Apache-2.0 | Yes | code VERIFIED; ONNX weights UNVERIFIED |
| DWPose/YOLOX ONNX weights | Apache-2.0 (claimed) | Yes | **UNVERIFIED** (HF blocked) |
| rembg (U²-Net segmenter) | MIT (code) / Apache-2.0 (U²-Net weights) | Yes | code VERIFIED; weights UNVERIFIED |
| SAM-2 (optional segmenter) | Apache-2.0 | Yes | code VERIFIED; weights UNVERIFIED |
| onnxruntime | MIT | Yes | known |
| bundled ffmpeg | LGPL-2.1 (dynamic link) | Yes | known |

**The one commercial trap — do NOT enable `--fast` on the 1.3B backend.** That
path fuses a **Self-Forcing DMD distill LoRA that Motion Mirror labels
CC-BY-NC-SA-4.0 — non-commercial**; MM firewalls it behind an explicit opt-in
download and a license warning. The Self-Forcing *code* repo is Apache-2.0
(VERIFIED); the *weights* license is UNVERIFIED (HF blocked) but MM's warning is
authoritative — treat 1.3B-`--fast` output as non-commercial and never set that
flag in the product. The **14B `--fast` LoRA (LightX2V) is Apache-2.0** and is
fine.

**Clean commercial path:** `wan-1.3b-vace` or `wan-14b-vace*` **without** `--fast`
on 1.3B. `InsightFace`/`buffalo_l` (the usual non-commercial face trap) is **not
present** in this stack.

## Secondary — Wan2.2 (image-to-video, for complex/generative shots)

| Item | License | Commercial | Status |
|---|---|---|---|
| Wan2.2 code | **Apache-2.0** | Yes | VERIFIED |
| Wan2.2 weights (TI2V-5B / I2V-14B / S2V-14B) | Apache-2.0 (claimed) | Yes | **UNVERIFIED** (HF) |

Used as the `i2v` provider (`WAN22_META`) for shots a pose driver does not fit.

## Optional — lip-sync for arbitrary generated characters (TALK shots)

Motion Mirror has **no lip-sync** — it muxes the driver's audio through, nothing
more. For a talking arbitrary character, ONIQ adds a SEPARATE lip-sync stage on
top of the motion-transfer video, keeping Rhubarb→rig for the 11 demo characters.

| Item | License | Commercial | Status |
|---|---|---|---|
| MuseTalk code | **MIT** | Yes | UNVERIFIED here (HF blocked; upstream states MIT) |
| MuseTalk weights | commercially-usable (stated) | Yes | **UNVERIFIED** |
| LatentSync (alt) | **Apache-2.0** | Yes | UNVERIFIED here |

If MuseTalk degrades identity, fall back to the non-lip-synced motion clip rather
than corrupting the shot.

## Explicitly REJECTED (do not adopt)

| Model | Reason |
|---|---|
| Self-Forcing 1.3B `--fast` LoRA | CC-BY-NC-SA-4.0 — **non-commercial** |
| Wav2Lip pretrained weights | LRS2 — non-commercial |
| LivePortrait default pipeline | pulls InsightFace `buffalo_l` — non-commercial |
| MimicMotion | research/education only |
| HunyuanVideo family | Tencent license — EU/UK/SK blocked, 100M-MAU discretion |
| CogVideoX weights | free commercial only to 1M visits/month |

## Hardware (a cost note, not a license one)

OSS ≠ free to run. **Motion Mirror's VACE diffusion is strictly GPU** (pose +
segmentation can run on CPU via onnxruntime; the diffusion cannot). Measured
requirements: `wan-1.3b-vace` ≈ 9 GB VRAM / 32 GB RAM / ~20 GB disk; recommended
`wan-14b-vace-gguf` ≈ 18 GB VRAM / 40 GB RAM / ~45 GB disk; CUDA 12.x, driver
570+. Per-clip latency is **UNVERIFIED** (README: "tens of minutes" under CPU
offload, "much faster on 24 GB+"; `--fast` = 5–10× fewer steps). A GPU host is
owner-gated spend, tracked separately from Lovable credits (stills/voice) and
Google-metered billing (Veo) — see `ProviderMeta.billing` in `motionProvider.ts`.
The Story Worker stays CPU/orchestration-only; the GPU backend runs out of
process (a GPU worker/API behind `MotionBackend.run()`), never installed into
the ordinary worker.
