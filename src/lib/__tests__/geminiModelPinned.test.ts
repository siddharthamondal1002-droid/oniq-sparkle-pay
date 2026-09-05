/**
 * NO EDGE FUNCTION MAY CALL GEMINI WITHOUT NAMING THE MODEL.
 *
 * `callGemini` has a default — `GEMINI_FALLBACK_MODEL` in `_shared/llm.ts` —
 * and a default is not a decision. The September 2026 bill is what that costs:
 *
 *   Generate content output token count gemini 3.6 flash text   399,078   ₹142.99
 *
 * 41.3% of a ₹346.21 month, on a model NO caller names, reached only because
 * two call sites did not say which model they wanted. Meanwhile the tier those
 * callers thought they were choosing billed zero tokens all month, because a
 * tier is a `callText` concept that `callGemini` never sees.
 *
 * That is why this guard checks the CALL SITE rather than the default. Changing
 * `GEMINI_FALLBACK_MODEL` would not have prevented it — the next caller to
 * forget would simply land somewhere else nobody chose. Owner directives
 * 2026-09-05: "cap story-plot and switch it to flash-lite", then "fix it" for
 * the last unpinned caller.
 *
 * Source-level, in the house style: what this protects is "somebody added a
 * call site and forgot", which is a textual property, and the real paths need
 * two provider keys and money.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase/functions");

/** Comments describe code; they are not code. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Every .ts under supabase/functions, including _shared. */
function sources(): Array<{ rel: string; raw: string; code: string }> {
  const out: Array<{ rel: string; raw: string; code: string }> = [];
  const walk = (dir: string, prefix: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, d.name);
      const rel = prefix ? `${prefix}/${d.name}` : d.name;
      if (d.isDirectory()) walk(full, rel);
      else if (d.name.endsWith(".ts")) {
        const raw = readFileSync(full, "utf8");
        out.push({ rel, raw, code: codeOnly(raw) });
      }
    }
  };
  walk(FN_DIR, "");
  return out;
}

/**
 * The argument text of each `callGemini(` in `code`, by balanced parens.
 *
 * A regex cannot do this: every real call here spans several lines and nests
 * its own parens and braces, and `[^)]*` stops at the first inner one. The
 * scanner is the difference between reading the whole argument and reading its
 * first line.
 */
function callGeminiArgs(code: string): string[] {
  const out: string[] = [];
  const re = /\bcallGemini\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    out.push(code.slice(start, i - 1));
  }
  return out;
}

const FILES = sources();
/** llm.ts DEFINES callGemini; its own body is not a call site. */
const CALLERS = FILES.filter((f) => f.rel !== "_shared/llm.ts");

describe("the stripper first", () => {
  // The lesson the study suite paid for: codeOnly assumes block comments
  // balance, and a stray inside a string or regex literal makes it swallow the
  // lines under test. Prove the stripped sources still hold the call sites.
  it("does not swallow the code it is asked about", () => {
    for (const f of CALLERS) {
      if (!/\bcallGemini\s*\(/.test(f.raw)) continue;
      expect(f.code, f.rel).toMatch(/\bcallGemini\s*\(/);
      expect(f.code.length, f.rel).toBeGreaterThan(f.raw.length * 0.4);
    }
  });

  it("finds the call sites it is meant to police", () => {
    const withCalls = CALLERS.filter((f) => callGeminiArgs(f.code).length > 0).map((f) => f.rel);
    // Not frozen — a new caller is welcome, it just has to name a model. This
    // asserts the scanner is looking at something, so a silent zero-match
    // (a rename, a moved directory) cannot pass as "all clear".
    expect(withCalls.length).toBeGreaterThanOrEqual(3);
    expect(withCalls).toContain("story-plot/index.ts");
    expect(withCalls).toContain("translate-message/index.ts");
    expect(withCalls).toContain("ting/index.ts");
  });
});

describe("every callGemini names its model", () => {
  it("no call site relies on GEMINI_FALLBACK_MODEL", () => {
    const unpinned: string[] = [];
    for (const f of CALLERS) {
      for (const args of callGeminiArgs(f.code)) {
        if (!/\bgeminiModel\s*:/.test(args)) unpinned.push(`${f.rel}: callGemini(${args.trim()})`);
      }
    }
    expect(unpinned, "unpinned callGemini call sites").toEqual([]);
  });

  it("names a registry constant, never a hand-typed id", () => {
    // A literal drifts from the registry the day the registry moves, and the
    // registry is where the POST-verification lives.
    const literals: string[] = [];
    for (const f of CALLERS) {
      for (const args of callGeminiArgs(f.code)) {
        const m = args.match(/\bgeminiModel\s*:\s*(["'`])/);
        if (m) literals.push(`${f.rel}: geminiModel: ${m[1]}…`);
      }
    }
    expect(literals, "hand-typed model ids").toEqual([]);
  });
});

describe("the fallback default still exists, and is still nobody's choice", () => {
  it("is defined but unreferenced outside llm.ts", () => {
    const llm = FILES.find((f) => f.rel === "_shared/llm.ts");
    expect(llm).toBeDefined();
    // It stays as callGemini's internal default — deleting it would turn a
    // forgotten model into a crash rather than an expensive success, which is
    // a different change and not this one.
    expect(llm!.code).toMatch(/const GEMINI_FALLBACK_MODEL\s*=/);
    const elsewhere = CALLERS.filter((f) => /\bGEMINI_FALLBACK_MODEL\b/.test(f.code)).map(
      (f) => f.rel,
    );
    expect(elsewhere, "callers naming the fallback directly").toEqual([]);
  });
});
