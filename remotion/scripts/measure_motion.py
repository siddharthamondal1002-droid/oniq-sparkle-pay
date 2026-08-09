"""Measure the idle motion in the generated clips, so the rig can copy it.

    cd remotion && python3 scripts/measure_motion.py ep3_s01b ep3_s02a ...
    python3 scripts/measure_motion.py --all

WHY. The first rig pass invented its motion: breath at 0.9% of figure height on
a 4.5-second cycle, sway a third of that at 7.3 seconds. Those numbers came out
of nowhere. Sixty clips of real generated character motion are sitting in
public/ep3/clips — the same characters, in the same show — so the amplitudes
and periods are measurable and there is no reason to guess them.

This is the same discipline as the scene durations and the speech spans: a
value derived from media gets measured once, out of band, and committed as
data a person can read.

HOW, AND WHY NOT THE OBVIOUS WAY. The first version tracked the centroid of
motion energy — where in the frame things were changing. It reported 10-20% of
frame height at a 0.5-0.7s period, which is not a body breathing, it is the
centroid skating between a crowd, an awning and some dust. It measured where
motion WAS, not what moved.

So this estimates GLOBAL DISPLACEMENT instead: for each pair of frames, search
a small window of whole-pixel shifts and keep the one with the lowest sum of
absolute differences. That is the camera, because the camera moves every pixel
at once and a character moves a few hundred. Accumulating the per-frame shift
gives the camera path over the clip, and the total travel is the number the rig
actually needs — how far a real generated shot drifts, in percent of frame.

Residual energy after the best shift is reported too: it is everything the
camera cannot explain, which is the subject moving. It is a scalar, not a
trajectory, and it is honest about being one.
"""
import os
import subprocess
import sys
import tempfile
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
public = os.path.join(here, "..", "public")
clips_dir = os.path.join(public, "ep3", "clips")
ffmpeg = os.path.join(
    here, "..", "node_modules", "@remotion", "compositor-linux-x64-gnu", "ffmpeg"
)

# Small enough to be fast, large enough that a centroid is stable to a fraction
# of a percent of frame height.
W, H = 120, 214
FPS = 30


def frames_of(path):
    out = []
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            [ffmpeg, "-nostdin", "-v", "error", "-i", path,
             "-vf", "scale=%d:%d" % (W, H), os.path.join(tmp, "f%04d.png")],
            check=True,
        )
        for fn in sorted(os.listdir(tmp)):
            im = Image.open(os.path.join(tmp, fn)).convert("L")
            # tobytes() rather than getdata(): same pixels, no deprecation, and
            # indexing a bytes object is faster than a materialised list.
            out.append(im.tobytes())
    return out


# Frame-to-frame search. Small on purpose: a camera cannot jump.
SEARCH = 5
# END-TO-END search, wide. THIS IS THE ONE THAT MATTERS and the frame-to-frame
# pass alone is misleading without it: a 6% pan across 190 frames is 0.34 px
# per frame at this scale, which rounds to a whole-pixel shift of zero on every
# single step and accumulates to a confident, wrong 0.0%. Comparing the first
# frame against the last turns that same pan into 7 px, which is unmissable.
END_SEARCH = 24
BORDER = SEARCH + 1  # margin so a shifted lookup stays inside the frame


def best_shift(a, b, search=SEARCH):
    """(dx, dy, residual) minimising sum of absolute differences."""
    best = None
    border = search + 1
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            total = 0
            # Every 3rd row and column: 9x fewer samples, and the minimum does
            # not move — this is a smooth surface, not a needle in a haystack.
            for y in range(border, H - border, 3):
                rowa = y * W
                rowb = (y + dy) * W + dx
                for x in range(border, W - border, 3):
                    d = a[rowa + x] - b[rowb + x]
                    total += d if d >= 0 else -d
            if best is None or total < best[2]:
                best = (dx, dy, total)
    n = len(range(border, H - border, 3)) * len(range(border, W - border, 3))
    return best[0], best[1], best[2] / n


def track(frames):
    """Per-frame camera shift and unexplained residual."""
    out = []
    for i in range(1, len(frames)):
        out.append(best_shift(frames[i - 1], frames[i]))
    return out


def dominant_period(sig, fps):
    """Autocorrelation peak, in seconds. None when nothing repeats."""
    n = len(sig)
    if n < fps * 2:
        return None
    mean = sum(sig) / n
    d = [v - mean for v in sig]
    denom = sum(v * v for v in d) or 1.0
    best_lag, best_val = None, 0.0
    # 0.5s to 8s: shorter is a twitch, longer will not repeat inside a clip.
    for lag in range(int(fps * 0.5), min(int(fps * 8), n - 1)):
        val = sum(d[i] * d[i + lag] for i in range(n - lag)) / denom
        if val > best_val:
            best_val, best_lag = val, lag
    if best_lag is None or best_val < 0.1:
        return None
    return best_lag / fps


names = sys.argv[1:]
if not names or names[0] == "--all":
    names = sorted(
        f[:-4] for f in os.listdir(clips_dir) if f.endswith(".mp4")
    )

print("clip        frames    secs   stepX  stepY  endX%  endY%  subject")
agg_dx, agg_dy, periods, agg_end = [], [], [], []
for name in names:
    path = os.path.join(clips_dir, name + ".mp4")
    if not os.path.exists(path):
        print("%-11s MISSING" % name)
        continue
    frames = frames_of(path)
    steps = track(frames)
    if len(steps) < 10:
        print("%-11s too few frames" % name)
        continue
    # Accumulate into a camera path, then report how far it travelled.
    cx = cy = 0.0
    xs, ys = [0.0], [0.0]
    for dx, dy, _ in steps:
        cx += dx
        cy += dy
        xs.append(cx)
        ys.append(cy)
    travel_x = (max(xs) - min(xs)) / W * 100
    travel_y = (max(ys) - min(ys)) / H * 100
    # The measurement that can actually see a slow pan.
    ex, ey, _ = best_shift(frames[0], frames[-1], END_SEARCH)
    end_x = abs(ex) / W * 100
    end_y = abs(ey) / H * 100
    residual = sum(s[2] for s in steps) / len(steps)
    seconds = len(frames) / FPS
    agg_dx.append(travel_x)
    agg_dy.append(travel_y)
    periods.append(residual)
    agg_end.append(max(end_x, end_y))
    print("%-11s %5d  %5.1fs  %5.1f  %5.1f  %5.1f  %5.1f  %6.2f" % (
        name, len(frames), seconds, travel_x, travel_y, end_x, end_y, residual))

if agg_dx:
    n = len(agg_dx)
    med = lambda v: sorted(v)[len(v) // 2]
    print("")
    print("%d clips" % n)
    print("  camera travel X: median %.1f%% of frame width  (max %.1f%%)"
          % (med(agg_dx), max(agg_dx)))
    print("  camera travel Y: median %.1f%% of frame height (max %.1f%%)"
          % (med(agg_dy), max(agg_dy)))
    print("  end-to-end drift: median %.1f%% of frame (max %.1f%%)"
          % (med(agg_end), max(agg_end)))
    print("  subject residual: median %.2f grey levels per pixel per frame"
          % med(periods))
