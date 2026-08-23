# ROUND M3 — FINAL REPORT (2026-08-23, validation of 12 already-paid assets; zero new generation)

TOTAL ASSETS = 12

TRANSFER VERIFIED = 12 · TRANSFER FAILED = 0
(every file: exists, byte count = generator manifest, decodes via PIL+OpenCV,
1024×1536 PNG, SHA-256 recorded in `manifests/m3_transfer_verification.json`;
the generator supplied no hashes, so byte counts + decode were the
verification surface — noted, not invented. The generating agent
byte-verified every signed URL end-to-end before handoff; the bridge landed
18,109,413 bytes total, matching exactly.)

PRE-RENDER ELIGIBLE = 12 · PRE-RENDER REJECTED = 0
(contact-sheet §39 pre-check clean: single figures, wide margins, no border
contact, no logos, no props; the ≤75%-height framing clause held on all 12 —
the margin-regen contract is now proven on 4/4 first-pass regens)

WALK ACCEPT = 11 · WALK FAIL = 1 (ancient_scribe — pixels, see below)
IDLE ACCEPT = 10 · IDLE FAIL = 2 (ancient_scribe 0.63, court_scholar 0.65 —
FROZEN→DISCARD, recorded, not tuned, per §10)

STRESS_FAIL = 1 · HOLD = 0 · GATE_REJECT = 0 · RENDER_FAIL = 0 ·
MOTION_FAIL = 0 · SWAY_ONLY = 0 · IDENTITY_FAIL = 0

ALIVENESS FAILURES = 2 (both idles above; all 12 walks ≥ 4.02, range
4.02–8.31)
GEOMETRY FAILURES = 1 (ancient_scribe walk)
FOOT CONTACT FAILURES = 0 on the accepted renders (the scribe's grid80
EXPERIMENT showed floating feet — evidence of the failed rescue, not an
accepted render)
IDENTITY FAILURES = 0
HANGS = 0
THIN-LIMB CASES = 1 (ancient_scribe — NEW subclass, below)
THIN-STROKE CASES = 0

## Per-character classification (exactly one primary status each)

| character | walk aliv. | idle aliv. | primary status |
|---|---|---|---|
| m3_ancient_scribe | 4.02 | 0.63 FROZEN | **STRESS_FAIL** |
| m3_artisan_weaver | 5.49 | 0.78 | ACCEPT |
| m3_court_scholar | 5.34 | 0.65 FROZEN | ACCEPT (walk primary; idle failure recorded) |
| m3_desert_trader | 7.06 | 0.89 | ACCEPT |
| m3_grandpa_stocky | 5.78 | 0.97 | ACCEPT |
| m3_hijabi_teacher | 5.35 | 0.79 | ACCEPT |
| m3_maritime_captain | 8.31 | 1.22 | ACCEPT |
| m3_medieval_smith | 8.10 | 1.06 | ACCEPT |
| m3_mountain_hunter | 7.26 | 1.13 | ACCEPT |
| m3_nomad_rider | 6.62 | 0.98 | ACCEPT |
| m3_suit_woman | 8.20 | 1.18 | ACCEPT |
| m3_village_healer | 5.28 | 0.88 | ACCEPT |

**TOTAL: ACCEPT 11 · STRESS_FAIL 1**

## The one failure, in full (new negative-catalogue datapoint)

**ancient_scribe — BARE-THIN-SHIN CROSSING WARP.** Numerically the walk
passes (4.02 ALIVE); the decoded pixels do not: on every leg-crossing /
push-off phase (f55, f70, f110–130, f150 — periodic, `qc/m3_scribe_feet*.png`)
the exposed thin bare shins bow into an S-curve with the swing foot curling
under. This is the knee-damped driver's residual flexion made VISIBLE on
bare thin lower legs — the same excursion that trousers, robes, and boots
visually absorb on the other 11 characters (and on 20+ prior accepted
characters).

Per §13 the character qualifies for the thin-LIMB class, so the tested
density policy was applied: **grid80 re-render (AD_meshx copy, 48.2 s) did
NOT rescue it** — decoded pixels are worse (floating pointed feet,
`qc/m3_scribe_g40_vs_g80.png`). Finding: this is a **new subclass distinct
from thin-limb MERGE** — the scribe's legs never merge, so mesh pitch is not
the mechanism; joint-angle projection through exposed thin geometry is.
Density does not apply. Bounded honest statement: characters with exposed
bare thin lower legs are a stress class for the knee050 walk driver;
clothing coverage over the knee/shin is the empirically protective factor.
No gate was weakened, no new motion correction introduced (§8), nothing
tuned (§14).

Idle: aliveness s=0.25 regime failed on the two lightest-clothed, most
static silhouettes (scribe 0.63, scholar 0.65) — recorded, not tuned.

## Scene-compatibility notes (§15 — reference matching only, nothing generated)

The frozen scene library's historical/rural/village/market panels (Mega §5,
Global §4–5, VISTA ancient-civilizations/maritime/festivals) cover the
period contexts these 12 characters imply: scribe/desert_trader → desert
caravan, old-city and market panels; maritime_captain → harbor/ship-deck
panels (SCN-002 special locations, SCN-009 maritime history); medieval_smith
→ medieval castle/old-street panels; nomad_rider → mountain/valley/steppe
panels; village_healer/artisan_weaver → village, rural-school, courtyard
panels; suit_woman/hijabi_teacher/grandpa_stocky (modern regens) → urban,
professional-workplace, education panels; court_scholar → palace/temple
panels; mountain_hunter → mountain/canyon panels. Every ACCEPT has multiple
compatible frozen scene contexts; no gap forced a generation. Characters are
NOT locked to these contexts (§6).

## Costs, boundaries, evidence

NEW GENERATION = 0 · NEW API SPEND = ₹0 · NEW GPU SPEND = ₹0 ·
PRODUCTION CHANGES = 0 (main untouched; PR #83 untouched; ARAP primary
checkout untouched — grid80 experiment ran in the AD_meshx scratch copy;
scene library FROZEN/UNCHANGED; no fixture re-baselined; determinism per
host respected — all M3 renders and hashes are from this container's host,
recorded as such, no cross-host claim made).

Evidence tree: `roundM3/` — manifests (transfer verification), qc (contact
sheet, 4 chunk strips, scribe/trader zooms, grid80 comparison), montages
(12 refsets), walks (12 knee050 walk gifs + the scribe grid80 experiment
gif), f100_strip.png. Masters live at `m3masters/` (committed by the bridge,
byte-verified).
