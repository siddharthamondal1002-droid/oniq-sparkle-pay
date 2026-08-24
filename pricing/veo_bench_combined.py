#!/usr/bin/env python3
"""ONIQ-VEO-LITE-VS-FAST-v1: generate + measure. Bounded to exactly 20 clips."""
import base64, json, os, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
from PIL import Image

API = "https://generativelanguage.googleapis.com/v1beta"
MODELS = {"A": "veo-3.1-lite-generate-preview", "B": "veo-3.1-fast-generate-preview"}
PARAMS = {"aspectRatio": "9:16", "durationSeconds": 4, "resolution": "720p"}
KEY = os.environ["GOOGLE_AI_API_KEY"]
CASES = [
 ("c01_walk","aladdin","The man walks forward at a steady, even pace. Full body stays in frame. Natural arm swing."),
 ("c02_talking","morgiana","The woman speaks directly to camera. Her lips move naturally as she talks. Small, calm head movements."),
 ("c03_closeup","princess","Slow push in on her face. She blinks once and her expression softens slightly."),
 ("c04_turning","captain","He turns his upper body to face left, then holds the new position steadily."),
 ("c05_two_person","morgiana","Two people stand facing each other. One gestures while speaking; the other listens and nods once."),
 ("c06_hand","magician","He raises one hand and slowly opens his fingers, palm toward camera."),
 ("c07_lower_body","fisherman","He steps forward with one leg, the knee bending clearly, then plants his foot and settles."),
 ("c08_camera","lampJinni","The camera arcs slowly to the right around the standing figure, who remains still."),
 ("c09_environment","jarJinni","Smoke and loose cloth drift and curl in the air around the figure, who stays still."),
 ("c10_knee_regression","aliBaba","Full-body side view. He walks with a clear, correct walking cycle; both knees bend and straighten naturally."),
]


def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "x-goog-api-key": KEY})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def get(url):
    req = urllib.request.Request(url, headers={"x-goog-api-key": KEY})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def frame(repo, ch_name, dest):
    bg = Image.new("RGB", (720, 1280), (34, 38, 48))
    ch = Image.open(Path(repo, "remotion/public/sheets/cut", ch_name + ".png")).convert("RGBA")
    s = min(560 / ch.width, 900 / ch.height)
    ch = ch.resize((max(1, int(ch.width * s)), max(1, int(ch.height * s))), Image.LANCZOS)
    bg.paste(ch, ((720 - ch.width) // 2, 1280 - ch.height - 120), ch)
    bg.save(dest)
    return dest


def run_one(model, prompt, fp, out):
    img = base64.b64encode(Path(fp).read_bytes()).decode()
    body = {"instances": [{"prompt": prompt, "image": {"bytesBase64Encoded": img, "mimeType": "image/png"}}],
            "parameters": dict(PARAMS)}
    t0 = time.time()
    code, j = post(f"{API}/models/{model}:predictLongRunning", body)
    if code != 200:
        return {"ok": False, "submit_http": code, "error": json.dumps(j)[:300], "wall_s": round(time.time() - t0, 1)}
    op = j["name"]
    for _ in range(60):
        time.sleep(10)
        o = json.loads(get(f"{API}/{op}"))
        if not o.get("done"):
            continue
        if o.get("error"):
            return {"ok": False, "submit_http": 200, "error": json.dumps(o["error"])[:300], "wall_s": round(time.time() - t0, 1)}
        rp = o.get("response", {})
        sm = (rp.get("generateVideoResponse", {}).get("generatedSamples")
              or rp.get("generatedSamples") or rp.get("videos") or [])
        if not sm:
            return {"ok": False, "submit_http": 200, "error": "no samples", "wall_s": round(time.time() - t0, 1)}
        v = sm[0].get("video", sm[0])
        Path(out).write_bytes(base64.b64decode(v["bytesBase64Encoded"]) if v.get("bytesBase64Encoded") else get(v["uri"]))
        return {"ok": True, "submit_http": 200, "operation": op, "wall_s": round(time.time() - t0, 1)}
    return {"ok": False, "submit_http": 200, "error": "poll timeout", "wall_s": round(time.time() - t0, 1)}


def probe(p, ent):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", ent, "-of", "json", str(p)],
                       capture_output=True, text=True)
    try:
        return json.loads(r.stdout or "{}")
    except Exception:
        return {}


def measure(path):
    p = Path(path)
    m = {"clip": p.name, "size": p.stat().st_size if p.exists() else 0, "decodes": False,
         "codec_types": [], "codec_names": [], "streams": 0, "duration": 0.0,
         "frame_count": 0, "frame_diffs": [], "longest_static_run": 0, "blank_frames": 0}
    if not p.exists() or m["size"] == 0:
        return m
    st = probe(p, "stream=codec_type,codec_name")
    m["codec_types"] = [s.get("codec_type") for s in st.get("streams", [])]
    m["codec_names"] = [s.get("codec_name") for s in st.get("streams", [])]
    m["streams"] = len(st.get("streams", []))
    try:
        m["duration"] = float(probe(p, "format=duration").get("format", {}).get("duration", 0.0))
    except Exception:
        pass
    if "video" not in m["codec_types"]:
        return m
    d = p.with_suffix(".fr")
    d.mkdir(exist_ok=True)
    rc = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(p), "-vf",
                         "scale=64:114,format=gray", f"{d}/f%04d.pgm"], capture_output=True)
    fs = sorted(d.glob("*.pgm"))
    if rc.returncode != 0 or not fs:
        return m
    m["decodes"] = True
    m["frame_count"] = len(fs)

    def px(fp):
        b = fp.read_bytes()
        i = n = 0
        while n < 4 and i < len(b):
            if b[i:i + 1].isspace():
                n += 1
                while i < len(b) and b[i:i + 1].isspace():
                    i += 1
                continue
            i += 1
        return b[i:]
    prev = None
    run = best = 1
    for fp in fs:
        cur = px(fp)
        # A blank frame is UNIFORM, not merely dark. Testing the level instead
        # of the spread misses ffmpeg's limited-range black (pixel value 3, not
        # 0) and would false-positive on a legitimately dark shot. Spread <= 4 of
        # 255 means the whole frame sits within 1.6% of one value; measured
        # references: ffmpeg black = 3, ffmpeg gray = 2, real content = tens.
        if cur and (max(cur) - min(cur)) <= 4:
            m["blank_frames"] += 1
        if prev is not None and len(prev) == len(cur):
            diff = sum(abs(a - b) for a, b in zip(prev, cur)) / len(cur) / 255.0
            m["frame_diffs"].append(round(diff, 6))
            run = run + 1 if diff < 0.001 else 1
            best = max(best, run)
        prev = cur
    m["longest_static_run"] = best
    for fp in fs:
        fp.unlink()
    d.rmdir()
    return m


def main():
    repo, out = sys.argv[1], sys.argv[2]
    Path(out, "frames").mkdir(parents=True, exist_ok=True)
    log = []
    n = 0
    for cid, chn, prompt in CASES:
        fp = frame(repo, chn, Path(out, "frames", cid + ".png"))
        for label, model in MODELS.items():
            n += 1
            dest = Path(out, f"{cid}__{label}.mp4")
            r = run_one(model, prompt, fp, dest)
            r.update({"case": cid, "label": label, "model": model, "character": chn})
            log.append(r)
            print(f"[{n:2d}/20] {cid:22s} {label} {model:32s} "
                  f"{'OK  ' if r['ok'] else 'FAIL'} {r['wall_s']:6.1f}s {r.get('error','')[:80]}", flush=True)
    Path(out, "run_log.json").write_text(json.dumps(log, indent=1))
    rows = [measure(p) for p in sorted(Path(out).glob("*.mp4"))]
    Path(out, "measure.json").write_text(json.dumps(rows, indent=1))
    print()
    for r in rows:
        print(f"{r['clip']:26s} streams={r['streams']} {','.join(str(x) for x in r['codec_names']):12s} "
              f"dur={r['duration']:.3f} frames={r['frame_count']:3d} "
              f"static_run={r['longest_static_run']:3d} blank={r['blank_frames']}")
    ok = sum(1 for r in log if r["ok"])
    print(f"\nattempted 20, produced a file {ok}, failed {20-ok}")
    print("billed: Lite 40s, Fast 40s (4s x 10 each)")


if __name__ == "__main__":
    main()
