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

# A WRITABLE VIEW OVER A READ-ONLY CHECKOUT.
#
# l3_animate_reference.py writes its assembled scene config (_l3_mvc.yaml)
# INTO the Animated Drawings directory and chdirs there, because AD resolves
# its own configs relative to the working directory. /opt/oniq is root-owned
# and stripped of write bits and the job runs as uid 10001, so pointing the
# runner straight at the checkout fails with EACCES on every render.
#
# MEASURED 2026-09-02: as uid 65534 against a read-only checkout, a render
# through this symlink farm completed in 68.4 s with byte-identical output
# (1,971,306 bytes) to the same render run as root against a writable one.
# Every real file stays read-only behind its symlink; only the directory
# holding them is writable, which is exactly the amount of write access the
# runner actually needs.
#
# _l3_mvc.yaml is skipped deliberately. A stale one in the source would be
# symlinked, and the write would then follow the link back into the
# read-only tree — which is how this was mis-diagnosed as fixed once.
ad_view() {
  view="${ONIQ_AD_VIEW:-/tmp/oniq-ad-view}"
  rm -rf "$view"
  mkdir -p "$view"
  for entry in "$AD_DIR"/*; do
    base="$(basename "$entry")"
    [ "$base" = "_l3_mvc.yaml" ] && continue
    ln -s "$entry" "$view/$base"
  done
  printf '%s' "$view"
}

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
  measure <corpus_dir> <out_dir>     Step 11A: eligibility evidence     (ENV A)
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
      "$(ad_view)" "$1" "$2" "$SCRIPTS/retarget_armdamped_reference.yaml" "$3"
    ;;
  benchmark)
    AD_DIR="$(ad_view)" exec "$ARAP" "$PROOFS/benchmark.py" "${1:-/work/benchmark.gif}"
    ;;
  measure)
    # Step 11A. The driver is MOUNTED, not baked in, so the image under
    # measurement stays the validated digest. It measures and writes; it
    # renders nothing and decides nothing — eligibility is computed
    # afterwards by the production TypeScript functions, unchanged.
    [ $# -eq 2 ] || { echo "usage: measure <corpus_dir> <out_dir>" >&2; exit 2; }
    driver="${ONIQ_MEASURE_DRIVER:-/measure/measure_eligibility.py}"
    [ -f "$driver" ] || { echo "measure: driver not mounted at $driver" >&2; exit 2; }
    exec "$AUTORIG" "$driver" "$1" "$2"
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
    AD_DIR="$(ad_view)" ONIQ_ARAP_DETERMINISM=1 \
      "$ARAP" "$PROOFS/benchmark.py" "${1:-/work/benchmark.gif}"
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
