"""Cut a character off their sheet's background into a transparent PNG.

    cd remotion && python3 scripts/cutout_sheet.py aladdin
    TOL=42 python3 scripts/cutout_sheet.py aladdin      # tune the key

WHY. A crop box is a rectangle. Drawing one over a scene puts a hard white
panel behind the character and the whole thing reads as a sticker, which is
exactly what the first rig render looked like.

WHY TWO THRESHOLDS AND A FLOOD. Measured off the Aladdin sheet rather than
guessed, and the first guess was wrong in both directions:

    ground   min channel 190-233,  saturation 20-25
    tunic    min channel 123-141,  saturation 68-110

The ground is bright and neutral; the cream tunic is much darker and much
warmer. A single "distance from white" test fails because the ground is warm
cream and gets WARMER as it brightens — red saturates at 255 while blue lags
near 216 — so the brightest ground is the least neutral, and a neutrality guard
tuned for the corners rejects the halo around the character and blocks the
flood there. That is exactly what the first attempt did: it ate the dark outer
vignette and left a white halo ring welded to the figure.

So: light enough (min channel) AND neutral enough (saturation), with the gap
between ground and tunic wide on both axes. Connectivity from the border stays
as the third guard, so even a pixel that passes both cannot be removed unless
it is reachable without crossing the figure.

WHY PYTHON AND NOT FFMPEG. The first version of this piped rgb24 through the
compositor's ffmpeg. That build has no rawvideo muxer — it is the same cut-down
binary that has no `fps`, `zoompan` or `volumedetect`, documented in
findFfmpeg.mjs — and there is no other ffmpeg on the box. PIL is installed, so
the pixels come from there instead. No numpy and no scipy either, hence the
hand-rolled fill.

DERIVED ARTIFACT. Output goes to public/sheets/cut/. Re-run when a sheet
changes; never hand-edit a cut.
"""
import os
import sys
from collections import deque
from PIL import Image

name = sys.argv[1] if len(sys.argv) > 1 else None
if not name:
    raise SystemExit("usage: python3 scripts/cutout_sheet.py <character>")

# Darkest a background pixel may be, on its dimmest channel. The sheet's
# corners bottom out around 196 and the tunic never rises above 141.
MIN_CHANNEL = int(os.environ.get("MIN_CHANNEL", 190))
# Most colour cast a background pixel may carry. Ground measures 20-46, the
# tunic 68 and up, so 50 sits in open space between them.
MAX_SAT = int(os.environ.get("MAX_SAT", 50))
# A SECOND, RELAXED pass for the sheet's own cast shadow. The shadow under the
# feet is much darker than the ground (min channel ~176) so the strict pass
# cannot reach it, but it is also far more neutral than anything on the figure:
#
#     cast shadow   min 176-179,  saturation  6-34
#     sandals       min  19- 48,  saturation 68-108
#
# So the relaxed pass trades brightness for neutrality, and — critically — only
# grows from pixels the STRICT pass already accepted. A pixel that merely looks
# like shadow cannot be removed unless it is attached to real background, which
# is what stops this eating the shaded side of a figure.
SOFT_MIN_CHANNEL = int(os.environ.get("SOFT_MIN_CHANNEL", 150))
SOFT_MAX_SAT = int(os.environ.get("SOFT_MAX_SAT", 40))
FEATHER = int(os.environ.get("FEATHER", 2))

here = os.path.dirname(os.path.abspath(__file__))
public = os.path.join(here, "..", "public")
src = os.path.join(public, "sheets", name + ".jpg")
if not os.path.exists(src):
    raise SystemExit("no sheet at " + src)

img = Image.open(src).convert("RGB")
W, H = img.size
px = img.load()


def groundish(x, y):
    r, g, b = px[x, y]
    return min(r, g, b) >= MIN_CHANNEL and (max(r, g, b) - min(r, g, b)) <= MAX_SAT


def shadowish(x, y):
    r, g, b = px[x, y]
    return (
        min(r, g, b) >= SOFT_MIN_CHANNEL
        and (max(r, g, b) - min(r, g, b)) <= SOFT_MAX_SAT
    )


# Flood from every border pixel. A deque rather than recursion: this is two
# million pixels and a recursive fill dies with a bare RecursionError that says
# nothing about why.
bg = bytearray(W * H)
q = deque()


def push(x, y):
    i = y * W + x
    if not bg[i] and groundish(x, y):
        bg[i] = 1
        q.append((x, y))


for x in range(W):
    push(x, 0)
    push(x, H - 1)
for y in range(H):
    push(0, y)
    push(W - 1, y)

while q:
    x, y = q.popleft()
    if x > 0:
        push(x - 1, y)
    if x < W - 1:
        push(x + 1, y)
    if y > 0:
        push(x, y - 1)
    if y < H - 1:
        push(x, y + 1)

# Relaxed pass, seeded from everything the strict flood accepted.
soft = deque()
for y in range(H):
    row = y * W
    for x in range(W):
        if bg[row + x]:
            soft.append((x, y))


def push_soft(x, y):
    i = y * W + x
    if not bg[i] and shadowish(x, y):
        bg[i] = 1
        soft.append((x, y))


while soft:
    x, y = soft.popleft()
    if x > 0:
        push_soft(x - 1, y)
    if x < W - 1:
        push_soft(x + 1, y)
    if y > 0:
        push_soft(x, y - 1)
    if y < H - 1:
        push_soft(x, y + 1)

alpha = Image.new("L", (W, H))
ap = alpha.load()
for y in range(H):
    row = y * W
    for x in range(W):
        ap[x, y] = 0 if bg[row + x] else 255

# A short ramp inward so the edge is not a staircase. Two dilation passes
# rather than a real distance transform: at this width the difference is
# invisible and the code is something a person can check by reading it.
for step in range(FEATHER):
    level = round(255 * (step + 1) / (FEATHER + 1))
    edge = []
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if ap[x, y] != 255:
                continue
            if (
                ap[x - 1, y] < level
                or ap[x + 1, y] < level
                or ap[x, y - 1] < level
                or ap[x, y + 1] < level
            ):
                edge.append((x, y))
    for x, y in edge:
        ap[x, y] = level

out_dir = os.path.join(public, "sheets", "cut")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, name + ".png")
img.putalpha(alpha)
img.save(out)

kept = sum(1 for i in range(W * H) if not bg[i])
pct = 100.0 * kept / (W * H)
print("%s: %dx%d, min_channel %d, max_sat %d, feather %d"
      % (name, W, H, MIN_CHANNEL, MAX_SAT, FEATHER))
print("  kept %.1f%% of pixels -> %s" % (pct, os.path.relpath(out, public)))
if pct > 99.9:
    print("  WARNING: nothing removed — the ground is darker than MIN_CHANNEL allows.")
if pct < 5:
    print("  WARNING: almost everything removed — the flood leaked into the figure.")
