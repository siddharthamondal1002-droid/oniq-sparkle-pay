#!/usr/bin/env python3
"""Route 5B category-6 experiment: the damper's REFERENCE POSE.

Measured mechanism under test
-----------------------------
The accepted damper is  r' = r0 + s * unwrap(r - r0)  with r0 = FRAME 0, applied
identically to both knees. It is symmetric in ROTATION space. But the two legs
of a walk are in ANTIPHASE, so frame 0 is a systematically different point of
each leg's cycle. A symmetric scale about a phase-asymmetric reference produces
an ASYMMETRIC change in knee-flexion depth.

Candidate (smallest category-6 intervention): keep s = 0.50, keep six rotation
channels, keep both knees, keep the source-BVH layer — change ONLY the reference
pose from the shared frame 0 to a PER-LEG PHASE-MATCHED reference, so each leg is
damped about the same anatomical event.

  frame0     — the accepted production behaviour (control)
  extension  — each leg referenced to ITS OWN maximum-extension frame
  mean       — each leg referenced to ITS OWN per-channel mean

No clamp, no Euler limit, no smoothing, no foot pinning, no retiming, no
amplitude correction, no hip/ankle/root/mesh/ARAP change. Writes only into the
route5b experiment workspace; production files are never touched.

usage: knee_reference_experiment.py <src.bvh> <window_frames> <outdir>
"""
import json
import sys
from pathlib import Path

import numpy as np

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
sys.path.insert(0, str(SC / "genloop/v3"))
import kneeprobe as KP  # noqa: E402

SCALE = 0.50
TARGETS = ["RightLeg", "LeftLeg"]
LCH = ("LeftUpLeg", "LeftLeg", "LeftFoot")
RCH = ("RightUpLeg", "RightLeg", "RightFoot")


def interior(pos, chain):
    a, b, c = pos[chain[0]], pos[chain[1]], pos[chain[2]]
    u, v = a - b, c - b
    return float(np.degrees(np.arccos(
        np.clip(u @ v / (np.linalg.norm(u) * np.linalg.norm(v)), -1, 1))))


def read_bvh_text(path):
    lines = Path(path).read_text().splitlines()
    chan, idx, cur = [], 0, None
    for ln in lines:
        t = ln.split()
        if not t:
            continue
        if t[0] in ("ROOT", "JOINT"):
            cur = t[1]
        elif t[0] == "CHANNELS":
            n = int(t[1])
            chan.append((idx, cur, t[2:2 + n]))
            idx += n
        elif t[0] == "MOTION":
            break
    m = next(i for i, ln in enumerate(lines) if ln.strip() == "MOTION")
    fstart = m + 3
    frames = [ln.split() for ln in lines[fstart:] if ln.strip()]
    return lines, fstart, frames, chan


def cols_for(chan, joint):
    return [st + k for st, j, names in chan if j == joint
            for k, nm in enumerate(names) if nm.endswith("rotation")]


def unwrap(d):
    while d > 180.0:
        d -= 360.0
    while d < -180.0:
        d += 360.0
    return d


def damp(src, dst, mode, ref_frames):
    """Apply r' = rref + s*unwrap(r - rref) to the six knee rotation channels."""
    lines, fstart, frames, chan = read_bvh_text(src)
    per_joint = {j: cols_for(chan, j) for j in TARGETS}
    assert all(per_joint.values()), f"no rotation channels found for {TARGETS}"
    vals = np.array([[float(v) for v in f] for f in frames])
    for joint, cols in per_joint.items():
        for c in cols:
            if mode == "mean":
                rref = float(vals[:, c].mean())
            else:
                rref = float(vals[ref_frames[joint], c])
            for f in frames:
                f[c] = f"{rref + SCALE * unwrap(float(f[c]) - rref):.6f}"
    Path(dst).write_text("\n".join(lines[:fstart] + [" ".join(f) for f in frames]) + "\n")
    return {j: len(c) for j, c in per_joint.items()}


def curves(path, n):
    j, d, nf, ft = KP.parse(path)
    n = min(n, nf)
    out = [(interior(KP.fk(j, d[f])[0], LCH), interior(KP.fk(j, d[f])[0], RCH))
           for f in range(n)]
    return np.array(out), ft, nf


def channels_of(path, names):
    j, d, nf, ft = KP.parse(path)
    by = {x["name"]: x for x in j}
    out = {}
    for n in names:
        if n in by and by[n]["channels"]:
            s = by[n]["cstart"]
            out[n] = d[:, s:s + len(by[n]["channels"])]
    return out


def preservation(src, cand, n):
    """Everything outside the two knee joints must be bit-identical."""
    watch = ["Hips", "LeftUpLeg", "RightUpLeg", "LeftFoot", "RightFoot",
             "LeftToeBase", "RightToeBase", "Spine", "Neck", "Head"]
    a, b = channels_of(src, watch), channels_of(cand, watch)
    diffs = {k: round(float(np.abs(a[k][:n] - b[k][:n]).max()), 9)
             for k in a if k in b}
    js, ds, ns, fts = KP.parse(src)
    jc, dc, nc, ftc = KP.parse(cand)
    return {
        "max_abs_channel_diff_outside_knees": diffs,
        "all_zero": all(v == 0.0 for v in diffs.values()),
        "frame_count_src": ns, "frame_count_candidate": nc,
        "frame_time_src": fts, "frame_time_candidate": ftc,
        "frame_count_preserved": ns == nc,
        "frame_time_preserved": fts == ftc,
    }


def summarise(a, label):
    lm, rm = float(a[:, 0].min()), float(a[:, 1].min())
    return {
        "condition": label,
        "LEFT": {"min": round(lm, 4), "frame_of_min": int(a[:, 0].argmin()),
                 "mean": round(float(a[:, 0].mean()), 4)},
        "RIGHT": {"min": round(rm, 4), "frame_of_min": int(a[:, 1].argmin()),
                  "mean": round(float(a[:, 1].mean()), 4)},
        "right_minus_left_min": round(rm - lm, 4),
        "abs_asymmetry": round(abs(rm - lm), 4),
        "frames_below_120_left": int((a[:, 0] < 120).sum()),
        "frames_below_120_right": int((a[:, 1] < 120).sum()),
        "deeper_side": "LEFT" if lm < rm else "RIGHT",
    }


def main():
    src, nwin, outd = Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3])
    outd.mkdir(parents=True, exist_ok=True)

    # per-leg maximum-extension frame, measured from the SOURCE within the window
    raw, ft, nf = curves(str(src), nwin)
    ref_frames = {"LeftLeg": int(raw[:, 0].argmax()),
                  "RightLeg": int(raw[:, 1].argmax())}

    conditions = {}
    conditions["RAW (no driver)"] = summarise(raw, "RAW (no driver)")

    results, files = {}, {}
    for mode in ("frame0", "extension", "mean"):
        dst = outd / f"knee050_ref_{mode}.bvh"
        chans = damp(str(src), str(dst), mode,
                     {"LeftLeg": 0, "RightLeg": 0} if mode == "frame0" else ref_frames)
        a, _, _ = curves(str(dst), nwin)
        s = summarise(a, f"KNEE 0.50 ref={mode}")
        s["channels_modified"] = chans
        s["preservation"] = preservation(str(src), str(dst), nwin)
        results[mode] = s
        files[mode] = dst.name
        conditions[f"KNEE 0.50 ref={mode}"] = s

    ctrl = results["frame0"]
    out = {
        "record": "KNEE_REFERENCE_EXPERIMENT",
        "version": "1.0",
        "scope": "ONIQ's EXISTING source BVH. Says nothing about 100STYLE, "
                 "pristine or retargeted — both remain unacquired.",
        "source": src.name,
        "window_frames": nwin,
        "frame_time": ft,
        "source_total_frames": nf,
        "held_constant": {"scale": SCALE, "channels": 6, "joints": TARGETS,
                          "layer": "SOURCE BVH", "clamp": None,
                          "smoothing": None, "foot_pinning": None,
                          "retiming": None, "amplitude_correction": None},
        "single_variable": "reference pose only",
        "per_leg_extension_reference_frames": ref_frames,
        "conditions": conditions,
        "candidate_files": files,
        "comparison_vs_accepted_frame0_control": {
            mode: {
                "abs_asymmetry": results[mode]["abs_asymmetry"],
                "delta_vs_control": round(results[mode]["abs_asymmetry"]
                                          - ctrl["abs_asymmetry"], 4),
                "right_min": results[mode]["RIGHT"]["min"],
                "left_min": results[mode]["LEFT"]["min"],
                "frames_below_120": (results[mode]["frames_below_120_left"]
                                     + results[mode]["frames_below_120_right"]),
            } for mode in results
        },
    }
    (outd / "KNEE_REFERENCE_EXPERIMENT.json").write_text(json.dumps(out, indent=1))

    print(f"  window {nwin} frames, per-leg extension refs {ref_frames}\n")
    for k, v in conditions.items():
        print(f"  {k:<28} L {v['LEFT']['min']:8.3f}@f{v['LEFT']['frame_of_min']:<4} "
              f"R {v['RIGHT']['min']:8.3f}@f{v['RIGHT']['frame_of_min']:<4} "
              f"|R-L| {v['abs_asymmetry']:6.3f}  <120: "
              f"{v['frames_below_120_left']}L/{v['frames_below_120_right']}R")
    print()
    for mode, v in results.items():
        p = v["preservation"]
        print(f"  {mode:<10} outside-knee channels all zero: {p['all_zero']}  "
              f"frames {p['frame_count_preserved']}  ftime {p['frame_time_preserved']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
