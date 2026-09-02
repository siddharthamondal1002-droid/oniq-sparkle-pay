# ARAP Step 11A — eligibility measurement, and what it does not claim

**Status: `MEASUREMENT_ENGINE_VALIDATED_REAL_CORPUS_PENDING`.**

Step 11B — the verifier, the failure classes, the named-denominator report
and the decision state machine that will consume the real corpus — is in
`ARAP_STEP_11B_REAL_CORPUS.md`, and stands at `REAL_GATEWAY_CORPUS_PENDING`.

Step 11A builds and validates the instrument that measures ONIQ's existing
ARAP eligibility envelope. It does **not** enable pose-warp, register a
provider, change routing, or touch the validated runtime image. No real
gateway pixels have been measured, because none are reachable by any path
this work is authorised to use. Everything below is sorted by what kind of
evidence stands behind it.

## Proven

| what                                  | how                                                                                                                                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The ARAP CPU runtime                  | image `arap-cpu@sha256:d0fb43f5f0b2252ff62fc5bee15e121de2ece6d21711de39801d25878d520955`, run 33624902426: ENV A and ENV B built, torch hash-enforced, every in-image proof passed, two renders byte-identical inside the image. Recorded in `runtime/arap-cpu/pins.json`. |
| The measurement engine's arithmetic   | `src/lib/arapEligibilityCorpus.ts` over synthetic evidence records produced by the real Python writer; 16 production-safety guards; mutation-tested.                                                                                                                       |
| The bbox contract                     | `src/lib/arapBbox.ts`: one canonical form, declared representations only, every malformed/ambiguous/inverted/negative/out-of-bounds input refused with a reason.                                                                                                           |
| That measurement cannot reach routing | the measurement module imports two eligibility functions and the upstream gate, nothing else; the routing files are byte-identical to before this change (hashes in the commit).                                                                                           |

## Measured offline (`OFFLINE_CAST_SHEET_REFERENCE`, n = 6)

The six-character cast-sheet corpus from 2026-08-22 (`MOTION_CPU_CORPUS.md`)
is fed through the engine as **recorded** evidence — the bbox fill and
off-mask joints that run measured, with provenance — not as pixels. The
sheet images are not in the repository, so the autorig stage is not
re-executed here; the engine's gate and aggregation mechanics are.

- n = 6 characters (aladdin auto-rig, morgiana, mother, fisherman, magician, lampJinni).
- The thresholds (`maxBboxFillPct: 65`, core joints shoulder/hip/knee/foot) are **provisional**, derived from this same n=6, and are not tuned here.
- Cast sheets are clean cut-outs on plain backgrounds. They are **not representative of gateway traffic**, which is painterly, scene-composited, variably framed and sometimes multi-character.
- Result, from `remotion/fixtures/arap-eligibility/offline-cast-sheet-reference.report.json`: 6 measured, 0 not measured; **3 eligible** (aladdin hand-rig, aladdin auto-rig, morgiana) and **3 rejected** — 2 merged-blob silhouettes (mother 74.8%, lampJinni 67.3%) and 1 core-joints-off-silhouette (fisherman: left_shoulder, left_foot). bbox fill 51.7–74.8%, median 57.0.
- What this establishes: the engine reproduces the verdicts the repository's own corpus test pins. What it does not establish: a production eligibility rate. The 50% figure is six cast sheets and must not be quoted as anything else.

## Production evidence unavailable

Real gateway stills exist — 36 shots across 4 delivered films since the
gateway restore, 9 of them the owner's (job `64874747`), 27 belonging to
another user — and live in private Cloudflare R2 under
`oniq-gpu/story/still/`. There is no path to their bytes from a runner, from
this container, from a fixture, or from any artifact: the story worker
keeps no frames by explicit policy ("a Story's frames are the user's"), the
callback persists no scene/shot ids, and the R2 credential lives only in
edge-function secrets.

**Exact dependency:** an owner-authorised export producing an evidence
package (below) from R2. Nothing in this change adds a credential, modifies
the worker, or reads R2. Until that export exists the correct result is
`REAL_GATEWAY_CORPUS_PENDING`, and the 27 non-owner stills are additionally
a data-use decision the owner has not made.

## Not yet measured

- Eligibility on any gateway still (n = 0).
- Whether the classical mask's measured failure on painterly art (100% fill on 6/6 sheets) recurs on gateway output — the engine records both masks so this will be visible the moment a corpus arrives.
- Multi-character, non-frontal and non-full-body gateway framings: the engine keeps every detection at the detector's own 0.5 threshold and records the upstream gate's answer, but has seen none.

## The evidence package an authorised export must produce

A directory or zip: `manifest.json` (schema `oniq.arap-evidence/1`, corpus
id, provenance) plus either stills for the in-image driver to process, or
`records/*.json` already in the writer's shape. Each record carries a
status — `AVAILABLE`, `MISSING`, `UNAUTHORIZED`, `MALFORMED` — and the
engine counts anything but `AVAILABLE` as **NOT MEASURED**, never as
ineligible.

Run it with `.github/workflows/arap-eligibility-measure.yml`
(`corpus_url` → the package). The workflow pulls the validated image by
digest, mounts the driver rather than baking it, cannot push, cannot render,
and cannot enable anything; its guards are tests in the repository, read as
data, after an in-run grep guard failed four times on its own trigger text.

## Design reference: motion on twos

_Spider-Man: Into the Spider-Verse_ (2018) is a released feature, presented
at 24 fps, whose character animation is documented as being drawn on ones
and on twos — on twos meaning roughly twelve distinct drawings per second of
24-fps output — and whose cadence is chosen per performance as part of the
visual language rather than fixed at one drawing per frame.

The relevance to ONIQ is a design principle, not a benchmark: a stylised
character can read as convincingly in motion through deliberate pose
changes, holds and a controlled temporal cadence, and continuous 24-fps
deformation is not inherently required for every stylised performance. That
principle is compatible with a CPU-only ARAP pipeline whose realistic target
is `illustrated still → 15-joint pose → ARAP deformation → verified motion
grammar → controlled pose cadence → 24-fps final video`, where a valid
result may hold each pose for two output frames or deform continuously
where the verified motion needs it. The objective is recognisable, stable,
anatomically plausible stylised motion without deformation collapse — not
maximum temporal smoothness.

None of this is a claim that ONIQ reproduces the film, matches its quality,
or shares its pipeline, and it does not justify adding a single motion
grammar entry: WALKING remains the only one, and each addition still needs a
real driver, a real render, frame inspection, collapse QC, measured
evidence and a regression test.
