#!/usr/bin/env python3
"""
Step 11C, step 11 — per-frame silhouette statistics of an isolated WALKING
render, for the EXISTING post-render gate (src/lib/motionCost.ts l3RenderQc).

    walking_qc_stats.py <clip.gif> <stats.json>

Runs in ENV B (PIL + numpy), mounted, never baked in. It measures; it does
not judge. The verdict is l3RenderQc's, applied afterwards on the runner by
scripts/arap-walking-qc.ts, so the gate that decides is the one production
already has and not a second opinion written here.

What is measured, per body frame (the trailing GIF frame is a trailer and is
skipped, as benchmark.py does):
  fill        fraction of the canvas the silhouette occupies (pixels that
              differ from the frame's top-left background colour by > 24)
  bbox        the silhouette's bounding box, and whether it touches an edge
  foot line   the silhouette's lowest row
  diff        mean absolute difference from the previous frame
The summary carries what l3RenderQc consumes (meanFillPct, inFrameAllFrames,
footLineRangePx, frameSizePx) plus the evidence behind each of the
inspection items the brief names: fill min/max and the largest frame-to-frame
fill drop (collapse, tearing, vanishing), edge contact (walked off), static
frame pairs (frozen), and the inter-frame diff (unexpected motion is a human
call; the number is there to be read).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

DIFF_THRESHOLD = 24  # same rule as benchmark.py: a pixel is foreground when it differs this much from the background
VANISH_FRACTION = 0.25  # a frame whose fill is below this fraction of the median fill counts as vanished


def main(argv) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    clip, out = Path(argv[1]), Path(argv[2])
    frames = [np.asarray(f.convert("RGB"), dtype=np.int16) for f in ImageSequence.Iterator(Image.open(clip))]
    n = len(frames)
    if n == 0:
        print("FAIL: no frames")
        return 1
    h, w, _ = frames[0].shape
    bg = frames[0][0, 0]
    body = frames[:-1] if n > 1 else frames

    per = []
    for i, f in enumerate(body):
        m = np.abs(f - bg).sum(axis=2) > DIFF_THRESHOLD
        fill = float(m.mean())
        ys, xs = np.nonzero(m)
        if ys.size == 0:
            per.append({"i": i, "fill": 0.0, "bbox": None, "edge": False, "foot": None})
            continue
        t, b, l, r = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
        per.append({
            "i": i,
            "fill": round(fill, 5),
            "bbox": [l, t, r, b],
            "edge": bool(t == 0 or l == 0 or b == h - 1 or r == w - 1),
            "foot": b,
        })
    fills = [p["fill"] for p in per]
    median_fill = float(np.median(fills)) if fills else 0.0
    vanished = [p["i"] for p in per if p["fill"] < VANISH_FRACTION * median_fill or p["bbox"] is None]
    edge_frames = [p["i"] for p in per if p["edge"]]
    feet = [p["foot"] for p in per if p["foot"] is not None]
    diffs = [float(np.abs(frames[i] - frames[i - 1]).mean()) for i in range(1, n)]
    drops = [fills[i - 1] - fills[i] for i in range(1, len(fills))]
    largest_drop = max(drops) if drops else 0.0

    summary = {
        "clip": clip.name,
        "frames": n,
        "bodyFrames": len(body),
        "frameSize": [w, h],
        # exactly what l3RenderQc consumes
        "meanFillPct": round(100.0 * float(np.mean(fills)), 3) if fills else 0.0,
        "inFrameAllFrames": len(vanished) == 0 and len(edge_frames) == 0,
        "footLineRangePx": (max(feet) - min(feet)) if feet else None,
        "frameSizePx": h,
        # the evidence behind the inspection items
        "fillMinPct": round(100.0 * min(fills), 3) if fills else 0.0,
        "fillMaxPct": round(100.0 * max(fills), 3) if fills else 0.0,
        "largestFillDropPct": round(100.0 * largest_drop, 3),
        "vanishedFrames": vanished[:20],
        "edgeContactFrames": edge_frames[:20],
        "interframeMeanAbsDiff": round(float(np.mean(diffs)), 3) if diffs else 0.0,
        "staticPairs": sum(1 for d in diffs if d < 0.01),
        "comparedPairs": len(diffs),
    }
    out.write_text(json.dumps({"summary": summary, "frames": per}, indent=1) + "\n")
    print("QC_STATS " + json.dumps(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
