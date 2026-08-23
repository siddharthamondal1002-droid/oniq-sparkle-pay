#!/usr/bin/env python3
# BATCH 3 diagnostic — motion pipeline trace (loop SS2) + pre-ARAP skeleton
# test (loop SS3 TEST A). Headless: instantiates the full AnimatedDrawing
# model WITHOUT any GL context (GL init is deferred to draw, never called),
# steps its TimeManager to exact BVH frames, and dumps the numerical state at
# every stage: source BVH joints -> projected bone angles -> driven char
# skeleton (the ARAP constraints) -> ARAP-deformed mesh vertices.
# Nothing here modifies the pipeline; observation only.
#
# usage: b3_trace.py <AD_dir> <char_rig_dir> <motion_cfg> <retarget_cfg> <out_prefix> <frame,frame,...>
import json
import os
import sys
from pathlib import Path

import numpy as np

AD_DIR = Path(sys.argv[1])
CHAR_DIR = Path(sys.argv[2])
MOTION_CFG = Path(sys.argv[3]).resolve()
RETARGET_CFG = Path(sys.argv[4]).resolve()
OUT_PREFIX = sys.argv[5]
FRAMES = (list(range(int(sys.argv[6].split("-")[0]), int(sys.argv[6].split("-")[1]) + 1))
          if "-" in sys.argv[6] else [int(f) for f in sys.argv[6].split(",")])
SNAP_MESH = "nomesh" not in sys.argv[7:]  # range runs skip heavy mesh snapshots

sys.path.insert(0, str(AD_DIR))
os.chdir(AD_DIR)  # AD resolves example-relative paths from its root

from animated_drawings.config import CharacterConfig, MotionConfig, RetargetConfig  # noqa: E402
from animated_drawings.model.animated_drawing import AnimatedDrawing  # noqa: E402

char_cfg = CharacterConfig(str(CHAR_DIR / "char_cfg.yaml"))
motion_cfg = MotionConfig(str(MOTION_CFG))
retarget_cfg = RetargetConfig(str(RETARGET_CFG))
ad = AnimatedDrawing(char_cfg, retarget_cfg, motion_cfg)
rt = ad.retargeter
ft = rt.bvh.frame_time

BVH_LEGS = {
    "right": ("RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"),
    "left": ("LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase"),
}
CHAR_LEGS = {
    "right": ("right_hip", "right_knee", "right_foot"),
    "left": ("left_hip", "left_knee", "left_foot"),
}


def bvh_xyz(frame, joint):
    i = rt.bvh_joint_names.index(joint)
    return rt.joint_positions[frame, 3 * i : 3 * (i + 1)].astype(float)


def rig_xy(name):
    j = ad.rig.root_joint.get_transform_by_name(name)
    return np.array(j.get_world_position()[:2], dtype=float)


def signed_knee(hip, knee, ankle):
    """2D signed knee data: interior angle (deg, 180=straight) and bend sign
    (z of cross(hip->knee, knee->ankle); + = ankle CCW of thigh line)."""
    v1, v2 = knee - hip, ankle - knee
    cross = float(v1[0] * v2[1] - v1[1] * v2[0])
    dot = float(v1 @ v2)
    dev = float(np.degrees(np.arctan2(abs(cross), dot)))  # 0 = straight
    return {"interiorAngleDeg": round(180.0 - dev, 2), "deviationDeg": round(dev, 2),
            "bendSign": int(np.sign(cross)), "crossZ": round(cross, 6)}


plane = rt.joint_group_name_to_projection_plane
result = {
    "char": CHAR_DIR.name,
    "frame_time": ft,
    "projection_planes": {k: ("x(frontal)" if v[0] == 1.0 else "z(sagittal)") for k, v in plane.items()},
    "char_bone_lengths": {},
    "frames": {},
}
for side, (h, k, f) in CHAR_LEGS.items():
    result["char_bone_lengths"][side] = {
        "thigh": round(float(np.linalg.norm(rig_xy(k) - rig_xy(h))), 4),
        "shin": round(float(np.linalg.norm(rig_xy(f) - rig_xy(k))), 4),
    }

mesh_snapshots = {}
for frame in FRAMES:
    ad.set_time(frame * ft)
    ad.update()
    rec = {"bvh": {}, "char": {}}
    for side, (upleg, leg, foot, toe) in BVH_LEGS.items():
        hip3, knee3, ankle3 = (bvh_xyz(frame, j) for j in (upleg, leg, foot))
        thigh3, shin3 = knee3 - hip3, ankle3 - knee3
        # sagittal projection (what the Lower Limbs group uses when plane=z)
        p = lambda v: [round(float(v[0]), 4), round(float(v[1]), 4)]
        rec["bvh"][side] = {
            "hip": [round(float(x), 4) for x in hip3],
            "knee": [round(float(x), 4) for x in knee3],
            "ankle": [round(float(x), 4) for x in ankle3],
            "thighVec2d": p(thigh3), "shinVec2d": p(shin3),
            "knee2d": signed_knee(np.array([hip3[0], hip3[1]]), np.array([knee3[0], knee3[1]]),
                                  np.array([ankle3[0], ankle3[1]])),
        }
    for side, (h, k, f) in CHAR_LEGS.items():
        hip, knee, foot = rig_xy(h), rig_xy(k), rig_xy(f)
        rec["char"][side] = {
            "hip": [round(float(x), 4) for x in hip],
            "knee": [round(float(x), 4) for x in knee],
            "foot": [round(float(x), 4) for x in foot],
            "kneeOrientDeg": round(float(rt.char_joint_to_orientation[k.replace("_hip", "_knee")][frame]), 2)
            if k in rt.char_joint_to_orientation else round(float(rt.char_joint_to_orientation[k][frame]), 2),
            "footOrientDeg": round(float(rt.char_joint_to_orientation[f][frame]), 2),
            "knee2d": signed_knee(hip, knee, foot),
        }
    rec["root"] = [round(float(x), 4) for x in ad.rig.root_joint.get_world_position()]
    result["frames"][frame] = rec
    if SNAP_MESH:
        all_joints = {n: rig_xy(n) for n in ad.rig.root_joint.get_chain_joint_names()}
        mesh_snapshots[frame] = {
            "joints": {n: v.tolist() for n, v in all_joints.items()},
            "vertices": ad.vertices[:, :2].astype(float).tolist(),
        }

Path(f"{OUT_PREFIX}.json").write_text(json.dumps(result, indent=1))
if SNAP_MESH:
    Path(f"{OUT_PREFIX}_mesh.json").write_text(json.dumps(
        {"parents": {j["name"]: j["parent"] for j in char_cfg.skeleton}, "frames": mesh_snapshots}))
print(f"TRACE_OK {result['char']} frames={FRAMES} planes={result['projection_planes']}")
