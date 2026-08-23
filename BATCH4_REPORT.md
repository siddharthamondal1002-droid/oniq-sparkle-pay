# ANATOMICAL LIBRARY EXPANSION — BATCH 4 REPORT (2026-08-23)

## What ran

First bounded expansion tranche under the registered standard (the three
reference guides + 7-image anatomy library): 12 new characters generated
by the Lovable agent from the anatomy contract — 8 production candidates
spanning age (child/teen/elderly), body type (heavy, muscular,
tall-long-limbed, petite) and proportion (1:4 stylized head), plus 4
deliberate stress fixtures (thin-line, floor-robe, hair-occlusion,
tiny-hands). All 12 transferred byte-exact (signed-URL → Actions bridge →
val-charlib `b4masters/`, every byte count matching the generator's
manifest) and run through the full real pipeline: padded auto-rig →
dual-mask → eligibility gate → knee-damped ×0.50 WALK + IDLE renders →
aliveness validator → pixel review.

## Scoreboard

| character | gate | conf | walk | idle | verdict |
|---|---|---|---|---|---|
| child_girl | ELIGIBLE | .914 | 4.57 ALIVE, clean | 0.76 ALIVE | **ACCEPT** |
| teen_boy | ELIGIBLE | .916 | 7.23 ALIVE, clean | 0.99 ALIVE | **ACCEPT** |
| elder_woman | ELIGIBLE | .894 | 4.86 ALIVE, clean | 0.75 FROZEN→DISCARD | **ACCEPT_WITH_LIMITS** (no idle) |
| heavy_man | ELIGIBLE | .912 | 9.12 ALIVE, clean | 1.18 ALIVE | **ACCEPT** |
| muscular_woman | ELIGIBLE | .906 | 7.30 ALIVE, clean | 1.10 ALIVE | **ACCEPT** |
| tall_man | ELIGIBLE | .908 | 4.35 ALIVE, clean | 0.78 ALIVE | **ACCEPT_WITH_LIMITS** (tunic hem) |
| short_woman | ELIGIBLE | .884 | SOLVER HANG (300s + 560s retry) | — | **HOLD — new hang class** |
| stylized_kid | ELIGIBLE | .904 | 6.11 ALIVE, clean | 0.85 ALIVE | **ACCEPT** — first stylized-proportion pass |
| stress_thinline | eligible* | .896 | 1.42, thin-stroke ghosting | 0.64 DISCARD | STRESS FAIL (expected; 4th thin-limb confirmation) |
| stress_robe | eligible | .873 | 9.78 but **SWAY_ONLY** — no leg motion | 1.16 | STRESS: never true walking |
| stress_hair | **GATE REJECT** (border) | — | — | — | STRESS: pre-render gate caught it |
| stress_tinyhands | **GATE REJECT** (border) | — | — | — | STRESS: gate caught it; feet truncate in observation render |

7 of 8 production candidates ACCEPT/ACCEPT_WITH_LIMITS — walks are clean
natural gaits with **zero trailing-leg ribbon curls**.

## Batch findings

1. **The knee-damped ×0.50 driver generalizes.** All 7 rendered
   production walks show natural trailing legs at the old defect frames.
   Batch-3's fix holds beyond the two characters it was tuned on.
2. **The anatomy contract keeps producing the cleanest rig class**:
   conf 0.88–0.92, 0 joints off-silhouette on all 12, no false gate
   rejections, across ages, body types and a 1:4 stylized head.
3. **Defense in depth measured working**: the pre-render gate rejected
   both border-contact stress fixtures before any render; the aliveness
   floor discarded two frozen idles; and pixel review is what separated
   robe-sway (aliveness 9.78!) from true walking — the third confirmation
   that aliveness alone is never sufficient.
4. **New hang class (short_woman)**: gate-clean mask, but 6 interior
   holes (574 px between-legs hole sealed by the skirt hem) + 18 px
   minimum ankle width (below the ~24 px mesh pitch) hang the ARAP solve
   at 300 s AND 560 s. Candidate future gate signals: interior-hole
   count/size, minimum limb width. NOT tuned in this batch — needs its
   own single-variable loop. Production semantics today: fail-closed →
   still fallback, no garbage escapes.
5. **DETERMINISM IS PER-HOST, not universal** — found honestly by our own
   regression: after this session's container was recreated (05:28 UTC),
   all 3 frozen fixtures re-render byte-identically WITHIN the new host
   (back-to-back pair: same SHA) but differ from the frozen hashes by
   2–26 pixels/frame of floating-point noise. Inputs, rigs, configs and
   library versions verified byte-identical; the delta is CPU SIMD kernel
   dispatch (this host: AVX-512). Decoded-pixel review: the same walk, no
   visible change — NOT a pipeline regression, and the frozen hashes were
   NOT re-baselined (owner rule: changed hashes are neither regression
   nor acceptable automatically). Recorded per-host hashes:
   aladdin_hand c56f9565→a60f80b7, aladdin_auto 6ad08124→757228fd,
   morgiana 99d1d34f→894d29b1 (old container → this container).
   SPEC IMPLICATION (owner decision needed): §5.6 "identical SHA-256"
   holds per host/CPU class; production hash-pinning must pin the runner
   CPU class, or the byte gate becomes a pixel-tolerance gate.

## Library state (scratchpad + frozen on val-charlib)

ONIQ_ANATOMICAL_LIBRARY now holds 78 files across the 20-category
structure: 4 master-neutral characters (basma, rashid + 2 slots),
body-type/age/proportion masters for all 8 new candidates, per-character
silhouettes, joint maps, rig configs, knee-damped walk cycles, idles, the
thin-limb/robe/occlusion stress sets, and a 10-item negative catalogue
built from REAL measured failures (each mapped to its poster panel and
falsification record). CLASSIFICATION.json is the machine-readable
verdict sheet. Urchin remains STRESS_TEST; controls remain immutable
(all 9 Batch-1 hashes re-verified byte-exact this batch — static bytes
are host-independent).

## Costs and safety

Lovable credits: one generation+upload message (12 images; the agent
regenerated thin-line twice on its own QA). GPU ₹0, API ₹0. Repo main
touched only by the register→remove bridge pattern (behaviorally inert,
removed same hour, precedent-matching). No merge, no deploy, no gate
weakened, PR #83 untouched, 457598ad untouched, no production config
changed.

## Awaiting owner decisions (unchanged + one new)

(a) knee-damped WALKING driver production adoption; (b) merge 457598ad;
(c) basma/rashid cast adoption; (d) next expansion tranche (pose sets /
TURN-WAVE-REACH references, more categories); **(e) NEW: determinism
policy — pin runner CPU class for byte-exact hashes, or move the
determinism gate to pixel-tolerance.**
