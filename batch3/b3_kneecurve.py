#!/usr/bin/env python3
# BATCH 3 — full-cycle knee-angle curve from the retarget driver alone.
# The driven knee deviation is character-independent (proved in the trace:
# identical for basma and rashid): it is the difference between the projected
# thigh orientation (char knee driver) and shin orientation (char foot driver).
# usage: b3_kneecurve.py <AD_dir> <motion_cfg> <retarget_cfg> <out.json> [label]
import json
import os
import sys
from pathlib import Path

import numpy as np

AD_DIR = Path(sys.argv[1])
sys.path.insert(0, str(AD_DIR))
os.chdir(AD_DIR)
from animated_drawings.config import MotionConfig, RetargetConfig  # noqa: E402
from animated_drawings.model.retargeter import Retargeter  # noqa: E402

motion_cfg = MotionConfig(str(Path(sys.argv[2]).resolve()))
retarget_cfg = RetargetConfig(str(Path(sys.argv[3]).resolve()))
rt = Retargeter(motion_cfg, retarget_cfg)
for char_joint, (prox, dist) in retarget_cfg.char_joint_bvh_joints_mapping.items():
    rt.compute_orientations(prox, dist, char_joint)

out = {"label": sys.argv[5] if len(sys.argv) > 5 else "curve", "frames": rt.bvh.frame_max_num, "legs": {}}
for side in ("right", "left"):
    thigh = np.asarray(rt.char_joint_to_orientation[f"{side}_knee"], dtype=float)
    shin = np.asarray(rt.char_joint_to_orientation[f"{side}_foot"], dtype=float)
    dev = (thigh - shin + 180.0) % 360.0 - 180.0  # signed knee deviation, deg; 0 = straight
    out["legs"][side] = [round(float(d), 2) for d in dev]
    # temporal-continuity metrics the loop SS9 demands
    jumps = np.abs(np.diff(dev))
    out.setdefault("metrics", {})[side] = {
        "maxAbsDeviationDeg": round(float(np.max(np.abs(dev))), 2),
        "argmaxFrame": int(np.argmax(np.abs(dev))),
        "maxFrameToFrameJumpDeg": round(float(np.max(jumps)), 2),
        "signChanges": int(np.sum(np.diff(np.sign(dev[np.abs(dev) > 2.0])) != 0)),
    }
Path(sys.argv[4]).write_text(json.dumps(out))
print("CURVE_OK", out["label"], json.dumps(out["metrics"]))
