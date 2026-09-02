#!/bin/bash
# ONIQ ARAP CPU runtime entrypoint.
#
# The image holds TWO python environments that must never be confused, so it
# does not ship a `python` on PATH. Every command below names the venv it
# belongs to, which is the point: `rig` is ENV A (torch + OpenMMLab, numpy
# 1.23.5) and `render` is ENV B (OSMesa + ARAP, numpy 1.26.4). Handing a
# render to ENV A, or a rig to ENV B, is the mistake this file exists to make
# impossible from outside.
set -euo pipefail

AUTORIG=/opt/oniq/venv-autorig/bin/python
ARAP=/opt/oniq/venv-arap/bin/python
SCRIPTS=/opt/oniq/scripts
PROOFS=/opt/oniq/proofs

usage() {
  cat <<'USAGE'
ONIQ ARAP CPU runtime — zero-GPU character motion.

  rig <image> <out_dir>              auto-rig a drawing              (ENV A)
  segment <image> <out_dir>          u2netp silhouette only          (ENV A)
  render <char_dir> <motion> <out>   BVH retarget + ARAP + OSMesa    (ENV B)
  proofs                             run every proof in this image
  benchmark [out.gif]                render a reference clip, measure it
  versions                           what is installed, per environment
  shell-a | shell-b                  a python REPL in ENV A / ENV B

`render`'s <motion> is a motion config from the Animated Drawings checkout at
$AD_DIR; the retarget config is fixed to the arm-damped one, which is the only
setting with a pixel proof behind it (MOTION_AMPLITUDE.md).
USAGE
}

cmd="${1:---help}"; shift || true
case "$cmd" in
  rig)
    [ $# -eq 2 ] || { echo "usage: rig <image> <out_dir>" >&2; exit 2; }
    exec "$AUTORIG" "$SCRIPTS/autorig_reference.py" "$1" "$2"
    ;;
  segment)
    [ $# -eq 2 ] || { echo "usage: segment <image> <out_dir>" >&2; exit 2; }
    exec "$AUTORIG" "$SCRIPTS/segment_reference.py" \
      "${AD_MODEL_STORE}/u2netp.onnx" "$1" "$2"
    ;;
  render)
    [ $# -eq 3 ] || { echo "usage: render <char_dir> <motion_cfg> <out.gif>" >&2; exit 2; }
    exec "$ARAP" "$SCRIPTS/l3_animate_reference.py" \
      "$AD_DIR" "$1" "$2" "$SCRIPTS/retarget_armdamped_reference.yaml" "$3"
    ;;
  benchmark)
    exec "$ARAP" "$PROOFS/benchmark.py" "${1:-/work/benchmark.gif}"
    ;;
  proofs)
    # Ordered cheapest-first so a broken image fails fast, and so a failure
    # names the layer it is in rather than the last thing that ran.
    /usr/local/bin/python3 "$PROOFS/pins_match.py"
    /usr/local/bin/python3 "$PROOFS/envs_isolated.py"
    "$AUTORIG" "$PROOFS/torch_cpu_only.py"
    "$AUTORIG" "$PROOFS/models_ready.py"
    "$ARAP"    "$PROOFS/osmesa_render.py"
    "$AUTORIG" "$PROOFS/autorig_smoke.py"
    "$ARAP"    "$PROOFS/benchmark.py" "${1:-/work/benchmark.gif}"
    echo "ALL PROOFS PASSED"
    ;;
  versions)
    echo "== ENV A (autorig) =="; "$AUTORIG" -c \
      "import sys,numpy,torch;print('python',sys.version.split()[0],'numpy',numpy.__version__,'torch',torch.__version__)"
    echo "== ENV B (arap) =="; "$ARAP" -c \
      "import sys,numpy,OpenGL;print('python',sys.version.split()[0],'numpy',numpy.__version__,'pyopengl',OpenGL.__version__)"
    ;;
  shell-a) exec "$AUTORIG" "$@" ;;
  shell-b) exec "$ARAP" "$@" ;;
  -h|--help|help) usage ;;
  *) echo "unknown command: $cmd" >&2; usage >&2; exit 2 ;;
esac
