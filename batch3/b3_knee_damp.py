#!/usr/bin/env python3
# BATCH 3 SS8 — knee-channel damping, knees ONLY.
# Scales the rotation channels of the named joints (default: the two BVH knee
# joints RightLeg + LeftLeg) toward their frame-0 values, wrap-safe:
#   r' = r0 + s * unwrap(r - r0)
# Hip, ankle (Foot), toe and every other channel are untouched, as are root
# translation, frame count and frame time — stride and contact timing are
# driven by hips + root translation and remain unchanged by construction.
# usage: b3_knee_damp.py <src.bvh> <dst.bvh> <scale> [joint,joint]
import sys

src, dst, s = sys.argv[1], sys.argv[2], float(sys.argv[3])
targets = sys.argv[4].split(",") if len(sys.argv) > 4 else ["RightLeg", "LeftLeg"]

lines = open(src).read().splitlines()
chan = []
idx = 0
cur = None
for ln in lines:
    t = ln.split()
    if not t:
        continue
    if t[0] in ("ROOT", "JOINT"):
        cur = t[1]
    elif t[0] == "CHANNELS":
        n = int(t[1])
        chan.append((idx, cur, t[2 : 2 + n]))
        idx += n
    elif t[0] == "MOTION":
        break
m = next(i for i, ln in enumerate(lines) if ln.strip() == "MOTION")
fstart = m + 3
frames = [ln.split() for ln in lines[fstart:] if ln.strip()]
cols = [st + k for st, j, names in chan if j in targets for k, nm in enumerate(names) if nm.endswith("rotation")]
assert cols, f"no rotation channels found for {targets}"
f0 = [float(v) for v in frames[0]]
for f in frames:
    for c in cols:
        d = float(f[c]) - f0[c]
        while d > 180.0:
            d -= 360.0
        while d < -180.0:
            d += 360.0
        f[c] = f"{f0[c] + s * d:.6f}"
open(dst, "w").write("\n".join(lines[:fstart] + [" ".join(f) for f in frames]) + "\n")
print(f"KNEE_DAMP_OK joints={targets} channels={len(cols)} scale={s}")
