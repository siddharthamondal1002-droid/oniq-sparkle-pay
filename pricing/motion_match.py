#!/usr/bin/env python3
"""MOTION_REQUEST_MATCH — did the model do the thing that was ASKED?

This exists because the v1 gate could not tell the difference. On c04_turning
Lite produced drifting dust over a static image: the clip moved, so the
aliveness check passed, but no turn happened. Aliveness is not adherence, and
reporting it as adherence would have been a lie about what was measured.

States: PASS / FAIL / UNMEASURABLE.

UNMEASURABLE is used deliberately and is not a failure of nerve. "Her lips move
as she talks" and "she opens her fingers" have no test at this resolution that
would not also pass on unrelated motion. A test that cannot distinguish the
requested motion from any motion is worse than no test, because it launders a
guess as a measurement.

Inputs come from track() in the benchmark runner, which reports per frame:
    bbox (subject extent), centroid, motion energy split upper/lower and
    inside/outside the subject box.
"""

# thresholds are stated as fractions of frame dimensions so they do not depend
# on the analysis resolution
CENTROID_SHIFT_MIN = 0.060     # of frame width — a walk crosses ground
SCALE_GROWTH_MIN = 0.120       # of starting subject height — a push-in enlarges
WIDTH_CHANGE_MIN = 0.150       # of starting subject width — a turn reshapes
LOWER_DOMINANCE_MIN = 1.35     # lower-half energy / upper-half energy
GLOBAL_MOTION_MIN = 0.80       # outside-subject energy / total energy
OFF_SUBJECT_MIN = 1.20         # outside / inside energy
SUBJECT_STABLE_MAX = 0.040     # of frame width — "the figure stays still"
ENERGY_FLOOR = 50.0            # total inter-frame energy below this = a dead clip

# CALIBRATION, measured on reference clips with known motion (see
# ONIQ_VEO_LITE_VS_FAST_BENCHMARK.md). Thresholds are set so the plausible
# CONFOUNDER sits far below, not merely so the positive sits above:
#   global_motion 0.80 : camera 0.98 passes; walk 0.36 and push-in 0.35 -- the
#                        two things most likely to be mistaken for a camera
#                        move -- fail with a wide margin.
#   off_subject   1.20 : environment inf passes with drift 0.017; walk 0.56
#                        fails; camera fails on drift 0.045 > 0.040, which is
#                        correct because a camera arc is not environmental motion.

UNMEASURABLE = "UNMEASURABLE"


def _res(name, ok, detail):
    return {"test": name, "result": "PASS" if ok else "FAIL", "detail": detail}


def centroid_x_displacement(t):
    """Walking: the subject must actually travel across the ground."""
    cx = t["centroid_x"]
    if len(cx) < 2:
        return _res("centroid_x_displacement", False, "no track")
    shift = max(abs(x - cx[0]) for x in cx)
    return _res("centroid_x_displacement", shift >= CENTROID_SHIFT_MIN,
                f"max centroid shift {shift:.3f} of width (min {CENTROID_SHIFT_MIN})")


def subject_scale_increase(t):
    """Push-in: the subject must get bigger."""
    h = t["bbox_h"]
    if len(h) < 2 or h[0] <= 0:
        return _res("subject_scale_increase", False, "no track")
    growth = (max(h) - h[0]) / h[0]
    return _res("subject_scale_increase", growth >= SCALE_GROWTH_MIN,
                f"subject height grew {growth:+.1%} (min {SCALE_GROWTH_MIN:.0%})")


def silhouette_width_change(t):
    """Turning: a body rotating changes its silhouette width."""
    w = t["bbox_w"]
    if len(w) < 2 or w[0] <= 0:
        return _res("silhouette_width_change", False, "no track")
    change = max(abs(x - w[0]) for x in w) / w[0]
    return _res("silhouette_width_change", change >= WIDTH_CHANGE_MIN,
                f"silhouette width changed {change:.1%} (min {WIDTH_CHANGE_MIN:.0%})")


def lower_half_motion_dominant(t):
    """Lower-body motion: the legs must carry the movement, not the head."""
    up, lo = t["energy_upper"], t["energy_lower"]
    if up <= 0:
        return _res("lower_half_motion_dominant", lo > 0, "no upper-half energy")
    ratio = lo / up
    return _res("lower_half_motion_dominant", ratio >= LOWER_DOMINANCE_MIN,
                f"lower/upper energy {ratio:.2f} (min {LOWER_DOMINANCE_MIN})")


def global_motion_present(t):
    """Camera move: the whole frame shifts, not just the subject."""
    tot = t["energy_inside"] + t["energy_outside"]
    if tot <= 0:
        return _res("global_motion_present", False, "no motion at all")
    frac = t["energy_outside"] / tot
    return _res("global_motion_present", frac >= GLOBAL_MOTION_MIN,
                f"{frac:.1%} of motion energy is off-subject (min {GLOBAL_MOTION_MIN:.0%})")


def motion_off_subject(t):
    """Environmental motion: things move AROUND a figure that stays put."""
    ins, out = t["energy_inside"], t["energy_outside"]
    cx = t["centroid_x"]
    drift = max(abs(x - cx[0]) for x in cx) if len(cx) > 1 else 1.0
    # A dead clip has zero energy everywhere, which gives an infinite off/on
    # ratio and zero drift — i.e. it would score as perfect environmental
    # motion. Caught on a static reference clip; require real motion first.
    if (ins + out) < ENERGY_FLOOR:
        return _res("motion_off_subject", False,
                    f"total motion energy {ins + out:.1f} below floor {ENERGY_FLOOR} "
                    "— nothing moved, so nothing moved around the subject either")
    ratio = (out / ins) if ins > 0 else float("inf")
    ok = ratio >= OFF_SUBJECT_MIN and drift <= SUBJECT_STABLE_MAX
    return _res("motion_off_subject", ok,
                f"off/on-subject energy {ratio:.2f} (min {OFF_SUBJECT_MIN}), "
                f"subject drift {drift:.3f} (max {SUBJECT_STABLE_MAX})")


TESTS = {
    "centroid_x_displacement": centroid_x_displacement,
    "subject_scale_increase": subject_scale_increase,
    "silhouette_width_change": silhouette_width_change,
    "lower_half_motion_dominant": lower_half_motion_dominant,
    "global_motion_present": global_motion_present,
    "motion_off_subject": motion_off_subject,
}


def match(track, adherence_test):
    """Returns PASS / FAIL / UNMEASURABLE for one clip."""
    if adherence_test == UNMEASURABLE or adherence_test not in TESTS:
        return {"test": adherence_test, "result": UNMEASURABLE,
                "detail": "no defensible automatic test at this resolution; "
                          "defer to human assessment, never counted as a pass"}
    if not track or not track.get("centroid_x"):
        return {"test": adherence_test, "result": "FAIL", "detail": "no subject track"}
    return TESTS[adherence_test](track)


def summarise(rows):
    """Adherence is reported over MEASURABLE cases only — never inflated by
    counting UNMEASURABLE as a pass, and never deflated by counting it a fail."""
    meas = [r for r in rows if r["result"] in ("PASS", "FAIL")]
    return {
        "measurable": len(meas),
        "unmeasurable": len(rows) - len(meas),
        "pass": sum(1 for r in meas if r["result"] == "PASS"),
        "fail": sum(1 for r in meas if r["result"] == "FAIL"),
        "adherence_over_measurable": (
            sum(1 for r in meas if r["result"] == "PASS") / len(meas)) if meas else None,
    }
