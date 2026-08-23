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


# ------------------------------------------------- the resume from gate 1
@test
def t23_gate1_was_actually_re_run_not_assumed_from_the_last_result():
    a = P["gate1_attempts"]
    assert len(a) >= 2, "a resume must re-run the gate, not cite the old outcome"
    second = a[1]
    assert second["from_commit"] == "9c4c26a8"
    assert second["step_1_attached_source_bvh"]["checked"] is True
    assert second["step_2_authoritative_acquisition"]["attempted"] is True
    assert second["result"] == "BLOCKED"


@test
def t24_the_attached_bvh_check_ran_and_found_nothing():
    s = P["gate1_attempts"][1]["step_1_attached_source_bvh"]
    assert s["result"] == "NO_ATTACHED_SOURCE_BVH"
    assert "BOTH EMPTY" in s["mounts_state"]
    assert "/mnt/attach" in s["mounts_inspected"]
    assert "/mnt/user-data/working" in s["mounts_inspected"]
    # every .bvh it did find must be an ONIQ fixture, never mistaken for source
    assert s["bvh_files_found"]
    for f in s["bvh_files_found"]:
        assert "genloop/v3/_t" in f, f
    assert "None is a 100STYLE file" in s["bvh_files_found_note"]


@test
def t25_ownfixtures_were_not_promoted_into_a_source():
    """An ONIQ test fixture must never be dressed up as the independent source."""
    for f in P["gate1_attempts"][1]["step_1_attached_source_bvh"]["bvh_files_found"]:
        assert "100STYLE" not in f
    assert P["evidence_classes"]["AUTHORITATIVE_EVIDENCE"] == []
    assert P["cost"]["bvh_downloaded"] == 0


@test
def t26_the_block_is_shown_to_be_persistent_not_transient():
    p = P["persistence"]
    assert p["probes"] >= 2 and p["identical_outcome"] is True
    assert p["separation_minutes"] >= 10
    assert "persistent policy denial" in p["conclusion"]
    flat = " ".join(REP.split()).replace("**", "")
    assert "persistent policy denial, not a transient outage" in flat


@test
def t27_every_file_property_stays_unresolved_rather_than_invented():
    e = P["evidence_classes"]
    for field in ("sha256", "file_size", "joint_hierarchy", "channel_order",
                  "rotation_order", "rest_pose", "axis_convention",
                  "frame_count", "frame_time"):
        assert field in e["UNRESOLVED_FIELDS"], field
    assert e["ASSUMPTIONS"] == [], "no assumption may stand in for a measurement"
    assert "None was invented" in e["unresolved_fields_note"]


@test
def t28_evidence_classes_keep_authoritative_and_corroborating_apart():
    e = P["evidence_classes"]
    assert e["AUTHORITATIVE_EVIDENCE"] == []
    assert len(e["CORROBORATING_EVIDENCE"]) >= 1
    assert all("does NOT satisfy the gate" in c or "recorded" in c
               for c in e["CORROBORATING_EVIDENCE"])
    assert e["MEASURED_FACT"] and e["DERIVED_MEASUREMENT"]


@test
def t29_the_selection_rule_was_fixed_before_any_outcome_was_seen():
    r = P["source_selection_rule"]
    assert r["defined_before_any_outcome_was_seen"] is True
    assert r["applied"] is False
    assert "lexicographically first" in r["rule"], "the rule must be deterministic"
    assert "_FW" in r["rule"]
    for excluded in ("running", "sidestep", "backward", "transition", "idle"):
        assert excluded in r["rule"], excluded
    assert "cannot later be tuned" in r["applied_note"]


# ------------------------------------- the post-authorization gate 1 re-run
@test
def t31_gate1_was_re_run_after_the_authorization_not_assumed_blocked():
    """An authorization claim must be TESTED, not disbelieved and skipped."""
    a = [x for x in P["gate1_attempts"] if x["attempt"] == 3]
    assert a, "the post-authorization run must be recorded as its own attempt"
    a = a[0]
    assert a["from_commit"] == "95618a29"
    assert "authorized" in a["trigger"]
    assert a["result"] == "BLOCKED"


@test
def t32_all_seven_gate1_checks_are_reported_individually():
    c = P["gate1_attempts"][2]["gate1_checklist"]
    for k in ("1_zenodo_reachable", "2_ianxmason_reachable",
              "3_authoritative_licence_retrieved",
              "4_authoritative_source_record_retrieved",
              "5_unedited_bvh_downloaded", "6_sha256_computed",
              "7_provenance_tied_to_authoritative_source"):
        assert c[k] is False, k
    assert c["control_raw_githubusercontent"] is True


@test
def t33_propagation_lag_was_ruled_out_by_a_series_not_one_probe():
    s = P["gate1_attempts"][2]["probe_series"]
    assert s["attempts"] >= 6, "one failed probe cannot rule out propagation lag"
    assert s["spacing_seconds"] == 60
    assert s["terminal_line"] == "STILL_BLOCKED_AFTER_6_ATTEMPTS"
    # every probe must carry a live control alongside the failure
    for r in s["results"]:
        assert r["control"] == 200, r
        assert r["ianxmason"] == "000", r
    pa = P["persistence"]["post_authorization"]
    assert pa["any_success"] is False and pa["probes"] >= 6


@test
def t34_the_session_binding_idea_is_labelled_inferred_not_measured():
    ev = P["gate1_attempts"][2]["new_evidence_from_this_attempt"]
    inferred = [e for e in ev if e.startswith("INFERRED")]
    assert len(inferred) == 1
    assert "NOT verified" in inferred[0]
    assert "hypothesis" in inferred[0] and "not acted on" in inferred[0]
    assert any(e.startswith("MEASURED FACT") for e in ev)
    assert any(e.startswith("DERIVED MEASUREMENT") for e in ev)


@test
def t35_no_blocked_host_was_routed_around():
    """The proxy README forbids routing around a policy denial."""
    txt = json.dumps(P).lower()
    for banned in ("theorangeduck.com", "web.archive.org/web/2024",
                   "100style-retarget/master/bvh", "codeload", "mirror.download"):
        assert banned not in txt or "rejected" in txt or "blocked" in txt, banned
    assert P["rejected_substitutes"][0]["verdict"] == "REJECTED"
    assert P["cost"]["bvh_downloaded"] == 0


@test
def t36_target_side_mapping_is_measured_and_source_side_is_not_asserted():
    m = P["mapping_target_side"]
    assert m["status"].startswith("MEASURED")
    assert m["joint_count"] == 25 and len(set(m["joints"])) == 25
    assert "RightToeBase" in m["joints"] and "LeftToeBase" in m["joints"]
    t = m["toe_representation_question_answered"]
    assert t["evidence_class"] == "MEASURED FACT"
    assert "not BVH End Site markers" in t["answer"]
    assert m["source_side_status"].startswith("UNRESOLVED")
    assert "does NOT constitute a mapping" in m["note"]
    # and it must agree with the real config rather than a copy of it
    import yaml
    cfg = yaml.unsafe_load((SC / "eld/evidence/run1/retarget_engineering.yaml").read_text())
    real = set()
    for g in cfg["bvh_projection_bodypart_groups"]:
        real |= set(g["bvh_joint_names"])
    assert real == set(m["joints"]), "the recorded target skeleton must match the config"


@test
def t37_still_no_mapping_or_adapter_artifact_exists():
    assert not (G / "100STYLE_TO_ONIQ_MAPPING.json").exists()
    assert not (G / "100STYLE_ADAPTER_VALIDATION.json").exists()
    assert P["adapter_built"] is False
    assert P["conditions_run"] == {"A": False, "B": False, "C": False, "D": False}


@test
def t38_the_unblock_options_are_stated_without_choosing_for_the_owner():
    u = P["what_unblocks_this"]
    assert len(u["owner_options"]) >= 3
    joined = " ".join(u["owner_options"]).lower()
    assert "new session" in joined and "attach" in joined and "administrator" in joined
    assert "out of step" in u["status_2026_08_23"]


@test
def t30_decision_logic_returns_untested_not_a_forced_verdict():
    assert "`NOT_DEMONSTRATED`" in REP
    assert "`UNTESTED`" in REP
    assert "cannot be separated on" in REP
    assert "No conclusion is forced." in REP
    # the adapter verdict must not be spun as exoneration
    assert "not* evidence the adapter is innocent" in REP or \
        "*not* evidence the adapter is innocent" in REP


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
