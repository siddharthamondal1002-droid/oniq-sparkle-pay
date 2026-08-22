#!/usr/bin/env python3
# Phase 8 — PART-AWARE MASK (EVALUATED, DID NOT FIX THE ARTIFACT — kept as evidence).
#
# Hypothesis (Phase 7): the arm-claw tear came from the arm silhouette merging
# with the torso, so ARAP had no seam to hinge the arm. This script carves a thin
# separation seam between each arm bone-chain and the torso axis in the U^2-Net
# foreground — CPU, ₹0, SAFETY: only REMOVES a thin internal line (never adds
# pixels, never invents an arm), fail-closed to PART_MASK_UNCERTAIN when an arm
# can't be located in the foreground.
#
# RESULT (measured, same Aladdin still + zombie.bvh): carving had ~zero effect on
# the render — A vs part-mask pixel diff 0.004 (3px seam) / 0.007 (22px seam); the
# claw was UNCHANGED. A diagnostic 4x-denser ARAP mesh (40->110 grid) also failed
# (diff 4.0 but claw persists, 4x slower). => the arm tear is an ARAP_LIMIT (2D
# ARAP cannot foreshorten the driver's forward-arm reach on a detailed character),
# NOT an arm/torso occlusion the mask can fix. Conclusion: keep the arms-flush
# eligibility restriction; route arm-articulation shots to L4. See
# MOTION_ARM_TORSO.md. Reference/proof only; NOT wired to production.

import sys, json
from pathlib import Path
import numpy as np, cv2

RIG = Path(sys.argv[1])          # phase-7 rig dir (char_cfg.yaml, mask.png, texture.png, autorig_result.json)
OUT = Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
SEAM_W = int(sys.argv[3]) if len(sys.argv) > 3 else 3

d = json.load(open(RIG / "autorig_result.json"))
J = {k: np.array(v, float) for k, v in d["joints"].items()}
mask = cv2.imread(str(RIG / "mask.png"), 0)
H, W = mask.shape
fg = mask > 127

def polyline_dist(pts, shape):
    """Euclidean distance field to a polyline (list of xy points), via segment sampling."""
    H, W = shape
    yy, xx = np.mgrid[0:H, 0:W]
    best = np.full((H, W), 1e9, np.float32)
    for a, b in zip(pts[:-1], pts[1:]):
        ab = b - a
        L2 = float(ab @ ab) or 1.0
        t = ((xx - a[0]) * ab[0] + (yy - a[1]) * ab[1]) / L2
        t = np.clip(t, 0, 1)
        px = a[0] + t * ab[0]; py = a[1] + t * ab[1]
        best = np.minimum(best, np.hypot(xx - px, yy - py))
    return best

torso_axis = [J["neck"], J["torso"], (J["left_hip"] + J["right_hip"]) / 2]
d_torso = polyline_dist(torso_axis, mask.shape)

report = {"seam_width_px": SEAM_W, "arms": {}}
carved = mask.copy()
any_carved = False
uncertain = False

for side in ["left", "right"]:
    sh, el, ha = J[f"{side}_shoulder"], J[f"{side}_elbow"], J[f"{side}_hand"]
    arm_pts = [sh, el, ha]
    d_arm = polyline_dist(arm_pts, mask.shape)
    # arm region = foreground closer to the arm bone than to the torso axis, and
    # within a reasonable radius of the arm bone (so we don't claim half the body).
    arm_len = np.hypot(*(el - sh)) + np.hypot(*(ha - el))
    radius = max(30.0, 0.5 * arm_len)
    arm_region = fg & (d_arm < d_torso) & (d_arm < radius)
    # is the arm actually present in the foreground? (fail-closed if not)
    # sample along the bone: fraction of bone samples landing on foreground.
    ts = np.linspace(0, 1, 40)
    on_fg = 0
    for i in range(len(arm_pts) - 1):
        a, b = arm_pts[i], arm_pts[i + 1]
        for t in ts:
            p = a + t * (b - a)
            x, y = int(round(p[0])), int(round(p[1]))
            if 0 <= y < H and 0 <= x < W and fg[y, x]:
                on_fg += 1
    bone_fg_frac = on_fg / (2 * len(ts))
    # is the arm merged with the torso? (a natural gap already present => skip)
    # check rows in the arm band for a background gap between torso axis x and arm x.
    y0, y1 = int(min(sh[1], el[1])) + 8, int(ha[1])   # below shoulder → hand
    merged_rows, band_rows = 0, 0
    for y in range(max(0, y0), min(H, y1)):
        tx = int(round(np.interp(y, [torso_axis[0][1], torso_axis[2][1]], [torso_axis[0][0], torso_axis[2][0]])))
        ax = int(round(np.interp(y, [sh[1], ha[1]], [sh[0], ha[0]])))
        lo, hi = sorted((tx, ax))
        lo = max(0, lo); hi = min(W - 1, hi)
        if hi - lo < 3:
            continue
        band_rows += 1
        seg = fg[y, lo:hi + 1]
        if seg.all():                      # continuous foreground => arm welded to torso here
            merged_rows += 1
    merged_frac = merged_rows / band_rows if band_rows else 0.0

    status = "ok"
    if bone_fg_frac < 0.6:
        status = "uncertain_arm_not_in_fg"; uncertain = True
    elif merged_frac < 0.25:
        status = "already_separated_skip"   # a natural gap exists; nothing to carve
    else:
        # carve the internal seam: boundary of arm_region that lies inside fg.
        er = cv2.erode(arm_region.astype(np.uint8), np.ones((3, 3), np.uint8), 1)
        seam = (arm_region.astype(np.uint8) - er).astype(bool) & fg
        # only the part of the seam NOT on the outer silhouette (i.e. torso side)
        torso_side = d_torso < d_arm
        torso_neighbor = cv2.dilate(torso_side.astype(np.uint8), np.ones((5, 5), np.uint8), 1).astype(bool)
        seam = seam & torso_neighbor
        # keep the shoulder attached: don't carve the top 12% of the arm band
        keepy = int(sh[1] + 0.12 * (ha[1] - sh[1]))
        seam[:keepy, :] = False
        seam = cv2.dilate(seam.astype(np.uint8), np.ones((SEAM_W, SEAM_W), np.uint8), 1).astype(bool)
        carved[seam] = 0
        any_carved = True
        status = "carved"
    report["arms"][side] = {
        "bone_fg_frac": round(bone_fg_frac, 2), "merged_frac": round(merged_frac, 2),
        "status": status,
    }

# fail-closed: if any arm uncertain, do NOT ship a half-baked carve
if uncertain:
    report["result"] = "PART_MASK_UNCERTAIN"
else:
    report["result"] = "PART_MASK_OK" if any_carved else "PART_MASK_NOOP"

# largest-component guard: carving must not drop the body. Keep components that are
# either large OR touch the (now-hinged) arm; here we simply keep all components
# >0.5% of fg so a thin over-carve can't delete a limb silently.
n, lab, stats, _ = cv2.connectedComponentsWithStats((carved > 0).astype(np.uint8), 8)
kept = np.zeros_like(carved)
total = (carved > 0).sum() or 1
dropped = []
for i in range(1, n):
    area = stats[i, cv2.CC_STAT_AREA]
    if area / total > 0.005:
        kept[lab == i] = 255
    else:
        dropped.append(int(area))
carved = kept
report["components_kept"] = int((np.unique(lab).size - 1) - len(dropped))
report["components_dropped_small"] = dropped

cv2.imwrite(str(OUT / "mask.png"), carved)
# debug overlay: red = carved-away pixels
dbg = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
dbg[(mask > 0) & (carved == 0)] = (0, 0, 255)
cv2.imwrite(str(OUT / "carve_debug.png"), dbg)
print(json.dumps(report, indent=2))
