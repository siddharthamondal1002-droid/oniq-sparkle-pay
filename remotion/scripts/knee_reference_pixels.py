#!/usr/bin/env python3
"""Pixel validation for the route-5B reference-pose candidates.

Identical methodology for every condition, fixed frames chosen from the MOTION
measurement before any pixel was looked at — no cherry-picking:

  f0    start pose (the `mean` candidate's known cost)
  f101  right-knee minimum in the production window
  f126  left-knee minimum in the production window
  f27   right-foot contact in the raw source

GIF entries are expanded to real frames first (PIL collapses consecutive
identical frames and accumulates their duration — that defect cost a whole
review pass once, so it is handled here explicitly).

usage: knee_reference_pixels.py <route5b_dir> <out.json> <out.png>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FRAMES = [0, 27, 101, 126]
CONDS = ["raw", "frame0", "extension", "mean"]


def expand(gif_path):
    """Every GIF entry expanded by its duration into real frames."""
    im = Image.open(gif_path)
    base = None
    out = []
    try:
        while True:
            d = max(1, int(round(im.info.get("duration", 33) / 33.3333)))
            f = im.convert("RGBA")
            if base is None:
                base = f
            out.extend([f] * d)
            im.seek(im.tell() + 1)
    except EOFError:
        pass
    return out


def alpha_bbox(img):
    a = np.array(img)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def lower_leg_metrics(img):
    """Silhouette measures on the lower half of the figure."""
    a = np.array(img)[:, :, 3] > 8
    bb = alpha_bbox(img)
    if bb is None:
        return {}
    x0, y0, x1, y1 = bb
    h = y1 - y0
    lower = a[y0 + int(h * 0.55):y1 + 1, x0:x1 + 1]
    if lower.size == 0:
        return {}
    rows = lower.sum(axis=1)
    # per-row count of separate ink runs = 1 leg (merged) or 2 legs (separated)
    seps = []
    for r in lower:
        runs, prev = 0, False
        for v in r:
            if v and not prev:
                runs += 1
            prev = v
        seps.append(runs)
    seps = np.array(seps)
    return {
        "bbox": [x0, y0, x1, y1],
        "figure_height_px": int(h),
        "lower_ink_px": int(lower.sum()),
        "two_leg_row_fraction": round(float((seps >= 2).mean()), 4),
        "mean_lower_width_px": round(float(rows.mean()), 3),
        "touches_border": bool(x0 <= 0 or y0 <= 0 or x1 >= img.width - 1
                               or y1 >= img.height - 1),
    }


def main():
    d, outj, outp = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    seqs = {c: expand(d / f"render_{c}.gif") for c in CONDS}
    res = {"record": "KNEE_REFERENCE_PIXELS", "version": "1.0",
           "methodology": "identical for every condition; frames fixed from the "
                          "motion measurement BEFORE any pixel was inspected",
           "frames_inspected": FRAMES,
           "expanded_frame_counts": {c: len(s) for c, s in seqs.items()},
           "per_frame": {}}

    n = min(len(s) for s in seqs.values())
    tiles = []
    for f in FRAMES:
        if f >= n:
            res["per_frame"][str(f)] = {"skipped": f"frame {f} beyond clip ({n})"}
            continue
        row = {}
        base = np.array(seqs["raw"][f].convert("RGBA"))
        for c in CONDS:
            img = seqs[c][f]
            m = lower_leg_metrics(img)
            arr = np.array(img.convert("RGBA"))
            am, bm = arr[:, :, 3] > 8, base[:, :, 3] > 8
            inter = int((am & bm).sum())
            union = int((am | bm).sum())
            m["iou_vs_raw"] = round(inter / union, 4) if union else None
            row[c] = m
            tiles.append((f, c, img))
        # candidate-vs-control deltas, the comparison that actually decides
        ctrl = row["frame0"]
        for c in ("extension", "mean"):
            row[c]["delta_vs_control"] = {
                "two_leg_row_fraction": round(row[c]["two_leg_row_fraction"]
                                              - ctrl["two_leg_row_fraction"], 4),
                "mean_lower_width_px": round(row[c]["mean_lower_width_px"]
                                             - ctrl["mean_lower_width_px"], 3),
                "lower_ink_px": row[c]["lower_ink_px"] - ctrl["lower_ink_px"],
            }
        res["per_frame"][str(f)] = row

    # contact sheet: rows = frames, cols = conditions, lower-body crop
    if tiles:
        cw, ch = 240, 300
        cols, rows_n = len(CONDS), len([f for f in FRAMES if f < n])
        sheet = Image.new("RGB", (cw * cols, ch * rows_n + 24), (18, 18, 20))
        dr = ImageDraw.Draw(sheet)
        try:
            font = ImageFont.load_default()
        except Exception:  # noqa: BLE001
            font = None
        for i, f in enumerate([f for f in FRAMES if f < n]):
            for j, c in enumerate(CONDS):
                img = seqs[c][f]
                bb = alpha_bbox(img)
                if bb:
                    x0, y0, x1, y1 = bb
                    hgt = y1 - y0
                    crop = img.crop((x0, y0 + int(hgt * 0.45), x1 + 1, y1 + 1))
                else:
                    crop = img
                crop = crop.convert("RGB").resize((cw, ch))
                sheet.paste(crop, (j * cw, i * ch + 24))
                if font:
                    dr.text((j * cw + 4, i * ch + 26), f"f{f} {c}",
                            fill=(255, 235, 120), font=font)
        if font:
            dr.text((6, 6), "lower-body crop | cols: raw / frame0(accepted) / "
                            "extension / mean", fill=(200, 200, 200), font=font)
        sheet.save(outp)
        res["contact_sheet"] = outp.name

    Path(outj).write_text(json.dumps(res, indent=1))
    for f in FRAMES:
        r = res["per_frame"].get(str(f), {})
        if "skipped" in r:
            print(f"  f{f}: {r['skipped']}")
            continue
        print(f"  f{f}")
        for c in CONDS:
            m = r[c]
            dv = m.get("delta_vs_control")
            extra = (f"  dTwoLeg {dv['two_leg_row_fraction']:+.4f} "
                     f"dWidth {dv['mean_lower_width_px']:+.2f}") if dv else ""
            print(f"    {c:<10} IoU_vs_raw {m['iou_vs_raw']:.4f}  "
                  f"twoLeg {m['two_leg_row_fraction']:.4f}  "
                  f"width {m['mean_lower_width_px']:7.2f}  "
                  f"border {m['touches_border']}{extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
