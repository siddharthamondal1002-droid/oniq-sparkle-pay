#!/usr/bin/env python3
"""Regression tests for the source-BVH replacement attempt (STOPPED state)."""
import json, sys
from pathlib import Path
SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
G = SC / "eld/generalization"
PROV = json.loads((G / "ALTERNATIVE_BVH_PROVENANCE.json").read_text())
STRUCT = json.loads((G / "ALTERNATIVE_BVH_STRUCTURE.json").read_text())
T = []
def test(fn): T.append(fn); return fn

@test
def t01_source_identified_and_recorded():
    s = PROV["authorized_source"]
    assert "Carnegie Mellon" in s["database"]
    assert s["primary"]["motion"] == "0018_Walking001"
    assert s["secondary_backup"]["motion"] == "0007_Walking001"
    assert "SFU" in s["excluded_by_owner"] and "Mixamo" in s["excluded_by_owner"]

@test
def t02_license_not_claimed_as_verified():
    """A quoted licence must never be recorded as a verified one."""
    assert PROV["steps_completed"]["4_record_license_statement"].startswith("FAILED")
    assert "quoted licence is not a verified licence" in \
        PROV["steps_completed"]["4_record_license_statement"]

@test
def t03_no_file_obtained_and_no_hash_invented():
    assert PROV["file_downloaded"] is False
    assert PROV["sha256"] is None and PROV["bytes"] is None
    txt = (G / "ALTERNATIVE_BVH_SHA256.txt").read_text()
    assert "NO FILE OBTAINED" in txt
    import re
    assert not re.search(r"\b[0-9a-f]{64}\b", txt), "a hash was written for a file that does not exist"

@test
def t04_block_is_evidenced_not_asserted():
    ev = PROV["block_evidence"]
    hosts = {f["host"] for f in ev["relay_failures"]}
    assert "mocap.cs.cmu.edu:443" in hosts
    assert all(f["kind"] == "connect_rejected" for f in ev["relay_failures"])
    assert "pypi.org 200" in ev["reachability_control"]

@test
def t05_joint_mapping_incompatibility_measured():
    assert STRUCT["required_count"] == 25
    assert STRUCT["fair1_satisfies"] == 25
    assert STRUCT["cmu_satisfies"] < 25
    for j in ("LeftUpLeg", "LeftLeg", "LeftFoot"):
        assert j in STRUCT["missing_from_cmu"], j

@test
def t06_damper_fails_closed_on_a_foreign_skeleton():
    d = PROV["second_independent_blocker"]["damper_probe"]
    assert "no rotation channels found" in d["result"]
    assert "['RightLeg', 'LeftLeg']" in d["result"]

@test
def t07_all_four_stop_conditions_recorded():
    assert PROV["status"] == "BLOCKED_STOP_CONDITIONS_MET"
    assert len(PROV["stop_conditions_met"]) == 4
    assert all("MET" in s for s in PROV["stop_conditions_met"])

@test
def t08_no_workaround_was_taken():
    w = " ".join(PROV["workarounds_deliberately_not_taken"]).lower()
    for phrase in ("mirror", "retarget-config rewrite", "joint-name remapping",
                   "non-walking clip"):
        assert phrase in w, phrase
    assert PROV["cost"] == {"api_inr": 0, "gpu_inr": 0, "downloads": 0, "new_images": 0}

@test
def t09_knee_curve_comparison_absent_not_faked():
    for f in ("SOURCE_BVH_COMPARISON.json", "SOURCE_BVH_KNEE_CURVES.json",
              "SOURCE_BVH_PIXEL_DIAGNOSTICS.json"):
        assert not (G / f).exists(), f"{f} must NOT exist — the clips were never rendered"

@test
def t10_classification_not_upgraded_and_nothing_promoted():
    rep = (G / "SOURCE_BVH_GENERALIZATION_REPORT.md").read_text()
    assert "MEASUREMENT_OPEN" in rep
    assert "No classification was upgraded" in rep
    lib = json.loads((SC / "eld/engineering_numeric/ENGINEERING_NUMERIC_LIBRARY.json").read_text())
    assert sum(1 for r in lib["records"] if r["productionEligible"]) == 0

@test
def t11_knee_driver_untouched():
    tr = json.loads((SC / "eld/evidence/run1/ENGINEERING_TRACE.json").read_text())
    assert tr["knee_driver"]["scale"] == 0.50
    src = (SC / "genloop/v3/b3_knee_damp.py").read_text()
    assert '["RightLeg", "LeftLeg"]' in src, "damper joint targets must be unchanged"

if __name__ == "__main__":
    p = f = 0
    for fn in T:
        try: fn(); print(f"  PASS  {fn.__name__}"); p += 1
        except Exception as e: print(f"  FAIL  {fn.__name__}: {e}"); f += 1
    print(f"\n  {p} passed, {f} failed")
    raise SystemExit(1 if f else 0)
