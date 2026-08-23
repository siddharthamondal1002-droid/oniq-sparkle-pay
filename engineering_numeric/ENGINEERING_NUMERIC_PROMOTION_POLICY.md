# ONIQ character-engineering numeric library — promotion policy

## The rule that matters

**A number existing is not a reason to enforce it.** The 1,000-record library is
a *reference vocabulary of engineering candidates*. Nothing in it is a gate.
`productionEligible` is `false` for all 1,000 records in this build, including
every `SOURCE_LOCKED` one.

## The hierarchy

```
REFERENCE VOCABULARY          a number written down
        ↓
ENGINEERING CANDIDATE         CANDIDATE_TARGET — plausible, unmeasured
        ↓
CONTROLLED EXPERIMENT         one variable, same character/BVH/rig/camera/
                              timing/renderer, before + after captured
        ↓
PIXEL / NUMERIC VALIDATION    decoded frames inspected AND numbers measured;
                              numeric success alone is never sufficient
        ↓
REVIEW                        a human reads the pixels and the numbers
        ↓
SOURCE_LOCKED / MEASURED      the value and the parameter it is filed under
                              both agree with real evidence
        ↓
OPTIONAL PRODUCTION PROMOTION owner decision, recorded next to the code
```

`CANDIDATE_TARGET → PRODUCTION` is forbidden. There is no shortcut edge.

## Validation states

| state | meaning | can gate a render? |
|---|---|---|
| `MEASURED` | value and parameter both agree with ONIQ evidence | only after explicit promotion |
| `PROMOTED` | measured **and** an owner promoted it to production | yes |
| `UNVALIDATED` | `CANDIDATE_TARGET`; no ONIQ measurement exists | never |
| `OPEN` | claims support but cannot be tied to a measurement | never |
| `REJECTED` | the number is real but the parameter it is filed under names a different quantity | never |

`REJECTED` is deliberately not "wrong number". It means *the label does not
describe what was measured*. Those records are kept, not deleted and not
silently renamed — renaming them would be reinterpreting source evidence.

## What this policy protects

- **The knee solution is frozen and is not re-derived from this library.**
  Knee damping stays exactly `0.50`, six rotation channels, both knees
  symmetric, applied at the source-BVH layer. No generic joint limit, no Euler
  clamp, no arbitrary angle cap may replace it. The numeric library may
  *describe* the knee result; it may not *drive* it.
- **Camera numerics stay unmeasured.** `lens`, `fov`, `camera height`,
  `camera distance` are `NOT_SPECIFIED`. CAM-00031 remains eye-level,
  full-figure, locked/static, frontal / near-frontal lane. `NOT_SPECIFIED` is
  never encoded as `0`.
- **Lighting and scene stay plan-only.** LIT-00451 / LIT-00751 / LIT-01951,
  SCN-002 and ENG-0761 are retrieved reference data. The CPU motion plate
  contains no rain, no streetlight and no city. They must not be reported as
  rendered.
- **Fail-closed stays fail-closed.** Unknown category, unknown unit, unknown
  provenance and unknown grammar are rejected by the schema, not defaulted.

## Promoting something later

1. Pick ONE candidate. State the hypothesis and the failure it would prevent.
2. Design the controlled experiment: same character, same source BVH, same rig,
   same camera, same timing, same renderer; exactly one variable changed.
3. Run it. Capture before/after, numbers, decoded frames, pixel crops,
   SHA-256, runtime, RSS, and the failure reason if it fails.
4. Inspect the pixels — critical frames, feet, knees, crossing phase,
   silhouette, identity, mesh integrity — against a control.
5. Classify honestly: `SUPPORTED`, `UNSUPPORTED`, `OPEN`, `REJECTED`.
6. Only then may an owner promote it, and the decision is recorded next to the
   code it governs with the date.

A worked example of steps 3–5 is the knee-pixel validation: the over-curl was
proven fixed **on pixels** against an undamped control, while the leg crossing
was measured as essentially unchanged and correctly classified **NOT A DEFECT**
rather than converted into a false failure.
