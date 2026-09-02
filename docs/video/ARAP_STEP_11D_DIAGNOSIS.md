# ARAP Step 11D — why the eligible characters walked out of frame

**Finding: the walk-off is the driver's, not the characters'.** Both eligible
gateway characters and the reference character the image ships read
`TRANSLATION_DOMINANT` under the same WALKING driver, and the reference
character fails the existing render gate on the same reasons. Step 11C's
verdicts stand as recorded; they are not evidence of deform drift.

Measured by run 33662521801 (`arap-step-11d-diagnosis.yml` at `ef56ebdc`,
image `arap-cpu@sha256:d0fb43f5…520955`). The report is checked in at the
repository root as `ONIQ_Step_11D_Diagnosis_Report.pdf`, rebuilt here from
the run's transfer file with the same builder; the numbers are in
`remotion/fixtures/arap-eligibility/real-gateway-walking-diagnosis-reference.json`,
pinned by `arapRealCorpusReference.test.ts`. Clips, rig directories and
per-frame statistics are in the run's artifact.

## What was measured

Per body frame: the silhouette's bounding box, centroid, height, width and
fill. Each clip is split at its first edge contact; the segment before it
is where deform drift and driver translation look different.

| clip            | reading              | edge from | gone from | exit  | drift x, px/frame | height rel. std | fill rel. std | height Δ | fill Δ | foot range pre-edge | existing gate |
| --------------- | -------------------- | --------- | --------- | ----- | ----------------- | --------------- | ------------- | -------- | ------ | ------------------- | ------------- |
| shot 002        | TRANSLATION_DOMINANT | 159       | 237       | right | 0.96              | 0.008           | 0.006         | −0.6 %   | −0.6 % | 11 px               | FAIL          |
| shot 004        | TRANSLATION_DOMINANT | 346       | 526       | right | 0.59              | 0.020           | 0.009         | −0.9 %   | −0.7 % | 22 px               | FAIL          |
| reference char1 | TRANSLATION_DOMINANT | 138       | 189       | right | 1.22              | 0.009           | 0.010         | −1.0 %   | −1.4 % | 8 px                | FAIL          |

Height Δ and fill Δ compare the last quarter of the pre-edge segment with
its first. The cut points that name a reading (steady drift ≥ 0.2 px/frame,
height rel. std < 0.10, fill rel. std < 0.15, degradation ≥ 0.25) are
analysis parameters of this diagnosis, not gates, and the envelope and the
render gate are unchanged.

## What the numbers say

- Before edge contact, every silhouette kept its height and its fill to
  within about one percent and its foot line to within a few pixels. The
  meshes did not crumple, shrink or drift off their ground.
- Every centroid moved steadily to the right at a constant rate, in the
  direction the character then exited. The BVH driver (`zombie.bvh`,
  780 frames, `groundplane_joint: LeftFoot`, scale 0.025) carries the root
  forward, and the reference camera does not follow.
- The reference character, which passes the runtime's own render floors
  (real moving pixels, foreground above floor, no static frames), fails the
  existing gate on the same two reasons: it left the frame, and its foot
  line roamed 25 percent of the canvas during the exit. The gate's in-frame
  and foot-line criteria, applied to this driver in this camera, fail any
  character.
- The large foot-line ranges the gate reported for the gateway characters
  (80 px and 63 px) are the exit phase; before edge contact they were 11 px
  and 22 px.

## What the numbers do not say

They do not say the deform is good. A held silhouette is necessary for a
usable walk, not sufficient; limb tearing inside the silhouette, the four
rig points the renderer skipped on shot 002, and the arm-damped retarget's
own compromises are not measured here. What they do settle is that the
Step 11C failures are a property of the QC render setup, not a finding
about these two characters' meshes.

## The decision this leaves with the owner

The QC render setup has to change before the existing gate can say
anything about a gateway character, and each option is a change to the
QC setup, none to the envelope:

1. **Follow the character with the camera** in the QC render, so the gate
   measures the mesh and not the framing.
2. **Neutralise the driver's root translation for QC renders** (a
   walk-in-place variant of the same WALKING driver), so the character
   stays in the fixed camera.
3. **Measure in a character-centred frame**: apply the gate to
   silhouette-relative statistics rather than canvas-relative ones.

Until one is chosen and re-run, Step 11's answer for this corpus remains
"0 of 2 passed the gate as applied", now with the reason known. Grammar
stays WALKING; production stays off.
