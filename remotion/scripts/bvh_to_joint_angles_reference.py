#!/usr/bin/env python3
# L3R DRIVER CONVERSION — REFERENCE / PROOF (Phase 10).
# Reads the SAME zombie.bvh WALK driver and emits per-frame 2D in-plane swing
# angles (+ root bob/translation) for the rigid-part puppet. No new driver, no
# modification. Run with a python that has the Animated Drawings deps (BVH parser
# imports OpenGL). Reference/proof only; not wired to production; no media in git.
import sys, json, math
from pathlib import Path
AD = Path(sys.argv[1]); OUT = Path(sys.argv[2])
START = int(sys.argv[3]) if len(sys.argv) > 3 else 0
END = int(sys.argv[4]) if len(sys.argv) > 4 else 149
sys.path.insert(0, str(AD))
import numpy as np
from animated_drawings.model.bvh import BVH

bvh = BVH.from_file(str(AD / "examples/bvh/fair1/zombie.bvh"), START, END)

# bone = (name, parent_joint, child_joint); angle from the proximal (parent) joint
BONES = {
    "head": ("Neck", "Head"),
    "upper_arm_l": ("LeftArm", "LeftForeArm"),
    "forearm_l": ("LeftForeArm", "LeftHand"),
    "hand_l": ("LeftHand", "LeftHandEnd"),
    "upper_arm_r": ("RightArm", "RightForeArm"),
    "forearm_r": ("RightForeArm", "RightHand"),
    "hand_r": ("RightHand", "RightHandEnd"),
    "thigh_l": ("LeftUpLeg", "LeftLeg"),
    "shin_l": ("LeftLeg", "LeftFoot"),
    "foot_l": ("LeftFoot", "LeftToeBase"),
    "thigh_r": ("RightUpLeg", "RightLeg"),
    "shin_r": ("RightLeg", "RightFoot"),
    "foot_r": ("RightFoot", "RightToeBase"),
    "torso": ("Hips", "Neck"),
}

def wp(name):
    t = bvh.root_joint.get_transform_by_name(name)
    return np.array(t.get_world_position(), float)

nframes = bvh.frame_max_num
frames = []
for f in range(nframes):
    bvh.apply_frame(f)
    bvh.root_joint.update_transforms(update_ancestors=True)
    row = {}
    for bone, (a, b) in BONES.items():
        pa, pb = wp(a), wp(b)
        d = pb - pa  # (x lateral, y forward, z up)
        # sagittal swing angle: 0 when hanging straight down (-z), + when forward (+y)
        row[bone] = math.atan2(d[1], -d[2])
    hips = wp("Hips")
    row["_hips"] = [float(hips[0]), float(hips[1]), float(hips[2])]
    frames.append(row)

# deltas from rest (frame 0) so we ROTATE the still's parts by the swing change
rest = frames[0]
hips0 = np.array(rest["_hips"])
out = {"nframes": nframes, "fps": round(1.0 / bvh.frame_time, 2), "frames": []}
amp = {b: [] for b in BONES}
for fr in frames:
    row = {}
    for bone in BONES:
        dtheta = fr[bone] - rest[bone]
        # wrap to [-pi,pi]
        dtheta = (dtheta + math.pi) % (2 * math.pi) - math.pi
        row[bone] = round(dtheta, 4)
        amp[bone].append(dtheta)
    h = np.array(fr["_hips"]) - hips0
    row["_root"] = {"fwd": round(float(h[1]), 4), "up": round(float(h[2]), 4), "lat": round(float(h[0]), 4)}
    out["frames"].append(row)
OUT.write_text(json.dumps(out))
# report swing amplitude (peak-to-peak) per bone so we can confirm a real gait
print("fps", out["fps"], "nframes", nframes)
for b in ["thigh_l", "thigh_r", "shin_l", "upper_arm_l", "upper_arm_r", "forearm_l", "head", "torso"]:
    a = np.array(amp[b]); print(f"  {b:12s} swing p2p = {math.degrees(a.max()-a.min()):.1f} deg")
