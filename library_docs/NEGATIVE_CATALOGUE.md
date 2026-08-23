# NEGATIVE REFERENCE CATALOGUE — real measured failures, QA references ONLY

Every image here is a REAL failure produced and measured by the ONIQ
pipeline during the motion loops — not synthetic art. Each maps to a
poster §3/§6 negative panel. NEVER mix these with production candidates.

| file | poster panel | measured provenance |
|---|---|---|
| blade_spike_wave_sleeve.png | Blade/Spike | WAVE grammar falsification: wave_hello projects a sleeve blade (aliveness 0.51); WAVE excluded from grammar |
| wingtent_arms_graded_damping.png | Arm/Claw | graded arm damping s=0.4 falsification: zombie frame-0 arms are outstretched — damping toward it tents the arms |
| claw_arms_stock_retarget.png | Arm/Claw | stock fair1_ppf retarget: 4/5 corpus artifact frames — why the arm-damped retarget exists |
| merged_blob_collapse_bordercut.png | Merged Blob/Collapse | v1 mother collapse — root cause border-cut mask (fill≤65% mechanism falsified; padding fixed it) |
| edgeon_sliver_bordercut.png | Edge-on Sliver | v1 lampJinni sliver (~1.8% fill) — same border-cut root cause; l3RenderQc fill≥4% backstop |
| distortion_lowconf_rig.png | Limb Distortion | jarJinni kpt_conf_mean 0.61 — below the 0.70 gate; why the confidence floor exists |
| thinstroke_tear_ghost.png | Mesh Tears/Ghost | adchar4 — thin strokes below ~24px ARAP mesh pitch tear; the documented residual false accept |
| thinlimb_merge_urchin.png | Merged Limbs | urchin STRESS_TEST — stick legs merge into one strand; mesh-pitch class, NOT fixed by knee damping |
| ineligible_side_view.png | (pre-render gate) | morgiana_side — drawn-humanoid detector correctly fails on side views; ineligible→fallback |
