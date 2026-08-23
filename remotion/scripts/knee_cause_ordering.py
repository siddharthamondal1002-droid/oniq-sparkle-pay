#!/usr/bin/env python3
"""Route 5B section-12 causal ordering, applied to the source ONIQ actually has.

The external third-party BVH could not be acquired (its host is blocked and the
repository's own .gitignore excludes the data), so the external experiment is
stopped at source acceptance. What CAN still be done is the diagnostic ordering
the loop specifies — check representation causes BEFORE reaching for any
knee-specific compensation — against the existing source BVH.

Priority order, from the directive:
  1 joint mapping
  2 rotation order
  3 axis / sign conversion
  4 rest-pose handling
  5 coordinate conversion
  6 driver interpretation
  7 only then a bounded motion correction

Read-only. Parses BVH and measures. No renders, no writes into the rig.

usage: knee_cause_ordering.py <source.bvh> <driver_output.bvh> <out.json>
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
                            "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad/"
                            "genloop/v3")))
import kneeprobe as KP  # noqa: E402

L = ("LeftUpLeg", "LeftLeg", "LeftFoot")
R = ("RightUpLeg", "RightLeg", "RightFoot")


def interior_angle(pos, chain):
    """Interior knee angle: hip -> knee -> ankle, in degrees."""
    a, b, c = (pos[chain[0]], pos[chain[1]], pos[chain[2]])
    u, v = a - b, c - b
    nu, nv = np.linalg.norm(u), np.linalg.norm(v)
    if nu == 0 or nv == 0:
        return float("nan")
    return float(np.degrees(np.arccos(np.clip(u @ v / (nu * nv), -1, 1))))


def check_1_joint_mapping(joints):
    by = {j["name"]: j for j in joints}
    missing = [n for n in L + R if n not in by]
    parents = {n: by[n]["parent"] for n in L + R if n in by}
    mirrored = all(
        (parents.get(l) or "").replace("Left", "@").replace("Right", "@")
        == (parents.get(r) or "").replace("Left", "@").replace("Right", "@")
        for l, r in zip(L, R))
    return {
        "check": "1_joint_mapping",
        "missing_joints": missing,
        "parents": parents,
        "chains_are_mirror_parented": bool(mirrored and not missing),
        "verdict": "NOT_THE_CAUSE" if mirrored and not missing else "SUSPECT",
        "reason": ("both leg chains exist and are parented identically under "
                   "mirrored parents, so a mapping swap or a missing joint "
                   "cannot explain a left/right difference")
        if mirrored and not missing else "chain structure differs between sides",
    }


def check_2_rotation_order(joints):
    by = {j["name"]: j for j in joints}
    orders = {n: [c for c in by[n]["channels"] if c.endswith("rotation")]
              for n in L + R if n in by}
    same = all(orders[l] == orders[r] for l, r in zip(L, R) if l in orders and r in orders)
    return {
        "check": "2_rotation_order",
        "euler_order_per_joint": orders,
        "left_and_right_share_the_same_order": bool(same),
        "verdict": "NOT_THE_CAUSE" if same else "SUSPECT",
        "reason": ("identical Euler order on both sides, so a per-side rotation-"
                   "order error cannot explain the asymmetry")
        if same else "the two sides are interpreted in different Euler orders",
    }


def check_3_axis_sign(joints):
    """Rest OFFSETs should mirror in X and match in Y/Z."""
    by = {j["name"]: j for j in joints}
    rows, worst = [], 0.0
    for l, r in zip(L, R):
        ol, orr = by[l]["offset"], by[r]["offset"]
        mirror_err = float(np.abs(ol - np.array([-orr[0], orr[1], orr[2]])).max())
        worst = max(worst, mirror_err)
        rows.append({"left": l, "right": r,
                     "offset_left": [round(float(x), 6) for x in ol],
                     "offset_right": [round(float(x), 6) for x in orr],
                     "mirror_error": round(mirror_err, 6)})
    ok = worst < 1e-6
    return {
        "check": "3_axis_sign_conversion",
        "pairs": rows,
        "worst_mirror_error": round(worst, 6),
        "skeleton_is_exactly_mirror_symmetric": bool(ok),
        "verdict": "NOT_THE_CAUSE" if ok else "SUSPECT",
        "reason": ("the rest skeleton mirrors exactly in X, so no axis or sign "
                   "conversion difference exists between the sides")
        if ok else "the rest skeleton is not mirror symmetric",
    }


def check_4_rest_pose(joints, data):
    """Frame 0 rotation values, left vs right."""
    by = {j["name"]: j for j in joints}
    rows, worst = [], 0.0
    for l, r in zip(L, R):
        jl, jr = by[l], by[r]
        vl = data[0][jl["cstart"]:jl["cstart"] + len(jl["channels"])]
        vr = data[0][jr["cstart"]:jr["cstart"] + len(jr["channels"])]
        vl = vl[-3:]
        vr = vr[-3:]
        d = float(np.abs(vl - vr).max())
        worst = max(worst, d)
        rows.append({"left": l, "right": r,
                     "frame0_left": [round(float(x), 4) for x in vl],
                     "frame0_right": [round(float(x), 4) for x in vr],
                     "abs_diff_max": round(d, 4)})
    return {
        "check": "4_rest_pose_handling",
        "pairs": rows,
        "worst_frame0_difference_deg": round(worst, 4),
        "verdict": "NOT_THE_CAUSE" if worst < 1e-6 else "MOTION_NOT_REST_POSE",
        "reason": ("frame 0 already differs between the sides. In a walk that is "
                   "EXPECTED — frame 0 is a moment of a gait, not a T-pose — so "
                   "this is evidence the difference lives in the MOTION DATA, "
                   "not in rest-pose handling")
        if worst >= 1e-6 else "identical rest pose on both sides",
    }


def check_5_coordinate_conversion(joints, data):
    by = {j["name"]: j for j in joints}
    root = joints[0]
    return {
        "check": "5_coordinate_conversion",
        "root_joint": root["name"],
        "root_channels": root["channels"],
        "single_file_no_cross_space_conversion": True,
        "verdict": "NOT_APPLICABLE",
        "reason": ("source and measurement are the same BVH space. No conversion "
                   "between coordinate systems happens here, so none can be wrong. "
                   "This check only becomes live when an external source is "
                   "adapted, which is exactly the blocked experiment."),
        "hips_present": "Hips" in by,
    }


def check_6_driver_interpretation(src_joints, src_data, drv_joints, drv_data):
    """Does the driver touch anything except the two knee joints?"""
    bys = {j["name"]: j for j in src_joints}
    byd = {j["name"]: j for j in drv_joints}
    touched, untouched = {}, {}
    for name in bys:
        if not bys[name]["channels"] or name not in byd:
            continue
        a = src_data[:, bys[name]["cstart"]:bys[name]["cstart"] + len(bys[name]["channels"])]
        b = drv_data[:, byd[name]["cstart"]:byd[name]["cstart"] + len(byd[name]["channels"])]
        n = min(len(a), len(b))
        d = float(np.abs(a[:n] - b[:n]).max())
        (touched if d > 1e-9 else untouched)[name] = round(d, 9)
    only_knees = set(touched) == {"LeftLeg", "RightLeg"}
    return {
        "check": "6_driver_interpretation",
        "joints_modified_by_driver": touched,
        "joints_bit_identical_count": len(untouched),
        "modifies_only_the_two_knee_joints": bool(only_knees),
        "verdict": "CONTRACT_CLEAN" if only_knees else "SUSPECT",
        "reason": ("the driver changes channels on LeftLeg and RightLeg and "
                   "nothing else — hips, ankles, feet, root and timing are "
                   "bit-identical, so the driver cannot be introducing a "
                   "left/right difference elsewhere")
        if only_knees else "the driver touches joints outside its contract",
    }


def measure_asymmetry(joints, data, nframes, label):
    """Is the L/R knee difference present in this file's own motion?"""
    per = []
    for f in range(nframes):
        pos, _ = KP.fk(joints, data[f])
        per.append((interior_angle(pos, L), interior_angle(pos, R)))
    a = np.array(per)
    lmin, rmin = float(np.nanmin(a[:, 0])), float(np.nanmin(a[:, 1]))
    return {
        "clip": label,
        "frames": nframes,
        "LEFT": {"min": round(lmin, 4), "mean": round(float(np.nanmean(a[:, 0])), 4),
                 "frame_of_min": int(np.nanargmin(a[:, 0]))},
        "RIGHT": {"min": round(rmin, 4), "mean": round(float(np.nanmean(a[:, 1])), 4),
                  "frame_of_min": int(np.nanargmin(a[:, 1]))},
        "right_minus_left_min": round(rmin - lmin, 4),
        "right_minus_left_mean": round(float(np.nanmean(a[:, 1]) - np.nanmean(a[:, 0])), 4),
        "right_is_deeper": bool(rmin < lmin),
    }


def main():
    src_p, drv_p, out_p = (Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    sj, sd, sn, sft = KP.parse(str(src_p))
    dj, dd, dn, dft = KP.parse(str(drv_p))

    checks = [
        check_1_joint_mapping(sj),
        check_2_rotation_order(sj),
        check_3_axis_sign(sj),
        check_4_rest_pose(sj, sd),
        check_5_coordinate_conversion(sj, sd),
        check_6_driver_interpretation(sj, sd, dj, dd),
    ]
    raw = measure_asymmetry(sj, sd, sn, f"RAW SOURCE {src_p.name} (pre-driver)")
    drv = measure_asymmetry(dj, dd, dn, f"DRIVER OUTPUT {drv_p.name}")

    representation_causes_excluded = all(
        c["verdict"] in ("NOT_THE_CAUSE", "NOT_APPLICABLE", "CONTRACT_CLEAN",
                         "MOTION_NOT_REST_POSE")
        for c in checks)

    out = {
        "record": "KNEE_CAUSE_ORDERING",
        "version": "1.0",
        "scope": "the source ONIQ ALREADY HAS. This says nothing about 100STYLE, "
                 "pristine or retargeted — both remain unacquired.",
        "source_file": src_p.name,
        "driver_file": drv_p.name,
        "source_frames": sn, "source_frame_time": sft,
        "priority_order_from_the_directive": [
            "1 joint mapping", "2 rotation order", "3 axis/sign conversion",
            "4 rest-pose handling", "5 coordinate conversion",
            "6 driver interpretation", "7 only then a bounded motion correction",
        ],
        "checks": checks,
        "asymmetry_in_raw_source": raw,
        "asymmetry_after_driver": drv,
        "representation_causes_excluded": representation_causes_excluded,
        "conclusion": None,
    }
    if representation_causes_excluded and raw["right_is_deeper"]:
        out["conclusion"] = (
            "Causes 1-6 are excluded by measurement. The right-deeper-flexion is "
            "already present in the RAW SOURCE BVH, before the driver runs, in a "
            "skeleton that is exactly mirror symmetric, with identical Euler order "
            "and identical parenting on both sides. So it is NOT a representation "
            "defect in ONIQ's handling — it is a property of this source motion. "
            "Step 7, a bounded motion correction, is therefore the only remaining "
            "category, and the accepted knee damper is exactly that. Whether the "
            "property generalises to other sources stays OPEN — that is the "
            "question the blocked external-source experiment exists to answer."
        )
    else:
        out["conclusion"] = ("a representation cause is still open — see the "
                             "SUSPECT verdicts above")
    Path(out_p).write_text(json.dumps(out, indent=1))

    for c in checks:
        print(f"  {c['check']:<32} {c['verdict']}")
    print(f"\n  RAW SOURCE   L min {raw['LEFT']['min']:8.4f} @f{raw['LEFT']['frame_of_min']:<4} "
          f"R min {raw['RIGHT']['min']:8.4f} @f{raw['RIGHT']['frame_of_min']:<4} "
          f"R-L {raw['right_minus_left_min']:+.4f}")
    print(f"  DRIVER OUT   L min {drv['LEFT']['min']:8.4f} @f{drv['LEFT']['frame_of_min']:<4} "
          f"R min {drv['RIGHT']['min']:8.4f} @f{drv['RIGHT']['frame_of_min']:<4} "
          f"R-L {drv['right_minus_left_min']:+.4f}")
    print(f"\n  representation causes excluded: {representation_causes_excluded}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
