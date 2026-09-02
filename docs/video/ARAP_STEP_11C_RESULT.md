# ARAP Step 11C — the owner-authorised corpus, measured

**Decision state: `ARAP_AS_SELECTIVE_PROVIDER`**, reached through
`REAL_GATEWAY_CORPUS_MEASURED`, by the decision-confidence rule the owner
confirmed on 2026-09-02. Nothing in production changed: `allowPoseWarp` is
false, no provider is registered, the grammar is WALKING alone, the envelope
is `maxBboxFillPct: 65` with core joints shoulder/hip/knee/foot, and the
image is the validated digest, unrebuilt.

Measured by run 33652523296 on 2026-09-02, workflow
`arap-eligibility-measure.yml` at commit `e3fdb027`, image
`arap-cpu@sha256:d0fb43f5…520955`, driver mounted and invoked through the
image's ENV A python. The machine-readable reference is
`remotion/fixtures/arap-eligibility/real-gateway-eligibility-reference.report.json`
(report, comparison and decision as the run wrote them, no masks) and the
fetched manifest beside the committed one under `corpus/`. Pinned by
`src/lib/__tests__/arapRealCorpusReference.test.ts`.

## The corpus

Owner directive 2026-09-02: the 18 owner-owned stills of the two ready
films, scope `owner-only`; the other user's 27 stills out of scope. Keys
derived, not guessed, and fetched on the runner from the bucket's public read
base; hashes recorded by the first run (33646171242) and verified by this
one.

| film                | listed | fetched | at the derived key           |
| ------------------- | ------ | ------- | ---------------------------- |
| `87c2b756…` (08-31) | 9      | 9       | 704×480 PNG, sha256 verified |
| `64874747…` (09-02) | 9      | 0       | HTTP 404, all nine           |

The nine absent keys are classified `MISSING` (`NOT_IN_DRIVER_OUTPUT`) and
counted; they are not in any rate. **Why the newest film's stills are absent
at their derived keys is not established** by this evidence. The database
says the film rendered and has bytes; the still store either was not yet
live for that job or did not write. That is an operational finding outside
ARAP, recorded here and not explained.

## The measurement

| item                                       | value                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| records supplied                           | 21 (12 from the driver, 9 listed-but-absent)                                   |
| valid, measured (`MEASURED_VALID_RECORDS`) | 9                                                                              |
| not measured                               | 12 missing, 0 unauthorized, 0 malformed                                        |
| eligible / rejected                        | 2 / 7                                                                          |
| eligibility, point estimate                | 22.2 % (informational)                                                         |
| Wilson 95 % interval                       | lower 0.0632, upper 0.5474                                                     |
| majority line                              | 0.5                                                                            |
| primary candidates only                    | 2 eligible of 6 measured                                                       |
| bbox fill                                  | min 9.4, median 37.5, mean 38.7, max 71.7 %                                    |
| rejection distribution                     | core joints off silhouette 6, merged blob 1                                    |
| failure classes                            | detector_failure 3, core_joint_outside_mask 6, bbox_fill_exceeded 1, missing 9 |
| upstream gate, recorded not applied        | framing unknown 9, multiple characters 6                                       |

The interval straddles the majority line: the lower bound does not clear it
(so not `ARAP_ELIGIBILITY_SUPPORTED`) and the upper bound does not sit under
it (so not `GATEWAY_INPUT_CONSTRAINT_REQUIRED`); with at least one eligible
character that is CASE B. The point estimate is low and would read as "most
fail"; the rule the owner confirmed says the point estimate does not decide
on its own, and at n = 9 it should not.

Per record, film `87c2b756…`, candidate 0 is the detector's highest-scored
box:

| shot | cand. | fill % | det   | kpt mean | outcome                                          |
| ---- | ----- | ------ | ----- | -------- | ------------------------------------------------ |
| 000  | —     | —      | —     | —        | no drawn humanoid detected                       |
| 001  | 0     | 12.0   | 0.625 | 0.62     | rejected: hip, both shoulders off the silhouette |
| 002  | 0     | 57.2   | 0.970 | 0.69     | **eligible**                                     |
| 003  | —     | —      | —     | —        | no drawn humanoid detected                       |
| 004  | 0     | 37.5   | 0.916 | 0.33     | **eligible**                                     |
| 004  | 1     | 71.7   | 0.554 | 0.68     | rejected: merged blob, 71.7 % > 65 %             |
| 005  | 0     | 9.4    | 0.893 | 0.50     | rejected: shoulder, hip and more off silhouette  |
| 006  | —     | —      | —     | —        | no drawn humanoid detected                       |
| 007  | 0     | 29.4   | 0.762 | 0.70     | rejected: right foot off silhouette              |
| 007  | 1     | 59.4   | 0.612 | 0.76     | rejected: right foot off silhouette              |
| 008  | 0     | 30.4   | 0.817 | 0.68     | rejected: right foot off silhouette              |
| 008  | 1     | 41.2   | 0.687 | 0.73     | rejected: knee and feet off silhouette           |

## What the evidence says, and what it does not

- **Three of nine stills carry no drawn humanoid** at the detector's own
  0.5 threshold. Scenery or non-humanoid framing; the evidence does not say
  which.
- **Three of nine are multi-character** (two detections each). The existing
  upstream gate would stop all six of those records on its own; the
  envelope measured them anyway, as the brief asked, and rejected all but
  one.
- **The dominant rejection is a core joint off the u2netp silhouette**, six
  of seven, most often a foot. Whether that is the pose estimator, a
  cropped figure, or the mask is not established here; the masks and joints
  are in the run artifact for inspection.
- **One eligible character passed with a keypoint mean of 0.33.** The
  envelope does not gate on pose confidence; that is a fact about the
  envelope, recorded, not a threshold proposal.
- **No new failure mode inside the envelope** appeared: every rejection is
  one of the two reasons the gate already emits. The two findings outside it
  are the absent stills of the newest film, above, and that the validated
  image predates the `measure` verb (fixed by invoking the mounted driver
  directly; commit `e3fdb027`).

## Comparison with the offline reference

| population                        | n   | eligible | rate                | standing              |
| --------------------------------- | --- | -------- | ------------------- | --------------------- |
| `OFFLINE_CAST_SHEET_REFERENCE`    | 6   | 3        | 50 % [0.19, 0.81]   | provisional reference |
| `OWNER_AUTHORIZED_GATEWAY_CORPUS` | 9   | 2        | 22.2 % [0.06, 0.55] | measured              |

Two populations, never summed. Production eligibility is the gateway
figure: 22.2 % over `MEASURED_VALID_RECORDS`, with the interval above.

## What follows, and what does not

- **Step 11, WALKING render QC**, applies to the two eligible primaries
  (shots 002 and 004). The shots' requested motion is not recorded anywhere
  (plans are not persisted), so the QC is a capability test with the one
  grammar entry, not a claim that these shots asked to walk. It runs in
  `arap-walking-qc.yml`: rig, u2netp silhouette, WALKING render inside the
  same digest, judged by the existing `l3RenderQc`. Its verdicts are
  appended below when they exist.
- **The grammar stays WALKING.** Eligibility answered "can this character
  safely deform" for two of nine; it says nothing about what motion has
  been demonstrated.
- **Production stays off.** CASE B means ARAP could only ever be a
  selective provider with fail-closed fallback, never the path for every
  character, and that design is Step 12, a separate change gated on the QC
  result and on a production canary of its own.

## WALKING render QC

_Pending: the two eligible primaries have not yet been rendered._
