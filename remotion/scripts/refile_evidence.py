#!/usr/bin/env python3
"""Immutable evidence re-filing.

The 21 REJECTED + 1 OPEN records are EVIDENCE. They are never renamed,
overwritten or deleted. Instead each keeps its original id, value, parameter,
status and provenance, and — only where a corrected interpretation is directly
reproduced from a measurement that exists — a SEPARATE derived record is created
that points back at it via derivedFromOriginalId.

Result: original evidence AND corrected interpretation, both readable, never one
replacing the other. A record with no reproducible measurement gets no derived
record at all; it stays rejected with the reason, which is the honest outcome.

usage: refile_evidence.py <numeric_lib.json> <measurement_results.json> <out_dir>
"""
import hashlib
import json
import sys
from pathlib import Path

# Maps an original record to the measurement that actually produced its value.
# key = original id; value = (corrected parameter, measurement lookup, why).
# The lookup is (source_clip, measurement parameter) into the measurement
# results, so the derived value is REPRODUCED, never retyped from the report.
REFILE = {
    "CHAR-ENG-0024": ("clip_duration_seconds", None,
                      "4.26 s is the corrected clip's playing duration. The "
                      "corrected render took 8.2 s wall. Duration is already "
                      "correctly filed at CHAR-ENG-0860, so this is a duplicate "
                      "of a correct record under a wrong name."),
    "CHAR-ENG-0801": ("foot_slide_max_left", ("corrected_knee050", "foot_slide_max_left"),
                      "1.36 is the left planted-foot maximum per-frame travel"),
    "CHAR-ENG-0802": ("foot_slide_max_right", ("corrected_knee050", "foot_slide_max_right"),
                      "0.39 is the right planted-foot maximum per-frame travel"),
    "CHAR-ENG-0803": ("centroid_drift_y", ("corrected_knee050", "centroid_drift_y"),
                      "16.2 px is the vertical centroid drift range"),
    "CHAR-ENG-0901": ("silhouette_overlap_max", ("corrected_knee050", "silhouette_overlap_max"),
                      "0.906 is the corrected maximum silhouette overlap"),
    "CHAR-ENG-0902": ("two_leg_fraction_min", ("corrected_knee050", "two_leg_fraction_min"),
                      "0.095 is the corrected minimum two-leg fraction"),
    "CHAR-ENG-0903": ("leg_gap_min", ("corrected_knee050", "leg_gap_min_min"),
                      "2 px is the minimum gap between the legs"),
    "CHAR-ENG-0904": ("frames_iou_below_090_corrected",
                      ("corrected_knee050", "frames_iou_below_090"),
                      "17 is a COUNT of frames with IoU < 0.90, not a sway distance"),
    "CHAR-ENG-0911": ("silhouette_overlap_max_control",
                      ("control_undamped", "silhouette_overlap_max"),
                      "0.898 is the CONTROL maximum silhouette overlap"),
    "CHAR-ENG-0912": ("two_leg_fraction_min_control",
                      ("control_undamped", "two_leg_fraction_min"),
                      "0.102 is the CONTROL minimum two-leg fraction"),
    "CHAR-ENG-0913": ("leg_gap_min_control", ("control_undamped", "leg_gap_min_min"),
                      "2 px is the control minimum gap between the legs"),
    "CHAR-ENG-0914": ("frames_iou_below_090_control",
                      ("control_undamped", "frames_iou_below_090"),
                      "11 is a COUNT of control frames with IoU < 0.90"),
    # --- the eight knee records: side AND frame corrected, values reproduced
    "CHAR-ENG-0905": ("knee_min_interior_angle_right_corrected",
                      ("corrected_knee050", "knee_angle_min_right"),
                      "140.0 deg is the RIGHT knee minimum at frame 101, not a "
                      "left-knee peak. The library's L label is INVERTED."),
    "CHAR-ENG-0916": ("knee_min_interior_angle_left_corrected",
                      ("corrected_knee050", "knee_angle_min_left"),
                      "147.2 deg is the LEFT knee minimum at frame 126, not a "
                      "right-knee peak. The library's R label is INVERTED."),
    "CHAR-ENG-0925": ("knee_min_interior_angle_right_control",
                      ("control_undamped", "knee_angle_min_right"),
                      "112.3 deg is the CONTROL RIGHT knee minimum at frame 101"),
    "CHAR-ENG-0936": ("knee_min_interior_angle_left_control",
                      ("control_undamped", "knee_angle_min_left"),
                      "115.7 deg is the CONTROL LEFT knee minimum at frame 126"),
    # --- no derived record: value is a per-frame minimum across BOTH knees at a
    #     frame that is not either knee's extremum, so no correctly-named
    #     parameter reproduces it.
    "CHAR-ENG-0906": (None, None,
                      "140.4 deg is the per-frame minimum across BOTH knees at "
                      "frame 100. Frame 100 is not the extremum of either knee, "
                      "so no per-knee parameter reproduces this value. NO derived "
                      "record is created — the number is real but names nothing "
                      "ONIQ measures."),
    "CHAR-ENG-0915": (None, None,
                      "141.0 deg is the per-frame minimum across both knees at "
                      "frame 102. Not an extremum of either knee. NO derived record."),
    "CHAR-ENG-0926": (None, None,
                      "113.1 deg is the control per-frame minimum across both "
                      "knees at frame 100. Not an extremum. NO derived record."),
    "CHAR-ENG-0935": (None, None,
                      "114.3 deg is the control per-frame minimum across both "
                      "knees at frame 102. Not an extremum. NO derived record."),
    "CHAR-ENG-0951": ("knee_damping_scale", None,
                      "0.50 is the KNEE DAMPING CONSTANT, filed under "
                      "motion_limits as spine_flex. It must never act as a spine "
                      "limit. Already correctly held as an ENFORCED engineering "
                      "rule at ENG-0153, so no new derived record is minted here."),
    "CHAR-ENG-0003": (None, None,
                      "NOT_SPECIFIED encoded as the number 0, and four "
                      "independent quantities (lens, FOV, height, distance) "
                      "conflated into one record. ONIQ measures none of them, so "
                      "there is nothing to derive. Stays OPEN."),
}

# Side/frame corrections the knee re-filing must carry explicitly.
KNEE_SIDE = {
    "CHAR-ENG-0905": ("RIGHT", 101, "CORRECTED"),
    "CHAR-ENG-0916": ("LEFT", 126, "CORRECTED"),
    "CHAR-ENG-0925": ("RIGHT", 101, "CONTROL"),
    "CHAR-ENG-0936": ("LEFT", 126, "CONTROL"),
}


def main():
    lib_p, meas_p, outd = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    outd.mkdir(parents=True, exist_ok=True)
    lib = json.loads(lib_p.read_text())
    recs = {r["id"]: r for r in lib["records"]}
    meas = json.loads(meas_p.read_text())["measurements"]
    by = {(m["source_clip"], m["parameter"]): m for m in meas}

    originals, derived, unrefiled = [], [], []
    dn = 0
    for oid, (param, lookup, why) in REFILE.items():
        r = recs[oid]
        originals.append({
            "originalId": oid,
            "originalParameter": r["parameter"],
            "originalValue": r["value"],
            "originalUnit": r["unit"],
            "originalStatus": r["status"],
            "originalProvenance": r["provenance"],
            "rejectionReason": r["note"],
            "immutable": True,
        })
        if param is None or lookup is None:
            unrefiled.append({"originalId": oid, "reason": why,
                              "derivedRecordCreated": False})
            continue
        m = by.get(lookup)
        if m is None:
            unrefiled.append({"originalId": oid,
                              "reason": f"no measurement {lookup} exists to reproduce it",
                              "derivedRecordCreated": False})
            continue
        # the derived value must REPRODUCE the original within tolerance
        try:
            agrees = abs(float(m["value"]) - float(r["value"])) <= 0.06
        except (TypeError, ValueError):
            agrees = False
        dn += 1
        d = {
            "derivedId": f"CHAR-DER-{dn:04d}",
            "derivedFromOriginalId": oid,
            "sourceOriginalId": oid,
            "correctedParameter": param,
            "value": m["value"],
            "unit": m["unit"],
            "measurementDomain": m["measurement_domain"],
            "measurementMethod": m["method"],
            "sourceClip": m["source_clip"],
            "sourceFrames": [m["frame_start"], m["frame_end"]],
            "evidenceSha256": m["evidence_sha256"],
            "validationState": "MEASURED" if agrees else "OPEN",
            "derivationReason": why,
            "reproducesOriginalValue": agrees,
            "originalValue": r["value"],
            "productionEligible": False,
        }
        if oid in KNEE_SIDE:
            side, frame, clip = KNEE_SIDE[oid]
            d.update({"kneeSide": side, "frame": frame, "clip": clip,
                      "measurementType": "MIN_INTERIOR_ANGLE",
                      "sideCorrection": "LABEL_INVERTED_IN_ORIGINAL"
                                        if side in ("LEFT", "RIGHT") else None})
        derived.append(d)

    (outd / "ENGINEERING_EVIDENCE_REFILE_MAP.json").write_text(json.dumps({
        "record": "ENGINEERING_EVIDENCE_REFILE_MAP", "version": "1.0",
        "rule": "original evidence is immutable; corrections are SEPARATE derived "
                "records that point back via derivedFromOriginalId",
        "source_library": lib_p.name,
        "source_library_sha256": hashlib.sha256(lib_p.read_bytes()).hexdigest(),
        "originals_preserved": len(originals),
        "derived_created": len(derived),
        "no_derived_record": len(unrefiled),
        "originals": originals,
        "not_refiled": unrefiled,
    }, indent=1))
    (outd / "ENGINEERING_DERIVED_MEASUREMENTS.json").write_text(json.dumps({
        "record": "ENGINEERING_DERIVED_MEASUREMENTS", "version": "1.0",
        "count": len(derived), "productionEligible_total": 0,
        "derived": derived,
    }, indent=1))
    print(f"  originals preserved      {len(originals)}")
    print(f"  derived records created  {len(derived)}")
    print(f"  deliberately not refiled {len(unrefiled)}")
    for d in derived:
        flag = "" if d["reproducesOriginalValue"] else "  <-- value does NOT reproduce"
        side = f" [{d.get('kneeSide')} f{d.get('frame')}]" if "kneeSide" in d else ""
        print(f"    {d['derivedId']} <- {d['sourceOriginalId']}  "
              f"{d['correctedParameter']}{side} = {d['value']}{flag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
