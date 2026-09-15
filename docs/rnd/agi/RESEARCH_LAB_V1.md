# ONIQ AGI Research Lab v1

## Scope

The first in-app Research Lab reuses the authenticated TanStack route at `/app/admin/oqca` and the existing OQCA observer. Access is limited twice: the route requires an ONIQ session and the new `agi-research` edge function revalidates the caller's JWT and `is_admin` status before handling any action.

The verified implementation base is `main` at `4ab803407d9cc343262f32ff538863154c2bd4e1`. At implementation start, GitHub's compare API reported that checkpoint and `main` as identical (zero commits ahead or behind).

## Capabilities

- Repository research reads the server-resolved `main` commit and returns bounded excerpts from matching text files. It does not claim that an excerpt is correct or synthesize benchmark results.
- OQCA production observation remains the existing `oqca-observe` call. Its configured text budget may incur cost; its production tool-call budget remains zero.
- Repository write support is limited to one reversible action: create a research backlog issue. No code, branch, repository setting, deployment, workflow, or motion-routing mutation is exposed.

## Write Gate

The write control is unavailable unless `ONIQ_RESEARCH_GITHUB_TOKEN` exists only in the edge-function environment. The intended token is least privilege for issues on this repository; no token is returned to or referenced by client code.

A write uses two separate requests:

1. `stage_write` validates the issue and creates a server-only record with a five-minute expiry.
2. The page displays the exact consequence and requires the user to type `CREATE RESEARCH ISSUE`.
3. `confirm_write` atomically moves that caller's unexpired request from `pending` to `executing`. A second use cannot match the pending state.
4. The server creates the issue and records completion or failure. Failures are not retried automatically because the remote outcome can be ambiguous.

The confirmation table has row-level security enabled and grants no access to `anon` or `authenticated`; only the server-side service client uses it.

## API Contract

`POST /functions/v1/agi-research` supports:

- `capabilities`: reports the repository revision and server-configured availability.
- `research`: accepts `query` (2-120 characters), examines at most six text files of at most 80,000 bytes each, and applies a 12-second timeout to each GitHub request.
- `stage_write`: accepts only `kind: "issue"`, a title of 8-160 characters, and a body of 20-6,000 characters.
- `confirm_write`: accepts the staged UUID and exact confirmation phrase once before expiry.

## Security And Limits

- GitHub access is server-side. Public repository reads work without credentials; authenticated reads and issue creation use the optional server secret.
- The edge function is admin-only even if an unlinked client calls it directly.
- v1 performs filename/path-based evidence selection, not semantic code search.
- The write gate does not authorize source changes. Pull requests remain an external, human-controlled workflow.
- Uploaded Step 11D and rigid-puppet materials are contextual evidence only. This change does not modify motion production routing.

## Validation

Focused tests assert server-only credentials, admin gating order, read bounds, the one-time unexpired confirmation transition, the issue-only write surface, and browser-role denial on confirmation records. Repository-wide checks should be run in CI from the pull request because the implementation environment could not clone the repository through its network proxy.
