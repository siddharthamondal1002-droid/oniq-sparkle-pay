# ONIQ numeric library — gaps, open questions and misfiled evidence

Recorded rather than repaired. Rule 18 says do not silently reinterpret source
evidence, and rule 20 says record OPEN rather than guessing.

## 1. Twenty-one SOURCE_LOCKED records carry a real number under a wrong label

These are **not fabricated numbers**. Every value traces to a measurement in the
knee-pixel validation. The defect is that the parameter name describes a
*different quantity* from the one measured. They are `REJECTED` for the
parameter they are filed under, kept in the library, and never renamed here.

| id | filed as | what the number actually is |
|---|---|---|
| CHAR-ENG-0024 | `corrected_render_time` 4.26 s | the clip's **duration**; the corrected render took 8.2 s wall |
| CHAR-ENG-0801 | `support_width_01` 1.36 | **foot-slide, left** — max per-frame planted-foot travel (BVH units) |
| CHAR-ENG-0802 | `support_length_01` 0.39 | **foot-slide, right** |
| CHAR-ENG-0803 | `foot_contact_area_01` 16.2 px | **vertical centroid drift range** over 129 frames |
| CHAR-ENG-0901 | `stride_length_01` 0.906 | corrected **max silhouette overlap** |
| CHAR-ENG-0902 | `step_length_01` 0.095 | corrected **min two-leg fraction** |
| CHAR-ENG-0903 | `pelvis_bob_01` 2 px | **minimum leg gap** |
| CHAR-ENG-0904 | `pelvis_sway_01` 17 | **frame count** with IoU < 0.90 — a count, not a distance |
| CHAR-ENG-0905 | `knee_peak_L_01` 140.0° | corrected **frame-101 minimum** knee angle across both knees |
| CHAR-ENG-0906 | `knee_peak_R_01` 140.4° | corrected **frame 100** — not the right knee |
| CHAR-ENG-0911–0916 | `stride/step/pelvis/knee_peak_*_02` | the **control-clip** equivalents and frames 102 / 126 |
| CHAR-ENG-0925–0936 | `knee_peak_*_03/04` | **control** knee angles at frames 101, 100, 102, 126 |
| CHAR-ENG-0951 | `spine_flex_01` 0.5 | the **knee damping constant 0.50**, filed under `motion_limits` |

**CHAR-ENG-0951 is the dangerous one.** A knee-damping constant sitting in
`motion_limits` as `spine_flex` could, if promoted blindly, become a spine
constraint. It is `REJECTED` and must never act as a spine limit.

The `knee_peak_L/R` naming is systematically wrong in a second way: ONIQ measured
the **per-frame minimum interior angle across both knees**, not a left-knee peak
and a right-knee peak. No left/right-separated knee peak exists in the evidence.

## 2. NOT_SPECIFIED encoded as a number

`CHAR-ENG-0003` (`lens_fov_height_distance`) has `value: 0`, `unit:
NOT_SPECIFIED`. A downstream consumer reading `0` would treat it as a real
measurement — a zero lens, a zero camera height. Carried as the string
`NOT_SPECIFIED` in this build and marked `OPEN`. It also conflates four
independent quantities (lens, FOV, height, distance) into one record; four
separate `NOT_SPECIFIED` records would be correct.

## 3. 954 of 1,000 records are unmeasured

`CANDIDATE_TARGET`, `UNVALIDATED`, `productionEligible: false`. Overwhelmingly
millimetre anthropometry (697 `mm` records) across head, face, hands, fingers,
limbs and torso. ONIQ has **never measured a millimetre on a character** — the
pipeline works in normalized silhouette space, rig landmarks and BVH units.
There is currently no bridge from `mm` to anything ONIQ measures, so no `mm`
record can be validated until a scale reference exists. That bridge is an
OPEN question, not a task.

## 4. Categories present but with no ONIQ measurement at all

`head_cranium`, `face`, `neck_shoulders`, `torso_ribcage`, `pelvis_hips`,
`upper_arm`, `forearm`, `hand`, `fingers`, `thigh`, `lower_leg`, `foot`,
`joints`, `spine_posture`, `center_of_mass`, `overall_proportions` — 0 measured
records each. `balance_contact`, `gait_timing`, `gait_kinematics`,
`motion_limits` contain measured numbers only via the misfiled records above,
plus the two correctly-filed gait records (`cycle_frames_01` = 129,
`duration_01` = 4.26 s).

## 5. Open questions for the owner

1. **Scale bridge.** Is there any authorized way to relate `mm` anthropometry to
   ONIQ's normalized/rig/BVH space? Without one, 697 records are permanently
   unvalidatable.
2. **Should the misfiled 21 be re-filed?** Re-filing means editing supplied
   source evidence. I have not done it. If you want them re-filed under correct
   parameter names, say so and it becomes a recorded, auditable change.
3. **Left/right knee split.** Do you want a real per-knee measurement added
   (cheap, CPU-only, no new references), or is the per-frame minimum enough?
4. **CSV.** The loop referenced `..._REPORT_UPDATED.csv`; only the `.json` was
   uploaded. The CSV in this build is generated from the JSON, not from a
   supplied CSV — flagged so the two are not confused.

## 6. Experiments this library makes designable (NOT run)

Designs only — none executed, no new references, ₹0.

- **A. Proportion validation.** Correlate candidate proportion ranges against
  measured rig confidence, silhouette fill, core-joint visibility, connected
  components and pixel stability across the existing accepted characters. Needs
  no new renders — the M1–M3 gate records already hold the dependent variables.
- **B. Lower-leg validation.** Test shin width/depth, ankle width/visibility and
  clothing coverage against the bare-thin-shin crossing-warp class. **Blocked**:
  requires a bare-thin-shin fixture, which needs owner-approved new imagery.
  Remains the standing OPEN item.
- **C. Gait validation.** Stride, step timing, knee/ankle trajectory, pelvis and
  centre-of-mass movement, foot contact and crossing separation are all
  measurable today from the existing driver + decoded frames at ₹0. This is the
  cheapest real bridge from candidate to measured, and it would let the misfiled
  gait records be replaced by correctly-named measured ones.
- **D. Motion-limit validation.** Compare each candidate limit against observed
  successful motion and classify `SUPPORTED` / `UNSUPPORTED` / `OPEN` /
  `REJECTED`. **No limit may be imposed** — the knee already has a proven
  solution and must not be clamped.
