#!/usr/bin/env node
/**
 * `npm run check:deps` — every declared dependency must resolve to a real
 * package, installed from the public npm registry, whose own package.json
 * agrees about its name.
 *
 * No lint rule catches a hallucinated or typosquatted package name: a
 * plausible-but-fake dependency ("react-router-dom-v6", "@supabase/supabase")
 * is valid JSON, valid TypeScript once installed, and a supply-chain problem.
 * This codebase is written almost entirely by agents, which is exactly the
 * condition under which invented package names show up.
 *
 * Checks, per dependency:
 *   1. it resolves under node_modules (a name nobody publishes cannot)
 *   2. package-lock.json records it as coming from registry.npmjs.org
 *   3. the installed package.json's own `name` matches what we declared
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort();

const problems = [];
let ok = 0;

for (const name of declared) {
  let installed;
  try {
    installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"));
  } catch {
    problems.push(`${name}: does not resolve in node_modules — unpublished or misspelled?`);
    continue;
  }
  if (installed.name !== name) {
    problems.push(`${name}: installed package calls itself "${installed.name}"`);
    continue;
  }
  const entry = lock.packages?.[`node_modules/${name}`];
  if (!entry?.resolved) {
    problems.push(`${name}: package-lock.json records no resolved URL`);
    continue;
  }
  if (!/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved)) {
    problems.push(
      `${name}: resolved from ${entry.resolved}, not the public npm registry\n` +
        `      Lovable's build sandbox installs through its own Artifact Registry mirror, so a\n` +
        `      dependency bump made there rewrites this URL. Do NOT relax this check: confirm the\n` +
        `      package is public and that its hash is unchanged, then repoint the URL.\n` +
        `        npm view ${name}@${entry.version} dist.integrity   # must equal the lockfile integrity\n` +
        `        then set "resolved" to https://registry.npmjs.org/... and run a clean npm ci\n` +
        `      A clean npm ci verifies the tarball against the recorded hash, which is the proof\n` +
        `      that the mirror was serving the same bytes. If the hashes differ, stop — that is\n` +
        `      the supply-chain case this check exists for.`,
    );
    continue;
  }
  ok += 1;
}

console.log(`check:deps — ${ok}/${declared.length} dependencies verified`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ✖ ${p}`);
  process.exit(1);
}
