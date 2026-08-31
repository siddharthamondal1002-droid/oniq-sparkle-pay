/**
 * AN EDGE FUNCTION MAY NOT IMPORT ITS WAY OUT OF supabase/functions/.
 *
 * MEASURED 2026-08-31, against production `bqwttemnnoexadpwifcj`. PR #121 added
 * `import { ACTOR_ASSETS } from "../../../src/data/storyActorAssets.ts"` to
 * `_shared/characterRef.ts` and to `story-reference-publish/index.ts`. It was
 * clean through every gate this repo has — tsc, lint:ci, 3486 unit tests, a
 * 34-check build proof — because vitest and Vite resolve from the repo root and
 * the file was really there. The Supabase deploy bundler uploads ONLY the
 * supabase/functions tree, so at deploy time the specifier resolved to nothing:
 *
 *   story-still              failed to bundle: Module not found ".../src/data/storyActorAssets.ts"
 *   story-reference-publish  failed to bundle: Module not found ".../src/data/storyActorAssets.ts"
 *   story-motion             deployed
 *   story-plot               deployed
 *
 * The two that deployed are exactly the two that do not reach that module. The
 * damage was not a loud failure: `story-still` already existed, so the failed
 * deploy left the PREVIOUS build serving, and the endpoint answered 401 exactly
 * as a healthy one does. Only `story-reference-publish`, which had never been
 * deployed before, showed the fault plainly by returning 404.
 *
 * That is the shape of the bug worth guarding: a green pipeline, a live-looking
 * endpoint, and silently stale code. So the rule is asserted here over SOURCE,
 * where it fails the moment it is written rather than at the next deploy.
 *
 * The check resolves each specifier rather than pattern-matching `../../../`,
 * because the escape depends on how deep the importing file sits — `../../x`
 * leaves the tree from `_shared/` and stays inside it from `a/b/c/`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FUNCTIONS = join(ROOT, "supabase", "functions");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (entry.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Source with comments removed. The moved module's own header quotes the
 * `Module not found ".../src/data/storyActorAssets.ts"` error that motivated
 * this rule; a scanner that reads comments would accuse the file explaining the
 * prohibition. Strip the prose, never delete it.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every relative specifier — `npm:`, `jsr:`, `node:` and https: imports are not ours to resolve. */
function relativeImports(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.[^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

const FILES = sourceFiles(FUNCTIONS);

describe("edge function bundles are self-contained", () => {
  it("finds the functions tree, so a rename cannot silently pass this suite", () => {
    expect(existsSync(FUNCTIONS)).toBe(true);
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("no file under supabase/functions imports anything outside it", () => {
    const escapes: string[] = [];
    for (const file of FILES) {
      for (const spec of relativeImports(code(readFileSync(file, "utf8")))) {
        const target = resolve(dirname(file), spec);
        if (relative(FUNCTIONS, target).startsWith("..")) {
          escapes.push(`${relative(ROOT, file)} -> ${spec}`);
        }
      }
    }
    expect(escapes).toEqual([]);
  });

  it("every relative import resolves to a file that exists", () => {
    const missing: string[] = [];
    for (const file of FILES) {
      for (const spec of relativeImports(code(readFileSync(file, "utf8")))) {
        const target = resolve(dirname(file), spec);
        const found = [target, `${target}.ts`, join(target, "index.ts")].some(
          (c) => existsSync(c) && statSync(c).isFile(),
        );
        if (!found) missing.push(`${relative(ROOT, file)} -> ${spec}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the actor asset map is inside the tree, and src/data re-exports it", () => {
    // The specific regression. characterRef.ts must reach the map without
    // leaving the tree, and the app-side path must keep working for the six
    // modules and the Remotion worker that import it.
    expect(existsSync(join(FUNCTIONS, "_shared", "storyActorAssets.ts"))).toBe(true);

    const shim = readFileSync(join(ROOT, "src", "data", "storyActorAssets.ts"), "utf8");
    expect(shim).toContain("supabase/functions/_shared/storyActorAssets.ts");

    const characterRef = code(readFileSync(join(FUNCTIONS, "_shared", "characterRef.ts"), "utf8"));
    expect(characterRef).toContain('from "./storyActorAssets.ts"');
    expect(characterRef).not.toContain("src/data");
  });
});
