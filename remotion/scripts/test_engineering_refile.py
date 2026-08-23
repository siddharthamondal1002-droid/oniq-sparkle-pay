#!/usr/bin/env python3
"""Tests for immutable re-filing + the L/R knee generalization loop."""
import json
import re
import sys
from pathlib import Path

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
R = SC / "eld/refile"
G = SC / "eld/generalization"
N = SC / "eld/engineering_numeric"

MAP = json.loads((R / "ENGINEERING_EVIDENCE_REFILE_MAP.json").read_text())
DER = json.loads((R / "ENGINEERING_DERIVED_MEASUREMENTS.json").read_text())["derived"]
LIB = json.loads((N / "ENGINEERING_NUMERIC_LIBRARY.json").read_text())["records"]
MC = json.loads((G / "KNEE_LR_MULTI_CHARACTER_RESULTS.json").read_text())
VAL = json.loads((G / "KNEE_LR_MEASUREMENT_VALIDATION.json").read_text())
PIX = json.loads((G / "KNEE_LR_PIXEL_DIAGNOSTICS.json").read_text())
T = []


def test(fn):
    T.append(fn)
    return fn


@test
def t01_originals_are_preserved_unchanged():
    byid = {r["id"]: r for r in LIB}
    for o in MAP["originals"]:
        src = byid[o["originalId"]]
        assert o["originalValue"] == src["value"], o["originalId"]
        assert o["originalParameter"] == src["parameter"], o["originalId"]
        assert o["originalUnit"] == src["unit"], o["originalId"]
        assert o["originalStatus"] == src["status"], o["originalId"]
        assert o["immutable"] is True


@test
def t02_no_original_was_renamed_or_deleted():
    assert len(LIB) == 1000
    assert len({r["id"] for r in LIB}) == 1000
    # every re-filed original still carries its ORIGINAL parameter name
    byid = {r["id"]: r for r in LIB}
    for d in DER:
        src = byid[d["derivedFromOriginalId"]]
        assert src["parameter"] != d["correctedParameter"], (
            f"{src['id']} was renamed in place")
        assert src["validationState"] in ("REJECTED", "OPEN")


@test
def t03_every_derived_points_back_at_its_original():
    for d in DER:
        assert re.fullmatch(r"CHAR-DER-[0-9]{4}", d["derivedId"])
        assert re.fullmatch(r"CHAR-ENG-[0-9]{4}", d["derivedFromOriginalId"])
        assert d["derivedFromOriginalId"] == d["sourceOriginalId"]
        assert re.fullmatch(r"[0-9a-f]{64}", d["evidenceSha256"])
        assert d["measurementDomain"] in ("PIXEL", "NORMALIZED", "BVH")


@test
def t04_derived_records_reproduce_their_original_value():
    for d in DER:
        assert d["reproducesOriginalValue"] is True, d["derivedId"]
        assert d["validationState"] == "MEASURED", d["derivedId"]


@test
def t05_derived_records_are_never_production_eligible():
    for d in DER:
        assert d["productionEligible"] is False, d["derivedId"]
    assert DER and sum(1 for r in LIB if r["productionEligible"]) == 0


@test
def t06_knee_side_inversion_is_recorded_correctly():
    by = {d["derivedFromOriginalId"]: d for d in DER}
    # 140.0 was filed as knee_peak_L; it is the RIGHT knee
    d905 = by["CHAR-ENG-0905"]
    assert d905["kneeSide"] == "RIGHT" and d905["frame"] == 101
    assert abs(d905["value"] - 140.0076) < 1e-3
    # 147.2 was filed as knee_peak_R; it is the LEFT knee
    d916 = by["CHAR-ENG-0916"]
    assert d916["kneeSide"] == "LEFT" and d916["frame"] == 126
    assert abs(d916["value"] - 147.2307) < 1e-3
    for d in (d905, d916):
        assert d["sideCorrection"] == "LABEL_INVERTED_IN_ORIGINAL"
        assert d["measurementType"] == "MIN_INTERIOR_ANGLE"
        assert d["unit"] == "deg"


@test
def t07_left_right_swap_fails():
    """The regression test for the discovered inversion."""
    per = {p["frame"]: p for p in VAL["per_frame"]}
    assert abs(per[101]["RIGHT"] - 140.008) < 1e-2
    assert abs(per[101]["LEFT"] - 179.636) < 1e-2
    assert per[101]["min_belongs_to"] == "RIGHT"
    assert per[126]["min_belongs_to"] == "LEFT"
    # a swap would make the f101 minimum belong to LEFT — assert it does not
    assert per[101]["LEFT"] > per[101]["RIGHT"], "f101 LEFT must be the straighter knee"
    assert per[126]["LEFT"] < per[126]["RIGHT"], "f126 LEFT must be the flexed knee"


@test
def t08_per_frame_minimum_is_never_a_side_value():
    per = {p["frame"]: p for p in VAL["per_frame"]}
    sides = {p["min_belongs_to"] for p in per.values()}
    assert sides == {"LEFT", "RIGHT"}, (
        "the per-frame minimum alternates sides, which is why it cannot be read "
        "as a left or right value")
    for oid in ("CHAR-ENG-0906", "CHAR-ENG-0915", "CHAR-ENG-0926", "CHAR-ENG-0935"):
        assert not any(d["derivedFromOriginalId"] == oid for d in DER), (
            f"{oid} is a per-frame minimum and must get NO derived record")


@test
def t09_bvh_knee_stats_are_character_invariant():
    """Same BVH drives every character, so the angles must match exactly."""
    ref = None
    for c, conds in MC["results"].items():
        for cond in ("control", "corrected"):
            k = conds[cond]["knee_bvh"]
            key = (cond, k["LEFT"]["min"], k["RIGHT"]["min"],
                   k["LEFT"]["mean"], k["RIGHT"]["mean"])
            if ref is None:
                ref = {}
            ref.setdefault(cond, key)
            assert ref[cond] == key, f"{c}/{cond} diverged: {key} vs {ref[cond]}"
    assert len(MC["results"]) >= 4


@test
def t10_asymmetry_direction_holds_and_is_not_called_biological():
    for c, conds in MC["results"].items():
        for cond in ("control", "corrected"):
            k = conds[cond]["knee_bvh"]
            assert k["RIGHT"]["mean"] < k["LEFT"]["mean"], (c, cond)
            assert k["RIGHT"]["min"] < k["LEFT"]["min"], (c, cond)
    txt = (G / "KNEE_ASYMMETRY_ANALYSIS.md").read_text().lower()
    assert "not a biological" in txt
    assert "cannot independently test" in txt


@test
def t11_pixel_manifestation_is_character_specific():
    tw = {c: conds["control"]["pixel"]["two_leg_fraction_min"]
          for c, conds in MC["results"].items()}
    assert max(tw.values()) - min(tw.values()) > 0.15, tw
    assert tw["b4_heavy_man"] == 0.0


@test
def t12_garment_confound_is_recorded_not_treated_as_a_defect():
    hm = PIX["characters"]["b4_heavy_man"]
    assert hm["pixel_verdict"] == "PASS"
    assert hm["crossing_classification"] == "LEGITIMATE_PASSING_PHASE_OCCLUSION"
    assert "garment width" in hm["crossing_note"].lower()


@test
def t13_all_characters_pass_pixel_review():
    assert PIX["summary"] == {"pixel_PASS": 4, "pixel_FAIL": 0, "unknown": 0}
    for c, v in PIX["characters"].items():
        assert v["pixel_verdict"] == "PASS", c
        assert v["crossing_classification"] == "LEGITIMATE_PASSING_PHASE_OCCLUSION", c


@test
def t14_envelope_does_not_transfer_between_characters():
    b = {c: conds["control"]["pixel"]["border_contact_frames"]
         for c, conds in MC["results"].items()}
    assert b["m3_suit_woman"] == 0
    assert b["b4_heavy_man"] > 0, "the inherited window must be shown not to transfer"


@test
def t15_knee_damping_untouched_and_no_clamp_introduced():
    tr = json.loads((SC / "eld/evidence/run1/ENGINEERING_TRACE.json").read_text())
    assert tr["knee_driver"]["scale"] == 0.50
    assert "6 rotation channels" in tr["knee_driver"]["channels_modified"]
    src = (SC / "genloop/v3/b3_knee_damp.py").read_text()
    for banned in ("clamp", "np.clip", "min(max("):
        assert banned not in src, banned


@test
def t16_scale_bridge_still_not_available():
    st = (SC / "eld/measurement/ENGINEERING_SCALE_BRIDGE_STATUS.md").read_text()
    assert "SCALE_BRIDGE = NOT_AVAILABLE" in st
    eng = json.loads((SC / "eld/measurement/ENGINEERING_MEASUREMENT_ENGINE.json").read_text())
    assert eng["scale_bridge"] == "NOT_AVAILABLE"


@test
def t17_no_millimetre_domain_anywhere():
    for d in DER:
        assert d["unit"] != "mm" and d["measurementDomain"] != "MILLIMETRE"
    sch = json.loads((R / "ENGINEERING_REFILE_SCHEMA.json").read_text())
    dom = sch["$defs"]["DerivedMeasurementRecord"]["properties"]["measurementDomain"]["enum"]
    assert "MILLIMETRE" not in dom


if __name__ == "__main__":
    p = f = 0
    for fn in T:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            p += 1
        except Exception as e:  # noqa: BLE001
            print(f"  FAIL  {fn.__name__}: {e}")
            f += 1
    print(f"\n  {p} passed, {f} failed")
    raise SystemExit(1 if f else 0)
