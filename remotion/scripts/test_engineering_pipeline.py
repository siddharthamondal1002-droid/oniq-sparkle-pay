#!/usr/bin/env python3
"""Tests for the engineering-library-driven generation pipeline.

Covers §19's required areas for this layer: engineering retrieval, provenance,
explicit generation, negative gates, motion, knee driver, camera reference,
lighting reference and matrix retrieval. The shot-plan / TypeScript side is
covered by the shipped vitest suite.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
REFS = SC / "evc/engineering_refs"
SCRIPTS = SC / "eld/remotion/scripts"
EV = SC / "eld/evidence"
REQUEST = "A determined character walks through a rainy modern city street at night."

sys.path.insert(0, str(SCRIPTS))
import engineering_retrieval as ER  # noqa: E402

LIB = ER.Library(REFS)
RUN = ER.retrieve(LIB, REQUEST)
SH = RUN["shelves"]
T = []


def test(fn):
    T.append(fn)
    return fn


# ------------------------------------------------------------- retrieval
@test
def t_library_is_frozen_and_read_only():
    assert LIB.taxonomy["generation_allowed"] is False
    for name in ("CAMERA_ENGINEERING_INDEX", "LIGHTING_ENGINEERING_INDEX",
                 "CAMERA_LIGHTING_MATRIX"):
        assert LIB.data[name]["generation_allowed"] is False, name
        assert LIB.data[name]["production_enabled"] is False, name


@test
def t_camera_reference_retrieved_with_required_axes():
    c = SH["CAMERA"]["selected"]
    assert c is not None and c["id"].startswith("CAM-")
    assert c["angle"] == "eye level"
    assert c["subject_scale"] == "full-figure subject scale"
    assert c["camera_mode"] == "locked/static"


@test
def t_camera_numeric_parameters_stay_unspecified():
    """Lens above all: ONIQ measures no lens, so nothing may invent one."""
    c = SH["CAMERA"]["selected"]
    for k in ("lens", "height", "distance", "fov"):
        assert c["camera_parameters"][k] == "NOT_SPECIFIED", k


@test
def t_lighting_reference_and_separate_axes():
    lit = SH["LIGHTING"]["selected"]
    assert lit["condition"] == "night"
    assert lit["base_section"].startswith("S1 TIME OF DAY")
    conds = {s["condition"] for s in SH["LIGHTING"]["secondary_axes"]}
    assert {"rain light", "street light"} <= conds, conds
    for k in ("color_temperature", "ratio", "intensity"):
        assert lit["lighting_parameters"][k] == "NOT_SPECIFIED", k


@test
def t_matrix_entry_joins_the_two_selected_panels():
    cam, lit = SH["CAMERA"]["selected"], SH["LIGHTING"]["selected"]
    m = SH["CAMERA_X_LIGHTING"]["selected"]
    assert m is not None, "no registered pair"
    assert m["camera_panel"] == cam["base_panel"]
    assert m["lighting_panel"] == lit["base_panel"]
    assert SH["CAMERA_X_LIGHTING"]["compatibility"] == "REGISTERED_PAIR"
    assert len(LIB.recs("CAMERA_LIGHTING_MATRIX")) == 10000


@test
def t_motion_grammar_is_the_promoted_one_only():
    mo = SH["MOTION"]["selected"]
    assert mo["subdomain"].startswith("grammar/walking")
    assert "PRIMARY" in mo["engineering_detail"]
    for bad in ("running", "jumping", "sitting", "waving", "reaching"):
        assert bad not in json.dumps(mo).lower(), bad


@test
def t_knee_contract_rules_are_measured_and_enforced():
    rules = {r["id"]: r for r in SH["MOTION_KNEE_CONTRACT"]["selected"]}
    for rid in ("ENG-0153", "ENG-0154", "ENG-0155", "ENG-0156"):
        assert rules[rid]["evidence_class"] == "MEASURED", rid
        assert rules[rid]["implementation_status"] == "ENFORCED", rid
    assert "0.50" in rules["ENG-0153"]["engineering_detail"]
    assert "unwrap" in rules["ENG-0156"]["engineering_detail"]


@test
def t_provenance_is_complete_and_hashed():
    for name, shelf in SH.items():
        if shelf.get("status") != "RESOLVED":
            continue
        p = shelf.get("provenance") or {}
        assert p.get("id"), name
        assert re.fullmatch(r"[0-9a-f]{64}", p.get("index_sha256", "")), name
        assert p.get("generation_allowed") is False, name
        if p.get("reference_image_sha256"):
            assert re.fullmatch(r"[0-9a-f]{64}", p["reference_image_sha256"]), name


@test
def t_unmatchable_request_fails_closed_not_to_a_default():
    """The first draft of the retriever silently returned record #1. It must not."""
    r = ER.retrieve(LIB, "qwxz 999 zzzz")
    for shelf in ("MOTION", "SCENE", "CAMERA", "LIGHTING"):
        assert r["shelves"][shelf]["status"] == "REFERENCE_UNCERTAIN", shelf
        assert r["shelves"][shelf]["selected"] is None, shelf
        assert r["shelves"][shelf]["fallback"] == {
            "action": "STILL_PARALLAX", "contract": "MOTION_CONTRACT"}


@test
def t_emotion_atlas_is_not_forced_to_a_wrong_label():
    """The frozen emotion index is facial-only; 'determined' has no entry."""
    e = SH["EMOTION_ATLAS"]
    assert e["status"] == "NOT_APPLICABLE"
    assert e["selected"] is None
    assert "shotPlan" in e["delegated_to"]


# --------------------------------------------------- generation boundary
@test
def t_generation_requires_explicit_authorization():
    out = SC / "eld/evidence/_test_noauth"
    (out).mkdir(parents=True, exist_ok=True)
    for f in ("gate.json",):
        (out / f).write_text((EV / "run1" / f).read_text())
    r = subprocess.run([sys.executable, str(SCRIPTS / "engineering_generate.py"),
                        str(EV / "ENGINEERING_REFERENCE_RUN.json"),
                        str(EV / "SHOT_PLAN.json"), str(out)],
                       capture_output=True, text=True)
    assert "PLANNED_NOT_GENERATED" in r.stdout, r.stdout + r.stderr
    assert not list(out.glob("*.gif")), "rendered without authorization"
    tr = json.loads((out / "ENGINEERING_TRACE.json").read_text())
    assert tr["generation_authorization"]["authorized"] is False
    assert tr["result"]["status"] == "PLANNED_NOT_GENERATED"


@test
def t_trace_records_every_binding_with_a_reference():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    assert tr["result"]["status"] == "GENERATED"
    for b in tr["bindings"]:
        assert b["engineering_reference_ids"], b["renderer_parameter"]
        assert b["support"] in ("ENFORCED", "PLAN_ONLY", "NOT_SPECIFIED", "BLOCKED")
    enforced = [b for b in tr["bindings"] if b["support"] == "ENFORCED"]
    assert len(enforced) >= 5, enforced
    assert tr["knee_driver"]["matches_registered_driver"] is True
    assert tr["determinism"]["same_host_pair"] is True
    assert tr["generation_authorization"]["cost"] == {
        "api_inr": 0, "gpu_inr": 0, "gpu_used": False}


@test
def t_knee_driver_rederivation_matches_registered_file():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    k = tr["knee_driver"]
    assert k["scale"] == 0.50
    assert k["derived_bvh_sha256"] == k["registered_driver_sha256"]
    assert "channels=6" in k["damper_report"], k["damper_report"]


# ------------------------------------------------------- negative gates
@test
def t_negative_catalogue_has_no_failures():
    tr = json.loads((EV / "run1/ENGINEERING_TRACE.json").read_text())
    s = tr["negative_catalogue_summary"]
    assert s["fail"] == 0, [r for r in tr["negative_catalogue"] if r["verdict"] == "FAIL"]
    assert s["tested"] >= 10


@test
def t_structural_validator_rejects_the_known_bad_clip():
    """The 2026-08-23 defective sample must still fail — the gate has teeth."""
    r = subprocess.run([sys.executable, str(SC / "genloop/v3/validate_clip.py"),
                        str(SC / "genloop/v3/sample86/sample_1.gif"),
                        str(SC / "genloop/v3/motion_knee050.yaml"), "0.0333333"],
                       capture_output=True, text=True)
    assert r.returncode == 1
    assert "FROZEN_TAIL   FAIL" in r.stdout
    assert "EMPTY_FRAMES  FAIL" in r.stdout


if __name__ == "__main__":
    p = f = 0
    for fn in T:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            p += 1
        except Exception as e:  # noqa: BLE001 — a runner reports
            print(f"  FAIL  {fn.__name__}: {e}")
            f += 1
    print(f"\n  {p} passed, {f} failed")
    raise SystemExit(1 if f else 0)
