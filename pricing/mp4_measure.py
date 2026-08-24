#!/usr/bin/env python3
"""Extract raw per-clip measurements from mp4s. Emits JSON; makes NO judgement.

Runs where the clips are. The verdict is computed elsewhere (veo_gate.py) from
this output, so the gate has exactly one implementation and cannot diverge
between the two models being compared.

usage:  python3 mp4_measure.py out.json clip1.mp4 clip2.mp4 ...
"""
import json
import subprocess
import sys
from pathlib import Path


def probe(path, entries):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", entries, "-of", "json", str(path)],
        capture_output=True, text=True)
    try:
        return json.loads(r.stdout or "{}")
    except Exception:
        return {}


def measure(path):
    p = Path(path)
    m = {"clip": p.name, "size": p.stat().st_size if p.exists() else 0,
         "decodes": False, "codec_types": [], "duration": 0.0,
         "frame_count": 0, "frame_diffs": [], "longest_static_run": 0,
         "blank_frames": 0}
    if not p.exists() or m["size"] == 0:
        return m

    st = probe(p, "stream=codec_type,codec_name,width,height,r_frame_rate")
    fmt = probe(p, "format=duration,size")
    m["codec_types"] = [s.get("codec_type") for s in st.get("streams", [])]
    m["codec_names"] = [s.get("codec_name") for s in st.get("streams", [])]
    m["streams"] = len(st.get("streams", []))
    try:
        m["duration"] = float(fmt.get("format", {}).get("duration", 0.0))
    except Exception:
        pass
    if "video" not in m["codec_types"]:
        return m

    # decode to small greyscale frames; enough for motion/blank statistics and
    # cheap enough to run on every clip
    out = p.with_suffix(".frames")
    out.mkdir(exist_ok=True)
    rc = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(p),
         "-vf", "scale=64:114,format=gray", f"{out}/f%04d.pgm"],
        capture_output=True)
    frames = sorted(out.glob("*.pgm"))
    if rc.returncode != 0 or not frames:
        return m
    m["decodes"] = True
    m["frame_count"] = len(frames)

    def px(fp):
        b = fp.read_bytes()
        i, fields = 0, 0
        while fields < 4 and i < len(b):          # P5, w, h, maxval
            if b[i:i + 1].isspace():
                fields += 1
                while i < len(b) and b[i:i + 1].isspace():
                    i += 1
                continue
            i += 1
        return b[i:]

    prev, run, best = None, 1, 1
    for fp in frames:
        cur = px(fp)
        mean = sum(cur) / len(cur) / 255.0 if cur else 0.0
        if mean < 0.004 or mean > 0.996:
            m["blank_frames"] += 1
        if prev is not None and len(prev) == len(cur):
            d = sum(abs(a - b) for a, b in zip(prev, cur)) / len(cur) / 255.0
            m["frame_diffs"].append(round(d, 6))
            run = run + 1 if d < 0.001 else 1
            best = max(best, run)
        prev = cur
    m["longest_static_run"] = best
    for fp in frames:
        fp.unlink()
    out.rmdir()
    return m


if __name__ == "__main__":
    dest, clips = sys.argv[1], sys.argv[2:]
    rows = [measure(c) for c in clips]
    Path(dest).write_text(json.dumps(rows, indent=1))
    for r in rows:
        print(f"{r['clip']:28s} streams={r.get('streams')} "
              f"{','.join(str(x) for x in r.get('codec_names', []))} "
              f"dur={r['duration']:.3f} frames={r['frame_count']} "
              f"static_run={r['longest_static_run']} blank={r['blank_frames']}")
    print(f"\nwrote {dest}")
