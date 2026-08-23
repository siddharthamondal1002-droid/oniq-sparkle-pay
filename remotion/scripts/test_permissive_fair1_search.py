#!/usr/bin/env python3
"""Regression tests for the permissively-licensed fair1 walk search.

Outcome under test: ALTERNATIVE_FAIR1_WALK_BVH = NOT_FOUND, reached by the
licence gate. These tests exist to make the NEGATIVE result hard to erode —
a later loop must not be able to quietly accept a code licence as a data
licence, promote a snippet to evidence, or mint a candidate that never existed.
"""
import json
import re
from pathlib import Path

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
G = SC / "eld/generalization"
SCRIPTS = SC / "eld/remotion/scripts"

D = json.loads((G / "PERMISSIVE_FAIR1_WALK_SEARCH.json").read_text())
REP = (G / "SOURCE_BVH_GENERALIZATION_REPORT.md").read_text()
T = []


def test(fn):
    T.append(fn)
    return fn


# ---------------------------------------------------------------- licence
@test
def t01_result_is_not_found_and_no_experiment_ran():
    assert D["result"] == "ALTERNATIVE_FAIR1_WALK_BVH = NOT_FOUND"
    assert D["experiment_run"] is False
    assert D["p0_candidates"] == 0 and D["p1_candidates"] == 0
    assert D["outcome_class"].startswith("SUCCESSFUL_RESEARCH_OUTCOME")


@test
def t02_licence_gate_failed_for_every_candidate():
    gr = D["gates_reached"]
    assert gr["license_gate"] == "FAILED for every candidate"
    assert gr["skeleton_gate"].startswith("NOT REACHED")
    assert gr["motion_gate"].startswith("NOT REACHED")
    live = [c for c in D["candidates"] if c["verdict"] != "NOT RETRIED"]
    assert len(live) >= 7
    for c in live:
        assert c["verdict"] == "REJECTED", c["id"]


@test
def t03_a_code_licence_may_never_be_read_as_a_data_licence():
    """The PyMO trap: MIT LICENSE, unlicensed data."""
    p = next(c for c in D["candidates"] if c["id"] == "omimo/PyMO")
    assert p["verdict"] == "REJECTED"
    assert p["repo_license"] == "MIT (code)"
    assert p["data_license"] == "UNSTATED"
    assert p["data_provenance"] == "UNDOCUMENTED"
    assert re.fullmatch(r"[0-9a-f]{64}", p["repo_license_sha256"])
    assert "does not relicense data" in p["reason"]
    assert "does not relicense the data it ships" in REP


@test
def t04_an_unverified_licence_is_a_rejection_not_a_maybe():
    for c in D["candidates"]:
        if c.get("licence_verified") is False:
            assert c["verdict"] == "REJECTED", c["id"]
    bn = next(c for c in D["candidates"]
              if c["id"] == "Bandai Namco Research mocap")
    assert bn["licence_evidence_level"] == "SNIPPET_ONLY_NOT_AUTHORITATIVE"
    assert "never as licence evidence" in bn["note"]


@test
def t05_search_snippets_are_never_licence_evidence():
    assert "snippets were NEVER used as licence evidence" in \
        D["search_capability"]["licence_evidence_rule"]
    for s in D["sources"]:
        if s["evidence_level"] != "AUTHORITATIVE_FETCH":
            assert s.get("licence_sha256") is None, s["label"]


@test
def t06_a_missing_licence_file_is_not_probed_around():
    ci = next(c for c in D["candidates"] if c["id"] == "CreativeInquiry/BVH-Examples")
    assert ci["probed_further"] is False
    assert "guessing repository paths" in ci["note"]


# ---------------------------------------------------------------- provenance
@test
def t07_every_source_is_cited_as_a_markdown_link_or_explicitly_not():
    assert D["sources"]
    for s in D["sources"]:
        if s["url"] is None:
            assert s["markdown"] is None
            assert "manufacturing a citation" in s["note"], s["label"]
        else:
            assert s["url"].startswith("https://"), s["label"]
            assert s["markdown"] == f"[{s['label']}]({s['url']})", s["label"]
            assert s["markdown"] in REP or s["evidence_level"] == "UNVERIFIABLE_WITHOUT_ACCOUNT" \
                or f"]({s['url']})" in REP, s["label"]


@test
def t08_the_one_authoritative_fetch_records_status_and_sha():
    auth = [s for s in D["sources"] if s["evidence_level"] == "AUTHORITATIVE_FETCH"]
    assert len(auth) == 1
    a = auth[0]
    assert a["licence_fetch_status"] == 200
    assert re.fullmatch(r"[0-9a-f]{64}", a["licence_sha256"])
    # and it agrees with the candidate record it belongs to
    p = next(c for c in D["candidates"] if c["id"] == a["label"])
    assert p["repo_license_sha256"] == a["licence_sha256"]


@test
def t09_closed_routes_stay_closed():
    cmu = next(c for c in D["candidates"] if c["id"] == "CMU Graphics Lab")
    assert cmu["verdict"] == "NOT RETRIED"
    txt = json.dumps(D).lower()
    assert "lafan1, which is closed" in txt or "closed on cc by-nc-nd" in txt
    # no PyPI mirror, no indirect dataset download, no dataset host fetch
    for banned in ("pypi.org/packages", "files.pythonhosted", "mocap.cs.cmu.edu",
                   "mixamo.com", "codeload.github.com"):
        assert banned not in txt, banned


# ---------------------------------------------------------------- no fabrication
@test
def t10_no_candidate_artifact_was_fabricated():
    for f in ("FAIR1_WALK_CANDIDATE_PROVENANCE.json",
              "FAIR1_WALK_CANDIDATE_LICENSE.md",
              "FAIR1_WALK_CANDIDATE_STRUCTURE.json",
              "FAIR1_WALK_CANDIDATE_SHA256.txt",
              "FAIR1_WALK_CANDIDATE_MOTION.json"):
        assert not (G / f).exists(), f"{f} must not exist — there is no candidate"
        assert D["artifacts_not_produced"][f] == "no valid candidate"


@test
def t11_no_bvh_was_downloaded_so_no_bvh_sha_is_claimed():
    assert D["downloads"]["bvh_downloaded"] == 0
    assert D["cost"] == {"api_inr": 0, "gpu_inr": 0,
                         "bvh_downloaded": 0, "new_images": 0}
    # nothing in the record may claim a motion-file hash
    assert "no SHA-256 of any BVH exists" in D["downloads"]["note"]


@test
def t12_no_substitute_source_was_promoted_into_the_pipeline():
    """The current source BVH must still be the only one wired in."""
    cfg = (SC / "genloop/v3/motion_knee050_bounded.yaml").read_text()
    assert "zombie" in cfg
    for c in D["candidates"]:
        assert c["id"].split("/")[-1].lower() not in cfg.lower(), c["id"]


# ---------------------------------------------------------------- skeleton / gait
@test
def t13_skeleton_gate_was_not_reached_and_not_faked():
    """No candidate reached it, so no structure record may exist."""
    assert D["gates_reached"]["skeleton_gate"].startswith("NOT REACHED")
    assert not (G / "FAIR1_WALK_CANDIDATE_STRUCTURE.json").exists()
    # the requirement itself is unchanged from the earlier search
    prev = json.loads((G / "FAIR1_WALK_BVH_SEARCH.json").read_text())
    assert prev["target_skeleton"]["required_joint_count"] == 25


@test
def t14_gait_classifier_is_unchanged_and_still_calibrated():
    """Route 4 must not silently retune the classifier that route 2 calibrated."""
    prev = json.loads((G / "FAIR1_WALK_BVH_SEARCH.json").read_text())
    m = prev["motion_classification"]
    pos = next(r for r in m["results"] if r["clip"] == "fair1/zombie.bvh")
    assert pos["verdict"] == "WALKING" and pos["antiphase_error"] < 0.1
    assert len([r for r in m["results"] if r["verdict"] == "WALKING"]) == 1


# ---------------------------------------------------------------- no prod change
@test
def t15_driver_untouched_050_six_channels_bilateral():
    d = D["driver_unchanged"]
    assert d["damping"] == 0.50 and d["channels"] == 6 and d["bilateral"] is True
    assert d["location"] == "SOURCE BVH layer"
    tr = json.loads((SC / "eld/evidence/run1/ENGINEERING_TRACE.json").read_text())
    assert tr["knee_driver"]["scale"] == 0.50
    assert "6 rotation channels" in tr["knee_driver"]["channels_modified"]
    src = (SC / "genloop/v3/b3_knee_damp.py").read_text()
    assert '["RightLeg", "LeftLeg"]' in src
    for banned in ("clamp", "np.clip", "min(max("):
        assert banned not in src, banned


@test
def t16_generation_still_forbidden_and_nothing_promoted():
    run = json.loads((SC / "eld/evidence/ENGINEERING_REFERENCE_RUN.json").read_text())
    assert run["generation_allowed"] is False
    lib = json.loads((SC / "eld/engineering_numeric/"
                      "ENGINEERING_NUMERIC_LIBRARY.json").read_text())
    assert len(lib["records"]) == 1000
    assert sum(1 for r in lib["records"] if r["productionEligible"]) == 0


@test
def t17_classification_stays_open():
    assert D["classification"] == "RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN"
    assert "RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN" in REP
    assert "No classification was upgraded" in REP


@test
def t18_the_report_records_four_routes_not_three():
    assert "Four independent routes" in REP
    assert "## Route 4" in REP
    assert "ALTERNATIVE_FAIR1_WALK_BVH = NOT_FOUND" in REP
    # route 1 of the unblock list is struck through, not deleted
    assert "~~**A fair1/HumanIK-skeleton walking clip under a permissive licence.**~~" in REP


@test
def t19_the_search_itself_spent_nothing_and_wrote_nothing_executable():
    """This loop is a research loop: it adds a record, not a code path."""
    assert not (SCRIPTS / "permissive_fair1_fetch.py").exists()
    assert not (G / "experimental_source_bvh_adapter").exists()
    assert D["downloads"]["bvh_downloaded"] == 0


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
