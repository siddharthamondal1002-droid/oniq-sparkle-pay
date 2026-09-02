#!/usr/bin/env python3
"""
Step 11D — DIAGNOSE a failed WALKING render: deform drift, or the driver's own
translation under a fixed camera?

    walking_diagnosis.py <clip.gif> <out_dir> [--label NAME]

Runs in ENV B (PIL + numpy), mounted, never baked in. Step 11C's gate said
"left the frame or vanished" for both eligible gateway characters and could
not say why: the gate is deliberately blind to the difference between a mesh
that drifts off its ground and a correct mesh that the BVH root carries out of
the reference camera's view. This script measures the two readings apart.

Per body frame it records the silhouette's bounding box, centroid, height,
width and fill. It then splits the clip at the FIRST edge contact and asks,
about the part before it, three questions the two readings answer differently:

  1. Does the centroid move steadily toward the edge?   (translation: yes)
  2. Does the silhouette keep its height and its fill?   (translation: yes;
                                                          deform drift: no)
  3. Does the foot line stay put, or wander?              (translation: it may
     drift with the projected ground; a large wander with a stable height is
     still not a collapse)

The verdict names the dominant reading and the numbers behind it. The cut
points below are ANALYSIS PARAMETERS for this diagnosis — not gates, not
thresholds of the envelope, and not a change to l3RenderQc.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageSequence

DIFF_THRESHOLD = 24
# Analysis parameters (see the docstring). Relative changes are against the
# median of the pre-edge segment.
STEADY_DRIFT_PX_PER_FRAME = 0.2  # centroid must move at least this fast, on average, to call it translation
SHAPE_STABLE_REL = 0.10  # height rel. std below this = the shape is holding
FILL_STABLE_REL = 0.15  # fill rel. std below this = the silhouette is holding
DEGRADE_REL = 0.25  # height or fill down by this much before the edge = deforming


def frames_of(clip: Path):
    frames = [np.asarray(f.convert("RGB"), dtype=np.int16) for f in ImageSequence.Iterator(Image.open(clip))]
    return frames[:-1] if len(frames) > 1 else frames


def measure(frames):
    h, w, _ = frames[0].shape
    bg = frames[0][0, 0]
    rows = []
    for i, f in enumerate(frames):
        m = np.abs(f - bg).sum(axis=2) > DIFF_THRESHOLD
        ys, xs = np.nonzero(m)
        if ys.size == 0:
            rows.append({"i": i, "fill": 0.0, "bbox": None, "cx": None, "cy": None, "height": 0, "width": 0, "foot": None, "edge": False})
            continue
        t, b, l, r = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
        rows.append({
            "i": i,
            "fill": float(m.mean()),
            "bbox": [l, t, r, b],
            "cx": float(xs.mean()),
            "cy": float(ys.mean()),
            "height": b - t + 1,
            "width": r - l + 1,
            "foot": b,
            "edge": bool(t == 0 or l == 0 or b == h - 1 or r == w - 1),
        })
    return (w, h), rows


def rel_std(values):
    v = np.asarray(values, dtype=float)
    med = float(np.median(v)) if v.size else 0.0
    return float(v.std() / med) if med > 0 else 0.0


def slope(values):
    v = np.asarray(values, dtype=float)
    if v.size < 2:
        return 0.0
    x = np.arange(v.size)
    return float(np.polyfit(x, v, 1)[0])


def diagnose(rows, size):
    w, h = size
    present = [r for r in rows if r["bbox"] is not None]
    first_edge = next((r["i"] for r in rows if r["edge"]), None)
    fills = [r["fill"] for r in present]
    median_fill = float(np.median(fills)) if fills else 0.0
    first_vanish = next((r["i"] for r in rows if r["bbox"] is None or r["fill"] < 0.25 * median_fill), None)
    cut = first_edge if first_edge is not None else (first_vanish if first_vanish is not None else len(rows))
    pre = [r for r in present if r["i"] < cut]
    if len(pre) < 5:
        pre = present[: max(5, len(present) // 3)]

    heights = [r["height"] for r in pre]
    pre_fills = [r["fill"] for r in pre]
    cxs = [r["cx"] for r in pre]
    cys = [r["cy"] for r in pre]
    feet = [r["foot"] for r in pre]
    q = len(pre) // 4 or 1
    height_first_q = float(np.median(heights[:q]))
    height_last_q = float(np.median(heights[-q:]))
    fill_first_q = float(np.median(pre_fills[:q]))
    fill_last_q = float(np.median(pre_fills[-q:]))
    height_change = (height_last_q - height_first_q) / height_first_q if height_first_q else 0.0
    fill_change = (fill_last_q - fill_first_q) / fill_first_q if fill_first_q else 0.0
    drift_x = slope(cxs)
    drift_y = slope(cys)
    exit_side = None
    if first_edge is not None:
        r = rows[first_edge]["bbox"]
        exit_side = "left" if r[0] == 0 else "right" if r[2] == w - 1 else "top" if r[1] == 0 else "bottom"

    steady = abs(drift_x) >= STEADY_DRIFT_PX_PER_FRAME or abs(drift_y) >= STEADY_DRIFT_PX_PER_FRAME
    shape_holds = rel_std(heights) < SHAPE_STABLE_REL and rel_std(pre_fills) < FILL_STABLE_REL
    degrades = height_change <= -DEGRADE_REL or fill_change <= -DEGRADE_REL
    toward_edge = (
        exit_side == "right" and drift_x > 0
        or exit_side == "left" and drift_x < 0
        or exit_side == "bottom" and drift_y > 0
        or exit_side == "top" and drift_y < 0
    )

    if degrades:
        reading = "DEFORM_DOMINANT"
        why = "the silhouette's height or fill fell by a quarter or more BEFORE the first edge contact"
    elif steady and shape_holds and (toward_edge or first_edge is None):
        reading = "TRANSLATION_DOMINANT"
        why = "the centroid moved steadily toward the exit edge while height and fill held; the mesh kept its shape and the camera did not follow"
    elif steady and shape_holds:
        reading = "TRANSLATION_DOMINANT"
        why = "the centroid moved steadily while height and fill held, but the exit edge does not match the drift direction; read the frames"
    else:
        reading = "MIXED_OR_UNKNOWN"
        why = "the pre-edge segment shows neither a steady drift with a held shape nor a clear degradation; read the frames"

    return {
        "reading": reading,
        "why": why,
        "frames": len(rows),
        "framesPresent": len(present),
        "firstEdgeContact": first_edge,
        "firstVanish": first_vanish,
        "exitSide": exit_side,
        "preEdgeFrames": len(pre),
        "preEdge": {
            "centroidDriftXPxPerFrame": round(drift_x, 3),
            "centroidDriftYPxPerFrame": round(drift_y, 3),
            "heightMedianPx": float(np.median(heights)),
            "heightRelStd": round(rel_std(heights), 4),
            "heightChangeFirstToLastQuarter": round(height_change, 4),
            "fillMedianPct": round(100 * float(np.median(pre_fills)), 3),
            "fillRelStd": round(rel_std(pre_fills), 4),
            "fillChangeFirstToLastQuarter": round(fill_change, 4),
            "footLineRangePx": (max(feet) - min(feet)) if feet else None,
            "footLineDriftPxPerFrame": round(slope(feet), 3) if feet else None,
        },
        "parameters": {
            "steadyDriftPxPerFrame": STEADY_DRIFT_PX_PER_FRAME,
            "shapeStableRelStd": SHAPE_STABLE_REL,
            "fillStableRelStd": FILL_STABLE_REL,
            "degradeRel": DEGRADE_REL,
            "note": "analysis parameters for this diagnosis, not gates",
        },
    }


def contact_sheet(clip: Path, rows, out: Path, label: str, picks=None, cols=4, cell=250):
    frames = [f.convert("RGB") for f in ImageSequence.Iterator(Image.open(clip))]
    frames = frames[:-1] if len(frames) > 1 else frames
    n = len(frames)
    if picks is None:
        picks = sorted(set(int(round(x)) for x in np.linspace(0, n - 1, 8)))
    picks = [p for p in picks if 0 <= p < n]
    rws = (len(picks) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rws * (cell + 18)), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for k, p in enumerate(picks):
        im = frames[p].copy()
        im.thumbnail((cell, cell))
        x, y = (k % cols) * cell, (k // cols) * (cell + 18)
        sheet.paste(im, (x, y + 18))
        r = rows[p]
        tag = f"{label} f{p}  fill {100 * r['fill']:.1f}%" + ("  EDGE" if r["edge"] else "") + ("  GONE" if r["bbox"] is None else "")
        d.text((x + 4, y + 2), tag, fill=(0, 0, 0))
        if r["bbox"]:
            l, t, rr, b = r["bbox"]
            s = min(cell / frames[p].width, cell / frames[p].height)
            d.rectangle([x + l * s, y + 18 + t * s, x + rr * s, y + 18 + b * s], outline=(220, 30, 30), width=2)
    sheet.save(out)


def strip(clip: Path, rows, out: Path, label: str, anchors=(), height=150):
    """Eight evenly spaced frames plus the frames around each anchor, as one small JPEG."""
    frames = [f.convert("RGB") for f in ImageSequence.Iterator(Image.open(clip))]
    frames = frames[:-1] if len(frames) > 1 else frames
    n = len(frames)
    picks = set(int(round(x)) for x in np.linspace(0, n - 1, 8))
    for a in anchors:
        if a is not None:
            picks.update(i for i in (a - 10, a, a + 10) if 0 <= i < n)
    picks = sorted(picks)
    thumbs = []
    for p in picks:
        im = frames[p].copy()
        im.thumbnail((height, height))
        thumbs.append((p, im))
    w = sum(t.width for _, t in thumbs)
    sheet = Image.new("RGB", (w, height + 14), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    x = 0
    for p, im in thumbs:
        sheet.paste(im, (x, 14))
        r = rows[p]
        d.text((x + 2, 1), f"f{p} {100 * r['fill']:.1f}%" + (" E" if r["edge"] else "") + (" G" if r["bbox"] is None else ""), fill=(0, 0, 0))
        x += im.width
    sheet.save(out, "JPEG", quality=60, optimize=True)


def main(argv) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    clip, out_dir = Path(argv[1]), Path(argv[2])
    label = argv[argv.index("--label") + 1] if "--label" in argv else clip.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    frames = frames_of(clip)
    if not frames:
        print("FAIL: no frames")
        return 1
    size, rows = measure(frames)
    dx = diagnose(rows, size)
    dx["label"] = label
    dx["clip"] = clip.name
    dx["frameSize"] = list(size)
    (out_dir / "diagnosis.json").write_text(json.dumps({"diagnosis": dx, "frames": rows}, indent=1) + "\n")
    contact_sheet(clip, rows, out_dir / "sheet-overview.png", label)
    around = []
    for anchor in (dx["firstEdgeContact"], dx["firstVanish"]):
        if anchor is not None:
            around += [anchor - 20, anchor - 5, anchor, anchor + 5]
    if around:
        contact_sheet(clip, rows, out_dir / "sheet-exit.png", label, picks=sorted(set(a for a in around if a >= 0)))
    strip(clip, rows, out_dir / "strip.jpg", label, anchors=(dx["firstEdgeContact"], dx["firstVanish"]))
    print("DIAGNOSIS " + json.dumps(dx))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
