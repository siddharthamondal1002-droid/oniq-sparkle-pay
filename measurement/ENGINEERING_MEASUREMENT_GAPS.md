# ENGINEERING_MEASUREMENT_GAPS

## 1. Blocked by scale (697 records)

Every `mm` candidate. Unblocking needs exactly one measured physical dimension
tied to a real asset. See `ENGINEERING_SCALE_BRIDGE_STATUS.md`. Not converted,
not guessed, not deleted.

## 2. Measurable but not yet measured (223 records)

`deg` 149 · `frames` 48 · `ratio` 26. These sit in domains ONIQ can already
reach. They are unmeasured because each names a quantity the current single
character + single driver does not exercise — most are joint limits and timings
for grammars ONIQ does not have (running, jumping, sitting, reaching). Measuring
them needs new motion, which needs owner authorization; it does **not** need new
reference images.

## 3. OPEN — no defined measurement domain (34 records)

Unit `mixed`. A record whose unit is "mixed" cannot be measured, because it does
not say what it is. These need the supplier to declare a real unit before any
measurement is possible. Recorded OPEN rather than guessed.

## 4. Centre of mass is a proxy, not a COM

`joint_centroid_path_unweighted` is the unweighted mean of all joints. A true
centre of mass needs per-segment masses, which ONIQ does not have and cannot
derive from a 2D silhouette without a body-density model. The 50
`center_of_mass` candidates therefore stay unmeasured. Marked `medium`
confidence and explicitly noted in the record itself so it can never be read as
a COM.

## 5. Foot contact is inferred, not sensed

Contacts are local minima of foot height below the 25th percentile — there is no
ground-contact sensor in the pipeline, and the groundplane is set by
`groundplane_joint: LeftFoot`, which biases the left foot by construction.
Confidence `medium`. Stance/swing durations inherit that bias, so the measured
`stance_symmetry_left_right` should not be read as a biomechanical asymmetry
claim on its own.

## 6. Stride and step length are directional projections

Measured along the net forward axis of the Hips over the window. The zombie
driver's root path is not a straight line (it advances then returns over the
full 779 frames), so within the 129-frame window this is a local, not a global,
forward axis. Correct for this clip; not transferable to another window without
re-measuring.

## 7. Proportions are rig-landmark ratios, not anatomy

Group E ratios come from the 16-joint rig in the 253×688 crop. The rig is a
production skeleton, not an anatomical model — there is no crown, no true pelvis
width, no real head height. `head_to_body_height` uses the neck-y as a proxy for
the head base. Useful as a *stable per-character signature*; not an anatomical
measurement, and never a mm bridge.

## 8. Single character, single driver

Every measurement here is `m3_suit_woman` under the knee-0.50 walk and its
undamped control. Nothing about these numbers generalises to other characters
until the same pass runs across the accepted library — which is CPU-only, ₹0,
and the obvious next step if you want it.

## 9. Not done deliberately

- No mm conversion, no assumed scale.
- No candidate promoted; `productionEligible` is 0/1000.
- No misfiled record renamed — including the newly-proven L/R inversion.
- Knee damping untouched at 0.50; no clamp, no limit imposed.
- No new renders beyond the control that already existed; nothing generated.
