#!/usr/bin/env python3
"""Print the run's headline results, last, where they can be read.

WHY THIS IS A FILE. The first version of this was a `python3 -c "..."`
inside the workflow's `run:` block. Its escaped quotes did not survive the
patching that wrote them, the `"` closed the shell string early, and bash
parsed Python as shell:

    line 12: syntax error near unexpected token `('

The run had already built, proved and PUSHED the image; the only thing that
failed was the step meant to tell you about it. That is the third quoting
bug in this build definition, and the fix is the same one that worked for
the credential guard: put the code in a file, where it can be run locally
before it is trusted in CI.

usage: print_numbers.py <benchmark.json> <torch-wheels.json> [digest]
Missing files are reported, not fatal — this step must never be the reason
a good build looks bad.
"""
import json
import sys
from pathlib import Path

FIELDS = [
    "render_seconds", "wall_seconds", "max_rss_mb", "gif_frames",
    "frame_size", "output_bytes", "output_sha256",
    "foreground_fraction_mean", "interframe_mean_abs_diff",
    "static_frames", "compared_pairs", "gif_frames_per_render_second",
]


def row(label, value):
    print(f"  {label:<30} {value}")


def main(argv):
    bench_p = Path(argv[1]) if len(argv) > 1 else Path("out/benchmark.json")
    wheels_p = Path(argv[2]) if len(argv) > 2 else Path("torch-wheels.json")
    digest = argv[3] if len(argv) > 3 else ""

    print("=" * 66)
    print("  ARAP CPU RUNTIME")
    print("=" * 66)

    if digest:
        row("digest", digest)

    if bench_p.is_file():
        b = json.loads(bench_p.read_text())
        for k in FIELDS:
            row(k, b.get(k))
        gl = b.get("gl") or {}
        row("gl_version", gl.get("version"))
        row("gl_renderer", gl.get("renderer"))
    else:
        row("benchmark", f"MISSING ({bench_p}) — the proofs step did not complete")

    if wheels_p.is_file():
        m = json.loads(wheels_p.read_text())
        row("torch hash_pinned", m.get("hash_pinned"))
        for name in ("torch", "torchvision"):
            w = (m.get("wheels") or {}).get(name)
            if w:
                row(name, f"{w.get('version')} {w.get('sha256')}")
    else:
        row("torch wheels", f"MISSING ({wheels_p})")

    print("=" * 66)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
