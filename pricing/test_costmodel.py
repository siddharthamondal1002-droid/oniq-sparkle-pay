#!/usr/bin/env python3
"""Tests for the pricing registry and cost model.

These pin the things that quietly go wrong in a pricing layer: a stale rate
surviving a refactor, an undated FX constant, and the three-way conflation of
generated cost / accepted cost / customer price.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import costmodel as C  # noqa: E402
import veo_gate as G  # noqa: E402

REPO = Path("/home/user/oniq-sparkle-pay")
T = []


def test(fn):
    T.append(fn)
    return fn


# ------------------------------------------------------- registry integrity
@test
def t01_every_priced_entry_carries_a_source_and_a_date():
    for e in C.REG["entries"]:
        if e["usd_per_generated_second"] is None:
            assert e.get("status") == "PRICING_OPEN", e
            continue
        assert e["source"], f"{e['model']} has a price with no source"
        assert e["verified_at"], f"{e['model']} has a price with no date"


@test
def t02_the_fx_rate_is_sourced_and_dated_not_a_bare_constant():
    fx = C.REG["fx"]
    assert fx["source"] and fx["verified_at"]
    assert 50 < fx["rate"] < 200, fx["rate"]


@test
def t03_the_stale_015_rate_is_not_in_the_registry():
    """$0.15/s appears nowhere on Google's tier table. It must not come back."""
    for e in C.REG["entries"]:
        assert e["usd_per_generated_second"] != 0.15, e


@test
def t04_runway_is_unpriced_and_says_so():
    r = [e for e in C.REG["entries"] if e["provider"] == "runway"][0]
    assert r["usd_per_generated_second"] is None
    assert r["status"] == "PRICING_OPEN"
    try:
        C.rate("gen4", False)
    except ValueError:
        return
    raise AssertionError("asking for an unpriced rate must raise, not return a guess")


@test
def t05_lite_is_cheaper_than_fast_on_the_surface_oniq_uses():
    assert C.rate("lite", True) < C.rate("fast", True)


@test
def t05b_no_video_only_rate_is_reachable_on_ai_studio():
    """AI Studio sells one rate per Veo tier, audio bundled. The $0.03/$0.08
    video-only rates are Vertex-only. Asking for one must RAISE rather than
    return a number ONIQ cannot actually buy — every earlier table that used
    $0.03 understated cost by 67%."""
    assert C.REG["surface"]["video_only_tier_exists"] is False
    for m in ("lite", "fast"):
        try:
            C.rate(m, False)
        except KeyError:
            continue
        raise AssertionError(f"{m} returned a video-only rate; none exists on AI Studio")


# ------------------------------------------------------- the three quantities
@test
def t06_accepted_cost_is_never_below_generated_cost():
    gen = C.inr_per_generated_second("lite", True)
    for a in (0.3, 0.5, 0.75, 0.9, 1.0):
        acc = C.cost_per_accepted_second(gen, a, 2)
        assert acc >= gen - 1e-9, (a, acc, gen)


@test
def t07_accepted_cost_equals_generated_cost_only_at_perfect_acceptance():
    gen = C.inr_per_generated_second("lite", True)
    assert abs(C.cost_per_accepted_second(gen, 1.0, 2) - gen) < 1e-9
    assert C.cost_per_accepted_second(gen, 0.5, 2) > gen


@test
def t08_zero_acceptance_raises_rather_than_dividing_by_zero():
    try:
        C.cost_per_accepted_second(1.0, 0.0, 2)
    except ValueError:
        return
    raise AssertionError("acceptance 0 must raise, not silently produce a number")


@test
def t09_customer_price_covers_cost_fees_and_margin():
    """min_price_per_minute must actually leave the margin it promises."""
    for margin in (0.21, 0.26, 0.28):
        for a in (0.6, 0.8, 1.0):
            acc = C.cost_per_accepted_second(C.inr_per_generated_second("lite", True), a, 2)
            p = C.min_price_per_minute(acc, margin)
            contrib = C.contribution(p, 60, acc, acc)
            assert contrib >= p * margin - 0.01, (margin, a, p, contrib)


@test
def t10_the_registry_forbids_mixing_the_three_numbers():
    d = C.REG["do_not_mix"]
    for k in ("generated_cost", "accepted_cost", "customer_price"):
        assert k in d and d[k]


# ------------------------------------------------------- gate integrity
@test
def t11_the_gate_thresholds_still_come_from_shipped_code():
    assert G.CLIP_ALIVENESS_MIN == 0.75
    assert G.DURATION_MIN_RATIO == 0.5
    assert G.DURATION_MAX_RATIO == 1.6
    assert G.VIDEO_MIN_BYTES == 1024


@test
def t12_the_motion_epsilon_sits_inside_the_measured_separation():
    """static h264 = 0.000000 exactly; slowest real motion measured = 0.001549."""
    assert 0.0 < G.MOTION_EPS < 0.001549, G.MOTION_EPS


@test
def t13_a_still_held_for_the_whole_clip_cannot_be_accepted():
    """The 'provider returned a still image' failure mode."""
    m = {"clip": "still.mp4", "size": 500000, "decodes": True,
         "codec_types": ["video"], "duration": 4.0, "frame_count": 96,
         "frame_diffs": [0.0] * 95, "longest_static_run": 96, "blank_frames": 0}
    r = G.gate(m)
    assert r["verdict"] == "HARD_FAIL"
    assert "temporal_aliveness" in r["hard_failures"]
    assert "no_frozen_run" in r["hard_failures"]


@test
def t14_open_checks_never_count_as_passes():
    m = {"clip": "ok.mp4", "size": 500000, "decodes": True, "codec_types": ["video"],
         "duration": 4.0, "frame_count": 96, "frame_diffs": [0.01] * 95,
         "longest_static_run": 1, "blank_frames": 0}
    r = G.gate(m)
    opens = [c for c in r["checks"] if c["classification"] == "OPEN"]
    assert opens, "the OPEN checks must be present, not omitted"
    assert all(c["result"] == "OPEN" for c in opens)
    assert r["ALL_MANDATORY_QA_PASS"] is True


@test
def t15_the_same_gate_object_judges_both_models():
    """Phase 12: there is exactly ONE gate function, and it takes no model arg."""
    import inspect
    sig = inspect.signature(G.gate)
    assert "model" not in sig.parameters, (
        "the gate must not be able to see which model it is judging")
    assert list(sig.parameters) == ["m", "requested_seconds"], sig


# ------------------------------------------------------- production safety
@test
def t16_story_clip_does_not_send_a_rejected_audio_parameter():
    """MEASURED 2026-08-24: generateAudio 400s on both Veo 3.1 models here.
    Adding it would break every clip. If this test fails, re-probe the API
    before assuming the parameter became valid."""
    s = (REPO / "supabase/functions/story-clip/index.ts").read_text()
    for banned in ("generateAudio", "generate_audio", "enableAudio", "addAudio"):
        assert banned not in s, (
            f"{banned} is rejected by this API surface (HTTP 400) — sending it "
            "would fail every clip, and the strip-on-400 fallback does not cover it")


@test
def t17_the_strip_fallback_still_only_covers_parameters_that_exist():
    s = (REPO / "supabase/functions/story-clip/index.ts").read_text()
    assert '["resolution", "durationSeconds"]' in s


@test
def t18_no_customer_price_is_activated_by_this_audit():
    """Phase 26: nothing here may switch paid pricing on."""
    me = Path(__file__).resolve()
    for p in HERE.glob("*.py"):
        if p.resolve() == me:
            continue          # this file names the flags in order to forbid them
        s = p.read_text()
        for banned in ("paid_pricing_enabled = True", "generation_allowed = True"):
            assert banned not in s, f"{p.name} activates pricing"


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
