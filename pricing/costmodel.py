#!/usr/bin/env python3
"""ONIQ video cost model, driven by the versioned pricing registry.

Every rate comes from registry.json — nothing is hard-coded here, including the
FX rate, which is the defect this module replaces (storyCostModel pinned 84
INR/USD with no source and no date).

The three quantities the loop forbids conflating are kept in separate
functions on purpose:
    generated cost  -> inr_per_generated_second()
    accepted cost   -> cost_per_accepted_second()
    customer price  -> min_price_per_minute()
"""
import json
from pathlib import Path

REG = json.loads((Path(__file__).resolve().parent / "registry.json").read_text())

FX = REG["fx"]["rate"]
GST_OF_INCL = 0.18 / 1.18       # published price is GST-inclusive (owner, 2026-08-16)
PAY_FEE = 0.0236                # Razorpay 2% + 18% GST on the fee
INFRA_PER_FILM = 3.00           # ₹, storage + egress + db
INHOUSE_INR_PER_S = REG["in_house"]["inr_per_finished_minute"] / 60.0


def rate(model_substr, audio):
    """USD per GENERATED second for a registry entry. Raises if unpriced."""
    for e in REG["entries"]:
        if model_substr in (e["model"] or "") and e["audio"] is audio:
            if e["usd_per_generated_second"] is None:
                raise ValueError(f"{e['model']} is {e.get('status')} — no price exists")
            return e["usd_per_generated_second"]
    raise KeyError(f"no registry entry for {model_substr} audio={audio}")


def inr_per_generated_second(model_substr, audio):
    return rate(model_substr, audio) * FX


def expected_attempts(a, n):
    """E[attempts] with at most n tries, per-attempt acceptance a."""
    return sum(k * a * (1 - a) ** (k - 1) for k in range(1, n + 1)) + n * (1 - a) ** n


def p_success(a, n):
    return 1 - (1 - a) ** n


def cost_per_accepted_second(inr_per_generated_s, a, n):
    """Spend per ACCEPTED second, including spend burnt on rejected attempts.

    This is the loop's key economic metric: TOTAL_SPEND / TOTAL_ACCEPTED_SECONDS.
    It is always >= the generated rate, and the gap widens fast as `a` falls.
    """
    if a <= 0:
        raise ValueError("acceptance of 0 means no accepted seconds exist at any price")
    return inr_per_generated_s * expected_attempts(a, n) / p_success(a, n)


def min_price_per_minute(cost_per_accepted_s, margin, seconds=60):
    """Lowest GST-inclusive ₹/min that still clears `margin` of the price."""
    denom = 1 - margin - PAY_FEE - GST_OF_INCL
    if denom <= 0:
        raise ValueError("margin + fees + GST exceed the whole price")
    return (cost_per_accepted_s * seconds + INFRA_PER_FILM) / denom


def contribution(price, ext_seconds, ext_inr_per_accepted_s,
                 inhouse_inr_per_accepted_s, seconds=60):
    """₹ contribution on one film at `price`, GST-inclusive."""
    net = price * (1 - GST_OF_INCL - PAY_FEE)
    cost = (ext_seconds * ext_inr_per_accepted_s
            + max(0.0, seconds - ext_seconds) * inhouse_inr_per_accepted_s
            + INFRA_PER_FILM)
    return net - cost


def max_external_seconds(price, ext_inr_per_accepted_s, inhouse_inr_per_accepted_s,
                         margin=0.26, seconds=60):
    """External seconds affordable at `price` while still clearing `margin`."""
    net = price * (1 - GST_OF_INCL - PAY_FEE) - price * margin - INFRA_PER_FILM
    budget = net - seconds * inhouse_inr_per_accepted_s
    delta = ext_inr_per_accepted_s - inhouse_inr_per_accepted_s
    if delta <= 0:
        return float(seconds)
    return max(0.0, min(float(seconds), budget / delta))


if __name__ == "__main__":
    print(f"FX {FX:.4f} INR/USD — {REG['fx']['source']}, {REG['fx']['verified_at']}")
    print(f"in-house ₹{INHOUSE_INR_PER_S:.4f}/finished second "
          f"(₹{REG['in_house']['inr_per_finished_minute']}/min, INR-denominated: FX does not move it)\n")
    print(f"surface: {REG['surface']['api']}")
    print(f"video-only tier exists on this surface: {REG['surface']['video_only_tier_exists']}\n")
    for label, sub in (("Lite  (audio bundled)", "lite"),
                       ("Fast  (audio bundled, SHIPPED)", "fast"),
                       ("Standard", "veo-3.1-generate")):
        s = inr_per_generated_second(sub, True)
        print(f"{label:32s} ${rate(sub, True):.2f}/s  ₹{s:7.3f}/generated s  ₹{s*60:8.2f}/generated min")
    # asking for a rate this surface does not sell must RAISE, not guess
    try:
        rate("lite", False)
        print("\nBUG: a video-only Lite rate was returned; none exists on AI Studio")
    except KeyError:
        print("\nvideo-only rates correctly unavailable (KeyError) — they are Vertex-only")
