#!/usr/bin/env python3
"""Step 11A — MEASURE the existing ARAP eligibility envelope on real stills.

Runs in ENV A inside the validated arap-cpu image, MOUNTED rather than baked
in, so the image under measurement stays the digest that was validated.

WHAT IT DOES, AND ONLY THAT. For every still in a directory it runs the
EXISTING pipeline — autorig_reference.py's detector and pose estimator, the
skeleton mapping, and the two silhouette masks the codebase already has —
and writes what came out, per detected character, in the exact shape
src/lib/arapProvider.ts reads. It decides nothing. There is no threshold in
this file; eligibility is computed afterwards, in TypeScript, by the same
two functions production would call.

THE ONE DEPARTURE FROM autorig(), stated plainly: autorig() keeps the single
highest-scoring detection and discards the rest. This keeps EVERY detection
at or above autorig()'s own 0.5 threshold, runs the identical crop → mask →
pose → skeleton sequence on each, and marks which one autorig() would have
chosen (`primary`). Nothing is scored differently; the secondaries are
detections the model already made and autorig() threw away. That is what
lets a multi-character still be measured instead of silently reduced to its
loudest figure.

TWO MASKS, BOTH RECORDED. The classical threshold mask is what
autorig_reference.py computes. The u2netp mask is what arapProvider.ts
records as MANDATORY ("mask: rembg-u2netp"), because the classical one
measured 100% fill on 6/6 painterly sheets. The artifact's mask is u2netp,
produced by running segment_reference.py exactly as it ships — as a
subprocess, on the crop — and the classical fill is kept beside it as
evidence. If u2netp produces nothing for a crop, that crop is recorded as
MISSING EVIDENCE, never quietly substituted.

usage: measure_eligibility.py <corpus_dir> <out_dir>
env:   ONIQ_CORPUS_ID (default: basename of corpus_dir)
       ONIQ_ARTIFACTS_LIB (dir holding arap_artifacts.py; default /opt/oniq/proofs)
       ONIQ_ARAP_SCRIPTS  (default /opt/oniq/scripts)
       AD_MODEL_STORE     (default /opt/oniq/model-store)
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPTS = Path(os.environ.get("ONIQ_ARAP_SCRIPTS", "/opt/oniq/scripts"))
ARTLIB = Path(os.environ.get("ONIQ_ARTIFACTS_LIB", "/opt/oniq/proofs"))
STORE = Path(os.environ.get("AD_MODEL_STORE", "/opt/oniq/model-store"))
os.environ.setdefault("AD_MODEL_STORE", str(STORE))
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
sys.path.insert(0, str(ARTLIB))
sys.path.insert(0, str(SCRIPTS))

import numpy as np  # noqa: E402
import cv2  # noqa: E402
import autorig_reference as ar  # noqa: E402
from arap_artifacts import artifacts_record, mask_fill_pct, missing_record, write_record  # noqa: E402

DET_THRESHOLD = 0.5  # autorig_reference.py's own; not a new number
U2NETP = STORE / "u2netp.onnx"
EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def working_image(path: Path):
    """The exact downsize autorig_reference.py applies before detecting."""
    img = cv2.imread(str(path))
    if img is None or len(img.shape) != 3:
        return None, None
    oh, ow = img.shape[:2]
    if np.max(img.shape) > 1000:
        s = 1000 / np.max(img.shape)
        img = cv2.resize(img, (round(s * img.shape[1]), round(s * img.shape[0])))
    return img, (ow, oh)


def u2netp_mask(crop_bgr, workdir: Path):
    """The provider-mandated silhouette, from segment_reference.py AS SHIPPED.

    Run as a subprocess on the crop so the code path is the file in the
    repository, not a copy of it that can drift.
    """
    crop_p = workdir / "crop.png"
    out_d = workdir / "u2"
    cv2.imwrite(str(crop_p), crop_bgr)
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "segment_reference.py"), str(U2NETP), str(crop_p), str(out_d)],
        capture_output=True, text=True, timeout=300,
    )
    mask_p = out_d / "mask.png"
    if proc.returncode != 0 or not mask_p.is_file():
        return None, (proc.stderr or proc.stdout)[-300:]
    m = cv2.imread(str(mask_p), cv2.IMREAD_GRAYSCALE)
    return m, None


def measure_still(path: Path, out_dir: Path, corpus_id: str) -> list:
    still_id = path.stem
    img, original_wh = working_image(path)
    if img is None:
        return [missing_record(still_id=still_id, original_wh=(0, 0), working_wh=(0, 0), reason="UNREADABLE_IMAGE")]
    working_wh = (img.shape[1], img.shape[0])

    from mmdet.apis import inference_detector
    from mmpose.apis import inference_top_down_pose_model

    t0 = time.time()
    det = inference_detector(ar._DET, img)
    det_s = time.time() - t0
    bbox_result = det[0] if isinstance(det, tuple) else det
    boxes = [b for class_result in bbox_result for b in class_result if float(b[4]) >= DET_THRESHOLD]
    boxes.sort(key=lambda b: float(b[4]), reverse=True)
    if not boxes:
        return [missing_record(
            still_id=still_id, original_wh=original_wh, working_wh=working_wh,
            reason="NO_HUMANOID_DETECTED", det_count=0, evidence={"det_seconds": round(det_s, 2)},
        )]

    records = []
    for idx, box in enumerate(boxes):
        l, t, r, b = [round(float(x)) for x in box[:4]]
        det_score = float(box[4])
        cropped = img[t:b, l:r]
        if cropped.size == 0:
            records.append(missing_record(
                still_id=still_id, original_wh=original_wh, working_wh=working_wh,
                reason="EMPTY_CROP", candidate=idx, det_count=len(boxes),
                evidence={"det_score": round(det_score, 4), "bbox": [l, t, r, b]},
            ))
            continue

        # The classical mask autorig_reference.py computes — evidence only.
        try:
            classical = ar.segment(cropped)
            classical_fill = mask_fill_pct(classical)
        except Exception as e:  # noqa: BLE001
            classical_fill = None
            classical_err = str(e)[:120]
        else:
            classical_err = None

        # The provider-mandated mask.
        with tempfile.TemporaryDirectory() as td:
            u2, u2_err = u2netp_mask(cropped, Path(td))

        # Pose on the crop, exactly as autorig() does it.
        person = [{"bbox": [0, 0, cropped.shape[1], cropped.shape[0]]}]
        pose_preds, _ = inference_top_down_pose_model(ar._POSE, cropped, person_results=person, format="xywh")
        if not pose_preds:
            records.append(missing_record(
                still_id=still_id, original_wh=original_wh, working_wh=working_wh,
                reason="NO_SKELETON", candidate=idx, det_count=len(boxes),
                evidence={"det_score": round(det_score, 4), "bbox": [l, t, r, b],
                          "classical_fill_pct": classical_fill, "u2netp_error": u2_err},
            ))
            continue
        kp = np.array(pose_preds[0]["keypoints"])
        kconf = kp[:, 2] if kp.shape[1] > 2 else None
        skeleton = ar.skeleton_from_kpts(kp[:, :2])

        if u2 is None:
            records.append(missing_record(
                still_id=still_id, original_wh=original_wh, working_wh=working_wh,
                reason="U2NETP_MASK_FAILED", candidate=idx, det_count=len(boxes),
                evidence={"det_score": round(det_score, 4), "bbox": [l, t, r, b],
                          "kpt_conf_mean": None if kconf is None else round(float(np.mean(kconf)), 4),
                          "classical_fill_pct": classical_fill, "classical_error": classical_err,
                          "u2netp_error": u2_err},
            ))
            continue

        rec = artifacts_record(
            still_id=still_id, candidate=idx, primary=(idx == 0),
            original_wh=original_wh, working_wh=working_wh, bbox_ltrb=(l, t, r, b),
            det_score=det_score, det_count=len(boxes), mask_u8=u2, mask_source="u2netp",
            skeleton=skeleton,
            kpt_conf_mean=None if kconf is None else float(np.mean(kconf)),
            kpt_conf_min=None if kconf is None else float(np.min(kconf)),
            classical_fill_pct=classical_fill,
        )
        rec["evidence"]["det_seconds"] = round(det_s, 2)
        if classical_err:
            rec["evidence"]["classical_error"] = classical_err
        records.append(rec)

        # Keep the pictures beside the numbers, so a surprising number can be
        # looked at. Never read back by anything.
        cdir = out_dir / "crops" / f"{still_id}-{idx:02d}"
        cdir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(cdir / "crop.png"), cropped)
        cv2.imwrite(str(cdir / "mask_u2netp.png"), u2)
        if classical_fill is not None:
            cv2.imwrite(str(cdir / "mask_classical.png"), classical)
    return records


def main(argv) -> int:
    if len(argv) != 3:
        print("usage: measure_eligibility.py <corpus_dir> <out_dir>")
        return 2
    corpus = Path(argv[1]); out = Path(argv[2])
    corpus_id = os.environ.get("ONIQ_CORPUS_ID", corpus.name)
    out.mkdir(parents=True, exist_ok=True)
    stills = sorted(p for p in corpus.iterdir() if p.suffix.lower() in EXTS)
    if not stills:
        (out / "manifest.json").write_text(json.dumps({
            "corpus_id": corpus_id, "stills": [], "records": [],
            "missing_evidence": "EMPTY_CORPUS — no image files in the corpus directory",
        }, indent=2) + "\n")
        print("MEASURE: EMPTY_CORPUS — nothing to measure; wrote a manifest that says so")
        return 0

    t0 = time.time()
    ar.load_models()
    load_s = time.time() - t0

    all_records, still_index = [], []
    for p in stills:
        recs = measure_still(p, out, corpus_id)
        for r in recs:
            r["corpus_id"] = corpus_id
            r["source_sha256"] = sha256_file(p)
            r["source_file"] = p.name
        all_records.extend(recs)
        still_index.append({"still_id": p.stem, "file": p.name, "sha256": sha256_file(p), "candidates": len(recs)})
        kinds = ",".join("missing:" + r["missing_evidence"] if "missing_evidence" in r else "artifact" for r in recs)
        print(f"STILL {p.name}: {len(recs)} record(s) [{kinds}]")

    recs_dir = out / "records"; recs_dir.mkdir(exist_ok=True)
    for r in all_records:
        name = f"{r['still_id']}-{'x' if r.get('candidate') is None else '%02d' % r['candidate']}.json"
        write_record(recs_dir / name, r)

    manifest = {
        "corpus_id": corpus_id,
        "measured_at_unix": int(time.time()),
        "model_load_seconds": round(load_s, 1),
        "detector_threshold": DET_THRESHOLD,
        "mask_in_artifact": "u2netp",
        "stills": still_index,
        "record_files": sorted(p.name for p in recs_dir.iterdir()),
        "instrument": "runtime/arap-cpu/measure/measure_eligibility.py",
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    n_art = sum(1 for r in all_records if "artifacts" in r)
    n_miss = len(all_records) - n_art
    print(f"MEASURE: {len(stills)} still(s), {len(all_records)} record(s): {n_art} with artifacts, {n_miss} missing-evidence")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
