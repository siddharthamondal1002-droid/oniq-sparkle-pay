#!/usr/bin/env python3
# L3 CPU character animation — REFERENCE / PROOF script (Phase 5).
#
# Proves the cheap tier: a still illustrated character + a BVH motion driver ->
# a real walking-character mp4, on CPU only (GPU=0, API cost 0). Uses Meta
# Animated Drawings (MIT code + weights) — rig + BVH retarget + ARAP 2D deform +
# headless OSMesa render. This is NOT wired into the production Story Worker; it
# documents the proven method for the future L3 MotionBackend adapter.
#
# MEASURED (2026-08-21, 4-core CPU): a 150-frame / 4.5s / 500x500 clip rendered
# in ~24s wall (~16.6 render-fps), CPU 36.7s user + 18s sys, peak RSS 669 MB.
# Verdict: L3_ACCEPT_WITH_LIMITS (good-enough storybook-puppet motion; identity
# stable; frontal/full-body/unoccluded/single-subject only; the auto-rig half
# for arbitrary stills needs the separate Detectron2/mmpose char-analysis stack).
#
# SETUP (CPU, no GPU):
#   sudo apt-get install -y libosmesa6 libglu1-mesa
#   pip install numpy==1.26.4 scipy opencv-python-headless PyOpenGL scikit-image \
#               scikit-learn shapely Pillow PyYAML tqdm
#   git clone --depth 1 https://github.com/facebookresearch/AnimatedDrawings
# RUN (headless):
#   PYTHONPATH=<AnimatedDrawings> PYOPENGL_PLATFORM=osmesa MESA_GL_VERSION_OVERRIDE=3.3 \
#     python3 l3_animate_reference.py <AD_dir> <char_dir> <motion_cfg> <retarget_cfg> <out.gif>
# then mux to mp4 with the system ffmpeg (OpenCV's default h264 encoder is not
# always present):  ffmpeg -i out.gif -pix_fmt yuv420p out.mp4
#
# LICENSING: Animated Drawings + its example characters and the FAIR BVH clips
# are MIT. A production L3 driver library must use CC0 / public-domain / permissive
# BVH only (see OSS_MODEL_LICENSES.md); no driver media is committed to git.

import os
import resource
import sys
import time
from pathlib import Path

import yaml


def main() -> int:
    if len(sys.argv) != 6:
        print("usage: l3_animate_reference.py <AD_dir> <char_dir> <motion_cfg> <retarget_cfg> <out.gif>")
        return 2
    ad_dir, char_dir, motion_cfg, retarget_cfg, out_path = (Path(a) for a in sys.argv[1:])

    # Animated Drawings must be importable and OSMesa selected for headless GL.
    sys.path.insert(0, str(ad_dir))
    os.environ.setdefault("PYOPENGL_PLATFORM", "osmesa")
    os.environ.setdefault("MESA_GL_VERSION_OVERRIDE", "3.3")
    os.chdir(ad_dir)
    import animated_drawings.render  # noqa: E402  (import after sys.path/env set)

    mvc = {
        "scene": {
            "ANIMATED_CHARACTERS": [
                {
                    "character_cfg": str((char_dir / "char_cfg.yaml").resolve()),
                    "motion_cfg": str(motion_cfg.resolve()),
                    "retarget_cfg": str(retarget_cfg.resolve()),
                }
            ]
        },
        "controller": {"MODE": "video_render", "OUTPUT_VIDEO_PATH": str(out_path.resolve())},
        "view": {"USE_MESA": True},  # headless OSMesa — no display, no GPU
    }
    cfg = ad_dir / "_l3_mvc.yaml"
    cfg.write_text(yaml.dump(mvc))

    t0 = time.time()
    animated_drawings.render.start(str(cfg))
    dt = time.time() - t0
    ru = resource.getrusage(resource.RUSAGE_SELF)
    print(f"RENDER_SECONDS {dt:.1f}")
    print(f"CPU_USER_SECONDS {ru.ru_utime:.1f} CPU_SYS_SECONDS {ru.ru_stime:.1f}")
    print(f"MAX_RSS_MB {ru.ru_maxrss / 1024:.0f}")
    print(f"OUTPUT_EXISTS {out_path.exists()} SIZE {out_path.stat().st_size if out_path.exists() else 0}")
    return 0 if out_path.exists() else 1


if __name__ == "__main__":
    raise SystemExit(main())
