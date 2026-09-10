/**
 * AN EDGE FUNCTION THAT USES A HELPER IT NEVER IMPORTED.
 *
 * MEASURED 2026-09-04, and it was shipped. `voice-generate` called
 * `joinedText(res.data)` in its transcribe path and never imported it, so
 * Voice Input and Translate would have thrown "ReferenceError: joinedText is
 * not defined" on every single use — after the spend guard had already
 * admitted the charge.
 *
 * WHY NOTHING CAUGHT IT. `tsconfig.json` includes only `src/**`, so `tsc`
 * never type-checks `supabase/functions/**` at all; those files reach it only
 * when a test imports one, and no test imports an edge function's entrypoint —
 * they cannot, because the entrypoints call `Deno.serve` at module scope.
 * ESLint does not resolve modules. The suite was 4,000 tests green with a
 * dead feature in it.
 *
 * `deno check` finds this, and finding it is what produced this file. It
 * cannot run in CI here — the runtime downloads every remote import and this
 * container's proxy blocks the registries — so the property is asserted over
 * SOURCE instead, which needs no network and fails the moment the mistake is
 * written rather than the first time somebody taps the button.
 *
 * THE CHECK. Every name a `_shared` module exports is a name an edge function
 * may only use if it imported it. That is narrow on purpose: it is exactly the
 * shape of the bug, it has no false positives worth suppressing, and a wider
 * "resolve every identifier" check would be a type-checker written badly.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FUNCTIONS = join(ROOT, "supabase", "functions");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Source with comments, strings and regex literals blanked — code only. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

const ALL = walk(FUNCTIONS);
const SHARED = ALL.filter((f) => f.includes(`${join("functions", "_shared")}`));
const rel = (p: string) => p.slice(ROOT.length + 1);

/** Every value name the `_shared` modules export, mapped to its file. */
const EXPORTS = new Map<string, string>();
for (const f of SHARED) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    EXPORTS.set(m[1], rel(f));
  }
  // `export { a, b }` re-export lists.
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) EXPORTS.set(name, rel(f));
    }
  }
}

describe("the shared exports are discoverable at all", () => {
  it("finds a realistic number of them, so a broken regex cannot pass vacuously", () => {
    expect(EXPORTS.size).toBeGreaterThan(100);
    // A few by name, so a rename that silently empties the map is visible.
    for (const n of ["joinedText", "googleGenerateContent", "withProviderSpendGuard"]) {
      expect(EXPORTS.has(n), n).toBe(true);
    }
  });
});

/**
 * A class-method DECLARATION at the head of a line, through any modifier and
 * any return type, ending in a body rather than a semicolon.
 */
const METHOD =
  /^[ \t]*(?:(?:public|private|protected|static|abstract|override|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{;=]+)?\{/gm;

describe("no edge function calls a shared helper it did not import", () => {
  it("imports every _shared name it uses", () => {
    const offenders: string[] = [];
    for (const f of ALL) {
      const raw = readFileSync(f, "utf8");
      const src = code(raw);

      // What this file brings in or defines itself. Import specifiers are
      // read from the RAW source because `code()` blanks the quoted paths.
      const known = new Set<string>();
      for (const m of raw.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
        // Comments are stripped FIRST. A multi-line import list may carry a
        // `//` note above one of its entries (story-still does), and splitting
        // the raw text on commas then hands back the comment glued to the
        // name — which reads as "not imported" and is how this very check
        // produced its first false positive.
        const list = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        for (const part of list.split(",")) {
          // `a as b` binds b; a plain entry binds itself. Either way it is the
          // last word, and a leading `type` is not a binding of its own.
          const words = part.match(/[A-Za-z_$][\w$]*/g);
          const name = words?.[words.length - 1];
          if (name && name !== "type") known.add(name);
        }
      }
      for (const m of raw.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from/g)) {
        known.add(m[1]);
      }
      // Anything declared, assigned or bound locally — including a shared name
      // this very file is the definition of.
      for (const m of src.matchAll(
        /(?:^|\s)(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
      )) {
        known.add(m[1]);
      }
      // AND A CLASS METHOD IS A LOCAL BINDING TOO, which this scan missed
      // because a method declaration carries no `function` keyword.
      //
      // Found when the OQCA kernel's `_shared/oqca/quantum/math/state.ts`
      // began exporting `probabilities` and `formalState.ts` — whose
      // CognitiveState class has had a `probabilities()` method since v1.1 —
      // was reported as calling a helper it never imported. It calls its own
      // method; the two names collide and neither is wrong.
      //
      // `METHOD` is the DECLARATION shape and not a call: the closing paren is
      // followed by a body (optionally through a return type), where a bare
      // call statement ends in `;`. Both directions are asserted below.
      for (const m of src.matchAll(METHOD)) known.add(m[1]);

      for (const [name, from] of EXPORTS) {
        if (known.has(name)) continue;
        // A CALL or a bare reference, not a property access (`x.joinedText`)
        // and not a key (`{ joinedText: ... }`).
        const used = new RegExp(`(^|[^.\\w$])${name}\\s*\\(`, "m").test(src);
        if (used) offenders.push(`${rel(f)} uses ${name}() but never imports it (${from})`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("counts a class method as a local binding, and still catches a real call", () => {
    // BOTH DIRECTIONS TOGETHER — a narrowing asserted only on what it now
    // permits is a weaker guard with a comment on it.
    const method = (src: string) => [...src.matchAll(new RegExp(METHOD))].map((m) => m[1]);
    // What it must now admit: the real shape from `formalState.ts`.
    expect(method("  probabilities(): number[] {\n    return [];\n  }")).toContain("probabilities");
    expect(method("  async load(x: string): Promise<void> {")).toContain("load");
    expect(method("  static of(a: number, b: number): Thing {")).toContain("of");
    expect(method("  get basis(): readonly string[] {")).toContain("basis");
    // What it must NOT admit: a bare CALL, which is the thing being guarded.
    expect(method("  probabilities(state);")).toEqual([]);
    expect(method("  const p = probabilities(state);")).toEqual([]);
    // And the guard as a whole still catches an unimported use.
    const src = "export function f() {\n  return joinedText(x);\n}";
    const known = new Set([...src.matchAll(new RegExp(METHOD))].map((m) => m[1]));
    expect(known.has("joinedText")).toBe(false);
    expect(new RegExp(`(^|[^.\\w$])joinedText\\s*\\(`, "m").test(src)).toBe(true);
  });
});
