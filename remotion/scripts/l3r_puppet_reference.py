#!/usr/bin/env python3
# L3R RIGID-PART CHARACTER PUPPET — REFERENCE / PROOF (Phase 10).
# Real character cutout (U^2-Net mask) + auto-rig joints -> geometric part
# extraction (voronoi over bones, feathered joint overlap, fail-closed to
# PART_EXTRACTION_UNCERTAIN) -> hierarchical affine FK driven by the SAME
# zombie.bvh walk angles -> CPU alpha compositing -> frames. Rigid parts CANNOT
# ARAP-stretch, so the L3 arm/hand claw does not occur.
#
# MEASURED (2026-08-22, 4-core CPU) on the real Aladdin still + zombie walk:
#   part extraction ~2s, 149-frame 720x1280 render ~115s wall (~110s CPU), peak
#   RSS ~2.0 GB. GPU=0, API cost 0. Verdict L3R = PASS_WITH_LIMITS: real arm/leg
#   articulation, identity preserved, NO CLAW; minor joint seams when a limb
#   swings far. See MOTION_RIGID_PUPPET.md. Reference/proof only; not wired to
#   production; no media/weights in git.
import sys, json, math, time, resource
from pathlib import Path
import numpy as np, cv2

RIG = Path(sys.argv[1])                 # p7/rig (texture.png RGB, mask.png alpha, autorig_result.json)
ANGLES = json.loads(Path(sys.argv[2]).read_text())
OUTDIR = Path(sys.argv[3]); OUTDIR.mkdir(parents=True, exist_ok=True)
MODE = sys.argv[4] if len(sys.argv) > 4 else "animate"   # "parts" | "static" | "animate"

t_start = time.time()
J = {k: np.array(v, float) for k, v in json.load(open(RIG / "autorig_result.json"))["joints"].items()}
rgb = cv2.imread(str(RIG / "texture.png"))[:, :, :3]
mask = cv2.imread(str(RIG / "mask.png"), 0)
H, W = mask.shape
fg = mask > 127
rgba = np.dstack([rgb, np.where(fg, 255, 0).astype(np.uint8)])

# hand/foot terminal points: extrapolate a little beyond wrist/ankle along the limb
def beyond(a, b, f=0.5):
    return b + (b - a) * f
hand_l_tip = beyond(J["left_elbow"], J["left_hand"]);  hand_r_tip = beyond(J["right_elbow"], J["right_hand"])
foot_l_tip = beyond(J["left_knee"], J["left_foot"]);   foot_r_tip = beyond(J["right_knee"], J["right_foot"])

# each part: (name, seg_start, seg_end, pivot, parent, bone_key_in_angles)
hipmid = (J["left_hip"] + J["right_hip"]) / 2
PARTS = [
    ("torso",       J["torso"], hipmid,            hipmid,            None,        "torso"),
    ("head",        J["neck"],  J["neck"]+[0,-160],J["neck"],         "torso",     "head"),
    ("upper_arm_l", J["left_shoulder"],  J["left_elbow"],  J["left_shoulder"], "torso",       "upper_arm_l"),
    ("forearm_l",   J["left_elbow"],     J["left_hand"],   J["left_elbow"],    "upper_arm_l", "forearm_l"),
    ("hand_l",      J["left_hand"],      hand_l_tip,       J["left_hand"],     "forearm_l",   "hand_l"),
    ("upper_arm_r", J["right_shoulder"], J["right_elbow"], J["right_shoulder"],"torso",       "upper_arm_r"),
    ("forearm_r",   J["right_elbow"],    J["right_hand"],  J["right_elbow"],   "upper_arm_r", "forearm_r"),
    ("hand_r",      J["right_hand"],     hand_r_tip,       J["right_hand"],    "forearm_r",   "hand_r"),
    ("thigh_l",     J["left_hip"],  J["left_knee"],  J["left_hip"],  "torso",   "thigh_l"),
    ("shin_l",      J["left_knee"], J["left_foot"],  J["left_knee"], "thigh_l", "shin_l"),
    ("foot_l",      J["left_foot"], foot_l_tip,      J["left_foot"], "shin_l",  "foot_l"),
    ("thigh_r",     J["right_hip"], J["right_knee"], J["right_hip"], "torso",   "thigh_r"),
    ("shin_r",      J["right_knee"],J["right_foot"], J["right_knee"],"thigh_r", "shin_r"),
    ("foot_r",      J["right_foot"],foot_r_tip,      J["right_foot"],"shin_r",  "foot_r"),
]
PARENT = {p[0]: p[4] for p in PARTS}
PIVOT = {p[0]: p[3] for p in PARTS}
BONEKEY = {p[0]: p[5] for p in PARTS}

# ---- PART EXTRACTION: assign each fg pixel to the nearest bone segment ----------
def seg_dist(pts_x, pts_y, a, b):
    ab = b - a; L2 = float(ab @ ab) or 1.0
    t = ((pts_x - a[0]) * ab[0] + (pts_y - a[1]) * ab[1]) / L2
    t = np.clip(t, 0, 1)
    px = a[0] + t * ab[0]; py = a[1] + t * ab[1]
    return np.hypot(pts_x - px, pts_y - py)

ys, xs = np.where(fg)
segs = [(name, s, e) for (name, s, e, *_ ) in PARTS]
D = np.stack([seg_dist(xs, ys, s, e) for (_, s, e) in segs], axis=1)  # (Npix, Nparts)
assign = np.argmin(D, axis=1)
label = np.full((H, W), -1, np.int32)
label[ys, xs] = assign

uncertain = []
part_alpha = {}
MIN_PX = 150
# JOINT OVERLAP (owner-sanctioned): the torso keeps a wide margin so it stays
# BEHIND the limbs and fills the hole a swung arm/leg would otherwise expose at
# the shoulder/hip; limbs get a moderate proximal overlap so elbow/knee/wrist
# seams stay covered. Overlap only grows a part INTO the real silhouette
# (a·fg) — never invents pixels outside the character.
OVERLAP = {"torso": 27, "head": 11}
for i, (name, s, e) in enumerate(segs):
    a = (label == i).astype(np.uint8) * 255
    if (a > 0).sum() < MIN_PX and name not in ("hand_l", "hand_r", "foot_l", "foot_r"):
        uncertain.append(name)
    ksz = OVERLAP.get(name, 13)
    kk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksz, ksz))
    a = cv2.dilate(a, kk, 1)
    a = (a.astype(np.float32) / 255.0) * (fg.astype(np.float32))  # stay within the real silhouette
    a = cv2.GaussianBlur(a, (0, 0), 1.4)                          # feather edges
    part_alpha[name] = a

if uncertain:
    print(json.dumps({"result": "PART_EXTRACTION_UNCERTAIN", "parts_too_small": uncertain}))
    sys.exit(3)

# ---- canvas: place the crop centered in a larger frame so limbs can swing --------
CW, CH = 720, 1280
ox, oy = (CW - W) // 2, 90
def to_canvas(p):
    return np.array([p[0] + ox, p[1] + oy], float)

# full-canvas RGBA sprite per part (so warpAffine works in canvas coords)
sprites = {}
for name in part_alpha:
    spr = np.zeros((CH, CW, 4), np.float32)
    a = part_alpha[name]
    spr[oy:oy+H, ox:ox+W, :3] = rgb.astype(np.float32)
    spr[oy:oy+H, ox:ox+W, 3] = a * 255.0
    sprites[name] = spr

Z_ORDER = ["thigh_l","shin_l","foot_l","thigh_r","shin_r","foot_r",
           "torso","head","upper_arm_l","forearm_l","hand_l","upper_arm_r","forearm_r","hand_r"]

CHILDREN = {}
for name in PARENT:
    CHILDREN.setdefault(PARENT[name], []).append(name)

def compose_frame(fr_angles, root_dx, root_dy):
    # forward-kinematics: current pivot position + accumulated angle per part
    accum_ang = {}; cur_pivot = {}
    def walk(name, parent_ang, parent_pivot_cur, parent_pivot_rest):
        ang = parent_ang + fr_angles.get(BONEKEY[name], 0.0)
        rest_pivot = to_canvas(PIVOT[name])
        if PARENT[name] is None:
            cur = rest_pivot + np.array([root_dx, root_dy])
        else:
            off = rest_pivot - parent_pivot_rest
            c, s = math.cos(parent_ang), math.sin(parent_ang)
            rot = np.array([off[0]*c - off[1]*s, off[0]*s + off[1]*c])
            cur = parent_pivot_cur + rot
        accum_ang[name] = ang; cur_pivot[name] = cur
        for ch in CHILDREN.get(name, []):
            walk(ch, ang, cur, rest_pivot)
    walk("torso", 0.0, None, None)

    canvas = np.zeros((CH, CW, 4), np.float32)
    for name in Z_ORDER:
        spr = sprites[name]
        c_rest = to_canvas(PIVOT[name])
        deg = math.degrees(accum_ang[name])
        M = cv2.getRotationMatrix2D((float(c_rest[0]), float(c_rest[1])), -deg, 1.0)
        cur = cur_pivot[name]
        M[0, 2] += cur[0] - c_rest[0]
        M[1, 2] += cur[1] - c_rest[1]
        w = cv2.warpAffine(spr, M, (CW, CH), flags=cv2.INTER_LINEAR, borderValue=(0,0,0,0))
        a = (w[:, :, 3:4] / 255.0)
        canvas[:, :, :3] = w[:, :, :3] * a + canvas[:, :, :3] * (1 - a)
        canvas[:, :, 3:4] = np.clip(w[:, :, 3:4] + canvas[:, :, 3:4] * (1 - a), 0, 255)
    return canvas

def flatten_white(canvas):
    a = canvas[:, :, 3:4] / 255.0
    return (canvas[:, :, :3] * a + 255.0 * (1 - a)).astype(np.uint8)

if MODE == "parts":
    # debug: color each part
    vis = np.full((H, W, 3), 255, np.uint8)
    rng = [(255,0,0),(0,180,0),(0,0,255),(255,180,0),(180,0,255),(0,200,200),(120,120,0),
           (200,0,120),(0,120,200),(120,200,0),(200,120,0),(0,0,120),(120,0,0),(80,80,80)]
    for i,(name,_,_) in enumerate(segs):
        vis[label==i] = rng[i % len(rng)]
    cv2.imwrite(str(OUTDIR/"parts_debug.png"), vis)
    print(json.dumps({"result":"PARTS_OK","parts":[s[0] for s in segs]}))
    sys.exit(0)

# ---- animate over the driver frames ----
FR = ANGLES["frames"]
n = len(FR)
# scale root translation from BVH units to pixels; keep bounded (walk drifts gently)
lat = np.array([f["_root"]["lat"] for f in FR]); fwd = np.array([f["_root"]["fwd"] for f in FR]); up = np.array([f["_root"]["up"] for f in FR])
def norm(v, span):
    r = v.max()-v.min(); return (v - v[0]) * (span / r) if r > 1e-6 else v*0
dx = norm(fwd, 180.0)   # forward walk -> gentle screen drift
dy = -np.abs(norm(up, 40.0))  # vertical bob
frames_out = []
if MODE == "static":
    FR = [FR[0]]; dx = dx[:1]*0; dy = dy[:1]*0
for i, fa in enumerate(FR):
    canvas = compose_frame(fa, float(dx[i]), float(dy[i]))
    frames_out.append(flatten_white(canvas))

# write gif (then ffmpeg to mp4 outside)
import imageio
gif = OUTDIR / "l3r_walk.gif"
imageio.mimsave(str(gif), [cv2.cvtColor(f, cv2.COLOR_BGR2RGB) for f in frames_out], fps=ANGLES["fps"], loop=0)
ru = resource.getrusage(resource.RUSAGE_SELF)
print(json.dumps({
    "result": "L3R_RENDERED", "frames": len(frames_out), "canvas": [CW, CH], "fps": ANGLES["fps"],
    "gif": str(gif), "wall_seconds": round(time.time()-t_start, 1),
    "cpu_user_seconds": round(ru.ru_utime,1), "peak_rss_mb": round(ru.ru_maxrss/1024),
}))
