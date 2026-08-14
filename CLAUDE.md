# ONIQ — working agreements

## Business decisions are the owner's — ask first

Owner directive, 2026-08-14. Recorded after the Story pipeline was routed
onto the metered Google AI key by an agent's engineering call (2026-08-09,
`4bb498e`) without the owner being asked — a provider-and-payment choice
presented as a code comment instead of a question.

**Before acting, ASK the owner about anything that:**

- chooses or changes a paid provider, API, or model tier, or which
  account's money a feature spends (Google key vs Lovable credits vs
  anything else);
- sets or changes prices, margins, caps, quotas, or what is on sale;
- spends real money beyond what an existing, owner-approved path already
  spends in the normal course of running;
- changes a user-visible policy (watermarks, refunds, content rules,
  payout terms).

Engineering inside decisions already made — how to implement, test,
harden, or fix what the owner has approved — stays delegated and does not
need a question. When unsure which side of the line something is on, it is
a business decision: ask. An owner decision, once given, is recorded next
to the code it governs as "owner directive" with the date, the way the
2026-08-13 movie-on/classic-off flip is.

## Linting

A task is not complete until `npm run lint:ci` passes. Never use
`git commit --no-verify`.

- `npm run lint:ci` — the blocking gate. Same command in CI, the pre-commit
  hook, and the PostToolUse hook. `npm run lint:ci -- <paths>` for one file
  (~2s, vs ~44s for all of `src`).
- `npm run lint` — the full advisory run. Carries ~512 deliberate warnings.
  Never run it with `--max-warnings 0`.
- `npm run format:check` / `npm run format` — formatting. ESLint does not
  report formatting; Prettier owns it.

Machine-readable output: `npx eslint --config eslint.ci.config.mjs --format json <paths>`.

**`react-hooks/rules-of-hooks` is a release blocker.** On 2026-08-04 three
violations of it reached production. `tsc` was clean, 275 tests were green, and
a signed-in walk of the live app found nothing — the app threw to the root
error boundary only once a personalisation suggestion appeared. Placing a hook
after an early `return` is a documented, systematic failure mode for
LLM-written components, and this codebase is written almost entirely by agents.
Every hook goes above every early return, always.

Never run a repo-wide `eslint --fix` and commit it. It would touch nearly every
file and make future diffs unreviewable, which is the primary quality control
here.

The pre-existing violation tail is frozen in `eslint-suppressions.json` and
`eslint-suppressions.ci.json`. Only new violations fail. Ratchet it down with
`--prune-suppressions`; never add to it to make a new violation go away.
