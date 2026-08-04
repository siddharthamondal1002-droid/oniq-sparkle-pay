#!/usr/bin/env node
/**
 * `npm run format:check:changed` — Prettier, but only on files this branch
 * actually touched.
 *
 * Why not plain `prettier --check .`: 199 files in this repo predate Prettier
 * being enforced. Formatting them all would mean one commit rewriting nearly
 * every file, destroying `git blame` and making future agent diffs
 * unreviewable — the same reason a repo-wide `eslint --fix` is banned here.
 *
 * So formatting ratchets, exactly like eslint-suppressions.json: the
 * pre-existing tail is left alone, and anything you change has to be
 * formatted. The pre-commit hook already runs `prettier --write` on staged
 * files, so in practice this only catches commits that bypassed it.
 *
 *   npm run format:check:changed              # vs origin/main
 *   BASE_REF=origin/dev npm run format:check:changed
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|css|md)$/;

function git(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const base = process.env.BASE_REF || "origin/main";
// merge-base keeps us honest: we compare against where this branch diverged,
// not against whatever main has moved on to since.
const mergeBase = git(["merge-base", "HEAD", base]);
if (!mergeBase) {
  console.log(`format:check:changed — no merge-base with ${base}; nothing to check.`);
  process.exit(0);
}

const changed = (git(["diff", "--name-only", "--diff-filter=ACMR", mergeBase, "HEAD"]) ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter((f) => f && EXT.test(f) && existsSync(f));

if (changed.length === 0) {
  console.log("format:check:changed — no formattable files changed.");
  process.exit(0);
}

console.log(`format:check:changed — ${changed.length} changed file(s) vs ${base}`);
const r = spawnSync("npx", ["prettier", "--check", ...changed], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
