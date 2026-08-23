#!/usr/bin/env python3
"""Regression tests for the LAFAN1 licence-gate rejection."""
import json, re
from pathlib import Path
SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
G = SC / "eld/generalization"
P = json.loads((G / "SOURCE_DATASET_PROVENANCE.json").read_text())
T = []
def test(fn): T.append(fn); return fn

@test
def t01_license_verified_from_authoritative_source():
    lic = P["license"]
    assert P["authoritative_source"]["license_http"] == 200
    assert "ubisoft-laforge-animation-dataset" in P["authoritative_source"]["license_url"]
    assert re.fullmatch(r"[0-9a-f]{64}", lic["license_text_sha256"])
    assert lic["short"] == "CC BY-NC-ND 4.0"

@test
def t02_license_verifies_as_incompatible_not_merely_unknown():
    assert P["status"] == "REJECTED_AT_LICENSE_GATE"
    assert "INCOMPATIBLE" in P["license"]["verification_status"]
    clauses = {c["clause"] for c in P["incompatibility"]}
    assert {"NonCommercial", "NoDerivatives", "owner precedent"} <= clauses

@test
def t03_sha_file_never_claims_a_hash_we_do_not_hold():
    txt = (G / "SOURCE_SHA256.txt").read_text()
    assert "NO BVH OBTAINED" in txt
    assert "NOT a hash of bytes this session possesses" in txt
    # the only 64-hex we assert ownership of is the licence text
    assert P["license"]["license_text_sha256"] in txt

@test
def t04_no_bvh_downloaded_and_no_adapter_built():
    assert P["file_downloaded"] is False
    assert P["bvh_obtained"] is False
    assert P["bvh_sha256"] is None
    assert P["adapter_built"] is False
    assert not (SC / "eld/experimental_source_bvh_adapter").exists()

@test
def t05_data_unavailability_evidenced():
    b = P["second_independent_blocker"]["evidence"]
    assert b["bytes_returned"] == 134
    assert "git-lfs pointer" in b["content"]
    assert b["declared_size"] == 144051503
    assert "secondary" in P["second_independent_blocker"]["note"]

@test
def t06_dependent_artifacts_not_fabricated():
    for f in ("SOURCE_SKELETON.json", "SOURCE_TO_ONIQ_MAPPING.json",
              "ADAPTER_VALIDATION.json", "SOURCE_GAIT_VALIDATION.json",
              "SOURCE_BVH_COMPARISON.json", "SOURCE_BVH_KNEE_CURVES.json",
              "SOURCE_BVH_PIXEL_DIAGNOSTICS.json"):
        assert not (G / f).exists(), f"{f} must not exist"
        assert f in P["artifacts_not_produced"]

@test
def t07_all_prohibited_sources_avoided():
    p = " ".join(P["prohibitions_observed"]).lower()
    for phrase in ("cmu not used", "no pypi mirror", "mixamo not used",
                   "sfu not used", "no guessed repository urls"):
        assert phrase in p, phrase

@test
def t08_classification_open_and_nothing_promoted():
    assert P["classification"] == "RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN"
    assert P["experiment_run"] is False
    lib = json.loads((SC / "eld/engineering_numeric/ENGINEERING_NUMERIC_LIBRARY.json").read_text())
    assert sum(1 for r in lib["records"] if r["productionEligible"]) == 0

@test
def t09_production_untouched():
    src = (SC / "genloop/v3/b3_knee_damp.py").read_text()
    assert '["RightLeg", "LeftLeg"]' in src
    for banned in ("clamp", "np.clip"):
        assert banned not in src
    cfg = (SC / "eld/evidence/run1/retarget_engineering.yaml").read_text()
    assert "LeftUpLeg" in cfg
    tr = json.loads((SC / "eld/evidence/run1/ENGINEERING_TRACE.json").read_text())
    assert tr["knee_driver"]["scale"] == 0.50

@test
def t10_cost_zero_and_only_text_fetched():
    c = P["cost"]
    assert c == {"api_inr": 0, "gpu_inr": 0, "bvh_downloaded": 0, "new_images": 0,
                 "downloads_note": c["downloads_note"]}
    assert "No motion data" in c["downloads_note"]

@test
def t11_consolidated_report_keeps_categories_separate():
    rep = (G / "SOURCE_BVH_GENERALIZATION_REPORT.md").read_text()
    for cat in ("MEASURED FACT", "DERIVED MEASUREMENT", "SOURCE-SPECIFIC",
                "INFERRED", "BLOCKED", "OPEN", "NOT_APPLICABLE", "PRODUCTION RULE"):
        assert cat in rep, cat
    assert "MEASUREMENT_OPEN" in rep
    assert "DIAGNOSTIC ONLY" in rep
    assert "per character and" in rep

if __name__ == "__main__":
    p = f = 0
    for fn in T:
        try: fn(); print(f"  PASS  {fn.__name__}"); p += 1
        except Exception as e: print(f"  FAIL  {fn.__name__}: {e}"); f += 1
    print(f"\n  {p} passed, {f} failed")
    raise SystemExit(1 if f else 0)
