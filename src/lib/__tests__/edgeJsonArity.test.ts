/**
 * EVERY EDGE FUNCTION CALLS ITS OWN `json` IN ITS OWN ORDER.
 *
 * WHY THIS IS A TEST AND NOT A TYPE. tsconfig.json includes only `src/**`, so
 * NOTHING under supabase/functions is typechecked — not by `tsc`, not in CI.
 * A `json` called with its arguments swapped compiles nowhere and fails
 * nowhere; it throws at RUNTIME, because `new Response(body, { status: {…} })`
 * raises RangeError on a non-numeric status. Every path in that function 500s
 * and the first to find out is whoever invoked it.
 *
 * Caught exactly that way on 2026-09-05 while writing firebase-provisioning:
 * all five calls were reversed. A deploy and a round trip to production would
 * have been spent discovering it.
 *
 * AND THERE ARE TWO CONVENTIONS IN THIS TREE, which is the trap. The shared
 * helper in `_shared/llm.ts` is `json(status, body)` — STATUS FIRST. But many
 * functions declare a local `const json = (body, status = 200)` — BODY FIRST,
 * the exact opposite, and correct for themselves. The first version of this
 * test assumed the shared order everywhere and "failed" twenty files that were
 * all perfectly right. So the invariant is not one order: it is that a file
 * agrees with the `json` it actually has.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FUNCTIONS = join(ROOT, "supabase/functions");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Strip comments, so prose about `json(...)` is not read as a call. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

type Convention = "status-first" | "body-first" | "none";

/** Which `json` does this file actually have? */
function conventionOf(code: string): Convention {
  // A local declaration wins: it shadows any import.
  const local =
    code.match(/(?:const|let)\s+json\s*=\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)/) ??
    code.match(/function\s+json\s*\(\s*([A-Za-z_$][\w$]*)/);
  if (local) return local[1] === "status" ? "status-first" : "body-first";
  if (/import\s*\{[^}]*\bjson\b[^}]*\}\s*from\s*["'][^"']*llm\.ts["']/.test(code)) {
    return "status-first";
  }
  return "none";
}

const FILES = sources(FUNCTIONS)
  .map((f) => ({ label: f.slice(ROOT.length + 1), code: codeOnly(readFileSync(f, "utf8")) }))
  .map((f) => ({ ...f, convention: conventionOf(f.code) }))
  .filter((f) => f.convention !== "none" && /\bjson\(/.test(f.code));

describe("edge functions call json() the way their own json is declared", () => {
  it("finds both conventions in the tree, so neither branch is dead", () => {
    expect(FILES.length).toBeGreaterThan(20);
    const kinds = new Set(FILES.map((f) => f.convention));
    expect(kinds).toContain("status-first");
    expect(kinds).toContain("body-first");
  });

  it("pins the shared helper's own signature", () => {
    // If _shared/llm.ts ever flips, every "status-first" verdict above is
    // checking the wrong thing.
    const llm = readFileSync(join(FUNCTIONS, "_shared/llm.ts"), "utf8");
    expect(llm).toMatch(/export function json\(status: number, body: unknown\)/);
  });

  it.each(FILES.map((f) => [`${f.label} [${f.convention}]`, f] as const))("%s", (label, f) => {
    const bad: string[] = [];
    for (const m of f.code.matchAll(/\bjson\(\s*([[{]|\d)/g)) {
      const first = m[1];
      const looksLikeBody = first === "{" || first === "[";
      const wrong =
        f.convention === "status-first" ? looksLikeBody : /\d/.test(first) && !looksLikeBody;
      if (!wrong) continue;
      const line = f.code.slice(0, m.index).split("\n").length;
      bad.push(`line ${line}: json(${first}… but this file's json is ${f.convention}`);
    }
    expect(bad, `${label}\n${bad.join("\n")}`).toEqual([]);
  });
});
