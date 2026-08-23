#!/usr/bin/env python3
"""Regression tests for the 100STYLE independent-source experiment.

Outcome under test: ACQUISITION_BLOCKED_BY_NETWORK_POLICY. Two fail-closed
stop conditions were met (licence unverifiable from the authoritative source,
BVH undownloadable), so no adapter was built and A/B/C/D never ran.

These tests exist so a later loop cannot quietly relax any of that: accept a
redistributor's licence notice as the gate, substitute a retargeted third-party
export for the unedited source, mint an unvalidated mapping, or report a
condition that did not run.
"""
import json
import re
from pathlib import Path

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
G = SC / "eld/generalization"
SCRIPTS = SC / "eld/remotion/scripts"

P = json.loads((G / "100STYLE_SOURCE_PROVENANCE.json").read_text())
LIC = (G / "100STYLE_LICENSE.md").read_text()
REP = (G / "SOURCE_BVH_GENERALIZATION_REPORT.md").read_text()
T = []


def test(fn):
    T.append(fn)
    return fn


# ------------------------------------------------------------ fail-closed
@test
def t01_two_stop_conditions_met_and_named():
    assert P["result"] == "ACQUISITION_BLOCKED_BY_NETWORK_POLICY"
    assert P["outcome_class"] == "FAIL_CLOSED_two_stop_conditions_met"
    sc = P["stop_conditions_met"]
    assert len(sc) == 2
    assert any("license cannot be verified" in s for s in sc)
    assert any("BVH cannot be downloaded" in s for s in sc)


@test
def t02_nothing_downstream_of_a_stop_condition_ran():
    assert P["adapter_built"] is False
    assert P["experiment_run"] is False
    assert P["conditions_run"] == {"A": False, "B": False, "C": False, "D": False}


@test
def t03_licence_gate_did_not_pass():
    assert P["licence_status"] == "NOT_VERIFIED_FROM_THE_AUTHORITATIVE_SOURCE"
    assert "LICENCE = NOT_VERIFIED_FROM_THE_AUTHORITATIVE_SOURCE" in LIC
    # and the report must not claim otherwise anywhere
    for claim in ("licence verified", "licence gate passed", "LICENSE = PASS"):
        assert claim.lower() not in REP.lower(), claim


# ------------------------------------------------------------ evidence grading
@test
def t04_redistributor_evidence_is_graded_as_corroboration_not_as_the_gate():
    c = P["corroborating_evidence_only"]
    assert c["grade"].startswith("THIRD_PARTY_REDISTRIBUTOR")
    assert "NOT the licence gate" in c["grade"]
    assert "why_this_does_not_pass_the_gate" in c
    assert "still not the upstream author's own statement" in \
        c["why_this_does_not_pass_the_gate"]
    assert "still not the gate" in REP


@test
def t05_corroborating_fetches_carry_status_and_sha():
    c = P["corroborating_evidence_only"]
    assert c["license_http"] == 200 and c["readme_http"] == 200
    for k in ("license_sha256", "readme_sha256"):
        assert re.fullmatch(r"[0-9a-f]{64}", c[k]), k
    assert c["license_bytes"] == 18650
    assert c["license_first_line"] == "Attribution 4.0 International"
    assert c["noncommercial_or_noderivatives_strings_found"] == 0


@test
def t06_the_block_is_evidenced_against_a_working_control():
    r = P["reachability"]
    assert r["control_host_proving_the_network_works"]["http"] == 200
    hosts = {b["host"] for b in r["blocked"]}
    for must in ("ianxmason.github.io", "zenodo.org", "datashare.ed.ac.uk",
                 "www.ianxmason.com", "doi.org"):
        assert must in hosts, must
    # each authoritative host must say what it would have supplied
    for b in r["blocked"]:
        assert b["would_have_supplied"], b["host"]


@test
def t07_no_repository_path_was_guessed_around_a_404():
    g = P["path_guessing_policy"]
    assert "no repository path was guessed" in g["rule"]
    assert "NOT probed further" in g["note"]
    assert P["add_repo_attempt"]["retried"] is False


# ------------------------------------------------------------ no substitution
@test
def t08_the_retargeted_third_party_export_was_refused():
    sub = next(s for s in P["rejected_substitutes"]
               if "100style-retarget" in s["candidate"])
    assert sub["verdict"] == "REJECTED"
    joined = " ".join(sub["reasons"]).lower()
    for reason in ("retargeted", "motion-editing", "sha-256", "geno"):
        assert reason in joined, reason
    assert "was NOT used" in sub["note"]


@test
def t09_no_third_party_character_asset_entered_the_tree():
    for bad in ("Geno.fbx", "Geno.bvh", "geno"):
        hits = list(G.glob(f"**/*{bad}*"))
        assert not hits, hits
    assert P["cost"]["bvh_downloaded"] == 0


@test
def t10_no_dependent_artifact_was_fabricated():
    for f in ("100STYLE_SHA256.txt", "100STYLE_BVH_STRUCTURE.json",
              "100STYLE_TO_ONIQ_MAPPING.json", "100STYLE_ADAPTER_VALIDATION.json",
              "100STYLE_GAIT_VALIDATION.json", "SOURCE_BVH_COMPARISON.json",
              "SOURCE_BVH_KNEE_CURVES.json", "SOURCE_BVH_PIXEL_DIAGNOSTICS.json"):
        assert not (G / f).exists(), f"{f} must not exist — its input does not"
        assert f in P["artifacts_not_produced"], f
    assert len(P["artifacts_not_produced"]) == 8


@test
def t11_the_two_artifacts_that_do_exist_are_records_of_the_block():
    assert (G / "100STYLE_SOURCE_PROVENANCE.json").exists()
    assert (G / "100STYLE_LICENSE.md").exists()
    assert not (SC / "eld/experimental_source_bvh_adapter").exists()
    assert not (G / "experimental_source_bvh_adapter").exists()


@test
def t12_no_mapping_was_written_without_the_file():
    why = P["artifacts_not_produced"]["100STYLE_TO_ONIQ_MAPPING.json"]
    assert "inventing joints" in why
    assert "not** as a mapping artifact" in REP or \
        "not*** as a mapping artifact" in REP or \
        "**not** as a mapping artifact" in REP


# ------------------------------------------------------------ pipeline intact
@test
def t13_driver_untouched_050_six_channels_bilateral():
    d = P["driver_unchanged"]
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
def t14_production_retarget_config_untouched():
    cfg = (SC / "eld/evidence/run1/retarget_engineering.yaml").read_text()
    assert "LeftUpLeg" in cfg
    # no 100STYLE joint name may have leaked into the ONIQ config
    for src_name in ("LeftKnee", "RightKnee", "LeftAnkle", "RightAnkle",
                     "LeftHip", "RightHip"):
        assert src_name not in cfg, src_name


@test
def t15_generation_still_forbidden_and_nothing_promoted():
    run = json.loads((SC / "eld/evidence/ENGINEERING_REFERENCE_RUN.json").read_text())
    assert run["generation_allowed"] is False
    lib = json.loads((SC / "eld/engineering_numeric/"
                      "ENGINEERING_NUMERIC_LIBRARY.json").read_text())
    assert len(lib["records"]) == 1000
    assert sum(1 for r in lib["records"] if r["productionEligible"]) == 0


@test
def t16_determinism_policy_unchanged():
    tr = json.loads((SC / "eld/evidence/run1/ENGINEERING_TRACE.json").read_text())
    d = tr["determinism"]
    assert d["policy"] == "PER_HOST / PER_CPU_CLASS"
    assert d["rebaselined_fixtures"] is False


# ------------------------------------------------------------ classification
@test
def t17_asymmetry_is_not_promoted():
    assert P["classification"] == "RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN"
    assert "RIGHT_KNEE_ASYMMETRY = MEASUREMENT_OPEN" in REP
    for banned in ("biological", "anatomical", "universal", "production-ready"):
        # the report may only use these words to say the finding is NOT that
        for line in REP.splitlines():
            if banned in line.lower():
                assert ("not" in line.lower() or "never" in line.lower()
                        or "cannot" in line.lower()), line


@test
def t18_untested_classes_stay_untested():
    for cls in ("ADAPTER FINDING", "DRIVER FINDING", "MOTION-SOURCE FINDING",
                "POTENTIALLY-GENERALIZED"):
        assert cls in REP, cls
    assert "**NONE. UNTESTED.**" in REP
    assert "Nothing may be moved into this class" in REP


@test
def t19_report_records_five_routes():
    assert "Five independent routes" in REP
    assert "## Route 5" in REP
    assert "No classification was upgraded" in REP


@test
def t20_two_leg_fraction_stays_diagnostic_only():
    assert "DIAGNOSTIC ONLY" in REP
    assert "per character and" in REP


@test
def t21_the_unblock_is_named_as_an_owner_decision():
    u = P["what_unblocks_this"]
    assert "zenodo.org" in u["minimum_hosts"]
    assert "owner decision" in u["note"]
    assert "attach" in u["second_route"].lower()


@test
def t22_zero_spend():
    assert P["cost"] == {"api_inr": 0, "gpu_inr": 0,
                         "bvh_downloaded": 0, "new_images": 0}


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
