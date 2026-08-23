#!/usr/bin/env python3
"""Regression tests for the route-5B knee reference-pose finding.

These pin the CAUSAL MECHANISM, not one rendered pixel:

  the accepted damper references both knees to the SHARED frame 0. A walk's
  legs are in ANTIPHASE, so frame 0 is a different point of each leg's cycle.
  A scale that is symmetric in ROTATION space about a phase-ASYMMETRIC
  reference therefore produces an ASYMMETRIC change in knee-flexion depth.

If that mechanism is ever fixed, or ever regresses, these fail.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

SC = Path("/tmp/claude-0/-home-user-oniq-sparkle-pay/"
          "65e4b369-079b-5eca-8708-c0c1cc6772c6/scratchpad")
R5 = SC / "eld/route5b"
SRC = SC / "l3amp/AD_meshx/examples/bvh/fair1/zombie.bvh"
sys.path.insert(0, str(SC / "genloop/v3"))
import kneeprobe as KP  # noqa: E402

L = ("LeftUpLeg", "LeftLeg", "LeftFoot")
R = ("RightUpLeg", "RightLeg", "RightFoot")
WIN = 129
EXP = json.loads((R5 / "KNEE_REFERENCE_EXPERIMENT.json").read_text())
PIX = json.loads((R5 / "KNEE_REFERENCE_PIXELS.json").read_text())
ORD = json.loads((R5 / "KNEE_CAUSE_ORDERING.json").read_text())
T = []


def test(fn):
    T.append(fn)
    return fn


def angle(pos, chain):
    a, b, c = pos[chain[0]], pos[chain[1]], pos[chain[2]]
    u, v = a - b, c - b
    return float(np.degrees(np.arccos(
        np.clip(u @ v / (np.linalg.norm(u) * np.linalg.norm(v)), -1, 1))))


def curves(path, n=WIN):
    j, d, nf, ft = KP.parse(str(path))
    n = min(n, nf)
    return np.array([(angle(KP.fk(j, d[f])[0], L), angle(KP.fk(j, d[f])[0], R))
                     for f in range(n)])


def asym(a):
    return abs(float(a[:, 1].min()) - float(a[:, 0].min()))


# ------------------------------------------------- the defect being pinned
@test
def t01_the_accepted_frame0_damper_AMPLIFIES_the_left_right_asymmetry():
    """This is the defect. If it ever stops being true, the driver changed."""
    raw = asym(curves(SRC))
    ctrl = asym(curves(R5 / "knee050_ref_frame0.bvh"))
    assert raw < ctrl, (
        f"frame-0-referenced damping should AMPLIFY the asymmetry "
        f"(raw {raw:.3f} -> {ctrl:.3f}); it no longer does")
    assert ctrl / raw > 1.8, f"amplification factor collapsed: {ctrl / raw:.2f}"


@test
def t02_the_phase_asymmetry_of_frame0_is_real_not_assumed():
    """Frame 0 must sit at a different point of each leg's cycle."""
    raw = curves(SRC)
    f0l, f0r = raw[0, 0], raw[0, 1]
    assert abs(f0l - f0r) > 5.0, (
        "frame 0 is nearly symmetric between the legs, so the phase-asymmetric-"
        "reference explanation would not hold")
    # and the two legs reach their minima at clearly different frames
    assert abs(int(raw[:, 0].argmin()) - int(raw[:, 1].argmin())) > 10


# ------------------------------------------------- the candidate
@test
def t03_per_leg_extension_reference_does_not_amplify():
    raw = asym(curves(SRC))
    cand = asym(curves(R5 / "knee050_ref_extension.bvh"))
    assert cand <= raw + 1e-6, (
        f"the candidate must not amplify the asymmetry (raw {raw:.3f} -> "
        f"{cand:.3f})")


@test
def t04_candidate_beats_the_accepted_control_on_asymmetry():
    ctrl = asym(curves(R5 / "knee050_ref_frame0.bvh"))
    cand = asym(curves(R5 / "knee050_ref_extension.bvh"))
    assert cand < ctrl * 0.6, f"control {ctrl:.3f}, candidate {cand:.3f}"


@test
def t05_over_curl_removal_is_not_traded_away():
    """Acceptance 1: the candidate must remove over-curl as completely."""
    for f in ("knee050_ref_frame0.bvh", "knee050_ref_extension.bvh"):
        a = curves(R5 / f)
        assert int((a[:, 0] < 120).sum()) == 0, f
        assert int((a[:, 1] < 120).sum()) == 0, f
    raw = curves(SRC)
    assert int((raw[:, 0] < 120).sum()) > 0 and int((raw[:, 1] < 120).sum()) > 0, \
        "the raw source must still exhibit the over-curl the damper exists to fix"


@test
def t06_right_knee_improves_and_left_does_not_regress():
    ctrl, cand = curves(R5 / "knee050_ref_frame0.bvh"), curves(R5 / "knee050_ref_extension.bvh")
    assert cand[:, 1].min() > ctrl[:, 1].min() + 1.0, "right knee must straighten"
    assert cand[:, 0].min() >= ctrl[:, 0].min() - 1.0, "left knee must not regress"


@test
def t07_mean_reference_is_rejected_for_a_measured_reason():
    """`mean` symmetrises by making the RIGHT knee worse. Recorded, not hidden."""
    ctrl, mean = curves(R5 / "knee050_ref_frame0.bvh"), curves(R5 / "knee050_ref_mean.bvh")
    assert mean[:, 1].min() < ctrl[:, 1].min(), (
        "the recorded reason for rejecting `mean` is that it bends the right "
        "knee further than the accepted control; if that stops being true the "
        "rejection needs revisiting")


# ------------------------------------------------- preservation
@test
def t08_nothing_outside_the_two_knee_joints_moves():
    for mode in ("frame0", "extension", "mean"):
        p = EXP["conditions"][f"KNEE 0.50 ref={mode}"]["preservation"]
        assert p["all_zero"] is True, mode
        assert p["frame_count_preserved"] and p["frame_time_preserved"], mode


@test
def t09_foot_contact_is_compared_on_the_plateau_not_the_argmin():
    """The stance minimum is flat; argmin alone would fabricate a shift."""
    def plateau(path):
        j, d, nf, ft = KP.parse(str(path))
        r = np.array([KP.fk(j, d[f])[0]["RightFoot"][1] for f in range(WIN)])
        lo = r.min() + 0.02 * (r.max() - r.min())
        idx = np.where(r <= lo)[0]
        return int(idx.min()), int(idx.max())
    ctrl, cand = plateau(R5 / "knee050_ref_frame0.bvh"), plateau(R5 / "knee050_ref_extension.bvh")
    assert ctrl == cand, f"stance plateau moved: {ctrl} vs {cand}"


@test
def t10_the_driver_contract_is_still_six_channels_two_knees_scale_050():
    assert EXP["held_constant"]["scale"] == 0.50
    assert EXP["held_constant"]["channels"] == 6
    assert sorted(EXP["held_constant"]["joints"]) == ["LeftLeg", "RightLeg"]
    assert EXP["held_constant"]["layer"] == "SOURCE BVH"
    for k in ("clamp", "smoothing", "foot_pinning", "retiming",
              "amplitude_correction"):
        assert EXP["held_constant"][k] is None, k
    assert EXP["single_variable"] == "reference pose only"


@test
def t11_control_reproduces_production_byte_for_byte():
    """The harness is only trustworthy if ref=frame0 IS the shipped damper."""
    out = Path("/tmp/_t11_prod.bvh")
    subprocess.run([sys.executable, str(SC / "genloop/v3/b3_knee_damp.py"),
                    str(SRC), str(out), "0.50"], check=True,
                   capture_output=True)
    a = hashlib.sha256(out.read_bytes()).hexdigest()
    b = hashlib.sha256((R5 / "knee050_ref_frame0.bvh").read_bytes()).hexdigest()
    assert a == b, "the experimental control diverged from the production damper"


@test
def t12_production_damper_source_is_unmodified():
    src = (SC / "genloop/v3/b3_knee_damp.py").read_text()
    assert "f0 = [float(v) for v in frames[0]]" in src, (
        "production still references frame 0 — this experiment did NOT change it")
    for banned in ("clamp", "np.clip", "min(max("):
        assert banned not in src, banned


# ------------------------------------------------- causal ordering
@test
def t13_representation_causes_were_excluded_before_touching_motion():
    assert ORD["representation_causes_excluded"] is True
    got = {c["check"]: c["verdict"] for c in ORD["checks"]}
    assert got["1_joint_mapping"] == "NOT_THE_CAUSE"
    assert got["2_rotation_order"] == "NOT_THE_CAUSE"
    assert got["3_axis_sign_conversion"] == "NOT_THE_CAUSE"
    assert got["6_driver_interpretation"] == "CONTRACT_CLEAN"


@test
def t14_the_window_dependence_of_the_asymmetry_is_recorded():
    """Right-deeper is a property of the 129-frame window, not the whole clip."""
    full = curves(SRC, 779)
    win = curves(SRC, WIN)
    assert full[:, 0].min() < full[:, 1].min(), "full clip: LEFT is the deeper knee"
    assert win[:, 1].min() < win[:, 0].min(), "window: RIGHT is the deeper knee"


# ------------------------------------------------- pixels + honesty
@test
def t15_pixel_frames_were_fixed_before_inspection():
    assert "BEFORE any pixel was inspected" in PIX["methodology"]
    assert PIX["frames_inspected"] == [0, 27, 101, 126]
    for f in ("0", "27", "101", "126"):
        assert "raw" in PIX["per_frame"][f] and "frame0" in PIX["per_frame"][f]


@test
def t16_no_candidate_touches_the_render_border():
    for f, row in PIX["per_frame"].items():
        for cond, m in row.items():
            if isinstance(m, dict) and "touches_border" in m:
                assert m["touches_border"] is False, (f, cond)


@test
def t17_nothing_here_claims_anything_about_100style():
    for doc in (EXP, ORD):
        assert "100STYLE" in doc["scope"] and "unacquired" in doc["scope"]
    assert not (SC / "eld/generalization/100STYLE_BVH_STRUCTURE.json").exists()
    assert not (SC / "eld/generalization/SOURCE_BVH_COMPARISON.json").exists()


@test
def t18_production_remains_locked():
    run = json.loads((SC / "eld/evidence/ENGINEERING_REFERENCE_RUN.json").read_text())
    assert run["generation_allowed"] is False
    lib = json.loads((SC / "eld/engineering_numeric/"
                      "ENGINEERING_NUMERIC_LIBRARY.json").read_text())
    assert sum(1 for r in lib["records"] if r["productionEligible"]) == 0
    tr = json.loads((SC / "eld/evidence/run1/ENGINEERING_TRACE.json").read_text())
    assert tr["knee_driver"]["scale"] == 0.50


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
