#!/usr/bin/env node
/**
 * MIRROR THE OQCA LOOP CLOSURE INTO THE EDGE TREE.
 *
 * Deno cannot import from `src/`, and an edge function bundles only from
 * `supabase/functions/` — story-sweep's header records what reaching into
 * `src/` costs. So the loop's dependency closure exists twice, exactly as
 * `src/health/` and `_shared/health/` already do.
 *
 * TWO COPIES DRIFT THE FIRST TIME ONE IS EDITED ALONE, which is why this is a
 * script and not a habit: `--check` is what `oqcaMirror.test.ts` asserts, and
 * the fix when it fails is to run this without `--check`. Never hand-merge.
 *
 * THE CLOSURE IS COMPUTED, NOT LISTED. A hand-written file list is a list
 * someone forgets to extend — the same failure as the audit trigger that named
 * five columns and missed the sixth (CLAUDE.md, 2026-09-08). Add an import to
 * the loop and the mirror grows on the next run.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
export const ENTRY = "src/oqca/loop/cognitiveLoop.ts";
const SRC_ROOT = join(ROOT, "src", "oqca");
const DST_ROOT = join(ROOT, "supabase", "functions", "_shared", "oqca");

/** Every file the entry point reaches, transitively, by relative import. */
export function closure(entry = join(ROOT, ENTRY), seen = new Set()) {
  const f = resolve(entry);
  if (seen.has(f)) return seen;
  seen.add(f);
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const p = resolve(dirname(f), m[1]);
    if (existsSync(p)) closure(p, seen);
    else throw new Error(`${relative(ROOT, f)} imports ${m[1]}, which does not exist`);
  }
  return seen;
}

function listMirrored(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listMirrored(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * SIDE EFFECTS ONLY WHEN RUN DIRECTLY, AND A MUTATION IS WHAT FOUND THIS.
 *
 * `mirror.test.ts` imports `closure` from this file so the test checks what the
 * script actually mirrors rather than reimplementing it. But an ES module runs
 * its whole body on import — so importing it RE-RAN the mirror and copied every
 * drifted file back into place BEFORE a single assertion executed. The test
 * repaired the thing it was checking, and passed on a genuinely broken mirror.
 *
 * Nothing green ever said so. The mutation run did: M22 deliberately drifts the
 * mirror and reported ESCAPED, which is the only reason this is a guard rather
 * than a comment. A check that has never failed has never been tested.
 */
function main() {
  const check = process.argv.includes("--check");

  const files = [...closure()].sort();
  const want = new Map();
  for (const f of files) {
    const rel = relative(SRC_ROOT, f);
    if (rel.startsWith("..")) throw new Error(`closure escaped src/oqca: ${relative(ROOT, f)}`);
    want.set(join(DST_ROOT, rel), readFileSync(f, "utf8"));
  }

  const problems = [];
  for (const [dst, body] of want) {
    const cur = existsSync(dst) ? readFileSync(dst, "utf8") : null;
    if (cur === body) continue;
    problems.push(`${cur === null ? "missing" : "differs"}: ${relative(ROOT, dst)}`);
    if (!check) {
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, body);
    }
  }
  for (const stale of listMirrored(DST_ROOT)) {
    if (want.has(stale)) continue;
    problems.push(`stale: ${relative(ROOT, stale)}`);
    if (!check) rmSync(stale);
  }

  if (check) {
    if (problems.length) {
      console.error("oqca mirror is out of date:\n  " + problems.join("\n  "));
      console.error("\nfix: node scripts/oqca-mirror.mjs");
      process.exit(1);
    }
    console.log(`oqca mirror clean — ${want.size} files`);
  } else {
    console.log(
      problems.length
        ? `oqca mirror updated:\n  ${problems.join("\n  ")}`
        : `oqca mirror already clean — ${want.size} files`,
    );
  }
}

// `process.argv[1]` is the script node was told to run. Absent under a test
// runner, and different from this file's URL when this module is imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
