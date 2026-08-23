#!/usr/bin/env python3
"""ENGINEERING_MEASUREMENT_TESTS — invariants the measurement layer must hold."""
import json
import re
import sys
from pathlib import Path

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
M = SC / "eld/measurement"
N = SC / "eld/engineering_numeric"
EV = SC / "eld/evidence"
SCRIPTS = SC / "eld/remotion/scripts"

RES = json.loads((M / "ENGINEERING_MEASUREMENT_RESULTS.json").read_text())["measurements"]
SCHEMA = json.loads((M / "ENGINEERING_MEASUREMENT_SCHEMA.json").read_text())
ENGINE = json.loads((M / "ENGINEERING_MEASUREMENT_ENGINE.json").read_text())
CLS = json.loads((M / "CANDIDATE_CLASSIFICATION.json").read_text())
LIB = json.loads((N / "ENGINEERING_NUMERIC_LIBRARY.json").read_text())["records"]
T = []


def test(fn):
    T.append(fn)
    return fn


@test
def t01_1000_ids_remain_unique():
    assert len(LIB) == 1000
    assert len({r["id"] for r in LIB}) == 1000


@test
def t02_candidate_values_cannot_drive_production():
    for r in LIB:
        if r["status"] == "CANDIDATE_TARGET":
            assert r["productionEligible"] is False, r["id"]
    for r in CLS["records"]:
        assert r["productionEligible"] is False, r["id"]


@test
def t03_rejected_records_cannot_drive_production():
    for r in LIB:
        if r["validationState"] == "REJECTED":
            assert r["productionEligible"] is False, r["id"]
    assert sum(1 for r in LIB if r["validationState"] == "REJECTED") == 21


@test
def t04_not_specified_cannot_become_zero():
    ns = [r for r in LIB if r["unit"] == "NOT_SPECIFIED"]
    assert ns
    for r in ns:
        assert r["value"] == "NOT_SPECIFIED" and r["value"] != 0


@test
def t05_millimetre_records_cannot_validate_without_a_scale_bridge():
    assert ENGINE["scale_bridge"] == "NOT_AVAILABLE"
    assert CLS["scale_bridge"] == "NOT_AVAILABLE"
    mm = [r for r in CLS["records"] if r["unit"] == "mm"]
    assert len(mm) == 697, len(mm)
    for r in mm:
        assert r["classification"] == "BLOCKED_SCALE_BRIDGE", r["id"]
    # and nothing may be emitted in the millimetre domain
    assert "MILLIMETRE" not in SCHEMA["properties"]["measurement_domain"]["enum"]
    for m in RES:
        assert m["measurement_domain"] in ("PIXEL", "NORMALIZED", "BVH"), m["id"]
        assert m["unit"] != "mm", m["id"]


@test
def t06_knee_damping_remains_050():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    assert tr["knee_driver"]["scale"] == 0.50
    frozen = json.loads((EV / "MOTION_ENGINEERING_FROZEN.json").read_text())
    assert frozen["knee_contract"]["scale"] == 0.50


@test
def t07_knee_damping_cannot_map_to_spine_flex():
    r = next(x for x in LIB if x["id"] == "CHAR-ENG-0951")
    assert r["value"] == 0.5
    assert r["parameter"] == "spine_flex_01"
    assert r["validationState"] == "REJECTED"
    assert r["productionEligible"] is False
    assert "knee" in r["note"].lower() and "spine" in r["note"].lower()
    # no spine parameter anywhere may be production eligible
    for x in LIB:
        if "spine" in x["parameter"].lower():
            assert x["productionEligible"] is False, x["id"]


@test
def t08_left_right_knee_cannot_be_inferred_from_aggregate():
    """The independent measurement exists AND disagrees with the library labels."""
    g = {(m["source_clip"], m["parameter"]): m["value"] for m in RES}
    lmin = g[("corrected_knee050", "knee_angle_min_left")]
    rmin = g[("corrected_knee050", "knee_angle_min_right")]
    lf = g[("corrected_knee050", "knee_angle_frame_of_min_left")]
    rf = g[("corrected_knee050", "knee_angle_frame_of_min_right")]
    assert lmin != rmin, "left and right must be measured separately"
    assert abs(lmin - 147.2307) < 1e-3 and abs(rmin - 140.0076) < 1e-3
    assert int(lf) == 126 and int(rf) == 101
    # the library's knee_peak_L_01 = 140.0 is in fact the RIGHT knee
    lib905 = next(x for x in LIB if x["id"] == "CHAR-ENG-0905")
    assert lib905["value"] == 140.0 and "knee_peak_L" in lib905["parameter"]
    assert abs(rmin - 140.0) < 0.01, "140.0 is the RIGHT knee, so the L label is wrong"
    assert lib905["validationState"] == "REJECTED"


@test
def t09_units_cannot_silently_change():
    allowed = set(SCHEMA["properties"]["unit"]["enum"])
    for m in RES:
        assert m["unit"] in allowed, (m["id"], m["unit"])
    bad = dict(RES[0], unit="furlongs")
    assert bad["unit"] not in allowed


@test
def t10_measurement_domain_is_mandatory():
    assert "measurement_domain" in SCHEMA["required"]
    for m in RES:
        assert m.get("measurement_domain"), m["id"]


@test
def t11_provenance_is_mandatory_for_measured_values():
    for m in RES:
        assert re.fullmatch(r"[0-9a-f]{64}", m["evidence_sha256"]), m["id"]
        assert m["source_asset"] and m["source_clip"] and m["method"]
        assert m["confidence"] in ("high", "medium", "low")


@test
def t12_no_measurement_is_automatically_promoted():
    assert "PROMOTED" not in SCHEMA["properties"]["validationState"]["enum"]
    for m in RES:
        assert m["validationState"] != "PROMOTED", m["id"]
    assert sum(1 for r in LIB if r["productionEligible"]) == 0


@test
def t13_fail_closed_fallback_remains_intact():
    plan = json.loads((EV / "SHOT_PLAN.json").read_text())
    assert plan["fallback"] == {"action": "STILL_PARALLAX", "contract": "MOTION_CONTRACT"}
    sys.path.insert(0, str(SCRIPTS))
    import engineering_retrieval as ER
    lib = ER.Library(SC / "evc/engineering_refs")
    r = ER.retrieve(lib, "qwxz 999 zzzz")
    assert r["shelves"]["MOTION"]["status"] == "REFERENCE_UNCERTAIN"


@test
def t14_explicit_generation_remains_required():
    plan = json.loads((EV / "SHOT_PLAN.json").read_text())
    assert plan["explicitGenerationRequired"] is True


@test
def t15_no_generation_apis_introduced_in_the_engine():
    src = (SCRIPTS / "measurement_engine.py").read_text()
    for banned in ("requests", "urllib", "supabase", "openai", "genai",
                   "l3_animate_ref" + "erence", "--auth" + "orize"):
        assert banned not in src, banned
    assert ENGINE["read_only"] is True
    assert ENGINE["renders_anything"] is False
    assert ENGINE["generates_anything"] is False
    assert ENGINE["api_spend_inr"] == 0 and ENGINE["gpu_spend_inr"] == 0


@test
def t16_reference_hashes_remain_unchanged():
    run = json.loads((EV / "ENGINEERING_REFERENCE_RUN.json").read_text())
    expect = {
        "ENG-001": "fc0ea82faccf3d436c8870f328657db9c5c4999ad27f602e8d8aa8c09c33fe18",
        "ENG-002": "84588b3ad10a2a7bf9b5832e1eccfd7900c8fe7a0bd71c52c87f24e3640cfb69",
        "ENG-003": "35c00f60678c9ed07a87b3938f2b220afb6557d5a75f0f56954a07ae6efc6356",
        "ENG-004": "705e1c37db4fa28efe0ffab9160fbc4cb74e494994e45df5fabbb8de29fa22ea",
    }
    for k, v in expect.items():
        assert run["engineering_reference_sha256"][k] == v, k
    assert run["generation_allowed"] is False


@test
def t17_determinism_remains_unchanged():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    d = tr["determinism"]
    assert d["policy"] == "PER_HOST / PER_CPU_CLASS"
    assert d["rebaselined_fixtures"] is False and d["same_host_pair"] is True


@test
def t18_measured_facts_locked():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    g = json.loads((EV / "run1/gate.json").read_text())
    assert tr["renderer"]["canvas"] == "500x500"
    assert "6 rotation channels" in tr["knee_driver"]["channels_modified"]
    assert ENGINE["window"]["frames"] == 129
    assert g["thresholds"]["mask_fill_max_pct"] == 90


@test
def t19_domains_are_never_mixed_in_a_single_record():
    for m in RES:
        d, u = m["measurement_domain"], m["unit"]
        if d == "PIXEL":
            assert u in ("px", "frames", "frame"), (m["id"], u)
        if d == "NORMALIZED":
            assert u in ("ratio", "IoU"), (m["id"], u)
        if d == "BVH":
            assert u in ("BVH units", "deg", "deg/s", "deg/s^2", "frames", "frame"), (m["id"], u)


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
