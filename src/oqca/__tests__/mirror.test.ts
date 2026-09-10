/**
 * THE EDGE MIRROR — brief section 1 item 5, and section 3.
 *
 * The loop now runs inside a Deno edge function, and Deno cannot import from
 * `src/`. So its dependency closure exists twice, exactly as `src/health/` and
 * `_shared/health/` already do, and for the same reason story-sweep's header
 * gives: "edge functions bundle from supabase/functions and reaching into src/
 * makes the deploy fragile".
 *
 * TWO COPIES DRIFT THE FIRST TIME ONE IS EDITED ALONE. This is the assertion
 * that turns "should be the same" into a red build, and the fix when it fails
 * is `node scripts/oqca-mirror.mjs` — never a hand-merge.
 *
 * THE CLOSURE IS COMPUTED, NOT LISTED, and that is the half worth keeping. A
 * hand-written file list is a list someone forgets to extend; this repo has the
 * receipt in the audit trigger that named five columns and missed the sixth.
 * Add an import to the loop and the mirror grows on the next run of the script,
 * and fails here until it does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { closure, ENTRY } from "../../../scripts/oqca-mirror.mjs";

const SRC = "src/oqca";
const DST = "supabase/functions/_shared/oqca";
const RUNTIME = "supabase/functions/_shared/oqcaRuntime";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const CLOSURE = [...closure()].map((f) => relative(process.cwd(), f)).sort();

describe("the OQCA edge mirror", () => {
  it("covers exactly the loop's import closure — no more, no less", () => {
    const mirrored = walk(DST)
      .map((f) => f.replace(`${DST}/`, ""))
      .sort();
    const wanted = CLOSURE.map((f) => f.replace(`${SRC}/`, "")).sort();
    expect(mirrored).toEqual(wanted);
  });

  it.each(CLOSURE)("%s is byte-identical on both sides", (file) => {
    const src = readFileSync(file, "utf8");
    const dst = readFileSync(file.replace(`${SRC}/`, `${DST}/`), "utf8");
    // `toBe` and not a diff helper: the fix is a copy, so the only useful
    // failure message is "these are not the same file".
    expect(dst).toBe(src);
  });

  it("every mirrored relative import carries a .ts extension", () => {
    // DENO REQUIRES IT AT RUNTIME AND `tsc` PERMITS IT VIA
    // `allowImportingTsExtensions`, which is what makes a byte-identical mirror
    // possible at all. Without the extension the mirror typechecks locally
    // under --unstable-sloppy-imports and fails on the deployed function, which
    // is the worst place to find it.
    for (const file of walk(DST)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/from\s+"(\.[^"]*)"/g)) {
        expect(m[1], `${file} imports ${m[1]}`).toMatch(/\.ts$/);
      }
    }
  });

  it("the entry point is the loop, so nothing unused is mirrored", () => {
    expect(ENTRY).toBe("src/oqca/loop/cognitiveLoop.ts");
    // The benchmark, the backends and megaLoop are NOT in the closure. They are
    // research code that will never run in Deno, and mirroring them would put
    // them inside the edge deploy bundle where every edge guard applies to
    // them for no benefit.
    const names = CLOSURE.join("\n");
    expect(names).not.toMatch(/\/bench\//);
    expect(names).not.toMatch(/\/backends\//);
    expect(names).not.toMatch(/megaLoop/);
  });

  it("the kernel and the runtime adapters are separate directories", () => {
    // THE PATH IS THE BOUNDARY. `_shared/oqca/**` is walked by the security
    // guard and may hold no fetch, credential or clock; `_shared/oqcaRuntime/**`
    // holds all three and is deliberately not walked. If a runtime file ever
    // landed inside the kernel directory the guard would go red — and if the
    // kernel directory ever swallowed the runtime one, this goes red first.
    for (const f of walk(DST)) expect(f.startsWith(`${DST}/`)).toBe(true);
    for (const f of walk(RUNTIME)) expect(f.startsWith(`${RUNTIME}/`)).toBe(true);
    expect(RUNTIME.startsWith(`${DST}/`)).toBe(false);
  });

  it("no mirrored file imports out of the mirrored tree", () => {
    // A relative import that climbs above `_shared/oqca/` would reach the
    // runtime adapters or the rest of `_shared` — either of which puts a fetch
    // one hop from the kernel. The closure computation would not catch it,
    // because it walks the SOURCE tree where the same path means something
    // else.
    for (const file of walk(DST)) {
      const depth = file.replace(`${DST}/`, "").split("/").length - 1;
      for (const m of readFileSync(file, "utf8").matchAll(/from\s+"(\.[^"]*)"/g)) {
        const up = (m[1].match(/\.\.\//g) ?? []).length;
        expect(up, `${file} imports ${m[1]}`).toBeLessThanOrEqual(depth);
      }
    }
  });
});
