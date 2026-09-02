#!/usr/bin/env python3
"""BENCHMARK + PROOF: render a real clip in ENV B and check the pixels.

A render that exits 0 is not a render that produced anything. This drives
the same reference runner the provider's argv names, then DECODES the result
and measures it: how much of the frame the character occupies, and whether
consecutive frames actually differ. A dead GL context, a mask that swallowed
the character, or a retarget that froze the rig all exit 0 and all fail here.

Thresholds are floors, not targets. They are set well below what this stack
measured on a 2-core container (2026-09-02: 779 frames in 72.6 s, foreground
0.1107, inter-frame mean abs diff 1.579, 0 static frames of 210) so that
only a genuinely broken render trips them — a slower runner is not a defect.

WHAT DOES *NOT* TRANSFER ACROSS HOSTS: the exact bytes. Two runs on the
reference container produced byte-identical output (1,971,306 bytes), and
that is a real determinism result — but it is a WITHIN-HOST one. The
reference container renders on Mesa 25.1.7 from Ubuntu 24.04; this image is
built on Debian bookworm and carries a different Mesa, and a different
software rasteriser is entitled to different pixels. So the wall-clock and
the byte count are RECORDED for comparison and never asserted against the
native figures; determinism is proved where the claim is actually valid, by
rendering twice HERE and comparing the two. Set ONIQ_ARAP_DETERMINISM=1 for
that second pass (the `proofs` entrypoint does).

Usage:  benchmark.py [out.gif]
Env:    AD_DIR, ONIQ_ARAP_SCRIPTS, ONIQ_ARAP_CHAR, ONIQ_ARAP_MOTION
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

AD = Path(os.environ.get("AD_DIR", "/opt/oniq/AnimatedDrawings"))
SCRIPTS = Path(os.environ.get("ONIQ_ARAP_SCRIPTS", "/opt/oniq/scripts"))
CHAR = Path(os.environ.get("ONIQ_ARAP_CHAR", str(AD / "examples/characters/char1")))
MOTION = Path(os.environ.get("ONIQ_ARAP_MOTION", str(AD / "examples/config/motion/zombie.yaml")))
RETARGET = SCRIPTS / "retarget_armdamped_reference.yaml"
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/work/benchmark.gif")

# Floors. Generous on purpose — see the docstring.
MIN_FRAMES = 100
MIN_FG_FRACTION = 0.02
MIN_INTERFRAME_DIFF = 0.20
MAX_STATIC_FRACTION = 0.10
MIN_GIF_FPS = 0.5

env = dict(os.environ)
env.setdefault("PYOPENGL_PLATFORM", "osmesa")
env.setdefault("MESA_GL_VERSION_OVERRIDE", "3.3")

OUT.parent.mkdir(parents=True, exist_ok=True)
argv = [sys.executable, str(SCRIPTS / "l3_animate_reference.py"),
        str(AD), str(CHAR), str(MOTION), str(RETARGET), str(OUT)]
print("RUN", " ".join(argv))

t0 = time.time()
proc = subprocess.run(argv, env=env, capture_output=True, text=True)
wall = time.time() - t0

# The runner's own measurements, echoed rather than re-derived.
stats = {}
for line in proc.stdout.splitlines():
    parts = line.split()
    if parts and parts[0] in ("RENDER_SECONDS", "MAX_RSS_MB", "OUTPUT_EXISTS"):
        print(line)
    if parts and parts[0] in ("RENDER_SECONDS", "MAX_RSS_MB"):
        stats[parts[0]] = float(parts[1])

if proc.returncode != 0:
    print("FAIL: the render exited", proc.returncode)
    print(proc.stderr[-2000:])
    sys.exit(1)
if not OUT.is_file() or OUT.stat().st_size == 0:
    print(f"FAIL: no output at {OUT}")
    sys.exit(1)

from PIL import Image, ImageSequence  # noqa: E402
import numpy as np  # noqa: E402

frames = [np.asarray(f.convert("RGB"), dtype=np.int16)
          for f in ImageSequence.Iterator(Image.open(OUT))]
n = len(frames)
h, w, _ = frames[0].shape
bg = frames[0][0, 0]

def fg(f):
    return float((np.abs(f - bg).sum(axis=2) > 24).mean())

# The last GIF frame is a trailer and is legitimately empty; measure the body.
body = frames[:-1] if n > 1 else frames
fgs = [fg(f) for f in body]
diffs = [float(np.abs(frames[i] - frames[i - 1]).mean()) for i in range(1, n)]
static = sum(1 for d in diffs if d < 0.01)
render_s = stats.get("RENDER_SECONDS", wall)
# GIF frames, NOT render frames: the encoder de-duplicates, so this is
# smaller than the renderer's own count (779 -> 211 on the reference run).
# Named for what it measures so nobody reads it as render throughput.
gif_fps = (n / render_s) if render_s else 0.0

# The renderer that actually produced these pixels, on record — so a
# comparison against the native baseline is made on the right axis rather
# than by assuming the two hosts rasterise alike.
gl = {}
try:
    import subprocess as _sp
    _probe = _sp.run(
        [sys.executable, str(Path(__file__).with_name("osmesa_render.py"))],
        env=env, capture_output=True, text=True, timeout=120,
    )
    for line in _probe.stdout.splitlines():
        if line.startswith("GL_VERSION"):
            gl["version"] = line.split(None, 1)[1].strip()
        elif line.startswith("GL_RENDERER"):
            gl["renderer"] = line.split(None, 1)[1].strip()
except Exception as e:  # noqa: BLE001  — a probe failure is not a render failure
    gl["error"] = str(e)[:120]

digest = hashlib.sha256(OUT.read_bytes()).hexdigest()

report = {
    "gl": gl, "output_sha256": digest,
    "gif_frames": n, "frame_size": f"{w}x{h}",
    "render_seconds": round(render_s, 1), "wall_seconds": round(wall, 1),
    "gif_frames_per_render_second": round(gif_fps, 2),
    "max_rss_mb": stats.get("MAX_RSS_MB"),
    "output_bytes": OUT.stat().st_size,
    "foreground_fraction_mean": round(sum(fgs) / len(fgs), 4),
    "foreground_fraction_min": round(min(fgs), 4),
    "interframe_mean_abs_diff": round(sum(diffs) / len(diffs), 3) if diffs else 0.0,
    "static_frames": static, "compared_pairs": len(diffs),
}
print("BENCHMARK " + json.dumps(report))

fail = []
if n < MIN_FRAMES:
    fail.append(f"{n} frames, floor {MIN_FRAMES}")
if report["foreground_fraction_mean"] < MIN_FG_FRACTION:
    fail.append(f"foreground {report['foreground_fraction_mean']} of frame, floor "
                f"{MIN_FG_FRACTION} — the character is missing or the mask ate it")
if report["interframe_mean_abs_diff"] < MIN_INTERFRAME_DIFF:
    fail.append(f"inter-frame diff {report['interframe_mean_abs_diff']}, floor "
                f"{MIN_INTERFRAME_DIFF} — the rig is not moving")
if diffs and static / len(diffs) > MAX_STATIC_FRACTION:
    fail.append(f"{static}/{len(diffs)} identical frame pairs, ceiling "
                f"{MAX_STATIC_FRACTION:.0%}")
if gif_fps < MIN_GIF_FPS:
    fail.append(f"{gif_fps:.2f} gif-frames/render-second, floor {MIN_GIF_FPS}")

# DETERMINISM, proved where the claim holds: the same image, twice.
if os.environ.get("ONIQ_ARAP_DETERMINISM") == "1" and not fail:
    second = OUT.with_name(OUT.stem + "-again" + OUT.suffix)
    argv2 = list(argv); argv2[-1] = str(second)
    print("RUN (second pass, determinism)")
    p2 = subprocess.run(argv2, env=env, capture_output=True, text=True)
    if p2.returncode != 0 or not second.is_file():
        fail.append(f"the second render exited {p2.returncode} — cannot check determinism")
    else:
        d2 = hashlib.sha256(second.read_bytes()).hexdigest()
        print(f"DETERMINISM run1={digest}")
        print(f"DETERMINISM run2={d2}")
        if d2 != digest:
            fail.append("two renders of the same input in the same image "
                        "produced different bytes — the pipeline is not deterministic")
        else:
            print("PROOF determinism: two renders, byte-identical output")
        second.unlink(missing_ok=True)

if fail:
    for f in fail:
        print("FAIL:", f)
    sys.exit(1)
print("PROOF render: real moving pixels, within every floor")
