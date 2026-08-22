#!/usr/bin/env python3
# L3 AUTO-RIG — REFERENCE / PROOF script (Phase 6).
#
# Closes the gap Phase 5 left open: turning an ARBITRARY drawn character into a
# rig with NO hand annotation, on CPU only (GPU=0, API cost 0). It is Animated
# Drawings' image_to_annotations with the TorchServe HTTP hop removed — it loads
# the SAME two MIT-licensed models AD ships (a drawn-humanoid MaskRCNN detector
# [mmdet 2.x] + a drawn-humanoid top-down pose estimator [mmpose 0.x]) directly
# with init_detector / init_pose_model on CPU, then builds AD's 15-joint skeleton
# from the 17 COCO keypoints exactly as AD does.
#
# MEASURED (2026-08-22, 4-core CPU): model load ~3.7 s once; then ~1.9 s
# detection + ~0.12 s pose PER character; peak RSS ~1.4 GB. Three distinct
# drawings auto-rigged with detector score >0.998 and keypoint confidence
# 0.87-0.91; all skeletons landed on the right body parts. See
# MOTION_GENERALIZATION.md for the end-to-end (2/3 clean walk) result and the
# post-render QC gate (`l3RenderQc` in src/lib/motionCost.ts).
#
# SETUP (CPU, no GPU) — the OpenMMLab 1.x generation on Python 3.10 + torch 1.13:
#   python3.10 -m venv venv && . venv/bin/activate
#   pip install torch==1.13.1 torchvision==0.14.1 numpy==1.23.5 \
#               opencv-python-headless==4.9.0.80 scipy pyyaml setuptools==65.7.0
#   # mmcv-full has NO reachable prebuilt CPU wheel here (download.openmmlab.com and
#   # download.pytorch.org are blocked by the container network policy), so build it
#   # from source against the installed torch:
#   MMCV_WITH_OPS=1 FORCE_CUDA=0 pip install mmcv-full==1.6.2 \
#       --no-binary mmcv-full --no-build-isolation
#   pip install mmdet==2.28.2 json_tricks munkres xtcocotools
#   pip install mmpose==0.29.0 --no-deps        # skip chumpy (3D-mesh only)
#   # rebuild xtcocotools against numpy 1.23.5 if it was wheel-built for numpy 2:
#   pip install --no-binary xtcocotools --force-reinstall --no-build-isolation \
#       --no-deps xtcocotools
#   # models (MIT weights): from github releases (reachable), unzip each .mar:
#   #   drawn_humanoid_detector.mar  -> <store>/unpack_drawn_humanoid_detector/
#   #   drawn_humanoid_pose_estimator.mar -> <store>/unpack_drawn_humanoid_pose_estimator/
#   # point AD_MODEL_STORE at <store>.
# RUN:
#   AD_MODEL_STORE=<store> python3 autorig_reference.py <img out> [<img out> ...]
#
# LICENSING: Animated Drawings code + weights are MIT (commercial-clean). No model
# weights are committed to git. This is a reference/proof script, NOT wired into
# the production Story Worker; it documents the method for a future L3 adapter.

import os
import sys
import json
import time
import resource
import logging
from pathlib import Path

import numpy as np
import cv2
import yaml
from scipy import ndimage

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")  # force CPU

MODEL_STORE = Path(os.environ.get("AD_MODEL_STORE", Path(__file__).parent / "model-store"))
DET_DIR = MODEL_STORE / "unpack_drawn_humanoid_detector"
POSE_DIR = MODEL_STORE / "unpack_drawn_humanoid_pose_estimator"


def segment(img):
    """Largest-contour silhouette (OpenCV port of AD's classical segmenter).
    NOTE: assumes a near-uniform light background; for stills without one, use a
    real segmenter (rembg / SAM) — the mask is not the auto-rig's novel output."""
    g = np.min(img, axis=2)
    g = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 115, 8)
    g = cv2.bitwise_not(g)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    g = cv2.morphologyEx(g, cv2.MORPH_CLOSE, k, iterations=2)
    g = cv2.morphologyEx(g, cv2.MORPH_DILATE, k, iterations=2)
    contours, _ = cv2.findContours(g, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        raise RuntimeError("no contour found in image")
    out = np.zeros(g.shape, np.uint8)
    cv2.fillPoly(out, [max(contours, key=cv2.contourArea)], 1)
    out = ndimage.binary_fill_holes(out).astype(int)
    return 255 * out.astype(np.uint8)


def skeleton_from_kpts(kpts):
    """COCO-17 keypoints -> AD 15-joint skeleton (identical mapping to AD)."""
    def mid(a, b): return [round(x) for x in (kpts[a] + kpts[b]) / 2]
    def at(a): return [round(x) for x in kpts[a]]
    return [
        {"loc": mid(11, 12), "name": "root", "parent": None},
        {"loc": mid(11, 12), "name": "hip", "parent": "root"},
        {"loc": mid(5, 6), "name": "torso", "parent": "hip"},
        {"loc": at(0), "name": "neck", "parent": "torso"},
        {"loc": at(6), "name": "right_shoulder", "parent": "torso"},
        {"loc": at(8), "name": "right_elbow", "parent": "right_shoulder"},
        {"loc": at(10), "name": "right_hand", "parent": "right_elbow"},
        {"loc": at(5), "name": "left_shoulder", "parent": "torso"},
        {"loc": at(7), "name": "left_elbow", "parent": "left_shoulder"},
        {"loc": at(9), "name": "left_hand", "parent": "left_elbow"},
        {"loc": at(12), "name": "right_hip", "parent": "root"},
        {"loc": at(14), "name": "right_knee", "parent": "right_hip"},
        {"loc": at(16), "name": "right_foot", "parent": "right_knee"},
        {"loc": at(11), "name": "left_hip", "parent": "root"},
        {"loc": at(13), "name": "left_knee", "parent": "left_hip"},
        {"loc": at(15), "name": "left_foot", "parent": "left_knee"},
    ]


_DET = None
_POSE = None


def load_models():
    global _DET, _POSE
    import torch  # noqa: F401
    from mmdet.apis import init_detector
    from mmpose.apis import init_pose_model
    # The detector config inits its backbone from open-mmlab:// (network-blocked
    # here); we load a full checkpoint so that init is dead weight — strip it.
    det_cfg = DET_DIR / "config.py"
    nopre = DET_DIR / "config_nopretrain.py"
    if not nopre.exists():
        txt = det_cfg.read_text().replace(
            "init_cfg=dict(\n            type='Pretrained',\n            checkpoint='open-mmlab://detectron2/resnet50_caffe'))",
            "init_cfg=None)")
        nopre.write_text(txt)
    _DET = init_detector(str(nopre), str(DET_DIR / "latest.pth"), device="cpu")
    _POSE = init_pose_model(str(POSE_DIR / "config.py"), str(POSE_DIR / "best_AP_epoch_72.pth"), device="cpu")


def autorig(img_fn, out_dir):
    from mmdet.apis import inference_detector
    from mmpose.apis import inference_top_down_pose_model
    outdir = Path(out_dir); outdir.mkdir(parents=True, exist_ok=True)
    img = cv2.imread(str(img_fn))
    if img is None or len(img.shape) != 3:
        raise RuntimeError(f"bad image {img_fn}")
    if np.max(img.shape) > 1000:
        s = 1000 / np.max(img.shape)
        img = cv2.resize(img, (round(s * img.shape[1]), round(s * img.shape[0])))
    cv2.imwrite(str(outdir / "image.png"), img)

    t0 = time.time()
    det = inference_detector(_DET, img)
    det_dt = time.time() - t0
    bbox_result = det[0] if isinstance(det, tuple) else det
    boxes = [b for class_result in bbox_result for b in class_result if float(b[4]) >= 0.5]
    if not boxes:
        raise RuntimeError("NO_HUMANOID_DETECTED")
    boxes.sort(key=lambda b: b[4], reverse=True)
    l, t, r, b = [round(float(x)) for x in boxes[0][:4]]
    det_score = float(boxes[0][4])
    # PAD the detector bbox (measured fix, generalization v2 2026-08-22): a
    # mask cut off at the crop border gives Animated Drawings' mesh builder
    # degenerate boundary geometry — every pathological render in the
    # 24-character corpus (5 solver hangs at 300-900s, the mother/princess
    # sliver collapses, the lampJinni fold) had its mask touching >=3 crop
    # edges, and re-rendering the SAME rigs with a 24px margin fixed 8 of 10.
    # Clean renders always sat clear of the border. Padding is cheap and
    # mandatory; clamp to the source image so tight framings stay valid.
    PAD = 24
    l2, t2 = max(0, l - PAD), max(0, t - PAD)
    r2, b2 = min(img.shape[1], r + PAD), min(img.shape[0], b + PAD)
    cropped = img[t2:b2, l2:r2]
    # Where the source image itself ran out, replicate-pad the shortfall so
    # the margin is GUARANTEED — the mask must never touch the crop border.
    cropped = cv2.copyMakeBorder(
        cropped,
        PAD - (t - t2), PAD - (b2 - b), PAD - (l - l2), PAD - (r2 - r),
        cv2.BORDER_REPLICATE,
    )
    mask = segment(cropped)
    # Belt-and-braces for source-cut subjects: the mask boundary must be a
    # closed contour strictly inside the crop, never on its border.
    mask[:2, :] = 0
    mask[-2:, :] = 0
    mask[:, :2] = 0
    mask[:, -2:] = 0

    person = [{"bbox": [0, 0, cropped.shape[1], cropped.shape[0]]}]
    t1 = time.time()
    pose_preds, _ = inference_top_down_pose_model(_POSE, cropped, person_results=person, format="xywh")
    pose_dt = time.time() - t1
    if not pose_preds:
        raise RuntimeError("NO_SKELETON")
    kp = np.array(pose_preds[0]["keypoints"])
    kpts = kp[:, :2]
    kconf = kp[:, 2] if kp.shape[1] > 2 else None
    skeleton = skeleton_from_kpts(kpts)

    char_cfg = {"skeleton": skeleton, "height": cropped.shape[0], "width": cropped.shape[1]}
    cv2.imwrite(str(outdir / "texture.png"), cv2.cvtColor(cropped, cv2.COLOR_BGR2BGRA))
    cv2.imwrite(str(outdir / "mask.png"), mask)
    (outdir / "char_cfg.yaml").write_text(yaml.dump(char_cfg))

    overlay = cropped.copy()
    for j in skeleton:
        x, y = j["loc"]
        cv2.circle(overlay, (int(x), int(y)), 4, (0, 0, 255), 4)
        cv2.putText(overlay, j["name"], (int(x), int(y + 12)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1, 2)
    cv2.imwrite(str(outdir / "joint_overlay.png"), overlay)

    return {
        "image": str(img_fn), "det_score": round(det_score, 4), "bbox": [l, t, r, b],
        "crop_wh": [cropped.shape[1], cropped.shape[0]],
        "kpt_conf_mean": round(float(np.mean(kconf)), 4) if kconf is not None else None,
        "kpt_conf_min": round(float(np.min(kconf)), 4) if kconf is not None else None,
        "det_seconds": round(det_dt, 2), "pose_seconds": round(pose_dt, 2), "out_dir": str(outdir),
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.ERROR)
    pairs = sys.argv[1:]  # img1 out1 img2 out2 ...
    assert pairs and len(pairs) % 2 == 0, "usage: autorig_reference.py <img out> [<img out> ...]"
    tL0 = time.time()
    load_models()
    results = {"model_load_seconds": round(time.time() - tL0, 1), "characters": []}
    for i in range(0, len(pairs), 2):
        try:
            r = autorig(pairs[i], pairs[i + 1]); r["status"] = "RIGGED"
        except Exception as e:  # noqa: BLE001
            r = {"image": pairs[i], "out_dir": pairs[i + 1], "status": "FAILED", "error": str(e)}
        results["characters"].append(r)
        print(json.dumps(r))
    ru = resource.getrusage(resource.RUSAGE_SELF)
    results["peak_rss_mb"] = round(ru.ru_maxrss / 1024)
    results["total_seconds"] = round(time.time() - tL0, 1)
    print("SUMMARY", json.dumps({k: results[k] for k in ("model_load_seconds", "peak_rss_mb", "total_seconds")}))
