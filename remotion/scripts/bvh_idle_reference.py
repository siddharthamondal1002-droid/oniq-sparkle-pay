#!/usr/bin/env python3
# IDLE driver synthesis — REFERENCE (generalization v2, 2026-08-22).
#
# Derives the CPU provider's IDLE motion from the MIT FAIR zombie walk,
# deterministically: every rotation channel is scaled toward its frame-0
# value (r' = r0 + s * unwrap(r - r0)) and the root translation channels
# are pinned to frame 0, so the character shifts weight subtly IN PLACE.
#
# MEASURED (Aladdin fixture, arm-damped retarget, real decoded frames):
#   s = 0.10 — FAILED the production aliveness gate (0.43 < 0.75): motion
#              too subtle to survive validation. Recorded falsification.
#   s = 0.25 — PASS: aliveness 0.94, pixel inspection shows grounded feet,
#              stable identity, no artifacts, visible weight shift. This is
#              the value ARAP_MOTION_GRAMMAR's IDLE entry names.
#
# usage: bvh_idle_reference.py <src.bvh> <dst.bvh> [scale=0.25]
# The output is derived media and is never committed to git.
import sys


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    s = float(sys.argv[3]) if len(sys.argv) > 3 else 0.25
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
            chan.append((idx, n, cur, t[2 : 2 + n]))
            idx += n
        elif t[0] == "MOTION":
            break
    m = next(i for i, ln in enumerate(lines) if ln.strip() == "MOTION")
    fstart = m + 3  # MOTION / Frames: / Frame Time:
    frames = [ln.split() for ln in lines[fstart:] if ln.strip()]
    rot = [st + k for st, n, j, names in chan for k, nm in enumerate(names) if nm.endswith("rotation")]
    pos = [st + k for st, n, j, names in chan for k, nm in enumerate(names) if nm.endswith("position")]
    f0 = [float(v) for v in frames[0]]
    for f in frames:
        for c in pos:
            f[c] = f"{f0[c]:.6f}"
        for c in rot:
            d = float(f[c]) - f0[c]
            while d > 180.0:
                d -= 360.0
            while d < -180.0:
                d += 360.0
            f[c] = f"{f0[c] + s * d:.6f}"
    open(dst, "w").write("\n".join(lines[:fstart] + [" ".join(f) for f in frames]) + "\n")
    print(f"IDLE driver: {len(rot)} rotation channels scaled by {s}, {len(pos)} position channels pinned")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
