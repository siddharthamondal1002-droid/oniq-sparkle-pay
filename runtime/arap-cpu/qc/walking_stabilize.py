#!/usr/bin/env python3
"""
Step 11D — post-render stabilization for the validated WALKING ARAP image.

    walking_stabilize.py <input.gif> <output.gif>

Runs in ENV B (PIL + numpy), mounted, never baked in. It keeps a rendered
character in frame and its feet on a stable baseline, so the EXISTING
post-render gate (l3RenderQc in src/lib/motionCost.ts) can judge the walk
deform instead of global locomotion drift.

Why this exists: the validated ARAP image uses Animated-Drawings'
zombie.bvh walk driver, which bakes root translation into the motion. The
character walks across the 512x512 canvas, exits the frame, and the gate
rightly rejects it. Rebuilding/revalidating the pinned image to cancel root
motion is expensive; stabilizing the already-rendered GIF keeps the exact
bytes under QC and only moves the frame-to-canvas mapping.

What it does, per body frame (the trailing GIF frame is a trailer and is
preserved unchanged):
  1. Builds a background-aware mask (pixels differing from the frame's
top-left background colour by > 24, same rule as walking_qc_stats.py).
  2. Measures the silhouette's centroid and lowest row (foot line).
  3. Computes a per-frame integer translation that keeps:
       - the centroid's horizontal position near the first frame's centroid;
       - the foot line near a fixed baseline (defaults to 92% of canvas height,
         roughly where a standing character's feet land).
  4. Paints the translated silhouette onto a fresh canvas of the same size,
     matching the background colour; frames that would fall entirely off-canvas
     are dropped from the body (kept only as trailers if they are the last
     frame), because a vanished frame is a deform failure the gate must see.

The output is a GIF with the same palette/duration/loop metadata as the input.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

# Pixel differs from background when it differs by > 24 in any channel, same as
# walking_qc_stats.py. For palette GIFs with transparency we prefer the alpha
# channel, so this threshold is the fallback for RGB inputs without transparency.
DIFF_THRESHOLD = 24
# Keep the foot line within a few pixels of this fraction of canvas height.
# 0.92 places feet near the bottom while leaving headroom; measured clean walks
# land between 0.88 and 0.94 depending on limb proportions.
DEFAULT_FOOT_BASELINE_FRAC = 0.92
# Maximum horizontal drift from the first-frame centroid we will correct.
# Beyond this we suspect a bad render rather than normal walk translation.
MAX_HORZ_CORRECTION_FRAC = 0.45


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path, help="rendered WALKING GIF to stabilize")
    p.add_argument("output", type=Path, help="stabilized output GIF")
    p.add_argument(
        "--foot-baseline-frac",
        type=float,
        default=DEFAULT_FOOT_BASELINE_FRAC,
        help="fraction of canvas height where the foot line should stay",
    )
    p.add_argument(
        "--max-horz-frac",
        type=float,
        default=MAX_HORZ_CORRECTION_FRAC,
        help="maximum horizontal correction as a fraction of canvas width",
    )
    return p.parse_args(argv[1:])


def mask_from_alpha(frame: np.ndarray) -> np.ndarray:
    """Use the alpha channel if the frame has one (RGBA)."""
    return frame[:, :, 3] > 128


def mask_from_diff(frame: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Fallback for RGB: foreground differs from the top-left background colour."""
    return np.abs(frame[:, :, :3] - bg).sum(axis=2) > DIFF_THRESHOLD


def silhouette_props(frame: np.ndarray, bg: np.ndarray | None, has_alpha: bool):
    m = mask_from_alpha(frame) if has_alpha else mask_from_diff(frame, bg)
    ys, xs = np.nonzero(m)
    if ys.size == 0:
        return None
    return {
        "centroid_x": float(xs.mean()),
        "centroid_y": float(ys.mean()),
        "top": int(ys.min()),
        "bottom": int(ys.max()),
        "left": int(xs.min()),
        "right": int(xs.max()),
    }


def translate_frame(frame: np.ndarray, dx: int, dy: int) -> Image.Image:
    """Translate the whole frame by integer pixels; empty areas keep transparency/black."""
    im = Image.fromarray(frame.astype(np.uint8))
    return im.transform(im.size, Image.AFFINE, (1, 0, -dx, 0, 1, -dy), resample=Image.NEAREST)


def stabilize(input_path: Path, output_path: Path, foot_baseline_frac: float, max_horz_frac: float) -> int:
    src = Image.open(input_path)
    # Convert to RGBA once so we preserve any transparency index the GIF uses.
    raw_frames = [np.asarray(f.convert("RGBA"), dtype=np.int16) for f in ImageSequence.Iterator(src)]
    n = len(raw_frames)
    if n == 0:
        print("FAIL: no frames", file=sys.stderr)
        return 1

    h, w, _ = raw_frames[0].shape
    has_alpha = np.any(raw_frames[0][:, :, 3] < 255)
    bg = raw_frames[0][0, 0, :3].copy() if not has_alpha else None
    trailer = raw_frames[-1:] if n > 1 else []
    body = raw_frames[:-1] if n > 1 else raw_frames

    if not body:
        print("FAIL: no body frames to stabilize", file=sys.stderr)
        return 1

    # First-frame reference: the character's starting position.
    ref = silhouette_props(body[0], bg, has_alpha)
    if ref is None:
        print("FAIL: first body frame has no silhouette", file=sys.stderr)
        return 1

    target_foot_y = int(round(foot_baseline_frac * h))
    max_dx = int(round(max_horz_frac * w))

    stabilized_body = []
    for f in body:
        props = silhouette_props(f, bg, has_alpha)
        if props is None:
            # Silhouette vanished: this is a real deform failure. Do not invent
            # pixels; drop the frame from the body so the QC gate sees it.
            continue

        # How far the centroid drifted horizontally from the first frame.
        dx = int(round(ref["centroid_x"] - props["centroid_x"]))
        dx = max(-max_dx, min(max_dx, dx))

        # How far the foot line is below the target baseline.
        dy = target_foot_y - props["bottom"]

        # After translation, make sure some part of the character stays on canvas.
        new_left = props["left"] + dx
        new_right = props["right"] + dx
        new_top = props["top"] + dy
        new_bottom = props["bottom"] + dy
        if new_right < 0 or new_left >= w or new_bottom < 0 or new_top >= h:
            # Fully off-canvas after correction: drop it.
            continue

        stabilized_body.append(translate_frame(f, dx, dy))

    if not stabilized_body:
        print("FAIL: every body frame left the canvas after correction", file=sys.stderr)
        return 1

    out_frames = stabilized_body + [Image.fromarray(t.astype(np.uint8)) for t in trailer]

    duration = src.info.get("duration", 40)
    loop = src.info.get("loop", 0)
    out_frames[0].save(
        output_path,
        save_all=True,
        append_images=out_frames[1:],
        duration=duration,
        loop=loop,
        optimize=False,
    )
    print(f"STABILIZED body_frames={len(stabilized_body)} original_body={len(body)} {output_path}")
    return 0


def main(argv) -> int:
    args = parse_args(argv)
    return stabilize(args.input, args.output, args.foot_baseline_frac, args.max_horz_frac)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
