#!/usr/bin/env python3
"""Wan2.1-I2V-14B-480P benchmark harness — the GPU-day runner, versioned.

Runs ONE image-to-video experiment through the OFFICIAL Wan2.1 generate.py
(github.com/Wan-Video/Wan2.1) with EXACTLY the argv that ONIQ's provider
builds (src/lib/wanProvider.ts buildWanI2vArgs — task i2v-14B, 832*480,
81 frames, recorded seed, explicit --offload_model), then validates the
output the same way production validates a Veo clip: decode real frames and
score temporal aliveness with the SAME metric and threshold the worker uses
(src/lib/motionRuntime.ts — mean abs luminance diff, sampled, min 0.75).
A drift between this file and those modules fails a vitest pin.

WHAT IT NEVER DOES: fabricate output, invent pricing, or soften the gate.
A missing/undecodable/static result exits non-zero with the reason in the
record. Pixel judgments beyond aliveness (CHARACTER_MOVED, identity,
anatomy, temporal coherence) stay HUMAN, frame-by-frame, per the
Veo-validation discipline — this harness only produces the frames and the
record for that inspection.

Usage (on the provisioned GPU host — never in ONIQ's CPU environments):

  python3 wan_i2v_reference.py \
    --wan_repo /host/Wan2.1 \
    --ckpt_dir /host/models/Wan2.1-I2V-14B-480P \
    --revision <hf-commit-recorded-at-download> \
    --image /host/fixture/f_013.20.png \
    --prompt "a person walking forward, natural gait, full body" \
    --seed 20260822 \
    --out /host/out/walk-s20260822.mp4 \
    --record /host/out/walk-s20260822.json
"""

import argparse
import hashlib
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

# Pinned against src/lib/wanProvider.ts (WAN21_I2V_RUN / buildWanI2vArgs).
MODEL_ID = "Wan-AI/Wan2.1-I2V-14B-480P"
TASK = "i2v-14B"
SIZE = "832*480"
FRAME_NUM = 81
FPS = 16
# Pinned against src/lib/motionRuntime.ts (CLIP_ALIVENESS_MIN).
ALIVENESS_MIN = 0.75
ALIVENESS_W, ALIVENESS_H = 192, 342


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def decode_frame_rgba(video: Path, t: float) -> bytes:
    """One frame at t seconds as raw RGBA at the analysis size (ffmpeg)."""
    out = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video),
            "-vf", f"scale={ALIVENESS_W}:{ALIVENESS_H}",
            "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
        ],
        capture_output=True, check=True,
    ).stdout
    expected = ALIVENESS_W * ALIVENESS_H * 4
    if len(out) != expected:
        raise RuntimeError(f"decode at {t}s returned {len(out)} bytes, expected {expected}")
    return out


def luminance_diff(a: bytes, b: bytes) -> float:
    """Mean abs luminance diff, every other pixel — motionRuntime's metric."""
    total, n = 0.0, 0
    for i in range(0, len(a), 8):
        la = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]
        lb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]
        total += abs(la - lb)
        n += 1
    return total / n if n else float("nan")


def gpu_snapshot() -> dict:
    try:
        q = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,driver_version",
             "--format=csv,noheader"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return {"nvidia_smi": q}
    except Exception as e:  # noqa: BLE001 — recorded, not hidden
        return {"nvidia_smi_error": str(e)}


class VramPeak(threading.Thread):
    """Polls nvidia-smi memory.used; the peak goes into the record."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.peak_mib = 0
        self.stop = threading.Event()

    def run(self) -> None:
        while not self.stop.is_set():
            try:
                used = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, check=True,
                ).stdout.strip().splitlines()
                self.peak_mib = max(self.peak_mib, max(int(x) for x in used))
            except Exception:  # noqa: BLE001 — polling best-effort
                pass
            time.sleep(2)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--wan_repo", required=True, help="checkout of github.com/Wan-Video/Wan2.1")
    p.add_argument("--ckpt_dir", required=True)
    p.add_argument("--revision", required=True, help="HF checkpoint commit recorded at download")
    p.add_argument("--image", required=True)
    p.add_argument("--prompt", required=True, help="movement only — never character biography")
    p.add_argument("--seed", type=int, required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--record", required=True)
    a = p.parse_args()

    image, out = Path(a.image), Path(a.out)
    record: dict = {
        "model_id": MODEL_ID,
        "revision": a.revision,
        "task": TASK,
        "size": SIZE,
        "frames": FRAME_NUM,
        "fps": FPS,
        "seed": a.seed,
        "prompt": a.prompt,
        "source_image": str(image),
        "source_sha256": sha256(image),
        "gpu": gpu_snapshot(),
        "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    # EXACTLY the provider's argv (buildWanI2vArgs), executed for real.
    args = [
        sys.executable, "generate.py",
        "--task", TASK,
        "--size", SIZE,
        "--ckpt_dir", a.ckpt_dir,
        "--image", str(image),
        "--prompt", a.prompt,
        "--frame_num", str(FRAME_NUM),
        "--base_seed", str(a.seed),
        "--save_file", str(out),
        "--offload_model", "True",
    ]
    record["argv"] = args[1:]

    vram = VramPeak()
    vram.start()
    t0 = time.monotonic()
    proc = subprocess.run(args, cwd=a.wan_repo)
    record["inference_seconds"] = round(time.monotonic() - t0, 1)
    vram.stop.set()
    record["peak_vram_mib"] = vram.peak_mib

    def finish(status: str, code: int) -> int:
        record["status"] = status
        Path(a.record).write_text(json.dumps(record, indent=2))
        print(json.dumps(record, indent=2))
        return code

    if proc.returncode != 0:
        record["failure_reason"] = f"generate.py exited {proc.returncode}"
        return finish("GENERATION_FAILED", 1)
    if not out.exists() or out.stat().st_size == 0:
        record["failure_reason"] = "no output file produced"
        return finish("NO_OUTPUT", 1)

    record["output_sha256"] = sha256(out)
    record["output_bytes"] = out.stat().st_size

    # The production gate: three frames, same metric, same threshold.
    duration = FRAME_NUM / FPS
    try:
        frames = [decode_frame_rgba(out, t) for t in (0.0, duration / 2, max(0.0, duration - 0.2))]
    except Exception as e:  # noqa: BLE001 — an undecodable clip is a failure
        record["failure_reason"] = f"decode failed: {e}"
        return finish("UNDECODABLE", 1)

    diffs = [luminance_diff(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
    aliveness = sum(diffs) / len(diffs)
    record["aliveness"] = round(aliveness, 2)
    record["aliveness_min"] = ALIVENESS_MIN

    if aliveness < ALIVENESS_MIN:
        record["failure_reason"] = f"static output (aliveness {aliveness:.2f} < {ALIVENESS_MIN})"
        return finish("STATIC_REJECTED", 1)

    # Aliveness proves temporal change, never character motion — that verdict
    # is the human frame inspection this record now feeds.
    record["next"] = "human frame inspection: CHARACTER_MOVED / identity / anatomy / temporal"
    return finish("ALIVE_PENDING_PIXEL_REVIEW", 0)


if __name__ == "__main__":
    sys.exit(main())
