#!/usr/bin/env python3
"""Knee / crossing diagnosis from PIXELS, control vs corrected.

The numerical knee angle passing is not the finding. This measures what is
actually visible in the decoded silhouette: how often the two legs read as two
legs, how close they come, how much the leg region merges into one blob, and
how violently the shape changes frame to frame — for the undamped control and
the knee-0.50 corrected render, on the identical frame window.

usage: knee_pixel_diagnostic.py <control.gif> <corrected.gif> <control.bvh>
                                <corrected.bvh> <out_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageSequence

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
sys.path.insert(0, str(SC / "genloop/v3"))
from kneeprobe import fk, parse  # noqa: E402


def load(clip):
    return [np.array(f.convert("RGB")) for f in ImageSequence.Iterator(Image.open(clip))]


def sil(a):
    return a.min(axis=2) < 245


def runs(row):
    """[(start, end)] of True runs in a boolean row."""
    idx = np.flatnonzero(row)
    if idx.size == 0:
        return []
    brk = np.flatnonzero(np.diff(idx) > 1)
    starts = np.r_[idx[0], idx[brk + 1]]
    ends = np.r_[idx[brk], idx[-1]]
    return list(zip(starts.tolist(), ends.tolist()))


def leg_metrics(m):
    """Two-leg readability in the lower body: how many rows show two legs,
    the smallest gap between them, and how much of the leg zone is merged."""
    ys, xs = np.nonzero(m)
    if ys.size == 0:
        return None
    top, bot = ys.min(), ys.max()
    h = bot - top
    zone = range(top + int(h * 0.55), bot + 1)          # hip -> feet
    two, gaps, merged = 0, [], 0
    for y in zone:
        r = runs(m[y])
        if len(r) >= 2:
            two += 1
            r = sorted(r, key=lambda t: t[0])
            gaps.append(min(b[0] - a[1] for a, b in zip(r[:-1], r[1:])))
        elif len(r) == 1:
            merged += 1
    n = max(len(list(zone)), 1)
    return {"leg_zone_rows": n,
            "rows_two_legs": two,
            "rows_merged": merged,
            "two_leg_fraction": round(two / n, 4),
            "silhouette_overlap_fraction": round(merged / n, 4),
            "min_gap_px": int(min(gaps)) if gaps else 0}


def kinematics(bvh, n):
    joints, data, _, _ = parse(bvh)
    out = {"knee_angle": [], "knee_pos": [], "ankle_pos": [], "foot_z": []}
    for f in range(n):
        p, _ = fk(joints, data[f])

        def ang(a, b, c):
            u, v = a - b, c - b
            return float(np.degrees(np.arccos(np.clip(
                u @ v / (np.linalg.norm(u) * np.linalg.norm(v)), -1, 1))))
        out["knee_angle"].append((ang(p["LeftUpLeg"], p["LeftLeg"], p["LeftFoot"]),
                                  ang(p["RightUpLeg"], p["RightLeg"], p["RightFoot"])))
        out["knee_pos"].append((p["LeftLeg"].tolist(), p["RightLeg"].tolist()))
        out["ankle_pos"].append((p["LeftFoot"].tolist(), p["RightFoot"].tolist()))
        out["foot_z"].append((float(p["LeftFoot"][2]), float(p["RightFoot"][2])))
    return out


def deformation(masks):
    """Frame-to-frame shape change with locomotion removed (centroid-aligned IoU)."""
    ious = []
    for a, b in zip(masks[:-1], masks[1:]):
        ya, xa = np.nonzero(a)
        yb, xb = np.nonzero(b)
        dy = int(round(ya.mean() - yb.mean()))
        dx = int(round(xa.mean() - xb.mean()))
        bs = np.roll(np.roll(b, dy, axis=0), dx, axis=1)
        inter = (a & bs).sum()
        union = (a | bs).sum()
        ious.append(float(inter / union) if union else 1.0)
    return ious


def main():
    ctrl_gif, corr_gif, ctrl_bvh, corr_bvh, outd = sys.argv[1:6]
    outd = Path(outd)
    outd.mkdir(parents=True, exist_ok=True)
    C, X = load(ctrl_gif), load(corr_gif)
    n = min(len(C), len(X))
    mC = [sil(a) for a in C[:n]]
    mX = [sil(a) for a in X[:n]]
    kC, kX = kinematics(ctrl_bvh, n), kinematics(corr_bvh, n)

    rows = {"control": [leg_metrics(m) for m in mC],
            "corrected": [leg_metrics(m) for m in mX]}
    dC, dX = deformation(mC), deformation(mX)

    def summarise(name, R, K, D):
        tw = np.array([r["two_leg_fraction"] for r in R])
        ov = np.array([r["silhouette_overlap_fraction"] for r in R])
        gp = np.array([r["min_gap_px"] for r in R])
        ka = np.array(K["knee_angle"])
        # max crossing = fewest rows reading as two legs (ties -> smallest gap)
        order = sorted(range(len(R)), key=lambda i: (tw[i], gp[i]))
        return {
            "clip": name,
            "frames": len(R),
            "two_leg_fraction_mean": round(float(tw.mean()), 4),
            "two_leg_fraction_min": round(float(tw.min()), 4),
            "silhouette_overlap_mean": round(float(ov.mean()), 4),
            "silhouette_overlap_max": round(float(ov.max()), 4),
            "min_gap_px_min": int(gp.min()),
            "knee_angle_min_deg": round(float(ka.min()), 2),
            "knee_angle_mean_deg": round(float(ka.mean()), 2),
            "frames_below_120deg": int((ka < 120).sum()),
            "frames_below_140deg": int((ka < 140).sum()),
            "deformation_iou_min": round(float(min(D)), 4),
            "deformation_iou_mean": round(float(np.mean(D)), 4),
            "max_crossing_frame": int(order[0]),
            "max_crossing_two_leg_fraction": round(float(tw[order[0]]), 4),
            "max_crossing_min_gap_px": int(gp[order[0]]),
            "worst_five_crossing_frames": [int(i) for i in order[:5]],
        }

    sC = summarise("control_undamped", rows["control"], kC, dC)
    sX = summarise("corrected_knee050", rows["corrected"], kX, dX)

    # foot contact frames (lowest-quartile foot height minima)
    def contacts(K):
        z = np.array(K["foot_z"])
        out = {}
        for i, side in enumerate(("L", "R")):
            h = z[:, i]
            thr = np.percentile(h, 25)
            out[side] = [int(f) for f in range(1, len(h) - 1)
                         if h[f] <= h[f - 1] and h[f] <= h[f + 1] and h[f] <= thr]
        return out
    sC["foot_contacts"] = contacts(kC)
    sX["foot_contacts"] = contacts(kX)

    # ---- crops at the shared worst-crossing frames, both clips side by side
    frames = sorted({sC["max_crossing_frame"], sX["max_crossing_frame"],
                     *sX["worst_five_crossing_frames"][:3]})

    def crop(a, m):
        ys, xs = np.nonzero(m)
        top, bot = ys.min(), ys.max()
        cx = (xs.min() + xs.max()) // 2
        h = bot - top
        box = (max(0, cx - 85), top + int(h * 0.45), min(a.shape[1], cx + 85), bot + 6)
        return Image.fromarray(a).crop(box).resize((250, 300))

    tiles = []
    for f in frames:
        for tag, A, M in (("CONTROL", C, mC), ("KNEE 0.50", X, mX)):
            t = crop(A[f], M[f])
            d = ImageDraw.Draw(t)
            d.text((4, 4), f"{tag}  f{f}", fill=(200, 0, 0))
            lm = leg_metrics(M[f])
            d.text((4, 18), f"2-leg {lm['two_leg_fraction']:.2f} gap {lm['min_gap_px']}px",
                   fill=(0, 90, 200))
            tiles.append(t)
    W = 250 * 2
    sheet = Image.new("RGB", (W, 300 * len(frames)), (255, 255, 255))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 2) * 250, (i // 2) * 300))
    sheet.save(outd / "knee_crossing_compare.png")

    rep = {"control": sC, "corrected": sX,
           "compared_frames": frames,
           "crop_image": "knee_crossing_compare.png",
           "note": "two_leg_fraction = share of lower-body rows whose silhouette "
                   "reads as TWO separate runs. Lower = legs visually merged. "
                   "silhouette_overlap_fraction is its complement over the same zone."}
    (outd / "KNEE_PIXEL_DIAGNOSTIC.json").write_text(json.dumps(rep, indent=1))
    for s in (sC, sX):
        print(f"--- {s['clip']}")
        for k in ("knee_angle_min_deg", "knee_angle_mean_deg", "frames_below_120deg",
                  "frames_below_140deg", "two_leg_fraction_mean", "two_leg_fraction_min",
                  "silhouette_overlap_mean", "silhouette_overlap_max", "min_gap_px_min",
                  "deformation_iou_min", "deformation_iou_mean", "max_crossing_frame",
                  "max_crossing_min_gap_px"):
            print(f"    {k:28s} {s[k]}")
    print("compared frames:", frames)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
