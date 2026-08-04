<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Linting (same policy as CLAUDE.md — keep the two in sync)

A task is not complete until `npm run lint:ci` passes. Never use
`git commit --no-verify`.

- `npm run lint:ci` — the blocking gate. Identical in CI, the pre-commit hook,
  and the Claude Code PostToolUse hook. `npm run lint:ci -- <paths>` for one
  file (~2s, vs ~44s for all of `src`).
- `npm run lint` — advisory only; carries ~512 deliberate warnings, so never
  run it with `--max-warnings 0`.
- Formatting is Prettier's, not ESLint's: `npm run format:check`.

**`react-hooks/rules-of-hooks` is a release blocker.** On 2026-08-04 three
violations reached production while `tsc` was clean and 275 tests were green.
Every hook goes above every early return, always.

Never run a repo-wide `eslint --fix` and commit it. The pre-existing tail is
frozen in `eslint-suppressions*.json`; only new violations fail.
