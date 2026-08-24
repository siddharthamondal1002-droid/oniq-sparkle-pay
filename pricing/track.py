#!/usr/bin/env python3
"""Per-clip subject track + motion-energy split. Emits numbers, judges nothing.

Reports, at a fixed analysis resolution:
    bbox_w / bbox_h / centroid_x   per frame, as fractions of frame size
    energy_upper / energy_lower    inter-frame motion split by image half
    energy_inside / energy_outside motion split by whether it is on the subject
"""
import json
import subprocess
import sys
from pathlib import Path

AW, AH = 96, 171          # analysis resolution
BG_TOL = 26


def _frames(mp4, workdir):
    workdir.mkdir(parents=True, exist_ok=True)
    rc = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp4), "-vf",
                         f"scale={AW}:{AH},format=gray", f"{workdir}/f%04d.pgm"],
                        capture_output=True)
    if rc.returncode != 0:
        return []
    out = []
    for fp in sorted(workdir.glob("*.pgm")):
        b = fp.read_bytes()
        i = n = 0
        while n < 4 and i < len(b):
            if b[i:i + 1].isspace():
                n += 1
                while i < len(b) and b[i:i + 1].isspace():
                    i += 1
                continue
            i += 1
        out.append(b[i:])
        fp.unlink()
    workdir.rmdir()
    return out


def track(mp4, workdir):
    fs = _frames(Path(mp4), Path(workdir))
    t = {"frames": len(fs), "bbox_w": [], "bbox_h": [], "centroid_x": [],
         "energy_upper": 0.0, "energy_lower": 0.0,
         "energy_inside": 0.0, "energy_outside": 0.0}
    if not fs:
        return t

    # background level = modal value of frame 0's border ring
    f0 = fs[0]
    ring = [f0[y * AW + x] for y in (0, AH - 1) for x in range(AW)] + \
           [f0[y * AW + x] for x in (0, AW - 1) for y in range(AH)]
    bg = max(set(ring), key=ring.count)

    boxes = []
    for f in fs:
        xs, ys, sx, cnt = AW, AH, 0, 0
        x1 = y1 = 0
        for y in range(AH):
            row = y * AW
            for x in range(AW):
                if abs(f[row + x] - bg) > BG_TOL:
                    xs = min(xs, x); x1 = max(x1, x)
                    ys = min(ys, y); y1 = max(y1, y)
                    sx += x; cnt += 1
        if cnt == 0:
            boxes.append(None)
            t["bbox_w"].append(0.0); t["bbox_h"].append(0.0)
            t["centroid_x"].append(t["centroid_x"][-1] if t["centroid_x"] else 0.5)
            continue
        boxes.append((xs, ys, x1, y1))
        t["bbox_w"].append((x1 - xs) / AW)
        t["bbox_h"].append((y1 - ys) / AH)
        t["centroid_x"].append((sx / cnt) / AW)

    # inside/outside is judged against the SUBJECT BOX FROM FRAME 0, held
    # fixed. The start frame is a clean figure on a plain backdrop, so frame 0
    # is the one moment the subject is unambiguous. Using the per-frame bbox
    # instead was measurably wrong: once a camera move puts content across the
    # background, the union-of-non-background box becomes the whole frame and
    # off-subject energy collapses to ~0. Reference clips with known camera and
    # environmental motion scored 0.06 and 0.01 that way.
    box0 = boxes[0]
    half = AH // 2
    for i in range(1, len(fs)):
        a, b = fs[i - 1], fs[i]
        bx = box0
        for y in range(AH):
            row = y * AW
            for x in range(AW):
                d = abs(a[row + x] - b[row + x])
                if d <= 6:
                    continue
                e = d / 255.0
                if y < half:
                    t["energy_upper"] += e
                else:
                    t["energy_lower"] += e
                if bx and bx[0] <= x <= bx[2] and bx[1] <= y <= bx[3]:
                    t["energy_inside"] += e
                else:
                    t["energy_outside"] += e
    return t


if __name__ == "__main__":
    dest, clips = sys.argv[1], sys.argv[2:]
    rows = {}
    for c in clips:
        rows[Path(c).name] = track(c, Path("/tmp/_trk") / Path(c).stem)
        r = rows[Path(c).name]
        tot = r["energy_inside"] + r["energy_outside"] or 1
        print(f"{Path(c).name:26s} frames={r['frames']:3d} "
              f"drift={max(abs(x-r['centroid_x'][0]) for x in r['centroid_x']) if r['centroid_x'] else 0:.3f} "
              f"hgrow={((max(r['bbox_h'])-r['bbox_h'][0])/r['bbox_h'][0]) if r['bbox_h'] and r['bbox_h'][0] else 0:+.2f} "
              f"wchg={(max(abs(x-r['bbox_w'][0]) for x in r['bbox_w'])/r['bbox_w'][0]) if r['bbox_w'] and r['bbox_w'][0] else 0:.2f} "
              f"lo/up={(r['energy_lower']/r['energy_upper']) if r['energy_upper'] else 0:.2f} "
              f"off={r['energy_outside']/tot:.2f}")
    Path(dest).write_text(json.dumps(rows, indent=1))
    print(f"\nwrote {dest}")
