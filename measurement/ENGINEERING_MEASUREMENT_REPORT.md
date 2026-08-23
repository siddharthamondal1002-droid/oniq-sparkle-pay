# ENGINEERING_MEASUREMENT_REPORT

Read-only measurement pass. **130 measurements** taken from assets that already
exist — 72 BVH, 30 PIXEL, 28 NORMALIZED, **0 MILLIMETRE**. Nothing rendered,
nothing generated, nothing promoted. ₹0 API, ₹0 GPU.

`SCALE_BRIDGE = NOT_AVAILABLE`

## Headline: the left/right knee labels in the library are INVERTED

Group B measured each physical knee independently for the first time. The
result does not merely refine the library's `knee_peak_L/R` records — it
contradicts their sides.

| | LEFT knee | RIGHT knee |
|---|---|---|
| corrected minimum | **147.23°** at frame **126** | **140.01°** at frame **101** |
| control minimum | **115.74°** at frame **126** | **112.28°** at frame **101** |

`CHAR-ENG-0905` files 140.0 as `knee_peak_L`; 140.0 is the **RIGHT** knee.
`CHAR-ENG-0916` files 147.2 as `knee_peak_R`; 147.2 is the **LEFT** knee.
The earlier "f101 / f126" figures were per-frame minima that happened to
alternate sides, so any L/R reading of them is wrong. All eight such records
stay `REJECTED` and are not renamed here.

**Newly measured gait asymmetry:** the right knee does more flexion work in
both clips (control mean 156.22° right vs 169.01° left; corrected 161.98° vs
173.91°). This is a real, previously unrecorded property of the driver.

### Group A — gait

| parameter | control | corrected (knee 0.50) | unit | domain |
|---|---|---|---|---|
| `stride_length_left` | 0.0009 | 12.6692 | BVH units | BVH |
| `stride_length_right` | 2.2724 | 9.5624 | BVH units | BVH |
| `stride_time_left` | 8.6667 | 36.5 | frames | BVH |
| `stride_time_right` | 11.25 | 17.3333 | frames | BVH |
| `step_time_mean` | 11.3333 | 18.0 | frames | BVH |
| `step_length_mean` | 4.2974 | 10.6263 | BVH units | BVH |
| `stance_frames_left` | 33.0 | 33.0 | frames | BVH |
| `stance_frames_right` | 33.0 | 33.0 | frames | BVH |
| `swing_frames_left` | 96.0 | 96.0 | frames | BVH |
| `swing_frames_right` | 96.0 | 96.0 | frames | BVH |
| `foot_slide_max_left` | 0.0054 | 1.3576 | BVH units | BVH |
| `foot_slide_max_right` | 0.1091 | 0.3938 | BVH units | BVH |
| `stance_symmetry_left_right` | 1.0 | 1.0 | ratio | NORMALIZED |
| `pelvis_bob_range` | 1.7455 | 1.7455 | BVH units | BVH |
| `pelvis_sway_range` | 6.2891 | 6.2891 | BVH units | BVH |
| `knee_trajectory_path_left` | 42.736 | 42.736 | BVH units | BVH |
| `knee_trajectory_path_right` | 43.0998 | 43.0998 | BVH units | BVH |
| `ankle_trajectory_path_left` | 38.769 | 43.5962 | BVH units | BVH |
| `ankle_trajectory_path_right` | 42.8025 | 47.0357 | BVH units | BVH |
| `hip_trajectory_path` | 41.6393 | 41.6393 | BVH units | BVH |
| `joint_centroid_path_unweighted` | 41.022 | 41.2282 | BVH units | BVH |

### Group B — knee, per physical knee

| parameter | control | corrected (knee 0.50) | unit | domain |
|---|---|---|---|---|
| `knee_angle_frame_of_max_left` | 102.0 | 98.0 | frame | BVH |
| `knee_angle_frame_of_max_right` | 110.0 | 110.0 | frame | BVH |
| `knee_angle_frame_of_min_left` | 126.0 | 126.0 | frame | BVH |
| `knee_angle_frame_of_min_right` | 101.0 | 101.0 | frame | BVH |
| `knee_angle_max_left` | 179.8379 | 179.9213 | deg | BVH |
| `knee_angle_max_right` | 177.0072 | 172.3694 | deg | BVH |
| `knee_angle_mean_left` | 169.0117 | 173.9121 | deg | BVH |
| `knee_angle_mean_right` | 156.224 | 161.9779 | deg | BVH |
| `knee_angle_min_left` | 115.7377 | 147.2307 | deg | BVH |
| `knee_angle_min_right` | 112.2836 | 140.0076 | deg | BVH |

### Group C — silhouette (pixels)

| parameter | control | corrected (knee 0.50) | unit | domain |
|---|---|---|---|---|
| `silhouette_height_mean` | 278.9535 | 279.9147 | px | PIXEL |
| `silhouette_width_mean` | 84.6202 | 82.5891 | px | PIXEL |
| `silhouette_aspect_ratio_mean` | 0.3036 | 0.2953 | ratio | NORMALIZED |
| `bbox_occupancy_mean` | 0.5624 | 0.5695 | ratio | NORMALIZED |
| `leg_gap_min_min` | 2.0 | 2.0 | px | PIXEL |
| `two_leg_fraction_min` | 0.1024 | 0.0945 | ratio | NORMALIZED |
| `foot_separation_mean` | 43.031 | 48.3721 | px | PIXEL |
| `silhouette_overlap_max` | 0.8976 | 0.9055 | ratio | NORMALIZED |
| `centroid_drift_x` | 200.5063 | 202.4664 | px | PIXEL |
| `centroid_drift_y` | 16.254 | 16.2275 | px | PIXEL |
| `frame_to_frame_iou_min` | 0.879 | 0.8376 | IoU | NORMALIZED |
| `frames_iou_below_090` | 11.0 | 17.0 | frames | PIXEL |

### Group E — proportions (NORMALIZED, from rig landmarks; never millimetres)

| parameter | value | unit | domain |
|---|---|---|---|
| `head_to_body_height` | 0.1227 | ratio | NORMALIZED |
| `shoulder_width_over_body_height` | 0.1879 | ratio | NORMALIZED |
| `pelvis_width_over_body_height` | 0.104 | ratio | NORMALIZED |
| `upper_arm_over_torso` | 0.337 | ratio | NORMALIZED |
| `forearm_over_upper_arm` | 1.0112 | ratio | NORMALIZED |
| `thigh_over_lower_leg` | 0.9505 | ratio | NORMALIZED |
| `foot_height_over_body_height` | 0.2189 | ratio | NORMALIZED |
| `arm_span_proxy_over_body_height` | 0.2811 | ratio | NORMALIZED |

Rig landmarks are pixels of the 253×688 crop; these ratios are dimensionless
and are **not** physical proportions.

## Group D — anatomy

697 millimetre records: `BLOCKED_SCALE_BRIDGE`. Not validated, not converted,
not deleted. See `ENGINEERING_SCALE_BRIDGE_STATUS.md`.

## Candidate classification (954 records)

| classification | count |
|---|---|
| BLOCKED_SCALE_BRIDGE (all `mm`) | 697 |
| MEASURABLE_NOT_YET_MEASURED (`deg` 149, `frames` 48, `ratio` 26) | 223 |
| OPEN (unit `mixed`, no defined domain) | 34 |

`productionEligible` is false for all 954, and for all 1,000.
