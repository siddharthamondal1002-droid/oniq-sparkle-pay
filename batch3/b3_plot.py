#!/usr/bin/env python3
# BATCH 3 — TEST A visualization (cv2): driven skeleton (pre-ARAP constraints)
# drawn over the ARAP-deformed mesh vertices, per frame panel.
# Legs red, everything else blue; mesh grey. World y is up; image y is down.
# usage: b3_plot.py <trace_prefix> <out.png> <frame,frame,...> <title>
import json
import sys

import cv2
import numpy as np

prefix, out, frames, title = sys.argv[1], sys.argv[2], sys.argv[3].split(","), sys.argv[4]
mesh = json.load(open(f"{prefix}_mesh.json"))
parents = mesh["parents"]

S, H, W = 420, 560, 480  # px per world unit, panel size
panels = []
for f in frames:
    snap = mesh["frames"][f]
    img = np.full((H, W, 3), 255, np.uint8)
    vs = np.array(snap["vertices"])
    jx = {n: np.array(p) for n, p in snap["joints"].items()}
    cx = float(np.mean(vs[:, 0]))
    def T(p):
        return (int(W / 2 + S * (p[0] - cx)), int(H - 40 - S * p[1]))
    for v in vs[::2]:
        cv2.circle(img, T(v), 1, (200, 200, 200), -1)
    for name, parent in parents.items():
        if parent is None or name not in jx or parent not in jx:
            continue
        leg = any(t in name for t in ("knee", "foot", "hip"))
        cv2.line(img, T(jx[parent]), T(jx[name]), (0, 0, 200) if leg else (200, 80, 0), 2)
        cv2.circle(img, T(jx[name]), 3, (0, 0, 200) if leg else (200, 80, 0), -1)
    cv2.putText(img, f"f{f}", (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
    panels.append(img)
strip = np.hstack(panels)
cv2.putText(strip, title, (10, H - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 1)
cv2.imwrite(out, strip)
print("PLOT_OK", out)
