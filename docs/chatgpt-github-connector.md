# ChatGPT GitHub connector setup

This repository does **not** contain an in-repo "app connector" to turn on.
ChatGPT repo access is granted by installing/configuring ChatGPT's GitHub app or connector from the GitHub/OpenAI side.

## Recommended mode

Use **branch + pull request** mode.

- Allow ChatGPT to read repository metadata and contents.
- Allow ChatGPT to write only through branches and pull requests.
- Do **not** grant direct push access to `main` unless you intentionally want that level of control.

## Minimum permissions

### Read-only

- Repository metadata: read
- Repository contents: read

### PR authoring

- Repository metadata: read
- Repository contents: write
- Pull requests: write
- Issues: write only if you want ChatGPT to open or update issues as part of its workflow

## Repo-specific operating rules

Connector-driven agents should follow the same repo rules already enforced here.

- Keep changes small and scoped.
- Use feature branches and pull requests.
- Keep `main` protected.
- Run `npm run lint:ci` before considering work complete.
- Do not rewrite published git history.
- Do not change deployment, provider, or billing behavior without explicit owner approval.

## Verification checklist

After the connector is installed:

1. Ask ChatGPT to read `/home/runner/work/oniq-sparkle-pay/oniq-sparkle-pay/AGENTS.md`.
2. Ask it to identify one harmless documentation-only change.
3. Have it make the change on a branch.
4. Have it open a pull request instead of pushing to `main`.
5. Confirm the PR stays within the granted permissions.

## Optional future extension

If you want ChatGPT to do things _inside_ ONIQ instead of just editing the repo, add a narrow server-side action for a specific task rather than giving broad write authority.
Examples: a single admin-safe status action, a single report-generation action, or a single read-only diagnostic action.
