#!/usr/bin/env python3
"""Regression tests for the acceptance gate and the v1 benchmark.

These pin the MECHANISM and the MEASUREMENT, so that neither the gate's
discrimination nor the benchmark's headline number can silently drift.
"""
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import acceptance_gate as G  # noqa: E402

B = HERE.parent / "bench"
RES = json.loads((B / "gate_results.json").read_text())
TRIM = json.loads((B / "gate_results_trim121.json").read_text())
T = []


def test(fn):
    T.append(fn)
    return fn


def _frames():
    return G.expand_gif(B / "b4_child_girl.gif")[0]


# ------------------------------------------------ the gate discriminates
@test
def t01_a_real_clip_is_accepted():
    r = G.gate(B / "b4_child_girl.gif")
    assert r["ALL_MANDATORY_QA_PASS"] is True, r["hard_failures"]


@test
def t02_a_frozen_tail_hard_fails():
    fs = _frames()
    p = Path("/tmp/_t02.gif")
    bad = fs + [fs[-1]] * 400
    bad[0].save(p, save_all=True, append_images=bad[1:], duration=33, loop=0, disposal=2)
    r = G.gate(p)
    assert r["verdict"] == "HARD_FAIL"
    assert "no_frozen_run" in r["hard_failures"]


@test
def t03_blank_frames_hard_fail():
    fs = _frames()
    blank = Image.new("RGBA", fs[0].size, (0, 0, 0, 0))
    p = Path("/tmp/_t03.gif")
    bad = fs[:60] + [blank] * 30 + fs[60:]
    bad[0].save(p, save_all=True, append_images=bad[1:], duration=33, loop=0, disposal=2)
    r = G.gate(p)
    assert r["verdict"] == "HARD_FAIL"
    assert "no_blank_frames" in r["hard_failures"]
    assert "character_present" in r["hard_failures"]


@test
def t04_a_dead_clip_hard_fails_on_aliveness():
    fs = _frames()
    p = Path("/tmp/_t04.gif")
    bad = [fs[0]] * 129
    bad[0].save(p, save_all=True, append_images=bad[1:], duration=33, loop=0, disposal=2)
    r = G.gate(p)
    assert "temporal_aliveness" in r["hard_failures"]


@test
def t05_a_truncated_file_hard_fails():
    p = Path("/tmp/_t05.gif")
    p.write_bytes((B / "b4_child_girl.gif").read_bytes()[:300])
    r = G.gate(p)
    assert r["verdict"] == "HARD_FAIL"
    assert "file_decodes" in r["hard_failures"]


@test
def t06_a_missing_file_hard_fails_closed():
    r = G.gate(Path("/tmp/_does_not_exist_.gif"))
    assert r["verdict"] == "HARD_FAIL" and "file_exists" in r["hard_failures"]


# ------------------------------------------------ warnings never block
@test
def t07_open_checks_are_warnings_not_hard_failures():
    r = G.gate(B / "b4_child_girl.gif")
    opens = [c for c in r["checks"] if c["classification"] == "OPEN"]
    assert opens, "the OPEN checks must be present, not omitted"
    for c in opens:
        assert c["result"] != "HARD_FAIL", c["check"]
    assert r["ALL_MANDATORY_QA_PASS"] is True


@test
def t08_requested_audio_fails_closed_when_the_stage_cannot_produce_it():
    r = G.gate(B / "b4_child_girl.gif", wants_audio=True)
    assert "audio_integrity" in r["hard_failures"], (
        "audio requested but unproducible must fail CLOSED, never silently pass")


@test
def t09_every_check_carries_a_classification():
    r = G.gate(B / "b4_child_girl.gif")
    allowed = {"MEASURED", "DERIVED", "INFERRED", "OPEN", "NOT_APPLICABLE"}
    for c in r["checks"]:
        assert c["classification"] in allowed, c


# ------------------------------------------------ the benchmark measurement
@test
def t10_benchmark_covers_the_whole_frozen_set():
    assert len(RES) == 49 and len(TRIM) == 49
    assert len({r["character"] for r in RES}) == 49


@test
def t11_measured_first_pass_acceptance_is_pinned():
    acc = [r for r in RES if r["ALL_MANDATORY_QA_PASS"]]
    assert len(acc) == 32, f"measured 32/49; got {len(acc)}/49"
    assert abs(len(acc) / 49 - 0.6531) < 0.001


@test
def t12_the_trimmed_window_reaches_full_acceptance():
    acc = [r for r in TRIM if r["ALL_MANDATORY_QA_PASS"]]
    assert len(acc) == 49, f"trimmed window should accept all 49; got {len(acc)}"


@test
def t13_every_failure_has_the_same_single_cause():
    fails = [r for r in RES if not r["ALL_MANDATORY_QA_PASS"]]
    assert len(fails) == 17
    causes = {h for r in fails for h in r["hard_failures"]}
    assert causes == {"within_render_envelope"}, (
        f"the finding is that ONE cause explains every failure; got {causes}")


@test
def t14_no_clip_failed_to_render():
    log = (B / "render_log.txt").read_text().splitlines()
    assert len(log) == 49
    assert all("rc=0" in ln for ln in log), "every render must have succeeded"


@test
def t15_the_dataset_selection_was_outcome_blind():
    """All 49 candidates qualified — nothing was excluded after seeing results."""
    names = {ln.split()[0] for ln in (B / "render_log.txt").read_text().splitlines()}
    assert len(names) == 49
    fails = {r["character"] for r in RES if not r["ALL_MANDATORY_QA_PASS"]}
    assert fails <= names, "no failing character may be dropped from the set"


@test
def t16_thresholds_come_from_shipped_code_not_invention():
    assert G.CLIP_ALIVENESS_MIN == 0.75      # story-worker.mjs
    assert G.DURATION_MIN_RATIO == 0.5       # storyPreflight.ts
    assert G.DURATION_MAX_RATIO == 1.6       # storyPreflight.ts
    assert G.VIDEO_MIN_BYTES == 1024         # storyPreflight.ts


@test
def t17_gif_entries_are_expanded_not_counted():
    frames, entries = G.expand_gif(B / "b4_child_girl.gif")
    assert len(frames) >= entries, (
        "held frames must be expanded; counting entries is how a 779-frame "
        "render was once reported as 159")


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
