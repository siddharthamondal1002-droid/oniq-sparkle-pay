# ONIQ video acceptance gate

`ALL_MANDATORY_QA_PASS` is the acceptance condition. **Only `HARD_FAIL` blocks
acceptance; a `WARNING` is recorded and never consumes a paid entitlement.**

Implementation: `pricing/acceptance_gate.py`. Deterministic, fail-closed,
read-only. Thresholds are **lifted from shipped ONIQ code**, not invented.

## The checks

| #   | check                             | class      | severity                       | source of threshold                                   |
| --- | --------------------------------- | ---------- | ------------------------------ | ----------------------------------------------------- |
| 1   | `file_exists`                     | MEASURED   | HARD_FAIL                      | —                                                     |
| 2   | `file_min_bytes`                  | MEASURED   | HARD_FAIL                      | `VIDEO_MIN_BYTES` = 1024, `storyPreflight.ts`         |
| 3   | `file_decodes`                    | MEASURED   | HARD_FAIL                      | —                                                     |
| 4   | `duration_within_band`            | DERIVED    | HARD_FAIL                      | `DURATION_MIN/MAX_RATIO` 0.5/1.6, `storyPreflight.ts` |
| 5   | `resolution_recorded`             | MEASURED   | recorded                       | film canvas is 1080×1920, `remotion/src/Root.tsx`     |
| 6   | `no_blank_frames`                 | MEASURED   | HARD_FAIL                      | ink fraction < 0.1 %                                  |
| 7   | `no_frozen_run`                   | MEASURED   | HARD_FAIL                      | longest identical run ≤ 10 % of clip                  |
| 8   | `character_present`               | MEASURED   | HARD_FAIL                      | —                                                     |
| 9   | `temporal_aliveness`              | MEASURED   | HARD_FAIL                      | `CLIP_ALIVENESS_MIN` = 0.75, `story-worker.mjs`       |
| 10  | `within_render_envelope`          | MEASURED   | HARD_FAIL                      | zero border contact                                   |
| 11  | `silhouette_area_stable`          | DERIVED    | HARD_FAIL                      | max/min ≤ 3.0                                         |
| 12  | `audio_integrity`                 | OPEN / N_A | HARD_FAIL when audio requested | —                                                     |
| 13  | `character_reference_consistency` | **OPEN**   | WARNING                        | no reliable automated test exists                     |
| 14  | `severe_anatomy_artifacts`        | **OPEN**   | WARNING                        | no reliable automated test exists                     |
| 15  | `dialogue_presence`               | **OPEN**   | WARNING                        | not measurable at this stage                          |
| 16  | `final_assembly_integrity`        | **OPEN**   | WARNING                        | needs the full film                                   |

**Nothing unreliable is labelled deterministic.** Four checks the loop asked for
are recorded `OPEN` rather than faked, and one — `audio_integrity` — **fails
closed** when audio is requested but the stage cannot produce it.

## Validation

The gate was proven to discriminate **before** it was trusted: a real clip
ACCEPTS; a frozen tail, spliced blank frames, a dead clip and a truncated file
all HARD_FAIL, each on the checks you would expect. See the benchmark report.

## GIF frame expansion

Entries are expanded by `duration` into real frames. PIL collapses consecutive
identical frames and accumulates their duration — reading `n_frames` instead is
how a 779-frame render was once reported as 159 frames. The gate does not repeat
that.

## Scope

Runs on the **in-house motion-stage clip**. The still and TTS stages need
provider keys absent from this container, so whole-film gating is `OPEN`.
