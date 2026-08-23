# ENGINEERING_NUMERIC_VALIDATION

Source: `e29ea316-ONIQ_1000_character_engineering_numbers_REPORT_UPDATED.json`
sha256 `953b6d3883a3a87f23cd5662027e64230f4ccf99c17701123bfb4b3d558f8fc3`
Build: `ENGINEERING_NUMERIC_LIBRARY.json` v1.0 — 1,000 records, nothing promoted.

## Totals

| field | count |
|---|---|
| TOTAL_RECORDS | 1000 |
| SOURCE_LOCKED | 46 |
| CANDIDATE_TARGET | 954 |
| MEASURED | 24 |
| UNVALIDATED | 954 |
| OPEN | 1 |
| REJECTED | 21 |
| PROMOTED | 0 |
| PRODUCTION_ELIGIBLE | **0** |

`PRODUCTION_ELIGIBLE = 0` is the intended result. Integrating a numeric library
is not the same act as enforcing it.

## Headline finding

The library labels 46 records `SOURCE_LOCKED`. Checked one by one against the
knee-pixel validation evidence:

- **24 are genuinely MEASURED** — value and parameter agree.
- **21 carry a real measured number under a parameter that names a different
  quantity** → `REJECTED` for that parameter. The numbers are not invented; the
  labels do not describe them. Not renamed (that would be reinterpreting
  supplied evidence), not deleted, never a gate. Full table in
  `ENGINEERING_NUMERIC_GAPS.md`.
- **1 encodes `NOT_SPECIFIED` as the number `0`** (`CHAR-ENG-0003`,
  lens/FOV/height/distance) → `OPEN`, carried as the string `NOT_SPECIFIED`.

The most dangerous single record is `CHAR-ENG-0951`: the **knee damping constant
0.50** filed under `motion_limits` as `spine_flex`. Promoted blindly it would
become a spine constraint. `REJECTED`.

## Per-category validation state

| category | records | MEASURED | REJECTED | OPEN | UNVALIDATED |
|---|---|---|---|---|---|
| balance_contact | 50 | 0 | 3 | 0 | 47 |
| camera | 3 | 2 | 0 | 1 | 0 |
| center_of_mass | 50 | 0 | 0 | 0 | 50 |
| cinematic_compositing | 1 | 1 | 0 | 0 | 0 |
| cost | 2 | 2 | 0 | 0 | 0 |
| crossing | 4 | 4 | 0 | 0 | 0 |
| deformation | 3 | 3 | 0 | 0 | 0 |
| face | 50 | 0 | 0 | 0 | 50 |
| fingers | 50 | 0 | 0 | 0 | 50 |
| foot | 50 | 0 | 0 | 0 | 50 |
| forearm | 50 | 0 | 0 | 0 | 50 |
| gait_kinematics | 50 | 0 | 16 | 0 | 34 |
| gait_timing | 50 | 2 | 0 | 0 | 48 |
| hand | 50 | 0 | 0 | 0 | 50 |
| head_cranium | 50 | 0 | 0 | 0 | 50 |
| joints | 50 | 0 | 0 | 0 | 50 |
| lighting | 1 | 1 | 0 | 0 | 0 |
| lower_leg | 50 | 0 | 0 | 0 | 50 |
| motion | 6 | 6 | 0 | 0 | 0 |
| motion_limits | 50 | 0 | 1 | 0 | 49 |
| neck_shoulders | 50 | 0 | 0 | 0 | 50 |
| overall_proportions | 26 | 0 | 0 | 0 | 26 |
| pelvis_hips | 50 | 0 | 0 | 0 | 50 |
| reference_generation | 1 | 1 | 0 | 0 | 0 |
| render | 2 | 1 | 1 | 0 | 0 |
| scene | 1 | 1 | 0 | 0 | 0 |
| spine_posture | 50 | 0 | 0 | 0 | 50 |
| thigh | 50 | 0 | 0 | 0 | 50 |
| torso_ribcage | 50 | 0 | 0 | 0 | 50 |
| upper_arm | 50 | 0 | 0 | 0 | 50 |

## Invariants verified by ENGINEERING_NUMERIC_TESTS (26/26 pass)

Load · exactly 1000 · unique ids · no duplicates · valid categories (all 20
required present) · explicit units · SOURCE_LOCKED provenance hashed ·
candidates cannot become gates · NOT_SPECIFIED representable and never 0 ·
unknown unit / category / provenance all fail closed · knee damping still 0.50 ·
six knee channels · bilateral symmetry · WALKING still PRIMARY · wave excluded ·
unknown grammar falls back to STILL_PARALLAX + MOTION_CONTRACT · the four
reference master hashes unchanged · determinism PER_HOST unchanged · pre-render
gates unchanged (0.70 / ≤90% / no border, no 65% rule) · fallback contract
unchanged · explicit generation still required · no automatic generation
introduced · no API or job client in the analysis layer.

## What was NOT done

No production change. No merge. No deploy. No new reference images. No API, GPU
or Lovable spend. No frozen hash altered. `generation_allowed` still false. No
candidate turned into a gate. Knee driver untouched. Camera numerics still
NOT_SPECIFIED. Lighting and scene still plan-only — the CPU motion plate
contains no rain, no streetlight and no city.
