AW, AH = 96, 171
BG_TOL = 26
#!/usr/bin/env python3
"""ONIQ-VEO-LITE-VS-FAST-v2 — clean inputs, generate, measure, track.
HARD BOUNDED: exactly 20 generations (10 classes x 2 models), 4s, 720p, 9:16.
NO retry path. A failure is the measurement.
Captures raiMediaFilteredCount/Reasons so a filtered result is distinguishable
from a provider fault. usage: python3 vb2.py <repo_root> <out_dir>
"""
import base64, json, os, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
from PIL import Image

API="https://generativelanguage.googleapis.com/v1beta"
MODELS={"A":"veo-3.1-lite-generate-preview","B":"veo-3.1-fast-generate-preview"}
PARAMS={"aspectRatio":"9:16","durationSeconds":4,"resolution":"720p"}
KEY=os.environ["GOOGLE_AI_API_KEY"]
CASES=[
 ("c01_walk","aladdin","The boy walks forward at a steady, even pace. Full body stays in frame. Natural arm swing."),
 ("c02_talking","morgiana","The woman speaks directly to camera. Her lips move naturally as she talks. Small, calm head movements."),
 ("c03_closeup","princess","Slow push in on her face. She blinks once and her expression softens slightly."),
 ("c04_turning","aladdin","He turns his upper body to face left, then holds the new position steadily."),
 ("c05_two_person","morgiana","Two people stand facing each other. One gestures while speaking; the other listens and nods once."),
 ("c06_hand","princess","She raises one hand and slowly opens her fingers, palm toward camera."),
 ("c07_lower_body","aladdin","He steps forward with one leg, the knee bending clearly, then plants his foot and settles."),
 ("c08_camera","lampJinni","The camera arcs slowly to the right around the standing figure, who remains still."),
 ("c09_environment","lampJinni","Smoke and loose cloth drift and curl in the air around the figure, who stays still."),
 ("c10_knee_regression","aladdin","Full-body side view. He walks with a clear, correct walking cycle; both knees bend and straighten naturally."),
]
W,H=720,1280


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



def post(url,payload):
    req=urllib.request.Request(url,data=json.dumps(payload).encode(),
        headers={"content-type":"application/json","x-goog-api-key":KEY})
    try:
        with urllib.request.urlopen(req,timeout=180) as r: return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read() or b"{}")

def get(url):
    req=urllib.request.Request(url,headers={"x-goog-api-key":KEY})
    with urllib.request.urlopen(req,timeout=300) as r: return r.read()

def run_one(model,prompt,fp,out):
    img=base64.b64encode(Path(fp).read_bytes()).decode()
    body={"instances":[{"prompt":prompt,"image":{"bytesBase64Encoded":img,"mimeType":"image/png"}}],
          "parameters":dict(PARAMS)}
    t0=time.time()
    code,j=post(f"{API}/models/{model}:predictLongRunning",body)
    if code!=200:
        return {"ok":False,"outcome":"submit_rejected","submit_http":code,
                "error":json.dumps(j)[:300],"wall_s":round(time.time()-t0,1)}
    op=j["name"]
    for _ in range(60):
        time.sleep(10)
        o=json.loads(get(f"{API}/{op}"))
        if not o.get("done"): continue
        if o.get("error"):
            return {"ok":False,"outcome":"operation_error","submit_http":200,
                    "error":json.dumps(o["error"])[:300],"wall_s":round(time.time()-t0,1)}
        rp=o.get("response",{})
        gv=rp.get("generateVideoResponse",rp)
        sm=(gv.get("generatedSamples") or rp.get("generatedSamples") or rp.get("videos") or [])
        rai_n=gv.get("raiMediaFilteredCount") or rp.get("raiMediaFilteredCount")
        rai_r=gv.get("raiMediaFilteredReasons") or rp.get("raiMediaFilteredReasons")
        if not sm:
            return {"ok":False,
                    "outcome":"provider_filtered_empty" if rai_n else "empty_no_rai_field",
                    "submit_http":200,"raiMediaFilteredCount":rai_n,
                    "raiMediaFilteredReasons":rai_r,"operation":op,
                    "response_keys":sorted(list(rp.keys())+list(gv.keys())),
                    "wall_s":round(time.time()-t0,1)}
        v=sm[0].get("video",sm[0])
        Path(out).write_bytes(base64.b64decode(v["bytesBase64Encoded"])
                              if v.get("bytesBase64Encoded") else get(v["uri"]))
        return {"ok":True,"outcome":"generated","submit_http":200,"operation":op,
                "raiMediaFilteredCount":rai_n,"wall_s":round(time.time()-t0,1)}
    return {"ok":False,"outcome":"poll_timeout","submit_http":200,"wall_s":round(time.time()-t0,1)}

def main():
    repo,out=sys.argv[1],Path(sys.argv[2])
    frames=out/"inputs_v2"; frames.mkdir(parents=True,exist_ok=True)
    meta=[]
    for n in ["aladdin","morgiana","princess","lampJinni"]:
        meta.append(build(repo,n,frames/f"{n}.png"))
        print(f"  input  {n:12s} crop={meta[-1]['crop_box']}")
    (frames/"inputs_v2.json").write_text(json.dumps(
        {"benchmark_input_version":"ONIQ-VEO-INPUTS-v2","items":meta},indent=1))
    print()
    log=[]; n=0
    for cid,chn,prompt in CASES:
        fp=frames/f"{chn}.png"
        for label,model in MODELS.items():
            n+=1
            dest=out/f"{cid}__{label}.mp4"
            r=run_one(model,prompt,fp,dest)
            r.update({"case":cid,"label":label,"model":model,"character":chn})
            log.append(r)
            print(f"[{n:2d}/20] {cid:22s} {label} {'OK  ' if r['ok'] else 'FAIL'} "
                  f"{r['outcome']:24s} {r['wall_s']:6.1f}s rai={r.get('raiMediaFilteredCount')}",flush=True)
    (out/"run_log.json").write_text(json.dumps(log,indent=1))
    tr={}
    for p in sorted(out.glob("*.mp4")):
        tr[p.name]=track(p,Path("/tmp/_t2")/p.stem)
        t=tr[p.name]; tot=t["energy_inside"]+t["energy_outside"] or 1
        print(f"{p.name:26s} fr={t['frames']:3d} "
              f"drift={max(abs(x-t['centroid_x'][0]) for x in t['centroid_x']) if t['centroid_x'] else 0:.3f} "
              f"hgrow={((max(t['bbox_h'])-t['bbox_h'][0])/t['bbox_h'][0]) if t['bbox_h'] and t['bbox_h'][0] else 0:+.2f} "
              f"wchg={(max(abs(x-t['bbox_w'][0]) for x in t['bbox_w'])/t['bbox_w'][0]) if t['bbox_w'] and t['bbox_w'][0] else 0:.2f} "
              f"lo/up={(t['energy_lower']/t['energy_upper']) if t['energy_upper'] else -1:.2f} "
              f"off={t['energy_outside']/tot:.2f} tot={tot:.0f}")
    (out/"track.json").write_text(json.dumps(tr,indent=1))
    ok=sum(1 for r in log if r["ok"])
    print(f"\nattempted 20, produced {ok}, failed {20-ok}")
    print("outcomes:", json.dumps({o:sum(1 for r in log if r['outcome']==o) for o in {r['outcome'] for r in log}}))

if __name__=="__main__": main()
