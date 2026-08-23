#!/usr/bin/env python3
"""Regression tests for the fair1 walking-BVH search (NOT_FOUND outcome)."""
import json, re
from pathlib import Path
SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
G = SC / "eld/generalization"
D = json.loads((G / "FAIR1_WALK_BVH_SEARCH.json").read_text())
T = []
def test(fn): T.append(fn); return fn

@test
def t01_result_is_not_found():
    assert D["result"] == "ALTERNATIVE_FAIR1_WALK_BVH = NOT_FOUND"
    assert D["candidates_found"] == 0
    assert D["experiment_run"] is False

@test
def t02_license_verified_from_an_authoritative_source():
    lic = D["license_verification"]
    assert lic["fetch_http_status"] == 200
    assert lic["status"].startswith("VERIFIED")
    assert lic["matches_local_clone"] is True
    assert re.fullmatch(r"[0-9a-f]{64}", lic["license_sha256"])
    assert "MIT" in lic["license"]

@test
def t03_motion_classified_by_decode_not_filename():
    m = D["motion_classification"]
    assert "Filenames were NOT trusted" in m["method"]
    walking = [r for r in m["results"] if r["verdict"] == "WALKING"]
    assert len(walking) == 1
    assert walking[0]["clip"] == "fair1/zombie.bvh"
    assert "CURRENT SOURCE" in walking[0]["note"]

@test
def t04_classifier_was_calibrated_against_a_positive_control():
    m = D["motion_classification"]
    assert "zombie.bvh (the ACCEPTED walk) must" in m["calibration"]
    assert "FALSE NEGATIVE" in m["first_attempt_error"]
    pos = next(r for r in m["results"] if r["clip"] == "fair1/zombie.bvh")
    assert pos["antiphase_error"] < 0.1, "the accepted walk must show L/R antiphase"
    for r in m["results"]:
        if r["verdict"] == "NOT WALKING":
            assert r["antiphase_error"] >= 0.45 or r["foot_osc"] <= 2.0, r["clip"]

@test
def t05_skeleton_requirement_taken_from_the_unmodified_config():
    t = D["target_skeleton"]
    assert t["required_joint_count"] == 25
    assert "unmodified" in t["source_of_requirement"]
    assert "LeftUpLeg->LeftLeg->LeftFoot" in t["critical_chain"]

@test
def t06_no_candidate_artifacts_were_fabricated():
    for f in ("FAIR1_CANDIDATE_PROVENANCE.json", "FAIR1_CANDIDATE_STRUCTURE.json",
              "FAIR1_CANDIDATE_SHA256.txt", "FAIR1_CANDIDATE_LICENSE.md"):
        assert not (G / f).exists(), f"{f} must not exist — there is no candidate"
        assert f in D["artifacts_not_produced"]

@test
def t07_all_prohibitions_observed():
    p = " ".join(D["prohibitions_observed"]).lower()
    for phrase in ("not retried", "no pypi mirror", "no joint renaming",
                   "no damper modification", "no normalization shim",
                   "no fabricated comparison"):
        assert phrase in p, phrase

@test
def t08_cmu_stays_closed():
    ext = D["search_step_4_external"]
    cmu = next(b for b in ext["blocked"] if "cmu" in b["host"])
    assert "CLOSED" in cmu["status"] and "not retried" in cmu["status"]

@test
def t09_external_search_limits_are_stated_not_worked_around():
    ext = D["search_step_4_external"]
    assert any(b["status"] == 403 for b in ext["blocked"])
    assert "not a principled search" in ext["conclusion"]
    assert "No external download was attempted" in ext["conclusion"]

@test
def t10_classification_unchanged_and_nothing_promoted():
    assert "MEASUREMENT_OPEN" in D["classification_unchanged"]
    lib = json.loads((SC / "eld/engineering_numeric/ENGINEERING_NUMERIC_LIBRARY.json").read_text())
    assert sum(1 for r in lib["records"] if r["productionEligible"]) == 0

@test
def t11_driver_and_retarget_untouched():
    src = (SC / "genloop/v3/b3_knee_damp.py").read_text()
    assert '["RightLeg", "LeftLeg"]' in src
    tr = json.loads((SC / "eld/evidence/run1/ENGINEERING_TRACE.json").read_text())
    assert tr["knee_driver"]["scale"] == 0.50
    cfg = (SC / "eld/evidence/run1/retarget_engineering.yaml").read_text()
    assert "LeftUpLeg" in cfg and "LeftKnee" not in cfg, "no CMU names may appear"

@test
def t12_no_bvh_was_downloaded():
    c = D["cost"]
    assert c["api_inr"] == 0 and c["gpu_inr"] == 0 and c["new_images"] == 0
    assert "No BVH and no media downloaded" in c["downloads_note"]

if __name__ == "__main__":
    p = f = 0
    for fn in T:
        try: fn(); print(f"  PASS  {fn.__name__}"); p += 1
        except Exception as e: print(f"  FAIL  {fn.__name__}: {e}"); f += 1
    print(f"\n  {p} passed, {f} failed")
    raise SystemExit(1 if f else 0)
