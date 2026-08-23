#!/usr/bin/env python3
"""ONIQ engineering measurement engine — READ-ONLY.

Measures candidate engineering parameters from assets that already exist: rig
landmarks, the driver BVH, decoded silhouettes and frame-to-frame trajectories.
It renders nothing, generates nothing, spends nothing, and promotes nothing.

Every measurement declares its DOMAIN and domains are never mixed:
  PIXEL       measured in image pixels
  NORMALIZED  a dimensionless ratio of two same-domain measurements
  BVH         the driver's own dimensionless units
  MILLIMETRE  requires a scale bridge. ONIQ has none, so nothing is emitted
              in this domain and mm candidates are BLOCKED_SCALE_BRIDGE.

usage: measurement_engine.py <out_dir>
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import yaml
from PIL import Image, ImageSequence

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
sys.path.insert(0, str(SC / "genloop/v3"))
from kneeprobe import fk, parse  # noqa: E402

CHAR = SC / "genloop/v3/b4/m3_suit_woman"
CORRECTED = SC / "eld/evidence/run1/sample_1.gif"
CONTROL = SC / "eld/evidence/diag/control.gif"
DRIVER = SC / "eld/evidence/run1/driver_knee050.bvh"
SRC_BVH = SC / "l3amp/AnimatedDrawings/examples/bvh/fair1/zombie.bvh"
N = 129
FPS = 1 / 0.0333333

SCALE_BRIDGE = "NOT_AVAILABLE"


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


class Recorder:
    def __init__(self):
        self.rows = []
        self.n = 0

    def add(self, parameter, value, unit, domain, method, confidence,
            source_asset, source_clip, f0, f1, evidence, state="MEASURED",
            note=""):
        assert domain in ("PIXEL", "NORMALIZED", "BVH"), domain
        self.n += 1
        self.rows.append({
            "id": f"MEAS-{self.n:04d}",
            "parameter": parameter,
            "value": (round(float(value), 4) if isinstance(value, (int, float, np.floating))
                      else value),
            "unit": unit,
            "measurement_domain": domain,
            "source_asset": source_asset,
            "source_clip": source_clip,
            "frame_start": f0,
            "frame_end": f1,
            "method": method,
            "confidence": confidence,
            "evidence_sha256": evidence,
            "validationState": state,
            "note": note,
        })


def load_masks(clip):
    out = []
    for f in ImageSequence.Iterator(Image.open(clip)):
        a = np.array(f.convert("RGB"))
        out.append(a.min(axis=2) < 245)
    return out[:N]


def fk_series(bvh):
    joints, data, _, _ = parse(bvh)
    P = []
    for f in range(N):
        p, _ = fk(joints, data[f])
        P.append({k: np.asarray(v, dtype=float) for k, v in p.items()})
    return P


def ang(a, b, c):
    u, v = a - b, c - b
    d = np.linalg.norm(u) * np.linalg.norm(v)
    return float(np.degrees(np.arccos(np.clip(u @ v / d, -1, 1)))) if d else np.nan


def contacts(z):
    thr = np.percentile(z, 25)
    return [f for f in range(1, len(z) - 1)
            if z[f] <= z[f - 1] and z[f] <= z[f + 1] and z[f] <= thr]


def measure(R, tag, clip, bvh):
    ev_clip, ev_bvh = sha(clip), sha(bvh)
    P = fk_series(bvh)
    masks = load_masks(clip)
    asset = "m3_suit_woman"

    # ---------------- GROUP B: KNEE, LEFT AND RIGHT INDEPENDENTLY ----------
    for side in ("Left", "Right"):
        a = np.array([ang(p[f"{side}UpLeg"], p[f"{side}Leg"], p[f"{side}Foot"])
                      for p in P])
        v = np.diff(a) * FPS
        acc = np.diff(a, 2) * FPS * FPS
        s = side.lower()
        for nm, val, unit, mth in (
            (f"knee_angle_min_{s}", a.min(), "deg", "FK interior angle UpLeg-Leg-Foot"),
            (f"knee_angle_max_{s}", a.max(), "deg", "FK interior angle UpLeg-Leg-Foot"),
            (f"knee_angle_mean_{s}", a.mean(), "deg", "FK interior angle mean"),
            (f"knee_angle_frame_of_min_{s}", int(a.argmin()), "frame", "argmin over window"),
            (f"knee_angle_frame_of_max_{s}", int(a.argmax()), "frame", "argmax over window"),
            (f"knee_angular_velocity_absmax_{s}", np.abs(v).max(), "deg/s",
             "first difference x fps"),
            (f"knee_angular_acceleration_absmax_{s}", np.abs(acc).max(), "deg/s^2",
             "second difference x fps^2"),
        ):
            R.add(nm, val, unit, "BVH", mth, "high", asset, tag, 0, N - 1, ev_bvh,
                  note="measured per physical knee — NOT inferred from a combined minimum")

    # ---------------- GROUP A: GAIT ---------------------------------------
    Lz = np.array([p["LeftFoot"][2] for p in P])
    Rz = np.array([p["RightFoot"][2] for p in P])
    cL, cR = contacts(Lz), contacts(Rz)
    R.add("foot_contact_frames_left", json.dumps(cL), "frames", "BVH",
          "local minima of foot height below the 25th percentile", "medium",
          asset, tag, 0, N - 1, ev_bvh)
    R.add("foot_contact_frames_right", json.dumps(cR), "frames", "BVH",
          "local minima of foot height below the 25th percentile", "medium",
          asset, tag, 0, N - 1, ev_bvh)

    hips = np.array([p["Hips"] for p in P])
    disp = hips - hips[0]
    fwd = disp[-1] - disp[0]
    nfwd = fwd / (np.linalg.norm(fwd) or 1)

    def along(v):
        return float(np.dot(v, nfwd))

    for nm, cs, jn in (("stride_length_left", cL, "LeftFoot"),
                       ("stride_length_right", cR, "RightFoot")):
        if len(cs) >= 2:
            d = [abs(along(P[b][jn] - P[a][jn])) for a, b in zip(cs[:-1], cs[1:])]
            R.add(nm, float(np.mean(d)), "BVH units", "BVH",
                  "mean forward distance between successive same-foot contacts",
                  "medium", asset, tag, cs[0], cs[-1], ev_bvh)
            R.add(nm.replace("stride_length", "stride_time"),
                  float(np.mean(np.diff(cs))), "frames", "BVH",
                  "mean frames between successive same-foot contacts", "medium",
                  asset, tag, cs[0], cs[-1], ev_bvh)
    allc = sorted([(f, "L") for f in cL] + [(f, "R") for f in cR])
    steps = [(a, b) for (a, sa), (b, sb) in zip(allc[:-1], allc[1:]) if sa != sb]
    if steps:
        R.add("step_time_mean", float(np.mean([b - a for a, b in steps])), "frames",
              "BVH", "mean frames between successive opposite-foot contacts",
              "medium", asset, tag, steps[0][0], steps[-1][1], ev_bvh)
        R.add("step_length_mean",
              float(np.mean([abs(along(P[b]["LeftFoot"] - P[b]["RightFoot"]))
                             for _, b in steps])), "BVH units", "BVH",
              "mean forward foot separation at opposite-foot contacts", "medium",
              asset, tag, steps[0][0], steps[-1][1], ev_bvh)

    for side, z, jn in (("left", Lz, "LeftFoot"), ("right", Rz, "RightFoot")):
        thr = np.percentile(z, 25)
        stance = np.flatnonzero(z <= thr)
        R.add(f"stance_frames_{side}", int(stance.size), "frames", "BVH",
              "frames with foot height in the lowest quartile", "medium",
              asset, tag, 0, N - 1, ev_bvh)
        R.add(f"swing_frames_{side}", int(N - stance.size), "frames", "BVH",
              "complement of stance within the window", "medium",
              asset, tag, 0, N - 1, ev_bvh)
        d = [float(np.linalg.norm(P[b][jn][:2] - P[a][jn][:2]))
             for a, b in zip(stance[:-1], stance[1:]) if b - a == 1]
        R.add(f"foot_slide_max_{side}", max(d) if d else 0.0, "BVH units", "BVH",
              "max per-frame horizontal travel of the planted foot", "high",
              asset, tag, 0, N - 1, ev_bvh)

    sl, sr = ([r for r in R.rows if r["parameter"] == f"stance_frames_{s}"][-1]["value"]
              for s in ("left", "right"))
    R.add("stance_symmetry_left_right", (min(sl, sr) / max(sl, sr)) if max(sl, sr) else 0,
          "ratio", "NORMALIZED", "min/max of the two stance-frame counts", "medium",
          asset, tag, 0, N - 1, ev_bvh)

    for nm, jn in (("knee_trajectory_path_left", "LeftLeg"),
                   ("knee_trajectory_path_right", "RightLeg"),
                   ("ankle_trajectory_path_left", "LeftFoot"),
                   ("ankle_trajectory_path_right", "RightFoot"),
                   ("hip_trajectory_path", "Hips")):
        pts = np.array([p[jn] for p in P])
        R.add(nm, float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum()),
              "BVH units", "BVH", "summed per-frame 3D displacement", "high",
              asset, tag, 0, N - 1, ev_bvh)

    lat = np.cross(np.array([0, 0, 1.0]), nfwd)
    lat = lat / (np.linalg.norm(lat) or 1)
    R.add("pelvis_bob_range", float(hips[:, 2].ptp()), "BVH units", "BVH",
          "vertical range of the Hips joint", "high", asset, tag, 0, N - 1, ev_bvh)
    R.add("pelvis_sway_range", float((hips @ lat).ptp()), "BVH units", "BVH",
          "lateral range of the Hips joint about the forward axis", "high",
          asset, tag, 0, N - 1, ev_bvh)

    # unweighted joint centroid — explicitly NOT a mass-weighted COM
    names = [k for k in P[0] if not k.endswith("_End")]
    cen = np.array([[p[k] for k in names] for p in P]).mean(axis=1)
    R.add("joint_centroid_path_unweighted", float(np.linalg.norm(np.diff(cen, axis=0), axis=1).sum()),
          "BVH units", "BVH", "summed displacement of the unweighted mean of all joints",
          "medium", asset, tag, 0, N - 1, ev_bvh,
          note="proxy only. A true centre of mass needs per-segment masses, which "
               "ONIQ does not have — see COM entry in the gaps file")

    # ---------------- GROUP C: SILHOUETTE (PIXEL) -------------------------
    hs, ws, cx, cy, occ, gaps, twofrac, footsep = [], [], [], [], [], [], [], []
    for m in masks:
        ys, xs = np.nonzero(m)
        h, w = ys.ptp() + 1, xs.ptp() + 1
        hs.append(h)
        ws.append(w)
        cx.append(xs.mean())
        cy.append(ys.mean())
        occ.append(m.sum() / (h * w))
        top, bot = ys.min(), ys.max()
        zone = range(top + int((bot - top) * 0.55), bot + 1)
        two, g = 0, []
        for y in zone:
            idx = np.flatnonzero(m[y])
            if idx.size == 0:
                continue
            brk = np.flatnonzero(np.diff(idx) > 1)
            if brk.size >= 1:
                two += 1
                st = np.r_[idx[0], idx[brk + 1]]
                en = np.r_[idx[brk], idx[-1]]
                g.append(min(b - a for a, b in zip(en[:-1], st[1:])))
        nz = max(len(list(zone)), 1)
        twofrac.append(two / nz)
        gaps.append(min(g) if g else 0)
        band = m[bot - max(int((bot - top) * 0.06), 1):bot + 1]
        fx = np.flatnonzero(band.any(axis=0))
        footsep.append(fx.ptp() if fx.size else 0)
    for nm, arr, unit, mth in (
        ("silhouette_height", hs, "px", "bounding-box height per frame"),
        ("silhouette_width", ws, "px", "bounding-box width per frame"),
        ("bbox_occupancy", occ, "ratio", "silhouette pixels / bounding-box area"),
        ("leg_gap_min", gaps, "px", "smallest gap between the two leg runs"),
        ("two_leg_fraction", twofrac, "ratio", "share of lower-body rows reading as two runs"),
        ("foot_separation", footsep, "px", "horizontal extent of the lowest 6% band"),
    ):
        a = np.array(arr, dtype=float)
        dom = "NORMALIZED" if unit == "ratio" else "PIXEL"
        R.add(f"{nm}_min", a.min(), unit, dom, mth, "high", asset, tag, 0, N - 1, ev_clip)
        R.add(f"{nm}_max", a.max(), unit, dom, mth, "high", asset, tag, 0, N - 1, ev_clip)
        R.add(f"{nm}_mean", a.mean(), unit, dom, mth, "high", asset, tag, 0, N - 1, ev_clip)
    R.add("silhouette_aspect_ratio_mean", float(np.mean(np.array(ws) / np.array(hs))),
          "ratio", "NORMALIZED", "width/height per frame, averaged", "high",
          asset, tag, 0, N - 1, ev_clip)
    R.add("centroid_drift_x", float(np.ptp(cx)), "px", "PIXEL",
          "range of the silhouette centroid x", "high", asset, tag, 0, N - 1, ev_clip)
    R.add("centroid_drift_y", float(np.ptp(cy)), "px", "PIXEL",
          "range of the silhouette centroid y", "high", asset, tag, 0, N - 1, ev_clip)
    ious = []
    for a, b in zip(masks[:-1], masks[1:]):
        ya, xa = np.nonzero(a)
        yb, xb = np.nonzero(b)
        bs = np.roll(np.roll(b, int(round(ya.mean() - yb.mean())), 0),
                     int(round(xa.mean() - xb.mean())), 1)
        ious.append((a & bs).sum() / max((a | bs).sum(), 1))
    R.add("silhouette_overlap_max", float(1 - min(twofrac)), "ratio", "NORMALIZED",
          "1 - min two-leg fraction", "high", asset, tag, 0, N - 1, ev_clip)
    R.add("frame_to_frame_iou_min", float(min(ious)), "IoU", "NORMALIZED",
          "centroid-aligned IoU of consecutive silhouettes", "high",
          asset, tag, 0, N - 1, ev_clip)
    R.add("frames_iou_below_090", int(sum(1 for i in ious if i < 0.90)), "frames",
          "PIXEL", "count of consecutive pairs with IoU < 0.90", "high",
          asset, tag, 0, N - 1, ev_clip)


def proportions(R):
    """GROUP E — ratios from rig landmarks. PIXEL source, NORMALIZED output."""
    cfg = yaml.safe_load((CHAR / "rig/char_cfg.yaml").read_text())
    J = {j["name"]: np.array(j["loc"], dtype=float) for j in cfg["skeleton"]}
    ev = sha(CHAR / "rig/char_cfg.yaml")
    d = lambda a, b: float(np.linalg.norm(J[a] - J[b]))  # noqa: E731
    body = float(J["left_foot"][1] - J["neck"][1]) + d("neck", "torso")
    head = float(J["neck"][1])          # crown(y=0) -> neck, in the cropped rig
    ratios = {
        "head_to_body_height": head / body,
        "shoulder_width_over_body_height": d("left_shoulder", "right_shoulder") / body,
        "pelvis_width_over_body_height": d("left_hip", "right_hip") / body,
        "upper_arm_over_torso": d("left_shoulder", "left_elbow") / d("neck", "hip"),
        "forearm_over_upper_arm": d("left_elbow", "left_hand") / d("left_shoulder", "left_elbow"),
        "thigh_over_lower_leg": d("left_hip", "left_knee") / d("left_knee", "left_foot"),
        "foot_height_over_body_height": (float(J["left_foot"][1]) - float(J["left_knee"][1])) / body,
        "arm_span_proxy_over_body_height": d("left_hand", "right_hand") / body,
    }
    for k, v in ratios.items():
        R.add(k, v, "ratio", "NORMALIZED",
              "ratio of rig-landmark pixel distances; no millimetre conversion",
              "medium", "m3_suit_woman", "rig/char_cfg.yaml", None, None, ev,
              note="rig landmarks are in PIXELS of the 253x688 crop; the ratio is "
                   "dimensionless and is NOT a physical proportion")


def main():
    outd = Path(sys.argv[1])
    outd.mkdir(parents=True, exist_ok=True)
    R = Recorder()
    measure(R, "corrected_knee050", CORRECTED, DRIVER)
    base = R.n
    measure(R, "control_undamped", CONTROL, SRC_BVH)
    proportions(R)

    engine = {
        "record": "ENGINEERING_MEASUREMENT_ENGINE", "version": "1.0",
        "read_only": True, "renders_anything": False, "generates_anything": False,
        "api_spend_inr": 0, "gpu_spend_inr": 0,
        "scale_bridge": SCALE_BRIDGE,
        "domains": {
            "PIXEL": "image pixels of the 500x500 render or the 253x688 rig crop",
            "NORMALIZED": "dimensionless ratio of two same-domain measurements",
            "BVH": "the driver's own dimensionless units",
            "MILLIMETRE": "UNAVAILABLE — requires a scale bridge ONIQ does not have",
        },
        "sources": {
            "corrected_clip": {"file": str(CORRECTED), "sha256": sha(CORRECTED)},
            "control_clip": {"file": str(CONTROL), "sha256": sha(CONTROL)},
            "driver_bvh": {"file": str(DRIVER), "sha256": sha(DRIVER)},
            "source_bvh": {"file": str(SRC_BVH), "sha256": sha(SRC_BVH)},
            "rig_cfg": {"file": str(CHAR / "rig/char_cfg.yaml"),
                        "sha256": sha(CHAR / "rig/char_cfg.yaml")},
        },
        "window": {"frame_start": 0, "frame_end": N - 1, "frames": N},
        "invariants": [
            "no measurement is emitted in the MILLIMETRE domain",
            "left and right knee values are measured independently, never inferred "
            "from a combined minimum",
            "no measurement sets productionEligible; promotion is a separate act",
        ],
        "measurements_corrected": base,
        "measurements_control": R.n - base - 8,
        "measurements_proportions": 8,
        "total_measurements": R.n,
    }
    (outd / "ENGINEERING_MEASUREMENT_ENGINE.json").write_text(json.dumps(engine, indent=1))
    (outd / "ENGINEERING_MEASUREMENT_RESULTS.json").write_text(json.dumps(
        {"record": "ENGINEERING_MEASUREMENT_RESULTS", "version": "1.0",
         "scale_bridge": SCALE_BRIDGE, "total": R.n, "measurements": R.rows}, indent=1))
    print(f"  total measurements: {R.n}")
    for dom in ("BVH", "PIXEL", "NORMALIZED"):
        print(f"    {dom:11s} {sum(1 for r in R.rows if r['measurement_domain'] == dom)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
