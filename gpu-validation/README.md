# gpu-validation — vendored harness

Owner directive, 2026-08-25: the live GPU validation runs from this
repository, because `RUNPOD_API_KEY` lives in this repository's Actions
secrets. These five files are byte-identical vendored copies of the
tested harness in `oniq-gpu-worker@bebaf8a` (257 tests there, including
a uid-10001 read-only rig):

- `runpod_client.py` — RunPod transport; raw bytes first, parser second
- `contract.py` — the job contract and output whitelist
- `validation/admission.py` — financial admission, pure and offline
- `validation/spend_run.py` — the phases 9–19 driver (incl. the
  five-scene video battery)
- `validation/standby_zero.py` — workersStandby → 0, the harness's one
  endpoint mutation (hard-coded zero, fresh-read verified)

Do not edit these here. Changes land in `oniq-gpu-worker` first, pass
its CI, and are re-vendored with the new commit id updated above.

What is deliberately NOT here: `handler.py`, `preprocess.py`,
`storage.py`, the Dockerfile — the deployable worker stays in its own
repository, and nothing in this directory contains a serverless
entrypoint. The prohibition on moving the worker into the app repo is
about that outcome, and it still holds.

The workflow that uses this directory is
`.github/workflows/gpu-validation.yml`: `workflow_dispatch` only,
read-only discovery by default, and spending gated on the literal
`SPEND` input plus approval of this repository's `gpu-spend`
environment, which preflight verifies actually carries a
required-reviewer rule before anything can run behind it.
