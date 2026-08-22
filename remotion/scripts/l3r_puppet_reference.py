#!/usr/bin/env python3
# L3R RIGID-PART CHARACTER PUPPET — REFERENCE / PROOF (Phase 10, HARDENED Phase 11).
# Real character cutout (U^2-Net mask) + auto-rig joints -> geometric part
# extraction (TIGHT per-bone corridors + keep-largest-component + hand/forearm
# structural validation, fail-closed to PART_EXTRACTION_UNCERTAIN) -> hierarchical
# affine FK driven by the SAME zombie.bvh walk -> CPU alpha compositing -> frames.
# Rigid parts cannot ARAP-stretch (no claw); the corridor cap + validation stop the
# Phase-10 hand/pants contamination ("blue blade" artifact) found in
# storyfilm_l3r_shot.mp4. No colour/identity hard-coded (geometric only).
#
# MEASURED (2026-08-22, 4-core CPU) real Aladdin + zombie walk: extraction ~2s,
# 149-frame 720x1280 render ~120s wall (~115s CPU), peak RSS ~2.0 GB. GPU=0, ₹0.
# Verdict L3R = PASS_WITH_LIMITS (blades resolved; minor joint seams remain).
# See MOTION_RIGID_PUPPET_HARDENING.md. Reference/proof only; not wired to
# production; no media/weights in git.
import sys, json, math, time, resource
from pathlib import Path
import numpy as np, cv2

RIG = Path(sys.argv[1]); ANGLES = json.loads(Path(sys.argv[2]).read_text())
OUTDIR = Path(sys.argv[3]); OUTDIR.mkdir(parents=True, exist_ok=True)
MODE = sys.argv[4] if len(sys.argv) > 4 else "animate"   # parts | static | animate

t_start = time.time()
J = {k: np.array(v, float) for k, v in json.load(open(RIG / "autorig_result.json"))["joints"].items()}
rgb = cv2.imread(str(RIG / "texture.png"))[:, :, :3]
mask = cv2.imread(str(RIG / "mask.png"), 0)
H, W = mask.shape
fg = mask > 127

def L(a, b): return float(np.hypot(*(b - a)))
hipmid = (J["left_hip"] + J["right_hip"]) / 2
# hand/foot as a SHORT stub at the joint (NOT extrapolated into the body)
def stub(joint, prox, f=0.22):
    d = joint - prox; n = np.hypot(*d) or 1.0
    return joint + d / n * (f * n)   # a little past the wrist ALONG the forearm only
hand_l_e = stub(J["left_hand"], J["left_elbow"]);  hand_r_e = stub(J["right_hand"], J["right_elbow"])
foot_l_e = stub(J["left_foot"], J["left_knee"]);   foot_r_e = stub(J["right_foot"], J["right_knee"])

# part: name, seg_start, seg_end, pivot, parent, bone_key, perp_cap(px)
ARM_W = 42.0; LEG_W = 66.0; HAND_R = 46.0; FOOT_R = 58.0
PARTS = [
    ("torso",       J["torso"], hipmid,           hipmid,             None,        "torso",       1e9),
    ("head",        J["neck"],  J["neck"]+[0,-150],J["neck"],         "torso",     "head",        150.0),
    ("upper_arm_l", J["left_shoulder"], J["left_elbow"], J["left_shoulder"], "torso","upper_arm_l",ARM_W),
    ("forearm_l",   J["left_elbow"],    J["left_hand"],  J["left_elbow"],    "upper_arm_l","forearm_l",ARM_W),
    ("hand_l",      J["left_hand"],     hand_l_e,        J["left_hand"],     "forearm_l","hand_l",  HAND_R),
    ("upper_arm_r", J["right_shoulder"],J["right_elbow"],J["right_shoulder"],"torso","upper_arm_r",ARM_W),
    ("forearm_r",   J["right_elbow"],   J["right_hand"], J["right_elbow"],   "upper_arm_r","forearm_r",ARM_W),
    ("hand_r",      J["right_hand"],    hand_r_e,        J["right_hand"],    "forearm_r","hand_r",  HAND_R),
    ("thigh_l",     J["left_hip"], J["left_knee"], J["left_hip"], "torso","thigh_l",LEG_W),
    ("shin_l",      J["left_knee"],J["left_foot"], J["left_knee"],"thigh_l","shin_l",LEG_W),
    ("foot_l",      J["left_foot"],foot_l_e,       J["left_foot"],"shin_l","foot_l",FOOT_R),
    ("thigh_r",     J["right_hip"],J["right_knee"],J["right_hip"],"torso","thigh_r",LEG_W),
    ("shin_r",      J["right_knee"],J["right_foot"],J["right_knee"],"thigh_r","shin_r",LEG_W),
    ("foot_r",      J["right_foot"],foot_r_e,      J["right_foot"],"shin_r","foot_r",FOOT_R),
]
PARENT={p[0]:p[4] for p in PARTS}; PIVOT={p[0]:p[3] for p in PARTS}; BONEKEY={p[0]:p[5] for p in PARTS}
CAP={p[0]:p[6] for p in PARTS}; SEG={p[0]:(p[1],p[2]) for p in PARTS}
TORSO_I=0

def seg_dist(px, py, a, b):
    ab=b-a; L2=float(ab@ab) or 1.0
    t=np.clip(((px-a[0])*ab[0]+(py-a[1])*ab[1])/L2,0,1)
    return np.hypot(px-(a[0]+t*ab[0]), py-(a[1]+t*ab[1]))

ys,xs=np.where(fg)
names=[p[0] for p in PARTS]
Dall=np.stack([seg_dist(xs,ys,*SEG[n]) for n in names],axis=1)     # (Npix, Nparts)
caps=np.array([CAP[n] for n in names])
# a pixel may join a limb only WITHIN that bone's cap; torso (huge cap) is the
# fallback so ambiguous mid-body pixels never leak into a thin limb.
elig = Dall <= caps[None,:]
Dmask = np.where(elig, Dall, np.inf)
assign = np.argmin(Dmask, axis=1)
# any pixel with no eligible limb (all inf) -> torso
none_elig = ~np.isfinite(Dmask.min(axis=1))
assign[none_elig]=TORSO_I
label=np.full((H,W),-1,np.int32); label[ys,xs]=assign

# ---- build feathered part alphas (overlap only INTO the real silhouette) --------
OVERLAP={"torso":27,"head":11}
part_alpha={}
for i,n in enumerate(names):
    a=(label==i).astype(np.uint8)*255
    # keep only the largest connected component of each LIMB part (drops a stray
    # speck a thin corridor can leave); torso/head kept whole. Safe: removes, never adds.
    if n not in ("torso","head"):
        nc,lb,st,_=cv2.connectedComponentsWithStats((a>0).astype(np.uint8),8)
        if nc>2:
            big=1+int(np.argmax(st[1:,cv2.CC_STAT_AREA])); a=np.where(lb==big,255,0).astype(np.uint8)
    ksz=OVERLAP.get(n,11)
    a=cv2.dilate(a,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(ksz,ksz)),1)
    a=(a.astype(np.float32)/255.0)*fg.astype(np.float32)
    a=cv2.GaussianBlur(a,(0,0),1.3)
    part_alpha[n]=a

# ---- HAND/FOREARM structural validation (fail-closed) ---------------------------
def validate_limb(n):
    a=(part_alpha[n]>0.4).astype(np.uint8)
    area=int(a.sum())
    if area<80: return {"ok":False,"reason":"empty","area":area}
    nc,lab,stats,_=cv2.connectedComponentsWithStats(a,8)
    comp=stats[1:,cv2.CC_STAT_AREA] if nc>1 else np.array([area])
    frag=1.0-(comp.max()/max(1,comp.sum()))                       # fraction NOT in largest comp
    yy,xx=np.where(a>0)
    # "far" = PERPENDICULAR distance to the bone SEGMENT (the corridor axis), not
    # distance from the pivot — a limb legitimately runs the length of its bone.
    perp=seg_dist(xx.astype(float),yy.astype(float),*SEG[n])
    far_frac=float((perp>CAP[n]*1.25).mean())                     # pixels outside the corridor
    x0,x1,y0,y1=xx.min(),xx.max(),yy.min(),yy.max()
    bw,bh=x1-x0+1,y1-y0+1
    fill=area/float(bw*bh)                                        # low fill => spiky/triangular
    ok = bool(frag<0.15 and far_frac<0.06 and fill>0.30)
    reason="" if ok else f"frag={frag:.2f} far={far_frac:.2f} fill={fill:.2f}"
    return {"ok":ok,"area":area,"frag":round(float(frag),3),"far_frac":round(float(far_frac),3),"fill":round(float(fill),3),"reason":reason}

VAL={n:validate_limb(n) for n in ("hand_l","hand_r","forearm_l","forearm_r","upper_arm_l","upper_arm_r")}
uncertain=[n for n,v in VAL.items() if not v["ok"]]
if MODE=="validate" or uncertain:
    print(json.dumps({"validation":VAL,"uncertain":uncertain,
        "result":"PART_EXTRACTION_UNCERTAIN" if uncertain else "PART_EXTRACTION_OK"}))
    if uncertain: sys.exit(3)
    if MODE=="validate": sys.exit(0)

# ---- canvas + sprites -----------------------------------------------------------
CW,CH=720,1280; ox,oy=(CW-W)//2,90
def to_canvas(p): return np.array([p[0]+ox,p[1]+oy],float)
sprites={}
for n in names:
    spr=np.zeros((CH,CW,4),np.float32)
    spr[oy:oy+H,ox:ox+W,:3]=rgb.astype(np.float32)
    spr[oy:oy+H,ox:ox+W,3]=part_alpha[n]*255.0
    sprites[n]=spr
Z=["thigh_l","shin_l","foot_l","thigh_r","shin_r","foot_r","torso","head",
   "upper_arm_l","forearm_l","hand_l","upper_arm_r","forearm_r","hand_r"]
CH_=({}); [CH_.setdefault(PARENT[n],[]).append(n) for n in PARENT]

def compose(fa,rdx,rdy):
    acc={}; cur={}
    def walk(n,pang,ppc,ppr):
        ang=pang+fa.get(BONEKEY[n],0.0); rp=to_canvas(PIVOT[n])
        if PARENT[n] is None: c=rp+np.array([rdx,rdy])
        else:
            off=rp-ppr; cs,sn=math.cos(pang),math.sin(pang)
            c=ppc+np.array([off[0]*cs-off[1]*sn, off[0]*sn+off[1]*cs])
        acc[n]=ang; cur[n]=c
        for ch in CH_.get(n,[]): walk(ch,ang,c,rp)
    walk("torso",0.0,None,None)
    canv=np.zeros((CH,CW,4),np.float32)
    for n in Z:
        cr=to_canvas(PIVOT[n]); deg=math.degrees(acc[n])
        M=cv2.getRotationMatrix2D((float(cr[0]),float(cr[1])),-deg,1.0)
        M[0,2]+=cur[n][0]-cr[0]; M[1,2]+=cur[n][1]-cr[1]
        w=cv2.warpAffine(sprites[n],M,(CW,CH),flags=cv2.INTER_LINEAR,borderValue=(0,0,0,0))
        al=w[:,:,3:4]/255.0
        canv[:,:,:3]=w[:,:,:3]*al+canv[:,:,:3]*(1-al)
        canv[:,:,3:4]=np.clip(w[:,:,3:4]+canv[:,:,3:4]*(1-al),0,255)
    return canv
def flat(c):
    a=c[:,:,3:4]/255.0; return (c[:,:,:3]*a+255.0*(1-a)).astype(np.uint8)

if MODE=="parts":
    vis=np.full((H,W,3),255,np.uint8)
    col=[(255,0,0),(0,180,0),(0,0,255),(255,180,0),(180,0,255),(0,200,200),(120,120,0),
         (200,0,120),(0,120,200),(120,200,0),(200,120,0),(0,0,120),(120,0,0),(80,80,80)]
    for i,n in enumerate(names): vis[label==i]=col[i%len(col)]
    cv2.imwrite(str(OUTDIR/"parts_debug.png"),vis)
    # per-part RGBA crops (tight bbox) for inspection
    for n in ("hand_l","hand_r","forearm_l","forearm_r"):
        a=part_alpha[n]; yy,xx=np.where(a>0.2)
        if len(xx):
            crop=rgb[yy.min():yy.max()+1,xx.min():xx.max()+1].copy()
            cv2.imwrite(str(OUTDIR/f"part_{n}.png"),crop)
    print(json.dumps({"result":"PARTS_OK","validation":VAL}))
    sys.exit(0)

FR=ANGLES["frames"]
lat=np.array([f["_root"]["lat"] for f in FR]);fwd=np.array([f["_root"]["fwd"] for f in FR]);up=np.array([f["_root"]["up"] for f in FR])
def nrm(v,s):
    r=v.max()-v.min(); return (v-v[0])*(s/r) if r>1e-6 else v*0
dx=nrm(fwd,180.0); dy=-np.abs(nrm(up,40.0))
if MODE=="static": FR=[FR[0]]; dx=dx[:1]*0; dy=dy[:1]*0
out=[flat(compose(fa,float(dx[i]),float(dy[i]))) for i,fa in enumerate(FR)]
import imageio
imageio.mimsave(str(OUTDIR/"l3r_walk.gif"),[cv2.cvtColor(f,cv2.COLOR_BGR2RGB) for f in out],fps=ANGLES["fps"],loop=0)
ru=resource.getrusage(resource.RUSAGE_SELF)
print(json.dumps({"result":"L3R_RENDERED","frames":len(out),"fps":ANGLES["fps"],
    "wall_seconds":round(time.time()-t_start,1),"cpu_user_seconds":round(ru.ru_utime,1),
    "peak_rss_mb":round(ru.ru_maxrss/1024),"validation_ok":len(uncertain)==0}))
