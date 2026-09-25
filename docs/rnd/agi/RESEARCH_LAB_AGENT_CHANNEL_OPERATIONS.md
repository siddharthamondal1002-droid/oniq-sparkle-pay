# Research Lab Workspace Agent Channel Operations

## Purpose

The admin-only Research Lab can queue a published ChatGPT Workspace Agent through API channel `agtch_6aa9492e2eec8191bbefd0c09127a457`. The Supabase edge function is the only component allowed to call `api.chatgpt.com`. The browser receives only the returned ChatGPT conversation URL and optional run identifier; it never receives the Workspace Agent access token.

The integration follows OpenAI's Workspace Agents API documentation:

- Trigger contract: <https://developers.openai.com/workspace-agents/trigger-runs>
- Access-token provisioning: <https://developers.openai.com/workspace-agents/authentication>

## Required Secret

Set `ONIQ_WORKSPACE_AGENT_ACCESS_TOKEN` as a server-only secret in the target Supabase project. Do not prefix it with `VITE_`, place it in a frontend environment, add it to an `.env` file committed to the repository, paste it into tickets or chat, or log it.

The existing `ONIQ_RESEARCH_GITHUB_TOKEN` is independent and remains limited to GitHub repository access. Do not reuse either credential for the other service.

## Provisioning

1. A ChatGPT workspace administrator enables Workspace agents and permits personal access-token creation under **Admin > Permissions & roles**.
2. In **Admin > Access tokens**, create a token with the **Workspace Agents** scope.
3. Move the token directly into the approved secrets manager. Do not keep an extra plaintext copy.
4. Provision the secret named `ONIQ_WORKSPACE_AGENT_ACCESS_TOKEN` into the intended Supabase environment using the organization's normal secret-management path.
5. Apply migration `20260915134000_agi_research_agent_trigger.sql` and deploy the `agi-research` edge function through the reviewed release process.
6. As an administrator in a non-production environment, verify that the capability is available, stage one harmless input, confirm it exactly once, and check that the returned conversation opens. Confirm that a second submission of the same request is rejected.
7. Review edge-function logs for status and request identifiers only. The token and user input must not be logged.

No repository default, migration, or client bundle contains a token. When the secret is absent, both staging and confirmation return `503` and no call is made to ChatGPT.

## Rotation

1. Create a replacement token with the same Workspace Agents scope and store it in the approved secrets manager.
2. Replace `ONIQ_WORKSPACE_AGENT_ACCESS_TOKEN` in the target Supabase environment. Do not remove the old token first.
3. Run the non-production smoke test with a newly staged request. Never reuse a failed or previously confirmed request.
4. After the replacement is verified, revoke the old token in **Admin > Access tokens**.
5. Record the rotation date, operator, environment, and verification request ID in the private operations log. Do not record either token value.

If verification fails, leave the channel disabled by removing the server secret or restore the prior still-valid secret through the approved secret-management path. A rejected or ambiguous confirmed trigger is marked failed and is not retried automatically.

## Incident Response

- Missing or revoked token: the channel fails closed; provision a valid replacement and create a new staged request.
- `401` or `403` upstream: verify expiry, revocation, Workspace Agents scope, workspace membership, and channel permission.
- `404` or `409` upstream: verify the published channel is visible and runnable in the token's workspace.
- Timeout or malformed upstream response: treat the outcome as ambiguous. Follow the returned/request audit record and ChatGPT workspace history; do not replay the consumed request.
- Suspected exposure: revoke the token immediately, remove the Supabase secret, investigate logs and repository history, then provision a replacement only after the exposure path is closed.

## Safety Properties

Every action revalidates the caller's Supabase JWT and current `is_admin` status. Agent input is limited to 6,000 characters. Staging expires after five minutes. Confirmation must exactly match `RUN RESEARCH AGENT`. The database atomically changes the request from `pending` to `executing` before the remote call. The request UUID is also sent as the upstream `Idempotency-Key`. Failed calls are not automatically retried.
