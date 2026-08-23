"""ONIQ India video pricing — parametric economics.

Provider prices VERIFIED 2026-08-23 from Google's own Vertex AI pricing page.
Acceptance rate is the ONE number nobody has measured, so price is expressed as
a FUNCTION of it rather than asserted.
"""
INR = 84.0                      # in-repo storyCostModel.UNIT.inrPerUsd
GST_OF_INCL = 0.18 / 1.18       # published price is GST-inclusive (owner, 2026-08-16)
PAY_FEE = 0.0236                # Razorpay 2% + 18% GST on the fee
INFRA_PER_FILM = 3.00           # ₹, storage+egress+db

# --- VERIFIED provider prices, USD per second of generated 720p video --------
SRC = "https://cloud.google.com/vertex-ai/generative-ai/pricing/ (fetched 2026-08-23)"
PROVIDER_USD_PER_S = {
    "veo31_lite_720_noaudio":  0.03,
    "veo31_lite_720_audio":    0.05,
    "veo31_fast_720_noaudio":  0.08,
    "veo31_fast_720_audio":    0.10,
    "veo31_720_audio":         0.40,
}
# ONIQ in-house: ₹37.55 per finished minute (measured, storyCostModel)
INHOUSE_INR_PER_S = 37.55 / 60.0

def expected_attempts(a, n):
    """E[attempts] with at most n tries, per-attempt acceptance a."""
    e = 0.0
    for k in range(1, n + 1):
        e += k * a * (1 - a) ** (k - 1)
    e += n * (1 - a) ** n
    return e

def p_success(a, n):
    return 1 - (1 - a) ** n

def cost_per_accepted_second(inr_per_generated_s, a, n):
    """Provider spend per ACCEPTED second, including wasted attempts."""
    return inr_per_generated_s * expected_attempts(a, n) / p_success(a, n)

def min_price_per_minute(cost_per_accepted_s, margin, seconds=60):
    """Lowest GST-inclusive ₹/min that clears `margin` of price."""
    gen = cost_per_accepted_s * seconds
    return (gen + INFRA_PER_FILM) / (1 - margin - PAY_FEE - GST_OF_INCL)

if __name__ == "__main__":
    N = 2
    print(f"VERIFIED provider source: {SRC}\n")
    print(f"in-house measured: ₹{INHOUSE_INR_PER_S:.4f}/s  (₹37.55/finished minute)\n")
    routes = [("in-house", INHOUSE_INR_PER_S)] + [
        (k, v * INR) for k, v in PROVIDER_USD_PER_S.items()]
    print(f"{'route':26s} {'₹/gen s':>9s} " + "".join(f"{int(a*100):>7d}%" for a in
          (0.5, 0.6, 0.7, 0.8, 0.9, 1.0)))
    print(f"{'':26s} {'':>9s} " + "  ₹/ACCEPTED second at that first-pass rate (MAX_ATTEMPTS=2)")
    for name, inr_s in routes:
        row = "".join(f"{cost_per_accepted_second(inr_s, a, N):>8.2f}" for a in
                      (0.5, 0.6, 0.7, 0.8, 0.9, 1.0))
        print(f"{name:26s} {inr_s:>9.3f} {row}")
    print()
    print("MINIMUM GST-INCLUSIVE ₹ PER ACCEPTED MINUTE at 26% margin (MAX_ATTEMPTS=2):")
    print(f"{'route':26s} " + "".join(f"{int(a*100):>8d}%" for a in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0)))
    for name, inr_s in routes:
        row = "".join(
            f"{min_price_per_minute(cost_per_accepted_second(inr_s, a, N), 0.26):>9.0f}"
            for a in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0))
        print(f"{name:26s} {row}")
