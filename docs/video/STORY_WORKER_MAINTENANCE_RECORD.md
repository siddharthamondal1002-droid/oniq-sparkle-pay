# Story worker maintenance record

Observed 2026-09-14 before any maintenance edits.

## Connector access restored/confirmed

GitHub connector inspection is working from this task session:

- workflow run metadata was readable for run `34763132497`
- job metadata was readable for job `103739321044`
- branch listings were readable
- workflow source on `main` was readable
- job logs were retrievable

## Current repository state

- current local working branch: `copilot/create-dedicated-maintenance-branch`
- current GitHub `main`: `a39a338e217f9687ff10ac0da86322f5c7d269c1`
- current local `main` after fetch: `a39a338e217f9687ff10ac0da86322f5c7d269c1`
- inspected failed story-worker run: `34763132497`
- inspected failed render job: `103739321044`
- inspected run head branch: `main`
- inspected run head SHA: `bbb045d86fc4d47a4c0f4e3b729da7e1093cdfbb`
- inspected run result: `completed / failure`

## Observed failed run details

GitHub reported these terminal step states for job `103739321044`:

1. Set up job — success
2. Run `actions/checkout@v5` — success
3. Run `actions/setup-node@v4` — success
4. `ffmpeg` — success
5. `install remotion` — success
6. `chromium` — success
7. `cached in-house voice` — success
8. `redact the job token from the log` — success
9. `render one job` — failure
10. `failure log` — success

The retrieved render log named the immediate defect as `storySeconds is not defined`.

## Checkout semantics observed from the product workflow

`/home/runner/work/oniq-sparkle-pay/oniq-sparkle-pay/.github/workflows/story-worker.yml` currently shows:

- `repository_dispatch` is the product path
- `workflow_dispatch` is the manual/operator path
- the render job uses `actions/checkout@v5`
- that checkout step has no explicit `ref`, so the product workflow runs the commit GitHub attached to the worker run on the default branch

This record distinguishes the failed run's `head_sha` (`bbb045d...`) from current `main` (`a39a338...`): the later fix is on `main`, but acceptance still requires one observed post-fix product-supported execution.

## Existing runbooks and incident references

Relevant checked-in operational references already present:

- `docs/incident-response.md`
- `docs/legal-ops.md`
- `docs/oqca/DISPATCH_INCIDENT.md`
- `docs/sprint-notes.md`
- `docs/video/ARAP_STEP_11B_REAL_CORPUS.md`

## Existing low-risk prior art already in production code

- `supabase/functions/story-dispatch/index.ts` exposes read-only GitHub inspection actions: `workflow_head`, `runs`, `run_log`
- `supabase/migrations/20260912060000_oniq_ops_watchdog.sql` plus `supabase/functions/ops-alert/index.ts` already model low-risk server-side monitoring and deduplicated alerting

This change adds a GitHub-native maintenance workflow and checked-in maintenance records; it does not dispatch or charge anything by itself.
