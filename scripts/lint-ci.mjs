#!/usr/bin/env node
/**
 * `npm run lint:ci` — the single blocking lint gate.
 *
 * Referenced identically by CI (.github/workflows/lint.yml), the pre-commit
 * hook (.husky/pre-commit via lint-staged) and the Claude Code PostToolUse
 * hook (.claude/settings.json). One target, one config, one exit code.
 *
 *   npm run lint:ci                 # whole gate over src/ — what CI runs
 *   npm run lint:ci -- <paths...>   # just those files — what the hooks run
 *
 * The default target matters: bare `eslint --max-warnings 0` with no path
 * lints the whole working directory, which is not the gate anyone means.
 *
 * Cost, measured on this repo (255 files in src):
 *   this gate, one file ....................  2.0s   <- what the hooks run
 *   this gate, all of src .................. 44.1s   <- what CI runs
 *   full eslint.config.js, all of src ...... 36.7s
 * set-state-in-render runs the React Compiler, which is why the reduced gate
 * is not the faster one. Speed comes from scope: pass explicit paths in hooks
 * rather than re-running the whole gate on every save.
 */
import { spawnSync } from "node:child_process";

const passed = process.argv.slice(2);
const targets = passed.length ? passed : ["src"];

const result = spawnSync(
  "npx",
  [
    "eslint",
    "--config",
    "eslint.ci.config.mjs",
    // The blocking gate has its own frozen baseline, separate from the one
    // belonging to the full config: the two enable different rule sets, so a
    // shared file would always carry entries the other considers stale.
    // Ratchet it down with:
    //   npx eslint --config eslint.ci.config.mjs \
    //     --suppressions-location eslint-suppressions.ci.json \
    //     --prune-suppressions src
    "--suppressions-location",
    "eslint-suppressions.ci.json",
    // Meaningful here precisely because this config enables no warn-level
    // rule at all. The full config carries ~512 deliberate warnings and must
    // never be run this way.
    "--max-warnings",
    "0",
    // Without this, passing an explicitly-ignored path emits "File ignored
    // because of a matching ignore pattern" as a WARNING, which --max-warnings 0
    // then turns into a failure. lint-staged hands us whatever is staged, so
    // any commit touching src/routeTree.gen.ts (i.e. every route change) was
    // blocked by its own gate. Ignoring a file is the intended outcome, not a
    // problem to report.
    "--no-warn-ignored",
    ...targets,
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
