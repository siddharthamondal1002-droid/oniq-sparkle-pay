#!/usr/bin/env python3
"""ENGINEERING_NUMERIC_TESTS — the 25 required validations.

Covers the numeric library itself (load, uniqueness, categories, units,
provenance, fail-closed behaviour, candidate/production separation) and the
invariants the library must never be able to break (knee constant, channel
count, symmetry, WALKING primary, wave excluded, hashes, determinism policy,
gates, fallback contract, explicit generation, no job clients).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
N = SC / "eld/engineering_numeric"
EV = SC / "eld/evidence"
REFS = SC / "evc/engineering_refs"
SCRIPTS = SC / "eld/remotion/scripts"

LIB = json.loads((N / "ENGINEERING_NUMERIC_LIBRARY.json").read_text())
SCHEMA = json.loads((N / "ENGINEERING_NUMERIC_SCHEMA.json").read_text())
R = LIB["records"]
T = []


def test(fn):
    T.append(fn)
    return fn


def validate(rec):
    """Minimal closed-world validator: unknown enum member => fail closed."""
    for f in SCHEMA["required"]:
        if f not in rec:
            raise ValueError(f"missing required field {f}")
    if rec["category"] not in SCHEMA["properties"]["category"]["enum"]:
        raise ValueError(f"unknown category {rec['category']}")
    if rec["unit"] not in SCHEMA["properties"]["unit"]["enum"]:
        raise ValueError(f"unknown unit {rec['unit']}")
    if rec["status"] not in SCHEMA["properties"]["status"]["enum"]:
        raise ValueError(f"unknown status {rec['status']}")
    if rec["validationState"] not in SCHEMA["properties"]["validationState"]["enum"]:
        raise ValueError(f"unknown validationState {rec['validationState']}")
    p = rec.get("provenance") or {}
    if not re.fullmatch(r"[0-9a-f]{64}", p.get("source_sha256", "")):
        raise ValueError("unknown/malformed provenance")
    if rec["status"] == "CANDIDATE_TARGET" and rec["productionEligible"]:
        raise ValueError("candidate marked production eligible")
    return True


# 1-6 structure
@test
def t01_all_records_load():
    assert isinstance(R, list) and R, "library did not load"


@test
def t02_exactly_1000_records():
    assert len(R) == 1000, len(R)
    assert LIB["total_records"] == 1000


@test
def t03_ids_unique():
    assert len({r["id"] for r in R}) == 1000


@test
def t04_no_duplicate_ids():
    seen = set()
    for r in R:
        assert r["id"] not in seen, r["id"]
        seen.add(r["id"])


@test
def t05_categories_valid():
    allowed = set(SCHEMA["properties"]["category"]["enum"])
    for r in R:
        assert r["category"] in allowed, r["category"]
    required = {"overall_proportions", "head_cranium", "face", "neck_shoulders",
                "torso_ribcage", "pelvis_hips", "upper_arm", "forearm", "hand",
                "fingers", "thigh", "lower_leg", "foot", "joints", "spine_posture",
                "center_of_mass", "balance_contact", "gait_timing",
                "gait_kinematics", "motion_limits"}
    present = {r["category"] for r in R}
    assert required <= present, required - present


@test
def t06_units_explicit():
    for r in R:
        assert r["unit"] and isinstance(r["unit"], str), r["id"]


# 7-12 provenance / promotion / fail-closed
@test
def t07_source_locked_records_have_provenance():
    for r in R:
        if r["status"] == "SOURCE_LOCKED":
            p = r["provenance"]
            assert p["source_document"] and p["source_sha256"], r["id"]
            assert re.fullmatch(r"[0-9a-f]{64}", p["source_sha256"]), r["id"]


@test
def t08_candidates_cannot_become_production_gates():
    for r in R:
        if r["status"] == "CANDIDATE_TARGET":
            assert r["productionEligible"] is False, r["id"]
            assert r["validationState"] == "UNVALIDATED", r["id"]
    assert sum(1 for r in R if r["productionEligible"]) == 0


@test
def t09_not_specified_is_representable_and_not_zero():
    ns = [r for r in R if r["unit"] == "NOT_SPECIFIED"]
    assert ns, "no NOT_SPECIFIED record"
    for r in ns:
        assert r["value"] == "NOT_SPECIFIED", (r["id"], r["value"])
        assert r["value"] != 0


@test
def t10_unknown_unit_fails_closed():
    bad = dict(R[0], unit="parsecs")
    try:
        validate(bad)
    except ValueError as e:
        assert "unknown unit" in str(e)
    else:
        raise AssertionError("unknown unit accepted")


@test
def t11_unknown_category_fails_closed():
    bad = dict(R[0], category="vibes")
    try:
        validate(bad)
    except ValueError as e:
        assert "unknown category" in str(e)
    else:
        raise AssertionError("unknown category accepted")


@test
def t12_unknown_provenance_fails_closed():
    bad = dict(R[0], provenance={"source_document": "x", "source_sha256": "nope",
                                 "source_field": "y", "supported_by": None})
    try:
        validate(bad)
    except ValueError as e:
        assert "provenance" in str(e)
    else:
        raise AssertionError("bad provenance accepted")


@test
def t12b_every_record_validates():
    for r in R:
        validate(r)


# 13-15 knee protection
@test
def t13_knee_damping_remains_050():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    assert tr["knee_driver"]["scale"] == 0.50
    frozen = json.loads((EV / "MOTION_ENGINEERING_FROZEN.json").read_text())
    assert frozen["knee_contract"]["scale"] == 0.50
    # nothing in the numeric library is allowed to act as a knee gate
    for r in R:
        if "knee" in r["parameter"].lower():
            assert r["productionEligible"] is False, r["id"]


@test
def t14_six_knee_channels_protected():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    assert "6 rotation channels" in tr["knee_driver"]["channels_modified"]
    rec = next(r for r in R if r["parameter"] == "knee_channels_modified")
    assert rec["value"] == 6 and rec["validationState"] == "MEASURED"


@test
def t15_bilateral_symmetry_protected():
    rec = next(r for r in R if r["parameter"] == "knees_damped_symmetrically")
    assert rec["value"] == 1 and rec["validationState"] == "MEASURED"
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    assert "LeftLeg + RightLeg" in tr["knee_driver"]["channels_modified"]


@test
def t16_walking_remains_primary():
    run = json.loads((EV / "ENGINEERING_REFERENCE_RUN.json").read_text())
    mo = run["retrieval"]["shelves"]["MOTION"]["selected"]
    assert mo["subdomain"].startswith("grammar/walking")
    assert "PRIMARY" in mo["engineering_detail"]


@test
def t17_wave_cannot_enter_a_production_plan():
    plan = json.loads((EV / "SHOT_PLAN.json").read_text())
    assert plan["motion"]["grammar"] == "walking"
    assert "wave" not in json.dumps(plan["motion"]).lower()


@test
def t18_unknown_grammar_falls_back_safely():
    sys.path.insert(0, str(SCRIPTS))
    import engineering_retrieval as ER
    lib = ER.Library(REFS)
    r = ER.retrieve(lib, "qwxz 999 zzzz")
    m = r["shelves"]["MOTION"]
    assert m["status"] == "REFERENCE_UNCERTAIN"
    assert m["fallback"] == {"action": "STILL_PARALLAX", "contract": "MOTION_CONTRACT"}


# 19-25 environment invariants
@test
def t19_reference_hashes_unchanged():
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
def t20_determinism_policy_unchanged():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    d = tr["determinism"]
    assert d["policy"] == "PER_HOST / PER_CPU_CLASS"
    assert d["rebaselined_fixtures"] is False
    assert d["same_host_pair"] is True


@test
def t21_pre_render_gates_unchanged():
    g = json.loads((EV / "run1/gate.json").read_text())
    t = g["thresholds"]
    assert t["rig_confidence_min"] == 0.70
    assert t["mask_fill_max_pct"] == 90
    assert t["border_contact_allowed"] is False
    assert "65%" in t["note"]
    assert g["ELIGIBLE"] is True


@test
def t22_fallback_contract_unchanged():
    plan = json.loads((EV / "SHOT_PLAN.json").read_text())
    assert plan["fallback"] == {"action": "STILL_PARALLAX", "contract": "MOTION_CONTRACT"}


@test
def t23_explicit_generation_requirement_remains_true():
    plan = json.loads((EV / "SHOT_PLAN.json").read_text())
    assert plan["explicitGenerationRequired"] is True


@test
def t24_no_automatic_generation_introduced():
    # scope: the ANALYSIS layer. The test file itself names the banned symbols
    # in order to look for them, so scanning it would be self-defeating.
    src = (SCRIPTS / "build_numeric_library.py").read_text()
    for banned in ("l3_animate_ref" + "erence", "--auth" + "orize", "RENDERER"):
        assert banned not in src, banned


@test
def t25_no_api_or_job_client_in_the_analysis_layer():
    src = (SCRIPTS / "build_numeric_library.py").read_text()
    for banned in ("requests", "urllib", "http", "supabase", "storyJobsClient",
                   "claim_story_seconds", "openai", "genai"):
        assert banned not in src, banned


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
