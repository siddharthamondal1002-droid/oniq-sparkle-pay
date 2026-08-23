"""How many EXTERNAL seconds can each candidate India price point afford?

This is the number the router needs: §29 says minimise external spend while
holding quality, and this says exactly how much external spend each price buys.
"""
import sys
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from econ import (GST_OF_INCL, PAY_FEE, INFRA_PER_FILM, INHOUSE_INR_PER_S,
                  PROVIDER_USD_PER_S, INR, cost_per_accepted_second)

N = 2
PRICES = [49, 79, 99, 129, 149, 199, 249, 299]
MARGIN = 0.26

def external_seconds_affordable(price_per_min, a, ext_key, minutes=1.0, margin=MARGIN):
    secs = 60 * minutes
    budget = price_per_min * minutes * (1 - margin - PAY_FEE - GST_OF_INCL) - INFRA_PER_FILM
    ext = cost_per_accepted_second(PROVIDER_USD_PER_S[ext_key] * INR, a, N)
    inh = cost_per_accepted_second(INHOUSE_INR_PER_S, a, N)
    if ext <= inh:
        return secs
    x = (budget - inh * secs) / (ext - inh)
    return max(0.0, min(secs, x))

for ext_key in ("veo31_lite_720_noaudio", "veo31_lite_720_audio", "veo31_fast_720_audio"):
    print(f"\n=== external route: {ext_key}   (MAX_ATTEMPTS={N}, margin {int(MARGIN*100)}%)")
    print(f"{'₹/min':>6s} | external seconds affordable in a 60s film, by first-pass acceptance")
    print(f"{'':>6s} | " + "".join(f"{int(a*100):>8d}%" for a in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0)))
    for p in PRICES:
        row = "".join(f"{external_seconds_affordable(p, a, ext_key):>9.1f}"
                      for a in (0.5, 0.6, 0.7, 0.8, 0.9, 1.0))
        print(f"{p:>6d} | {row}")
