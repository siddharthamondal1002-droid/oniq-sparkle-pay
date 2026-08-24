#!/usr/bin/env python3
"""ONIQ-VEO-LITE-VS-FAST-v1 benchmark runner.

HARD BOUNDED: exactly 20 generations (10 frozen cases x 2 models), 4 seconds
each, 720p, 9:16. No retries, no extra samples, no second pass. If a generation
fails it is recorded as a failure and the run moves on — a failure is DATA, and
silently regenerating it would corrupt the first-pass acceptance measurement
this whole benchmark exists to produce.

Reads GOOGLE_AI_API_KEY from the environment. Never prints it, never writes it
to any output file.

usage:  python3 run_veo_bench.py <repo_root> <out_dir>
"""
import base64
import io
import json
import os
import subprocess
import sys
import time
import urllib.request

API = "https://generativelanguage.googleapis.com/v1beta"
MODELS = {"A": "veo-3.1-lite-generate-preview", "B": "veo-3.1-fast-generate-preview"}
DURATION = 4
PARAMS = {"aspectRatio": "9:16", "durationSeconds": DURATION, "resolution": "720p"}

CASES = [
    ("c01_walk", "aladdin", "The man walks forward at a steady, even pace. Full body stays in frame. Natural arm swing."),
    ("c02_talking", "morgiana", "The woman speaks directly to camera. Her lips move naturally as she talks. Small, calm head movements."),
    ("c03_closeup", "princess", "Slow push in on her face. She blinks once and her expression softens slightly."),
    ("c04_turning", "captain", "He turns his upper body to face left, then holds the new position steadily."),
    ("c05_two_person", "morgiana", "Two people stand facing each other. One gestures while speaking; the other listens and nods once."),
    ("c06_hand", "magician", "He raises one hand and slowly opens his fingers, palm toward camera."),
    ("c07_lower_body", "fisherman", "He steps forward with one leg, the knee bending clearly, then plants his foot and settles."),
    ("c08_camera", "lampJinni", "The camera arcs slowly to the right around the standing figure, who remains still."),
    ("c09_environment", "jarJinni", "Smoke and loose cloth drift and curl in the air around the figure, who stays still."),
    ("c10_knee_regression", "aliBaba", "Full-body side view. He walks with a clear, correct walking cycle; both knees bend and straighten naturally."),
]

KEY = os.environ["GOOGLE_AI_API_KEY"]


def post(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "x-goog-api-key": KEY})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def get(url):
    req = urllib.request.Request(url, headers={"x-goog-api-key": KEY})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.status, r.read()


def start_frame(repo, character, dest):
    """Composite a real ONIQ character cut-out onto a plain backdrop, 720x1280.

    Deterministic and identical for both models — that is the only property the
    benchmark needs from it. It is NOT a full production still, and the report
    states that limit rather than implying otherwise.
    """
    from PIL import Image
    src = os.path.join(repo, "remotion/public/sheets/cut", character + ".png")
    bg = Image.new("RGB", (720, 1280), (34, 38, 48))
    ch = Image.open(src).convert("RGBA")
    scale = min(560 / ch.width, 900 / ch.height)
    ch = ch.resize((max(1, int(ch.width * scale)), max(1, int(ch.height * scale))), Image.LANCZOS)
    bg.paste(ch, ((720 - ch.width) // 2, 1280 - ch.height - 120), ch)
    bg.save(dest)
    return dest


def run_one(model, prompt, frame_path, out_path):
    img = base64.b64encode(open(frame_path, "rb").read()).decode()
    body = {"instances": [{"prompt": prompt,
                           "image": {"bytesBase64Encoded": img, "mimeType": "image/png"}}],
            "parameters": dict(PARAMS)}
    t0 = time.time()
    code, j = post(f"{API}/models/{model}:predictLongRunning", body)
    if code != 200:
        return {"submit_http": code, "error": json.dumps(j)[:400], "ok": False,
                "wall_s": round(time.time() - t0, 1)}
    op = j["name"]
    for _ in range(60):
        time.sleep(10)
        _, raw = get(f"{API}/{op}")
        o = json.loads(raw)
        if o.get("done"):
            if o.get("error"):
                return {"submit_http": 200, "error": json.dumps(o["error"])[:400],
                        "ok": False, "wall_s": round(time.time() - t0, 1)}
            resp = o.get("response", {})
            samples = (resp.get("generateVideoResponse", {}).get("generatedSamples")
                       or resp.get("generatedSamples") or resp.get("videos") or [])
            if not samples:
                return {"submit_http": 200, "error": "no samples in response",
                        "ok": False, "wall_s": round(time.time() - t0, 1)}
            v = samples[0].get("video", samples[0])
            if v.get("bytesBase64Encoded"):
                open(out_path, "wb").write(base64.b64decode(v["bytesBase64Encoded"]))
            else:
                _, blob = get(v["uri"])
                open(out_path, "wb").write(blob)
            return {"submit_http": 200, "ok": True, "operation": op,
                    "wall_s": round(time.time() - t0, 1)}
    return {"submit_http": 200, "error": "timed out polling", "ok": False,
            "wall_s": round(time.time() - t0, 1)}


def main():
    repo, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    frames = os.path.join(out, "frames")
    os.makedirs(frames, exist_ok=True)
    log = []
    n = 0
    for cid, character, prompt in CASES:
        fp = start_frame(repo, character, os.path.join(frames, cid + ".png"))
        for label, model in MODELS.items():
            n += 1
            dest = os.path.join(out, f"{cid}__{label}.mp4")
            r = run_one(model, prompt, fp, dest)
            r.update({"case": cid, "label": label, "model": model, "character": character})
            log.append(r)
            print(f"[{n:2d}/20] {cid:22s} {label} {model:32s} "
                  f"{'OK ' if r['ok'] else 'FAIL'} {r['wall_s']}s "
                  f"{r.get('error', '')[:90]}", flush=True)
    json.dump(log, open(os.path.join(out, "run_log.json"), "w"), indent=1)
    ok = sum(1 for r in log if r["ok"])
    print(f"\ngenerations attempted 20, produced a file {ok}, failed {20 - ok}")
    print(f"billed seconds: Lite {sum(4 for r in log if r['label'] == 'A')}, "
          f"Fast {sum(4 for r in log if r['label'] == 'B')}")


if __name__ == "__main__":
    main()
