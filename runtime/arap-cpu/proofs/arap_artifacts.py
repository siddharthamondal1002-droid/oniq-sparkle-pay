#!/usr/bin/env python3
"""The auto-rig's outputs, written in the shape the routing code reads.

TORCH-FREE ON PURPOSE. Everything here is numpy and json, so it can be run
and tested on any machine — including the one that authored it, which
cannot import torch — and so the JSON contract between the Python side and
src/lib/arapProvider.ts can be pinned by a test rather than by hope.

WHY THIS EXISTS. autorig_smoke.py wrote eligibility_input.json with
`bbox: {x, y, width, height}`. arapProvider.ts's AutorigArtifacts declares
`bbox: [left, top, right, bottom]`, and computeEligibilityMetrics destructures
it as a tuple — so every artifact the image produced would have been
rejected as "invalid bbox (non-finite bounds)". The seam between the runtime
and the routing code was broken, and nothing noticed because nothing had yet
carried a real artifact across it. This module is that seam, with one
definition of the shape.

The shape (mirrors AutorigArtifacts exactly):
  artifacts.bbox    [l, t, r, b] in WORKING-image pixels (see below)
  artifacts.mask    {width, height, data: 0/1 row-major, bbox-local}
  artifacts.joints  {name: {x, y}} in bbox-local pixels
plus evidence the detector and pose stages already produce, kept beside the
artifacts and never mixed into them.

WORKING IMAGE. autorig_reference.py downsizes anything whose long side
exceeds 1000 px before detecting. Every pixel value here is in THAT frame,
and the record carries both the original and the working dimensions so a
reader can tell which it is looking at.
"""
import json
from pathlib import Path

import numpy as np


def mask_fill_pct(mask_u8) -> float:
    """Foreground fraction of a bbox-local mask, in percent."""
    m = np.asarray(mask_u8)
    if m.size == 0:
        return 0.0
    return float((m > 127).mean() * 100.0)


def artifacts_record(
    *,
    still_id: str,
    candidate: int,
    primary: bool,
    original_wh,
    working_wh,
    bbox_ltrb,
    det_score: float,
    det_count: int,
    mask_u8,
    mask_source: str,
    skeleton,
    kpt_conf_mean=None,
    kpt_conf_min=None,
    classical_fill_pct=None,
) -> dict:
    l, t, r, b = (int(v) for v in bbox_ltrb)
    m = np.asarray(mask_u8)
    if m.ndim != 2:
        raise ValueError(f"mask must be 2-D, got shape {m.shape}")
    return {
        "still_id": still_id,
        "candidate": int(candidate),
        "primary": bool(primary),
        "image": {
            "original": {"width": int(original_wh[0]), "height": int(original_wh[1])},
            "working": {"width": int(working_wh[0]), "height": int(working_wh[1])},
        },
        "artifacts": {
            # THE TUPLE, not an object. computeEligibilityMetrics destructures it.
            "bbox": [l, t, r, b],
            # DECLARED, because [0, 0, 100, 100] reads as l,t,r,b and as x,y,w,h
            # equally well. The TypeScript normalizer refuses a bare array that
            # does not say which, so the writer always says.
            "bbox_format": "ltrb",
            "bbox_frame": "working",
            "mask": {
                "width": int(m.shape[1]),
                "height": int(m.shape[0]),
                "data": (m > 127).astype(np.uint8).flatten().tolist(),
            },
            "joints": {j["name"]: {"x": float(j["loc"][0]), "y": float(j["loc"][1])} for j in skeleton},
        },
        "evidence": {
            "det_score": round(float(det_score), 4),
            "det_count": int(det_count),
            "kpt_conf_mean": None if kpt_conf_mean is None else round(float(kpt_conf_mean), 4),
            "kpt_conf_min": None if kpt_conf_min is None else round(float(kpt_conf_min), 4),
            "mask_source": mask_source,
            "mask_fill_pct": round(mask_fill_pct(m), 2),
            "classical_fill_pct": None if classical_fill_pct is None else round(float(classical_fill_pct), 2),
            "crop_wh": [r - l, b - t],
        },
    }


def missing_record(*, still_id: str, original_wh, working_wh, reason: str, candidate=None, det_count=0, evidence=None) -> dict:
    """A still, or a candidate, that produced no usable artifact.

    FAILS CLOSED BY SHAPE: there is no `artifacts` key at all, so nothing
    downstream can mistake it for a measurement. The reason is the exact
    string the pipeline raised or the stage that produced nothing.
    """
    return {
        "still_id": still_id,
        "candidate": candidate,
        "primary": False,
        "image": {
            "original": {"width": int(original_wh[0]), "height": int(original_wh[1])},
            "working": {"width": int(working_wh[0]), "height": int(working_wh[1])},
        },
        "missing_evidence": reason,
        "evidence": {"det_count": int(det_count), **(evidence or {})},
    }


def write_record(path, record: dict) -> None:
    Path(path).write_text(json.dumps(record) + "\n")
