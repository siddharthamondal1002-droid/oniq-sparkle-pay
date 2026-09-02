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
  below.
- **The grammar stays WALKING.** Eligibility answered "can this character
  safely deform" for two of nine; it says nothing about what motion has
  been demonstrated.
- **Production stays off.** CASE B means ARAP could only ever be a
  selective provider with fail-closed fallback, never the path for every
  character, and that design is Step 12, a separate change gated on the QC
  result and on a production canary of its own.

## WALKING render QC

_Step 11D (run 33662521801) established why both failed: the driver's root
translation under the fixed reference camera, which fails the reference
character on the same reasons. See `ARAP_STEP_11D_DIAGNOSIS.md` and the
checked-in `ONIQ_Step_11D_Diagnosis_Report.pdf`. The verdicts below stand as
recorded._

Run 33654209597 (`arap-walking-qc.yml` at `21e99575`, same digest) rigged
each eligible primary with the image's own auto-rig, replaced the rig's
classical mask with the u2netp silhouette the envelope mandates, rendered
the WALKING driver (zombie.bvh, arm-damped retarget) headlessly, measured
every frame in ENV B, and judged with the existing `l3RenderQc` at its
default thresholds. The verdicts, as the run printed them, are in
`remotion/fixtures/arap-eligibility/real-gateway-walking-qc-reference.json`;
the clips, rig directories and per-frame statistics are in the run's
artifact.

| shot | frames | mean fill | fill min / max | largest per-frame drop | foot range  | edge contact from | vanished from | verdict                                                     |
| ---- | ------ | --------- | -------------- | ---------------------- | ----------- | ----------------- | ------------- | ----------------------------------------------------------- |
| 002  | 270    | 12.5 %    | 0.005 / 15.7 % | 0.34 pt                | 80 / 500 px | frame 159         | frame 237     | **FAIL**: left the frame or vanished; foot line roamed 16 % |
| 004  | 590    | 4.9 %     | 0 / 6.0 %      | 0.10 pt                | 63 / 500 px | frame 346         | frame 526     | **FAIL**: left the frame or vanished                        |

**0 of 2 passed.** The rig itself was fine on both (detector 0.970 and
0.916, the same primaries the measurement scored), the silhouette was the
measured one (57.2 % on shot 002), the render produced real moving pixels
(inter-frame difference 1.18 and 0.73, at most 7 static pairs of 589), and
the mean fill sat above the gate's 4 % collapse floor. What failed is that
in both clips the character reached the canvas edge and, some 80 to 180
frames later, was gone. The fill declined gradually to nothing; the largest
frame-to-frame loss was a third of a percentage point. That is the
walked-out-of-view signature, not the sudden crumple of a torn mesh.

What the evidence does not establish is why. Two readings fit the numbers
and only the frames can separate them: the ARAP deform drifting the figure
off its ground under the walk, which is the instability the gate exists to
catch, or the driver's scene translation carrying a correctly deforming
figure out of the fixed reference camera. The gate is deliberately blind to
that distinction and fails closed; under the brief, a failed render remains
a failure even when eligibility passed, and it is recorded as such. Frame
inspection of the artifact's clips is the next step, and it is a human one.

So Step 11 answers, for this corpus: **no real character has yet passed the
isolated WALKING QC.** Nothing is enabled, and nothing was going to be
enabled by a pass either.

## Where this leaves ARAP

- **Eligibility: `ARAP_AS_SELECTIVE_PROVIDER`**, 2 of 9 over
  `MEASURED_VALID_RECORDS`, with an interval that straddles the majority
  line.
- **Render QC: 0 of 2.** Both eligible characters failed the existing gate
  on the one grammar entry.
- **Grammar: WALKING**, unchanged. **Production: off**, unchanged.
- A Step 12 design for a selective provider is not warranted by this
  evidence until at least one real character survives the render gate; the
  frame inspection above decides whether that is a deform problem or a
  camera problem, and those have different fixes and different owners.
