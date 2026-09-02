# syntax=docker/dockerfile:1.7
# ONIQ ARAP CPU runtime — the zero-GPU character-motion worker image.
#
# WHAT THIS IS, AND WHAT IT IS NOT. This is a STANDALONE runtime artifact,
# built and validated on its own (owner directive 2026-09-02). It is
# deliberately NOT referenced by .github/workflows/story-worker.yml: that
# workflow still runs on a bare ubuntu-latest with no `container:`, and
# changing it is a separate decision made after this image has built and its
# proofs have passed. Nothing in production reads this image today, and
# motionRuntime.ts still passes `allowPoseWarp: false`.
#
# WHY AN IMAGE AND NOT actions/cache. The stack below is a 40-minute mmcv
# source build against a pinned torch, two mutually incompatible numpy
# versions, and ~700 MB of model weights. A cache key is not a build: it
# restores whatever a previous run happened to produce, with no way to prove
# the contents match the pins. An image pinned by DIGEST is the same bytes
# every time, and the proofs below run before it is ever pushed.
#
# BUILT FROM THE REPOSITORY ROOT:
#   docker build -f runtime/arap-cpu/Dockerfile --target models .
# The context is the repo root because the image ships reference scripts
# from remotion/scripts, and Docker cannot COPY above its context. The
# root .dockerignore is deny-by-default and re-admits only the files
# COPYed below, so the context stays small and a stray .env cannot enter.
#
# EVERY PIN COMES FROM pins.json, which is the single source of truth. The
# hashes there were measured by streaming each asset, and
# src/lib/__tests__/arapRuntimePins.test.ts fails if pins.json drifts from
# arapProvider.ts's ARAP_L3_RUN spec.
#
# THE TWO-VENV SPLIT IS NOT STYLE, IT IS THE ONLY WAY THIS STACK EXISTS:
#   ENV A (/opt/oniq/venv-autorig) — numpy 1.23.5, torch 1.13.1+cpu, mmcv-full
#     1.6.2, mmdet 2.28.2, mmpose 0.29.0. Turns an arbitrary drawn character
#     into a rig. The OpenMMLab 1.x generation pins numpy hard.
#   ENV B (/opt/oniq/venv-arap)  — numpy 1.26.4, no torch at all. BVH
#     retarget, ARAP 2D deform, headless OSMesa render. AD's retarget stack
#     uses np.bool8, which numpy 2 removed, and 1.23.5 predates other things
#     it needs. The two cannot share an interpreter's site-packages.
# One python (3.10), two venvs. They talk through the FILESYSTEM — ENV A
# writes a character dir, ENV B reads it — never through an import.
#
# SECURITY POSTURE, same shape as the GPU worker image:
# - no ARG and no ENV credential anywhere. This build needs NO credential at
#   all: every asset is a public, hash-pinned download, so there is nothing
#   for a build argument to leak;
# - COPY names each shipped file individually — there is no COPY . .;
# - builds as root, runs as oniq (uid/gid 10001). /opt/oniq is root-owned and
#   merely readable, so a job cannot rewrite the code or the models it runs;
# - exec-form CMD only.

# =====================================================================
FROM python:3.10-slim-bookworm AS base
# =====================================================================

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# libosmesa6 + libglu1-mesa are the headless GL that makes the render work
# with no display and no GPU; ffmpeg muxes the gif ENV B writes into mp4,
# because OpenCV's h264 encoder is not always present. build-essential is
# for the mmcv / pycocotools / xtcocotools source builds.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y \
      ca-certificates curl unzip git \
      build-essential \
      libosmesa6 libglu1-mesa libgl1 \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 oniq && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin oniq
RUN mkdir -p /opt/oniq /opt/oniq/model-store

# ---------------------------------------------------------------------
# ENV B first. It is small, it needs no blocked host, and it is the half
# that produces pixels — so a break here is worth finding before the
# 40-minute mmcv build, not after.
#
# These versions are a `pip freeze` of the environment that actually
# rendered 779 frames on CPU (pins.json -> validation.env_b_render), not a
# wish list. opencv-python-headless, not opencv-python: there is no GUI
# here and the GUI build drags in X11.
# ---------------------------------------------------------------------
RUN python3 -m venv /opt/oniq/venv-arap && \
    /opt/oniq/venv-arap/bin/pip install --no-cache-dir --upgrade \
      "pip==24.0" "setuptools==69.5.1" "wheel==0.43.0" && \
    /opt/oniq/venv-arap/bin/pip install --no-cache-dir \
      "numpy==1.26.4" \
      "scipy==1.10.1" \
      "scikit-image==0.19.3" \
      "scikit-learn==1.1.2" \
      "shapely==1.8.5.post1" \
      "opencv-python-headless==4.9.0.80" \
      "Pillow==10.1.0" \
      "PyOpenGL==3.1.7" \
      "PyYAML==6.0.1" \
      "tqdm==4.66.3" && \
    /opt/oniq/venv-arap/bin/python -c \
      "import numpy,scipy,skimage,sklearn,shapely,cv2,PIL,OpenGL,yaml,tqdm; \
       assert numpy.__version__=='1.26.4', numpy.__version__; \
       assert hasattr(numpy,'bool8'), 'np.bool8 gone — AD retarget will break'; \
       print('ENV B ok, numpy', numpy.__version__)"

# ---------------------------------------------------------------------
# ENV A. torch goes in FIRST and ALONE, from PyTorch's own CPU index.
#
# THE '+cpu' IS THE GATE, NOT A PREFERENCE. MEASURED 2026-09-02: PyPI holds
# no cpu-only torch 1.13.1 for linux x86_64 — its single manylinux wheel is
# the 887,450,534-byte CUDA 11.7 build. Because PyPI has no '+cpu' local
# version at all, it CANNOT satisfy this specifier. So if the PyTorch index
# is unreachable or the wheel is gone, pip fails and this build STOPS,
# rather than quietly baking a 887 MB CUDA torch into a CPU-only runtime.
# That silent substitution is the exact outcome this line exists to prevent.
# --index-url (not --extra-index-url) for the same reason: PyPI is not in
# the resolver's search path for this step.
RUN /usr/bin/env python3 -m venv /opt/oniq/venv-autorig && \
    /opt/oniq/venv-autorig/bin/pip install --no-cache-dir --upgrade "pip==24.0" && \
    ( /opt/oniq/venv-autorig/bin/pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        "torch==1.13.1+cpu" "torchvision==0.14.1+cpu" \
      || { echo "BLOCKED: torch 1.13.1 CPU artifact unavailable from permitted source"; \
           echo "  index: https://download.pytorch.org/whl/cpu"; \
           echo "  PyPI's torch==1.13.1 is the CUDA build and is NOT a substitute."; \
           exit 1; } ) && \
    /opt/oniq/venv-autorig/bin/python -c \
      "import torch; \
       assert torch.__version__.startswith('1.13.1'), torch.__version__; \
       assert torch.version.cuda is None, 'NOT a CPU-only torch: cuda=%s' % torch.version.cuda; \
       assert not torch.cuda.is_available(); \
       print('ENV A torch', torch.__version__, 'cuda', torch.version.cuda)"

# setuptools 65.7.0 before anything builds: mmcv-full 1.6.2's setup.py
# predates setuptools' distutils changes and does not build on a current one.
# numpy goes in before every C extension below, so each one compiles against
# the ABI it will actually run on.
RUN /opt/oniq/venv-autorig/bin/pip install --no-cache-dir \
      "setuptools==65.7.0" "wheel==0.38.4" "Cython==0.29.37" && \
    /opt/oniq/venv-autorig/bin/pip install --no-cache-dir \
      "numpy==1.23.5" \
      "opencv-python-headless==4.9.0.80" \
      "scipy==1.10.1" \
      "PyYAML==6.0.1" \
      "Pillow==9.5.0" \
      "matplotlib==3.7.5" \
      "terminaltables==3.1.10" \
      "six==1.16.0" \
      "onnxruntime==1.16.3"

# mmcv-full from SOURCE. MEASURED 2026-09-02: download.openmmlab.com answers
# 403 CONNECT under this project's network policy, and PyPI ships 1.6.2 as an
# sdist only — there is no cp310 wheel to fall back to. MMCV_WITH_OPS=1 builds
# the custom ops the pose estimator needs; FORCE_CUDA=0 keeps them CPU.
# --no-build-isolation is load-bearing: the build imports the torch installed
# above, and an isolated build env would not have it.
# This is the long step — tens of minutes on a 2-core runner.
RUN MMCV_WITH_OPS=1 FORCE_CUDA=0 \
    /opt/oniq/venv-autorig/bin/pip install --no-cache-dir \
      "mmcv-full==1.6.2" --no-binary mmcv-full --no-build-isolation && \
    /opt/oniq/venv-autorig/bin/python -c \
      "import mmcv; from mmcv.ops import nms; print('mmcv', mmcv.__version__, 'ops ok')"

# pycocotools and xtcocotools compile AGAINST numpy. Their published wheels
# are built against a different numpy than 1.23.5, and a mismatched C
# extension is the failure this project has already paid for once. Building
# both from source with --no-build-isolation links them to the numpy that is
# actually installed.
# CYTHON IS INSTALLED ABOVE AND IT IS NOT OPTIONAL. MEASURED 2026-09-02:
# --no-build-isolation means pip does NOT provision a build environment, so
# a source build that needs Cython simply does not get it — pycocotools
# fails with `cc1: fatal error: pycocotools/_mask.c: No such file or
# directory`, because Cython never ran to generate the C from the .pyx.
# --no-deps on pycocotools for a different reason: its dependency
# resolution otherwise UPGRADES matplotlib and Pillow off the pins set
# above (measured: matplotlib 3.7.5 -> 3.10.9, Pillow 9.5.0 -> 12.3.0).
# Both are already installed at their pinned versions, so nothing is lost.
RUN /opt/oniq/venv-autorig/bin/pip install --no-cache-dir --no-binary pycocotools \
      --no-build-isolation --no-deps "pycocotools==2.0.7" && \
    /opt/oniq/venv-autorig/bin/pip install --no-cache-dir \
      "json_tricks==3.17.3" "munkres==1.1.4" && \
    /opt/oniq/venv-autorig/bin/pip install --no-cache-dir --no-binary xtcocotools \
      --no-build-isolation --no-deps "xtcocotools==1.14.3" && \
    /opt/oniq/venv-autorig/bin/python -c \
      "import numpy; from pycocotools import mask; from xtcocotools.coco import COCO; \
       assert numpy.__version__=='1.23.5', numpy.__version__; \
       print('cocotools C extensions load against numpy', numpy.__version__)"

# mmdet with its deps already satisfied above; mmpose WITHOUT deps, because
# mmpose 0.29.0 requires chumpy — a 3D-mesh-only package that does not build
# on numpy 1.23.5. The auto-rig uses the 2D top-down path, which never
# touches it.
RUN /opt/oniq/venv-autorig/bin/pip install --no-cache-dir --no-deps \
      "mmdet==2.28.2" && \
    /opt/oniq/venv-autorig/bin/pip install --no-cache-dir --no-deps \
      "mmpose==0.29.0" && \
    /opt/oniq/venv-autorig/bin/python -c \
      "from mmdet.apis import init_detector, inference_detector; \
       from mmpose.apis import init_pose_model, inference_top_down_pose_model; \
       import numpy; assert numpy.__version__=='1.23.5', numpy.__version__; \
       print('ENV A ok, numpy', numpy.__version__)"

# Animated Drawings at the commit pins.json names. MIT code and MIT weights;
# the repo has been archived read-only since 2025-09, so this commit is
# stable. Cloned, then the .git directory is dropped — the image ships the
# tree, not the history.
RUN git clone --quiet https://github.com/facebookresearch/AnimatedDrawings \
      /opt/oniq/AnimatedDrawings && \
    git -C /opt/oniq/AnimatedDrawings checkout --quiet \
      b859684857519c7424da51a0b0862fbd1fd258f4 && \
    test "$(git -C /opt/oniq/AnimatedDrawings rev-parse HEAD)" \
       = "b859684857519c7424da51a0b0862fbd1fd258f4" && \
    cp /opt/oniq/AnimatedDrawings/LICENSE /opt/oniq/model-store/LICENSE.AnimatedDrawings && \
    rm -rf /opt/oniq/AnimatedDrawings/.git && \
    test -f /opt/oniq/AnimatedDrawings/examples/bvh/fair1/zombie.bvh

# The ONIQ side: the reference runners and the ONE retarget config with a
# pixel proof behind it. Named individually — there is no COPY . .
COPY --chown=root:root runtime/arap-cpu/pins.json                    /opt/oniq/pins.json
COPY --chown=root:root remotion/scripts/l3_animate_reference.py   /opt/oniq/scripts/l3_animate_reference.py
COPY --chown=root:root remotion/scripts/autorig_reference.py      /opt/oniq/scripts/autorig_reference.py
COPY --chown=root:root remotion/scripts/segment_reference.py      /opt/oniq/scripts/segment_reference.py
COPY --chown=root:root remotion/scripts/retarget_armdamped_reference.yaml /opt/oniq/scripts/retarget_armdamped_reference.yaml
COPY --chown=root:root runtime/arap-cpu/proofs/                       /opt/oniq/proofs/
COPY --chown=root:root runtime/arap-cpu/entrypoint.sh                 /opt/oniq/entrypoint.sh
RUN chmod 0755 /opt/oniq/entrypoint.sh

ENV PYOPENGL_PLATFORM=osmesa \
    MESA_GL_VERSION_OVERRIDE=3.3 \
    CUDA_VISIBLE_DEVICES="" \
    AD_DIR=/opt/oniq/AnimatedDrawings \
    AD_MODEL_STORE=/opt/oniq/model-store \
    ONIQ_ARAP_PINS=/opt/oniq/pins.json

# =====================================================================
FROM base AS models
# =====================================================================
# The weights, baked at BUILD time so a job never fetches a model over the
# network. Each download is verified against the sha256 in pins.json BEFORE
# it is unpacked: a hash mismatch fails the build rather than shipping a
# model nobody has checked.

RUN --mount=type=bind,source=runtime/arap-cpu/pins.json,target=/tmp/pins.json \
    set -euo pipefail && \
    fetch() { \
      url="$1"; want="$2"; out="$3"; \
      echo "fetching $(basename "$out")"; \
      curl -sSL --retry 4 --retry-delay 3 --max-time 1800 -o "$out" "$url"; \
      got="$(sha256sum "$out" | awk '{print $1}')"; \
      if [ "$got" != "$want" ]; then \
        echo "FAIL sha256 mismatch for $url"; \
        echo "  expected $want"; echo "  got      $got"; exit 1; \
      fi; \
      echo "PROOF sha256 $(basename "$out") $got"; \
    }; \
    read_pin() { python3 -c "import json,sys;print(json.load(open('/tmp/pins.json'))['assets'][sys.argv[1]][sys.argv[2]])" "$1" "$2"; }; \
    for m in drawn_humanoid_detector drawn_humanoid_pose_estimator; do \
      fetch "$(read_pin "$m.mar" url)" "$(read_pin "$m.mar" sha256)" "/tmp/$m.mar"; \
      unzip -q "/tmp/$m.mar" -d "/opt/oniq/model-store/unpack_$m"; \
      rm -f "/tmp/$m.mar"; \
    done; \
    fetch "$(read_pin u2netp.onnx url)" "$(read_pin u2netp.onnx sha256)" \
          "/opt/oniq/model-store/u2netp.onnx"

# The detector config initialises its backbone from open-mmlab://, a network
# fetch that is dead weight when a full checkpoint is being loaded anyway —
# and unreachable from a runtime with no egress. autorig_reference.py strips
# it at run time by WRITING config_nopretrain.py next to the model. That
# cannot work here: the model store is root-owned and the job runs as uid
# 10001. Generating it at build time is not an optimisation, it is what makes
# a read-only model store possible.
RUN /opt/oniq/venv-autorig/bin/python /opt/oniq/proofs/prepare_detector_config.py

# Ownership last: everything root-owned and readable, nothing writable by the
# uid that runs the job.
RUN chown -R root:root /opt/oniq && \
    chmod -R a-w /opt/oniq && \
    mkdir -p /work && chown oniq:oniq /work

WORKDIR /work
USER 10001:10001

ENTRYPOINT ["/opt/oniq/entrypoint.sh"]
CMD ["--help"]
