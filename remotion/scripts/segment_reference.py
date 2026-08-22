#!/usr/bin/env python3
# L3 GENERAL SEGMENTATION — REFERENCE / PROOF script (Phase 7).
#
# Produces a background-free character mask from a REAL ONIQ still using U^2-Net
# (the rembg model), CPU-only via onnxruntime. This REPLACES the Phase-6 example-
# mask dependency with a genuine general-purpose segmenter. MIT/permissive model.
#
# MEASURED (2026-08-22, CPU) on a real 800x1244 ONIQ character still:
#   model load 0.11s, inference 0.18s, peak RSS 458 MB, mask 34% fg, bbox covers
#   94.8% of height (full body). GPU=0, API cost 0. Clean full-body cutout: hair,
#   arms, hands, legs, feet all captured, no holes.
#
# SETUP (CPU): pip install onnxruntime==1.16.3 opencv-python-headless numpy scipy
#   model (smallest, ~4.7MB): u2netp.onnx from the rembg github release
#   (github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx).
# RUN: python3 segment_reference.py <u2netp.onnx> <still.png> <out_dir>
#      -> out_dir/{mask.png, matte.png, cutout.png, seg_result.json}
#
# Reference/proof only; NOT wired into the production Story Worker. No model
# weights are committed to git.

import sys, time, json, resource
from pathlib import Path
import numpy as np, cv2
import onnxruntime as ort
from scipy import ndimage

model, img_path, out_dir = sys.argv[1], sys.argv[2], Path(sys.argv[3])
out_dir.mkdir(parents=True, exist_ok=True)

img = cv2.imread(img_path)                 # BGR
H, W = img.shape[:2]
rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

t0 = time.time()
sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
load_dt = time.time() - t0

# rembg u2net preprocessing
inp = cv2.resize(rgb, (320, 320)).astype(np.float32) / 255.0
mean = np.array([0.485, 0.456, 0.406], np.float32)
std = np.array([0.229, 0.224, 0.225], np.float32)
inp = (inp - mean) / std
inp = np.transpose(inp, (2, 0, 1))[None, ...].astype(np.float32)

t1 = time.time()
out = sess.run(None, {sess.get_inputs()[0].name: inp})[0]  # (1,1,320,320)
infer_dt = time.time() - t1

d = out[0, 0]
d = (d - d.min()) / (d.max() - d.min() + 1e-8)
matte = cv2.resize((d * 255).astype(np.uint8), (W, H))

# binary mask + cleanup
_, mask = cv2.threshold(matte, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
mask = ndimage.binary_fill_holes(mask > 0).astype(np.uint8) * 255
n, lab = cv2.connectedComponents(mask)
if n > 2:
    sizes = [(lab == i).sum() for i in range(1, n)]
    big = 1 + int(np.argmax(sizes))
    mask = np.where(lab == big, 255, 0).astype(np.uint8)

ys, xs = np.where(mask > 127)
bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None
fg = float((mask > 127).mean() * 100)

cv2.imwrite(str(out_dir / "matte.png"), matte)
cv2.imwrite(str(out_dir / "mask.png"), mask)
# cutout preview over white
a = (mask > 127)[..., None]
cutout = (img * a + 255 * (~a)).astype(np.uint8)
cv2.imwrite(str(out_dir / "cutout.png"), cutout)

ru = resource.getrusage(resource.RUSAGE_SELF)
res = {
    "model": Path(model).name, "input": img_path, "in_wh": [W, H],
    "model_load_seconds": round(load_dt, 2), "infer_seconds": round(infer_dt, 2),
    "peak_rss_mb": round(ru.ru_maxrss / 1024),
    "mask_fg_pct": round(fg, 1), "bbox": bbox,
    "bbox_wh": [bbox[2] - bbox[0], bbox[3] - bbox[1]] if bbox else None,
    "bbox_covers_pct": round(100 * (bbox[3] - bbox[1]) / H, 1) if bbox else None,
}
(out_dir / "seg_result.json").write_text(json.dumps(res, indent=2))
print(json.dumps(res))
