# CPU MOTION — VISUAL ACCEPTANCE SPECIFICATION

Source: the owner-supplied "VIDEO GENERATION — MODEL REFERENCE GUIDE"
poster (sha256 first16 `2ae1783955f44a70`, 2026-08-22; the binary itself is
not committed — no generated media in git). This document translates that
visual standard into the measurable requirements the CPU ARAP provider is
held to, states where each is enforced, and keeps every unmeasured item an
explicit UNKNOWN. Where the poster's illustrative numbers differ from
ONIQ's measured thresholds, the MEASURED value governs — the poster's
"fill ≤ 65%" panel is the notable case: generalization-v2 falsified 65% as
a collapse mechanism (mother 74.8% and princess 77.6% walk cleanly once
the crop is padded), so the fill rule survives only as a 90% degenerate-
segmentation ceiling.

## Input requirements (poster §1 → pre-render gate)

| requirement | enforcement | status |
|---|---|---|
| clean cutout / well-segmented | dual-mask selection (classical vs rembg u2netp, pick by core-joints-on-silhouette); fill ≤ 90% ceiling | ENFORCED, measured |
| full/near-full body, frontal | drawn-humanoid detector must fire (side/back views fail detection — measured: morgiana_side, ep4s02) | ENFORCED by pipeline |
| usable silhouette, margins | mask must NOT touch the crop border — autorig pads every crop 24 px (the v2 root-cause fix: all 5 solver hangs and the sliver collapses were border-cut masks; padded re-renders fixed 8 of 10) | ENFORCED, measured |
| stable rig | core joints (shoulder/hip/knee/foot) on silhouette AND kpt_conf_mean ≥ 0.70 (clean walks ≥ 0.77; jarJinni 0.61 / side views ~0.60 all bad) | ENFORCED, measured |

## Positive motion (poster §2) — WALKING, the primary grammar

| requirement | evidence |
|---|---|
| natural gait, alternating legs | pixel-inspected on 9 padded corpus renders (aladdin×2, morgiana, adchar1-3, fisherman_staff, mother, princess — robed characters read as hem-sway walks, marked WITH LIMITS) |
| arm hang (downward trunk vector) | the arm-damped retarget — 0/5 artifact frames vs stock 4/5 (MOTION_AMPLITUDE.md) |
| identity / clothing / hair stable | STRUCTURAL: ARAP warps the source texture itself — there is no generative path for identity drift; per-frame appearance is the source pixels deformed |
| grounded feet, no sliding | foot-line range measured ≤ 24 px across the corpus (l3RenderQc bound: 15% of frame = 75 px) — coarse proxy; per-step contact analysis UNKNOWN |
| continuous temporal motion | temporalAliveness ≥ 0.75 (production floor), measured 5.0-12.1 on clean corpus walks |

## Negative catalogue (poster §3) — each mapped to a measured guard

- claw / blade / spike — killed by the arm-damped retarget (measured);
  recurrence would be caught only by pixel review: no automated spike
  detector exists (UNKNOWN / open follow-up).
- merged-blob collapse & edge-on sliver — root cause was the border-cut
  mask; prevented by padding + border-contact rejection; l3RenderQc's fill
  floor (≥4%) is the post-render backstop (slivers measure ~1.8%).
- missing limbs / disconnected geometry — largest-component mask keeps one
  body; post-render connected-output check UNKNOWN (open follow-up).
- identity drift — structurally impossible (texture warp, no generation).
- foot sliding — bounded by foot-line range; fine-grained check UNKNOWN.
- ghost geometry / mesh tears — thin-stroke figures below the ~24 px ARAP
  mesh pitch can still tear (adchar4 — the documented residual false
  accept, 1 of 11 admitted); no reliable cheap metric separates it yet;
  canary human pixel review is the backstop.

## Post-render gates (poster §5) — defense in depth, all three required

1. temporalAliveness ≥ 0.75 (motionRuntime — the production metric).
   MEASURED INSUFFICIENT ALONE: every v1 collapse scored "alive" (3.6-10.1).
2. l3RenderQc geometry (fill ≥ 4%, in-frame, foot-line ≤ 15%).
3. Character presence + pixel review for anything user-facing.
   Determinism is proven (identical SHA-256 across independent renders;
   the frozen aladdin×2/morgiana fixtures re-verify hash-identical after
   every experiment).

## Motion grammar status (poster §6)

| grammar | status |
|---|---|
| WALKING | PASS — 9 corpus characters on real pixels |
| IDLE | in progress — s=0.10 synthetic driver FAILED the aliveness gate (0.43, correctly discarded); s=0.25 single-variable retry rendered, pixel verdict pending |
| TURN | UNKNOWN — no MIT driver clip; not attempted |
| WAVE | FAILED and recorded — wave_hello projects near-static (0.51) with a sleeve blade; excluded from the provider grammar |
| REACH | UNKNOWN — not attempted |

The provider grammar (`ARAP_MOTION_GRAMMAR`) carries ONLY pixel-passed
motions; today that is WALKING alone.

## Constraints (poster §7) — standing

CPU only (4-core reference, 22-88 s / ~1.2 GB per ~12.5 s clip) · no model
weights in git · no API spend (₹0 across both generalization loops) ·
deterministic · ineligible characters fall back to the still/parallax
renderer with the MOTION_CONTRACT recording the reason.
