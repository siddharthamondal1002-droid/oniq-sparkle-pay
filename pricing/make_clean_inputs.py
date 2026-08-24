#!/usr/bin/env python3
"""Build CLEAN benchmark start frames from ONIQ character sheets.

The v1 benchmark fed Veo the raw sheets from remotion/public/sheets/cut/. Those
are two-pose design sheets, and several carry title and label text ("THE
PRINCESS", "FRONT VIEW", "SIDE VIEW"). Both models rendered that text into the
world as scenery. Worse, the contamination is UNEQUAL across characters —
aladdin.png has no text at all, princess.png is covered in it — so v1's cases
were not even contaminated consistently.

This isolates the FRONT pose only and drops every text band.

How, and why this way: text strokes are thin, so a column crossing text has a
small vertical ink extent. A column crossing the figure has a large one. So
classify each column by the vertical extent of its non-background pixels, keep
only columns above a threshold, and take the leftmost contiguous run. That is
robust to the layouts differing per character, which a fixed fractional crop
would not be.

usage:  python3 make_clean_inputs.py <repo_root> <out_dir>
"""
import json
import sys
from pathlib import Path

from PIL import Image

W, H = 720, 1280
CHARACTERS = ["aladdin", "morgiana", "princess", "captain", "magician",
              "fisherman", "lampJinni", "jarJinni", "aliBaba", "mother"]


def bg_of(im):
    """Background colour, sampled from the four corners."""
    px = im.load()
    w, h = im.size
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    corners = [c[:3] for c in corners]
    return tuple(sum(c[i] for c in corners) // 4 for i in range(3))


def ink_columns(im, bg, tol=26):
    """For each column, the vertical extent of non-background pixels."""
    px = im.load()
    w, h = im.size
    out = []
    for x in range(w):
        top, bot = None, None
        for y in range(0, h, 2):                     # stride 2: fast, ample
            p = px[x, y]
            if len(p) == 4 and p[3] < 24:
                continue                             # transparent
            if max(abs(p[i] - bg[i]) for i in range(3)) > tol:
                if top is None:
                    top = y
                bot = y
        out.append(0 if top is None else bot - top)
    return out


def front_pose_box(im):
    """Bounding box of the leftmost FIGURE (not text)."""
    bg = bg_of(im)
    w, h = im.size
    ext = ink_columns(im, bg)
    thresh = 0.45 * h                                # figures span ~half+ the height
    runs, cur = [], None
    for x, e in enumerate(ext):
        if e >= thresh:
            cur = [x, x] if cur is None else [cur[0], x]
        elif cur is not None:
            if cur[1] - cur[0] > 0.02 * w:           # ignore specks
                runs.append(cur)
            cur = None
    if cur is not None and cur[1] - cur[0] > 0.02 * w:
        runs.append(cur)
    if not runs:
        raise RuntimeError("no figure column-run found")
    x0, x1 = runs[0]                                 # leftmost = front pose

    # vertical bounds within that column band only
    px = im.load()
    bg = bg_of(im)
    top, bot = None, None
    for y in range(h):
        hit = False
        for x in range(x0, x1 + 1, 2):
            p = px[x, y]
            if len(p) == 4 and p[3] < 24:
                continue
            if max(abs(p[i] - bg[i]) for i in range(3)) > 26:
                hit = True
                break
        if hit:
            if top is None:
                top = y
            bot = y
    return x0, top, x1, bot, len(runs)


def build(repo, name, dest):
    src = Path(repo, "remotion/public/sheets/cut", name + ".png")
    im = Image.open(src).convert("RGBA")
    x0, y0, x1, y1, nruns = front_pose_box(im)
    pad = int(0.04 * (x1 - x0))
    box = (max(0, x0 - pad), max(0, y0 - pad),
           min(im.width, x1 + pad), min(im.height, y1 + pad))
    fig = im.crop(box)

    # place on a plain neutral backdrop at ONIQ delivery shape
    canvas = Image.new("RGB", (W, H), (34, 38, 48))
    s = min((W * 0.72) / fig.width, (H * 0.74) / fig.height)
    fig = fig.resize((max(1, int(fig.width * s)), max(1, int(fig.height * s))),
                     Image.LANCZOS)
    canvas.paste(fig, ((W - fig.width) // 2, H - fig.height - int(0.09 * H)), fig)
    canvas.save(dest)
    return {"character": name, "source_size": list(im.size),
            "figure_runs_detected": nruns, "crop_box": list(box),
            "output": Path(dest).name}


if __name__ == "__main__":
    repo, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    meta = []
    for n in CHARACTERS:
        try:
            meta.append(build(repo, n, out / f"{n}.png"))
            print(f"  OK   {n:12s} runs={meta[-1]['figure_runs_detected']} "
                  f"box={meta[-1]['crop_box']}")
        except Exception as e:  # noqa: BLE001
            print(f"  FAIL {n:12s} {e}")
    (out / "inputs_v2.json").write_text(json.dumps(
        {"benchmark_input_version": "ONIQ-VEO-INPUTS-v2",
         "rule": "front pose only, no captions, no labels, no second pose, "
                 "plain neutral backdrop, 720x1280. Frozen before generation.",
         "items": meta}, indent=1))
    print(f"\nwrote {out}/inputs_v2.json  ({len(meta)}/{len(CHARACTERS)})")
