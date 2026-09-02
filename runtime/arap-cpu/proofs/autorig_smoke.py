#!/usr/bin/env python3
"""PROOF: ENV A turns a real drawing into a real rig, end to end.

Runs in ENV A. Everything before this proves the stack IMPORTS; this proves
it WORKS — detector finds a humanoid, pose estimator finds joints, and the
character directory ENV B needs comes out the other side.

It also writes eligibility_input.json in the exact shape
src/lib/arapProvider.ts's AutorigArtifacts type names (bbox, mask{width,
height,data}, joints), so the eligibility measurement layer has a real
artifact to be tested against instead of a hand-written fixture. That is the
seam between this image and the routing code; emitting it here is what will
let the two be checked against each other without inventing numbers.

Floors are set below the measured reference (2026-08-22: 3 drawings rigged
at det score >0.998, keypoint confidence 0.87-0.91) with room for a
different subject, because a low score on a hard drawing is a routing
decision, not a broken image.
"""
import json
import os
import sys
from pathlib import Path

MIN_DET_SCORE = 0.50
MIN_KPT_CONF_MEAN = 0.30

sys.path.insert(0, os.environ.get("ONIQ_ARAP_SCRIPTS", "/opt/oniq/scripts"))
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
os.environ.setdefault("AD_MODEL_STORE", "/opt/oniq/model-store")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

import numpy as np  # noqa: E402
import cv2  # noqa: E402
import yaml  # noqa: E402
import autorig_reference as ar  # noqa: E402

AD = Path(os.environ.get("AD_DIR", "/opt/oniq/AnimatedDrawings"))
OUT = Path(os.environ.get("ONIQ_ARAP_OUT", "/work/autorig-smoke"))
src = Path(os.environ.get("ONIQ_ARAP_DRAWING", str(AD / "examples/drawings/garlic.png")))
if not src.is_file():
    cands = sorted((AD / "examples/drawings").glob("*.png"))
    if not cands:
        print(f"FAIL: no example drawing to rig under {AD / 'examples/drawings'}")
        sys.exit(1)
    src = cands[0]

print("rigging", src)
ar.load_models()
r = ar.autorig(str(src), str(OUT))
print("AUTORIG " + json.dumps(r))

fail = []
if r["det_score"] < MIN_DET_SCORE:
    fail.append(f"detector score {r['det_score']}, floor {MIN_DET_SCORE}")
if r["kpt_conf_mean"] is not None and r["kpt_conf_mean"] < MIN_KPT_CONF_MEAN:
    fail.append(f"keypoint confidence {r['kpt_conf_mean']}, floor {MIN_KPT_CONF_MEAN}")

for n in ("char_cfg.yaml", "texture.png", "mask.png", "joint_overlay.png"):
    if not (OUT / n).is_file():
        fail.append(f"the rig is missing {n}")

cfg_path = OUT / "char_cfg.yaml"
if cfg_path.is_file():
    cfg = yaml.safe_load(cfg_path.read_text())
    names = [j["name"] for j in cfg["skeleton"]]
    # AD's 15-joint skeleton, built from the 17 COCO keypoints. 16 entries:
    # root and hip share a location, which is AD's own shape, not a bug.
    if len(names) != 16:
        fail.append(f"skeleton has {len(names)} joints, AD's mapping yields 16")
    for need in ("root", "hip", "torso", "neck",
                 "left_shoulder", "right_shoulder",
                 "left_knee", "right_knee", "left_foot", "right_foot"):
        if need not in names:
            fail.append(f"skeleton is missing {need}")

    mask = cv2.imread(str(OUT / "mask.png"), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        fail.append("mask.png did not decode")
    else:
        fill = float((mask > 127).mean())
        print(f"MASK fill {fill:.4f} of the crop")
        if fill >= 0.999:
            fail.append("the mask is the whole crop (fill >= 0.999) — this is the "
                        "measured failure of AD's classical threshold segmenter on "
                        "painterly art, and means the silhouette is unusable")
        # The shape src/lib/arapProvider.ts's AutorigArtifacts names, written
        # through the ONE definition of it. The first version of this wrote
        # bbox as {x, y, width, height}; AutorigArtifacts is [l, t, r, b] and
        # computeEligibilityMetrics destructures a tuple, so every artifact
        # this image produced would have been rejected as "invalid bbox".
        from arap_artifacts import artifacts_record, write_record
        l, t, rr, bb = r["bbox"]
        write_record(OUT / "eligibility_input.json", artifacts_record(
            still_id=src.stem, candidate=0, primary=True,
            original_wh=(0, 0), working_wh=(0, 0), bbox_ltrb=(l, t, rr, bb),
            det_score=r["det_score"], det_count=1, mask_u8=mask,
            mask_source="classical", skeleton=cfg["skeleton"],
            kpt_conf_mean=r.get("kpt_conf_mean"), kpt_conf_min=r.get("kpt_conf_min"),
        ))
        print("WROTE", OUT / "eligibility_input.json")

if fail:
    for f in fail:
        print("FAIL:", f)
    sys.exit(1)
print("PROOF autorig: a real drawing rigged on CPU, skeleton and mask usable")
