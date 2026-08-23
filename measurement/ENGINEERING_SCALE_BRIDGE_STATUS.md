# SCALE_BRIDGE = NOT_AVAILABLE

## Verdict

**ONIQ possesses no character scale bridge.** No measurement in this build is
emitted in the MILLIMETRE domain, and the 697 millimetre candidate records are
classified `BLOCKED_SCALE_BRIDGE`. None were converted, none deleted.

## What was searched

| searched | result |
|---|---|
| `src/`, `remotion/`, `supabase/` for calibration / physical height / cm / mm / real-world | 0 relevant hits. Every match is unrelated: an A4 CV sheet in `CvPaper.tsx`, quiz options (`616 cm²`), marketing copy about real-world orders, an audio loudness "self-calibrating" comment |
| frozen `ENGINEERING_DETAILS_1000.json` for physical scale, calibration, mm/cm | **0 records** |
| `ENGINEERING_SCHEMA.json` proportions block | *"Normalized to body height = 1.000. REFERENCE_ONLY: illustrative poster values, never a gate."* — explicitly dimensionless, explicitly not a gate |
| character rig `char_cfg.yaml` | `width: 253`, `height: 688`, joint `loc` in **pixels** of the crop. No physical unit anywhere |
| driver BVH header | `OFFSET` values are bare numbers. BVH declares **no unit** by format |
| `motion_engineering.yaml` `scale: 0.025` | a render-space scaling factor between BVH units and canvas, **not** a physical conversion |
| `rig_result.json` | `det_score`, `bbox`, `crop_wh`, `kpt_conf_*` — no scale metadata |
| known physical reference object / calibration marker in any frozen master | none registered |

## What would count as a bridge, and what does not

A legitimate bridge needs **one measured physical dimension** tied to a specific
asset — a calibrated character height, a known body-segment length, or a
reference object of known size visible in the master. None exists.

Explicitly **not** acceptable, and not done:

- assuming `1 BVH unit = 1 cm`
- assuming `1 BVH unit = 1 mm`
- assuming a generic adult human height (e.g. "1.7 m") and back-solving
- reading the poster's normalized `body_height = 1.000` as a physical metre
- treating the 500 px canvas or the 688 px rig crop as a physical length

Each of those would manufacture a measurement. The 697 mm records stay blocked
until an owner supplies a real one.

## Consequence

- 697 records: `BLOCKED_SCALE_BRIDGE`, preserved, `productionEligible: false`
- 0 measurements in the MILLIMETRE domain
- `MILLIMETRE` is absent from the measurement schema's domain enum, so a future
  mm measurement fails schema validation rather than slipping through

## Open question for the owner

Is there any authorized source for a single physical dimension of an ONIQ
character? One measured number unblocks 697 records. Without it they remain
permanently unvalidatable — which is a fact to record, not a problem to solve
by guessing.
