# ARAP Step 11B — the real gateway corpus, and the loop that will decide on it

**Status: `REAL_GATEWAY_CORPUS_PENDING`.** No authorised gateway pixels have
been measured. Zero.

Step 11B is the decision loop that takes ONIQ's real gateway-generated
character stills through the ARAP eligibility envelope Step 11A validated
and ends in exactly one state. Its first gate is an authorised evidence
export, and that export does not exist yet. So this change builds and proves
every stage of the loop that does not depend on the data, runs the loop on
the actual state of the world, and stops where the brief says to stop.

Nothing here enables ARAP or pose-warp, registers a provider, changes
routing, touches the validated runtime image, adds a credential, reads R2,
or changes a threshold. The routing files are byte-identical to before;
`allowPoseWarp` is `false`; `ARAP_MOTION_GRAMMAR` is WALKING alone; the
envelope is `maxBboxFillPct: 65` with core joints shoulder/hip/knee/foot.

## Step 1 — the gate that stopped the loop

Searched for an `oniq.arap-evidence/1` package this session could legitimately
read, before concluding there is none:

| where                                             | found                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `oniq-sparkle-pay`, `main` and the working branch | only the offline cast-sheet reference and the synthetic writer record from Step 11A |
| `oniq-gpu-worker`, both branches                  | the R2 upload path, no exporter, no evidence                                        |
| GitHub Actions, `arap-eligibility-measure.yml`    | never registered (the file is not on `main`), never run                             |
| GitHub releases, both repositories                | ep3 and ep4 clip transfers; nothing else                                            |
| this session's filesystem                         | nothing uploaded                                                                    |
| `scripts/evidence-export.ts`                      | a legal-request export scaffold (BSA s.63), unrelated                               |

What the gateway corpus is today, read from the production database on
2026-09-02 (ids abbreviated, counts from `story_jobs.shot_count`):

| owner                      | ready films | shots | note                                       |
| -------------------------- | ----------- | ----- | ------------------------------------------ |
| the owner (`d3b58345…`)    | 2           | 18    | plus 5 purged jobs with no shots           |
| another user (`bb483798…`) | 3           | 27    | a data-use decision the owner has not made |

The stills live in private Cloudflare R2 under `oniq-gpu/story/still/`,
keyed `<jobId>-<sceneId>-<shotId>.png` when the worker passed shot
identifiers. The database keeps no still keys and no scene or shot ids, so
enumerating the corpus is an R2 listing by the credential holder. The S3
credential lives in edge-function secrets and on the worker; it is not in
this repository, this session, or any runner, and this change does not move
it.

## What this change builds

Everything below is data-independent and is exercised by tests on synthetic
evidence in the writer's exact shape. Nothing in the repository claims to be
a gateway still.

**Step 2 — `src/lib/arapEvidenceVerify.ts`.** A package is verified before
anything is measured, and the statuses that leave are the verifier's, not
the export's. Checks, each failing closed: package and record schema
version; provenance; **authorization, checked first** — a gateway package
must carry `authorization` (`grantedBy`, `grantedAt`, `scope` of
`owner-only` | `listed-users` | `all-users`) and each record an
`source.ownerUserId` inside that scope, or the record is `UNAUTHORIZED` and
never inspected further; still identifier; working and original dimensions;
bbox through the Step 11A normalizer; mask (positive dimensions, `data`
length = width × height, values 0/1); joints (present, finite); detector
confidence (required for artifacts, in [0, 1], positive detection count);
joint confidence (null or in [0, 1]); `poseWarpInputs` (typed, no unknown
keys, with the known and missing fields of the upstream gate listed per
record). Nothing is repaired.

**Step 6 — failure classes** (`src/lib/arapCorpusDecision.ts`). Each class
maps to a string an existing gate actually emitted or a status the verifier
actually assigned; what the evidence cannot establish is
`UNKNOWN_EVIDENCE_FAILURE`.

| class                      | supported by                                                |
| -------------------------- | ----------------------------------------------------------- |
| `bbox_fill_exceeded`       | `arapCharacterEligible`: merged-blob rejection              |
| `core_joint_outside_mask`  | `arapCharacterEligible`: core-joint rejection               |
| `detector_failure`         | driver `NO_HUMANOID_DETECTED`                               |
| `pose_failure`             | driver `NO_SKELETON`                                        |
| `missing_mask`             | driver `U2NETP_MASK_FAILED`, or a mask the verifier refused |
| `malformed_bbox`           | a bbox the normalizer refused                               |
| `malformed_evidence`       | any other shape failure                                     |
| `unauthorized`             | outside the package's authorization                         |
| `missing`                  | `UNREADABLE_IMAGE`, or declared missing by the export       |
| `UNKNOWN_EVIDENCE_FAILURE` | `EMPTY_CROP`, and anything unrecognised                     |

Upstream blockers (`multiple_character`, `insufficient_resolution`,
`occlusion`, `framing`, `photoreal`, `arms_against_torso`) are the existing
`poseWarpEligible` gate's own reasons, recorded apart and never applied. Its
fail-closed answer on an unknown framing is recorded as `framing_unknown`, a
fact about the evidence, not a finding about the still.

**Step 7 — the report.** `buildRealCorpusReport` produces
`oniq.arap-real-corpus-report/1`: supplied / valid / measured; missing,
unauthorized, malformed; eligible and rejected; the rate with its
denominator named in the JSON as **`MEASURED_VALID_RECORDS`** and a Wilson
95% interval; bbox-fill and joints-outside-mask distributions; rejection and
failure-class distributions; per-still rows; provenance; package version;
caveats. There is no eligible-over-everything-supplied field, because it
would read an unauthorised still as a failed one. The counts must add up or
the builder throws.

**Step 8 — the comparison.** `compareWithOffline` reports the two
populations side by side with `populationsMerged: false`: the offline
cast-sheet reference (n = 6, provisional) and the gateway corpus (n =
measured, or `NOT MEASURED`). A report from any population but `gateway`
offered as the gateway side is refused.

**Step 9 — the decision.** `decideGatewayState` ends in exactly one state
and never skips one:

```
REAL_GATEWAY_CORPUS_PENDING          no gateway package; a package not declared
                                     `gateway`; a package that failed verification;
                                     or one where no authorised valid record was measured
        ↓
REAL_GATEWAY_CORPUS_MEASURED         at least one authorised valid record measured
        ├── REAL_CORPUS_INSUFFICIENT             measured < 6
        ├── ARAP_ELIGIBILITY_GATE_SUPPORTED      interval lower bound ≥ 0.5
        ├── ARAP_AS_SELECTIVE_PROVIDER           interval straddles 0.5
        └── GATEWAY_INPUT_CONSTRAINT_REQUIRED    interval upper bound ≤ 0.5
```

The rule reads the Wilson 95% interval of eligible over
`MEASURED_VALID_RECORDS`, not the point estimate: at n = 6 only a unanimous
result decides A or C; at n = 18, A needs 14 eligible and C allows at most 4. Its parameters (`minMeasured: 6`, `majority: 0.5`, 95%) are
**decision-rule parameters, not ARAP thresholds**, they live in
`DECISION_RULE`, and they are marked PROVISIONAL: the owner confirms them
before the first real decision is acted on. `OFFLINE_CAST_SHEET_REFERENCE`
cannot reach `REAL_GATEWAY_CORPUS_MEASURED` whatever it scores; a test pins
that with the real fixture.

**The CLI** — `scripts/arap-real-corpus-decision.ts` — runs the whole chain
and prints `STATE: …`. It writes
`real-gateway-eligibility-reference.evidence.json` and
`real-gateway-eligibility-reference.report.json` only for a package declared
`gateway`; on today's state it prints `REAL_GATEWAY_CORPUS_PENDING` and
writes nothing, so no file exists that could be mistaken for a measurement.

**The workflow** gains one step: when the corpus zip carries
`corpus-manifest.json`, the decision runs over the driver's output; without
it, the run prints the pending state. The instrument self-test never
carries a manifest.

## What the owner's authorised export looks like

This is the exact dependency, and it involves no session credential.

1. **Decide the scope.** `owner-only` covers the 18 owner stills. Using the
   other user's 27 needs an explicit `all-users` or `listed-users` grant,
   recorded in the manifest below — a data-use decision, the owner's alone.
2. **Export the stills** from `oniq-gpu/story/still/` with the R2 credential
   the owner holds, on the owner's machine. Flat PNGs, each named by its key
   stem (`<jobId>-<sceneId>-<shotId>.png`); the stem becomes the record's
   `stillId`.
3. **Write `corpus-manifest.json`** beside them (schema
   `oniq.arap-corpus-manifest/1`):

   ```json
   {
     "schema": "oniq.arap-corpus-manifest/1",
     "population": "gateway",
     "corpusId": "gateway-2026-09-02",
     "authorization": {
       "grantedBy": "owner",
       "grantedAt": "2026-09-02",
       "scope": "owner-only",
       "ownerUserId": "<the owner's user id>"
     },
     "stills": {
       "<jobId>-<sceneId>-<shotId>": {
         "ownerUserId": "<the owner's user id>",
         "jobId": "<jobId>",
         "sceneId": "<sceneId>",
         "shotId": "<shotId>",
         "sha256": "<sha256 of the png>"
       }
     }
   }
   ```

   A still without a manifest entry is refused under any scope but
   `all-users`; a still listed but absent from the zip is counted `MISSING`;
   a sha256 that disagrees with the driver's is `MALFORMED`.

4. **Zip it flat** and put the zip where a GitHub runner can fetch it (a
   time-limited presigned URL is enough), then dispatch
   `arap eligibility measure` with `corpus_url` and a `corpus_id`. The
   workflow needs to be on `main` first; it is currently only on the
   working branch, and merging is the owner's call. The run pulls the
   validated image by digest, measures inside it with the mounted driver,
   computes eligibility with the production functions unchanged, verifies
   and decides, and uploads `out/` including `out/decision/`.
5. **Or, on any machine with Docker**, the same three commands the workflow
   runs, then `npx tsx scripts/arap-real-corpus-decision.ts --driver-out
<out> --corpus-manifest <manifest> --out-dir <out>/decision`. This
   session has no Docker daemon, so it cannot run the in-image half itself.
6. Hand the two `real-gateway-eligibility-reference.*.json` files to a
   session. They carry masks, joints and numbers, not pixels.

## Steps 10–13, on today's evidence

- Grammar stays WALKING. Eligibility answers "can this character safely
  deform"; grammar answers "what motion has been demonstrated". A high
  gateway rate, when there is one, adds no grammar entry.
- Render-level validation (Step 11) needs an eligible real character with a
  WALKING request. None exists to validate. `l3RenderQc` remains the
  post-render gate; a correct skeleton is not sufficient.
- Production integration stays off (Step 12), and the Step 12 design (Step 13) is not written: it is conditioned on evidence this loop has not seen.

## Design reference

The real-film reference (_Spider-Man: Into the Spider-Verse_, 24 fps, on
ones and twos) stays as recorded in `ARAP_STEP_11A_MEASUREMENT.md`: a
design principle that stylised motion may use deliberate pose changes and
holds, not a benchmark, not a claim about ONIQ, and not an acceptance
criterion. ONIQ's acceptance criteria come from ONIQ's own measured runtime
and character corpus.

## Verification

Full Vitest suite, `npm run lint:ci`, `tsc`, Prettier on every touched
file, the ARAP drift/pins tests, bbox tests, evidence-contract tests,
corpus-aggregation tests, routing regression tests, the 11A production-safety
guards and the new 11B guards all pass; the exact counts are in the commit
and the completion report. Ten mutations of the boundaries that matter
(offline promotion, missing authorization admitted, denominator widened,
point estimate read, minimum lowered, unknown framing reported as a finding,
unauthorised counted as rejected, non-binary mask admitted, workflow deciding
without a manifest, a grammar entry added) were each caught by the tests and
each file restored byte for byte. Validated image digest, unchanged:

```
ghcr.io/siddharthamondal1002-droid/oniq-sparkle-pay/arap-cpu@sha256:d0fb43f5f0b2252ff62fc5bee15e121de2ece6d21711de39801d25878d520955
```
