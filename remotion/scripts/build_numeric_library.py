#!/usr/bin/env python3
"""Reconcile the 1,000-record character engineering numeric library.

Takes the supplied REPORT_UPDATED library and turns it into a typed, provenance-
carrying layer WITHOUT promoting anything. The single job of this script is to
decide, per record, what is actually known:

  MEASURED     the value AND the parameter it is filed under both agree with a
               measurement that exists in the knee-pixel validation evidence
  REJECTED     the value traces to a real measurement, but the parameter name
               describes a DIFFERENT quantity. The number is not wrong; the
               label is. Never a gate, and never silently renamed.
  OPEN         claims SOURCE_LOCKED but cannot be tied to a measured number
  UNVALIDATED  CANDIDATE_TARGET — an engineering candidate, nothing more

productionEligible is true for NOTHING here. Promotion is a separate, evidence-
gated act (see ENGINEERING_NUMERIC_PROMOTION_POLICY.md); a number existing has
never been a reason to enforce it.

usage: build_numeric_library.py <source.json> <out_dir>
"""
import csv
import hashlib
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# The measurements this session actually produced. Each entry is
# (value, tolerance, what the number IS). A SOURCE_LOCKED record is MEASURED
# only if its value matches one of these AND its parameter names that quantity.
# ---------------------------------------------------------------------------
MEASURED = {
    "render_resolution_width": (500, 0, "render canvas width, px"),
    "render_resolution_height": (500, 0, "render canvas height, px"),
    "knee_channels_modified": (6, 0, "knee rotation channels damped"),
    "knees_damped_symmetrically": (1, 0, "both knees damped by the same scale"),
    "frames_below_120_control": (9, 0, "control frames with knee < 120 deg"),
    "frames_below_120_corrected": (0, 0, "corrected frames with knee < 120 deg"),
    "frames_below_140_control": (27, 0, "control frames with knee < 140 deg"),
    "frames_below_140_corrected": (0, 0, "corrected frames with knee < 140 deg"),
    "max_crossing_frame_control": (52, 0, "control max-crossing frame index"),
    "max_crossing_frame_corrected": (52, 0, "corrected max-crossing frame index"),
    "worst_corrected_iou": (0.838, 0.001, "worst centroid-aligned frame-to-frame IoU"),
    "corrected_frames_iou_below_090": (17, 0, "corrected frames with IoU < 0.90"),
    "control_frames_iou_below_090": (11, 0, "control frames with IoU < 0.90"),
    "min_leg_gap_control": (2, 0, "control minimum gap between legs, px"),
    "min_leg_gap_corrected": (2, 0, "corrected minimum gap between legs, px"),
    "control_render_time": (8.1, 0.05, "control render wall time, s"),
    "api_spend_inr": (0, 0, "API spend"),
    "gpu_spend_inr": (0, 0, "GPU spend"),
    "new_references": (0, 0, "new reference images generated"),
    "lighting_rendered": (0, 0, "lighting was NOT rendered (plan only)"),
    "scene_rendered": (0, 0, "scene was NOT rendered (plan only)"),
    "compositing_executed": (0, 0, "compositing was NOT run"),
    "cycle_frames_01": (129, 0, "configured/rendered frame window"),
    "duration_01": (4.26, 0.01, "corrected clip duration, s"),
}

# Values that ARE measured but are filed under a parameter naming something else.
# id -> (what the number really is, why the label does not fit)
MISFILED = {
    "CHAR-ENG-0024": ("corrected clip DURATION 4.26 s",
                      "filed as corrected_render_time; the corrected render took "
                      "8.2 s wall, 4.26 s is the clip's playing duration"),
    "CHAR-ENG-0801": ("foot-slide, left: max per-frame planted-foot travel 1.36 BVH units",
                      "filed as support_width; no support width was measured"),
    "CHAR-ENG-0802": ("foot-slide, right: max per-frame planted-foot travel 0.39 BVH units",
                      "filed as support_length; no support length was measured"),
    "CHAR-ENG-0803": ("vertical centroid drift range 16.2 px over 129 frames",
                      "filed as foot_contact_area; no contact area was measured"),
    "CHAR-ENG-0901": ("corrected MAX SILHOUETTE OVERLAP 0.906",
                      "filed as stride_length; no stride length was measured"),
    "CHAR-ENG-0902": ("corrected MIN TWO-LEG FRACTION 0.095",
                      "filed as step_length; no step length was measured"),
    "CHAR-ENG-0903": ("minimum leg gap 2 px",
                      "filed as pelvis_bob; no pelvis bob was measured"),
    "CHAR-ENG-0904": ("corrected frames with IoU < 0.90 = 17",
                      "filed as pelvis_sway; a frame COUNT is not a sway distance"),
    "CHAR-ENG-0905": ("corrected minimum knee interior angle at frame 101 = 140.0 deg",
                      "filed as knee_peak_L; it is a per-FRAME minimum across both "
                      "knees, not a left-knee peak"),
    "CHAR-ENG-0906": ("corrected minimum knee interior angle at frame 100 = 140.4 deg",
                      "filed as knee_peak_R; it is frame 100, not the right knee"),
    "CHAR-ENG-0911": ("control MAX SILHOUETTE OVERLAP 0.898",
                      "filed as stride_length"),
    "CHAR-ENG-0912": ("control MIN TWO-LEG FRACTION 0.102",
                      "filed as step_length"),
    "CHAR-ENG-0913": ("minimum leg gap 2 px", "filed as pelvis_bob"),
    "CHAR-ENG-0914": ("control frames with IoU < 0.90 = 11", "filed as pelvis_sway"),
    "CHAR-ENG-0915": ("corrected knee angle at frame 102 = 141.0 deg",
                      "filed as knee_peak_L_02; it is frame 102"),
    "CHAR-ENG-0916": ("corrected knee angle at frame 126 = 147.2 deg",
                      "filed as knee_peak_R_02; it is frame 126"),
    "CHAR-ENG-0925": ("CONTROL knee angle at frame 101 = 112.3 deg",
                      "filed as knee_peak_L_03; it is a control-clip frame value"),
    "CHAR-ENG-0926": ("CONTROL knee angle at frame 100 = 113.1 deg",
                      "filed as knee_peak_R_03"),
    "CHAR-ENG-0935": ("CONTROL knee angle at frame 102 = 114.3 deg",
                      "filed as knee_peak_L_04"),
    "CHAR-ENG-0936": ("CONTROL knee angle at frame 126 = 115.7 deg",
                      "filed as knee_peak_R_04"),
    "CHAR-ENG-0951": ("KNEE DAMPING SCALE 0.50",
                      "filed under motion_limits as spine_flex; it is the knee "
                      "damping constant and must never act as a spine limit"),
}

# NOT_SPECIFIED must never be encoded as a number.
NOT_SPECIFIED_IDS = {"CHAR-ENG-0003"}

CATEGORIES_REQUIRED = [
    "overall_proportions", "head_cranium", "face", "neck_shoulders",
    "torso_ribcage", "pelvis_hips", "upper_arm", "forearm", "hand", "fingers",
    "thigh", "lower_leg", "foot", "joints", "spine_posture", "center_of_mass",
    "balance_contact", "gait_timing", "gait_kinematics", "motion_limits",
]


def classify(rec):
    rid, p, v = rec["id"], rec["parameter"], rec["value"]
    if rid in NOT_SPECIFIED_IDS:
        return ("OPEN", False,
                "the library encodes NOT_SPECIFIED as the number 0. Lens, FOV, "
                "camera height and camera distance are NOT measured by ONIQ; a "
                "numeric 0 would read as a real value downstream. Carried as "
                "NOT_SPECIFIED, never as 0.")
    if rid in MISFILED:
        truth, why = MISFILED[rid]
        return ("REJECTED", False,
                f"value traces to a real measurement ({truth}) but the parameter "
                f"name does not describe it: {why}. Not renamed, not promoted.")
    if rec["status"] == "SOURCE_LOCKED":
        if p in MEASURED:
            want, tol, what = MEASURED[p]
            if abs(float(v) - float(want)) <= tol:
                return ("MEASURED", False,
                        f"matches measured evidence: {what} = {want}")
            return ("OPEN", False,
                    f"claims SOURCE_LOCKED but value {v} does not match the "
                    f"measured {what} = {want}")
        return ("OPEN", False,
                "claims SOURCE_LOCKED but no measurement in the knee-pixel "
                "validation evidence corresponds to this parameter")
    return ("UNVALIDATED", False,
            "CANDIDATE_TARGET: engineering candidate only, not measured by ONIQ "
            "and not a production gate")


def main():
    src, outd = Path(sys.argv[1]), Path(sys.argv[2])
    outd.mkdir(parents=True, exist_ok=True)
    raw = json.loads(src.read_text())
    src_sha = hashlib.sha256(src.read_bytes()).hexdigest()
    recs = raw["records"]

    out, prov = [], []
    for r in recs:
        state, eligible, why = classify(r)
        value = "NOT_SPECIFIED" if r["id"] in NOT_SPECIFIED_IDS else r["value"]
        unit = r["unit"]
        rec = {
            "id": r["id"],
            "category": r["category"],
            "parameter": r["parameter"],
            "value": value,
            "unit": unit,
            "status": r["status"],
            "source": r["source"],
            "provenance": {
                "source_document": src.name,
                "source_sha256": src_sha,
                "source_field": "records[]",
                "supported_by": ("ONIQ knee-pixel validation evidence"
                                 if state == "MEASURED" else None),
            },
            "validationState": state,
            "productionEligible": eligible,
            "note": why,
        }
        out.append(rec)
        if state in ("MEASURED", "REJECTED", "OPEN"):
            prov.append({"id": r["id"], "parameter": r["parameter"],
                         "value": value, "validationState": state, "note": why})

    lib = {
        "library": "ONIQ_CHARACTER_ENGINEERING_NUMERIC_LIBRARY",
        "version": "1.0",
        "source_document": src.name,
        "source_sha256": src_sha,
        "total_records": len(out),
        "generation_allowed": False,
        "production_enabled": False,
        "invariants": [
            "productionEligible is false for every record in this build",
            "a CANDIDATE_TARGET can never become a gate without passing the "
            "promotion hierarchy",
            "NOT_SPECIFIED is preserved as NOT_SPECIFIED, never as 0",
            "measured values filed under the wrong parameter are REJECTED for "
            "that parameter and never silently renamed",
        ],
        "records": out,
    }
    (outd / "ENGINEERING_NUMERIC_LIBRARY.json").write_text(json.dumps(lib, indent=1))

    with (outd / "ENGINEERING_NUMERIC_LIBRARY.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "category", "parameter", "value", "unit", "status",
                    "validationState", "productionEligible", "source", "note"])
        for r in out:
            w.writerow([r["id"], r["category"], r["parameter"], r["value"], r["unit"],
                        r["status"], r["validationState"], r["productionEligible"],
                        r["source"], r["note"]])

    (outd / "ENGINEERING_NUMERIC_PROVENANCE.json").write_text(json.dumps({
        "record": "ENGINEERING_NUMERIC_PROVENANCE", "version": "1.0",
        "source_document": src.name, "source_sha256": src_sha,
        "measured_facts_used_as_the_authority": MEASURED,
        "misfiled_measured_values": MISFILED,
        "not_specified_ids": sorted(NOT_SPECIFIED_IDS),
        "entries": prov,
    }, indent=1))

    tally = {}
    for r in out:
        tally[r["validationState"]] = tally.get(r["validationState"], 0) + 1
    summary = {
        "TOTAL_RECORDS": len(out),
        "SOURCE_LOCKED": sum(1 for r in out if r["status"] == "SOURCE_LOCKED"),
        "CANDIDATE_TARGET": sum(1 for r in out if r["status"] == "CANDIDATE_TARGET"),
        "MEASURED": tally.get("MEASURED", 0),
        "UNVALIDATED": tally.get("UNVALIDATED", 0),
        "OPEN": tally.get("OPEN", 0),
        "REJECTED": tally.get("REJECTED", 0),
        "PROMOTED": tally.get("PROMOTED", 0),
        "PRODUCTION_ELIGIBLE": sum(1 for r in out if r["productionEligible"]),
    }
    (outd / "SUMMARY.json").write_text(json.dumps(summary, indent=1))
    for k, v in summary.items():
        print(f"  {k:22s} {v}")
    missing = [c for c in CATEGORIES_REQUIRED
               if not any(r["category"] == c for r in out)]
    print("  missing required categories:", missing or "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
