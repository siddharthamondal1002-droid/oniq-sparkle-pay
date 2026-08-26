# ONIQ in-house media inference — production record

Owner directive, 2026-08-26: **in-house video generation is ONIQ's
PRIMARY video path.** Google/Veo is optional — fallback or a future
premium tier — and never required; no video request may fail merely
because Google video is unavailable. Wan 2.1 14B is FUTURE/EXPERIMENTAL
and disabled. This file is the production record; the measured evidence
chain lives in `ONIQ_AI_FINANCIAL_CONTROL.md` §16n–§16q.

## The production engine

| Item          | Value                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model         | `Lightricks/LTX-Video` (2B, diffusers snapshot)                                                                                                                                                               |
| Revision lock | baked at image build; identity recorded in `/app/models/MODEL_ID`; a 16 GiB transformer size guard refuses any 13B/14B-class checkpoint; weights load `local_files_only` — no network fetch at job time, ever |
| GPU           | NVIDIA GeForce RTX 3090 (24 GB), RunPod Secure Cloud                                                                                                                                                          |
| Endpoint      | `p3zmlv8ek10dzt` — 3090-exclusive `gpuTypeIds`, `gpuCount` 1, `workersMin` 0, `workersMax` 1, no substitution                                                                                                 |
| Storage       | Cloudflare R2 bucket `oniq-gpu`; production keys `media/input/<job_id>/…` in, `media/video/<job_id>/…` out; credentials live ONLY in the RunPod endpoint environment                                          |
| Worker        | `oniq-gpu-worker` main — uid-10001 read-only image, six shipped files, exec-form CMD, no shell surface (CI-scanned)                                                                                           |

## Initial production limits (Phase 8)

704×480, 24 fps, 3–5 s clips, concurrency 1, 900 s runtime ceiling,
**$0.50 hard ceiling per job**. Resolution and duration are server
constants — not exposed to callers — and expand only after real
production measurements justify it.

## Financial control (Phase 9)

Every job: live RTX 3090 Secure Cloud quote (never historical),
reservation `CEIL(price×900/3600, $0.01)` ≤ $0.50 or FAIL CLOSED,
unavailable price or GPU = FAIL CLOSED (no substitution), actual
billing reconciled against the reservation after every job, always-on
orphan sweep.

## Termination rule (Phase 6/17 — owner directive 2026-08-26)

The production financial rule concerns **ACTIVE COMPUTE**: after every
job, `pods = 0`, `running = 0`, `initializing = 0` (throttled/unhealthy
count when reported). `workersStandby` is provider-managed and not
settable by any API this account reaches (three-surface proof, ledger
§16p): a non-zero standby pool is recorded as
`STANDBY_PROVIDER_MANAGED` and the total worker count is never claimed
to be zero. An unreadable answer stays `TERMINATION_UNKNOWN`, which is
never converted to success and stops new GPU admissions.

## Provider architecture (Phases 2–4, 23–24)

`src/lib/videoProvider.server.ts` is the single source of truth:
`VIDEO_PROVIDER = in_house`, `GOOGLE_VIDEO_REQUIRED = false`,
`WAN_GENERATION_ENABLED = false`, selection server-controlled (the
selector takes no caller input). The story movie pipeline consumes
these flags when its in-house wiring lands; today its Veo path already
degrades to the classic stills renderer when Google is unavailable, so
no video request hard-depends on Google. External providers are used
only for a measured product reason, never by default.

## Client contract (Phase 10)

A caller may submit a prompt, an input object reference, and job
metadata. A caller may NOT submit a GPU, provider, endpoint, model,
container, runtime ceiling, budget, worker count, or credentials — the
worker's job schema refuses unknown fields outright (tested).

## License (Phase 21)

LTX-Video weights ship under Lightricks' **LTX-Video community
license** (the model repo's LICENSE file at
`huggingface.co/Lightricks/LTX-Video` is authoritative). As commonly
published it permits commercial use for organizations below an annual
revenue threshold (recorded understanding: US $10M), with attribution
requirements. ONIQ's current status — new, zero capital, zero
revenue — is within that threshold **today; this status is not
permanent**. Standing rule: if ONIQ approaches any licensing threshold
(revenue or otherwise), STOP and reassess the affected commercial use
before continuing, and re-read the license text as published at that
time rather than this summary.

## Measured production baseline (§16n)

$0.50/h live secure price → $0.13 reservation; 4.04 s clip (97 frames,
704×480/24fps) in 45.5 s execution: model load 11.5 s, inference
29.0 s, encode 1.0 s, peak VRAM 15,916 MB; **$0.01 actual =
$0.0025 per generated second, $0.15 per generated minute** — measured
baseline figures, not guarantees. Cold pull of the ~20 GB weight-baked
image: 399 s, once per release. Owner quality verdict on the baseline
clip: "awesome".

## Fail-closed conditions (Phase 27)

New admissions stop on: 3090 or price unavailable, reservation over
ceiling, CUDA unavailable, model failure, R2 failure, invalid output,
billing anomaly, orphan or unexpected active compute, repeated
OOM/generation failure. Every stop is a typed code; nothing
auto-recovers around a financial failure.
