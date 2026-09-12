/**
 * WHICH MODULES ANYTHING ACTUALLY RUNS.
 *
 * `routeDoors` asks whether a SCREEN can be reached. This asks the same
 * question one level down, because most of the failures were never screens.
 * CLAUDE.md records ten, and calls it "this repo's most-recorded failure" in
 * those words: `voiceReplication.ts` complete and unit-tested with zero
 * importers for two days of Vertex probing; `extractCandidates` hardened
 * against real report layouts while production ran a different path;
 * `toKnowledgeState` described as one of the substrate's "exactly two exits"
 * with no caller anywhere; OQCA across nine versions; the motion validator
 * "complete, calibrated, tested — and absent from the Dockerfile, imported by
 * nothing". Every one shipped green, and every one was found by a person.
 *
 * A TEST IS NOT AN ENTRYPOINT, AND THAT IS THE WHOLE GUARD. Every module
 * above had tests, and its tests passed. "Built and unit-tested is not
 * reachable" is the sentence this file exists to make checkable, so the
 * reachability walk starts from what the app and the platform actually run —
 * route files, the router, the three server entries, and each edge function's
 * `index.ts` — and never from a `__tests__` directory. Seeding the walk with
 * tests would make this file agree with itself and catch nothing.
 *
 * THERE ARE THREE WAYS TO HAVE A CALLER, and collapsing them would either
 * cry wolf or go quiet:
 *
 *   SHIPPED   reachable from a route or an edge function — it runs for users
 *   TOOLING   reachable only from `scripts/` — a developer runs it on purpose.
 *             Not shipped, but not dead either, and saying "orphan" here would
 *             be false: the §21 benchmark harness is exactly this.
 *   MIRRORED  a module whose BYTE-IDENTICAL twin is SHIPPED. The mirror is the
 *             copy that deploys and the mirror script COPIES rather than
 *             imports, so no import edge exists to find. Derived from content
 *             rather than from a path convention, because ONIQ has TWO mirrors
 *             (`src/oqca/` and `src/health/`) and a rule that knew only the
 *             first put `health/consent.ts` on the orphan list. Derived per
 *             FILE rather than by excluding a tree: 26 of OQCA's 40
 *             unreferenced modules are mirror sources and 14 are genuinely
 *             callerless, which a blanket exclusion would have hidden.
 *
 * WHAT IT CANNOT SEE, stated because the limit is load-bearing: this works at
 * FILE granularity. `extractCandidates` lived in a file that `synthetic.ts`
 * imports, so the file was reachable while the export was reached only by the
 * synthetic path — and that is two of the ten. A file with one live export and
 * nine dead ones passes here.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

/**
 * The trees CI typechecks and the platform deploys, plus the dev tools, plus
 * the COMPOSITOR.
 *
 * `remotion/` was missing from the first version of this file and that made
 * seventeen entries of the frozen list false. `remotion/scripts/story-worker.mjs`
 * is what GitHub Actions runs on every `repository_dispatch` for a user's
 * Story film, and it imports twenty-eight modules straight out of `src/` and
 * `_shared/` by relative path with the extension spelled out. So the busiest
 * caller in the repository lived in a tree the walk never entered, and every
 * module only IT reached read as dead.
 *
 * `.mjs` is in EXTENSIONS for the same reason: that worker, and every script
 * beside it, is an ES module rather than TypeScript. A tree admitted without
 * its own file extension is a tree admitted in name only.
 */
const TREES = ["src", "supabase/functions", "scripts", "remotion/src", "remotion/scripts"];
const EXTENSIONS = [".ts", ".tsx", ".mjs"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== "node_modules" && entry !== "dist" && entry !== ".git") walk(p, out);
    } else if (EXTENSIONS.some((e) => p.endsWith(e))) {
      out.push(relative(ROOT, p).split(/[\\/]/).join("/"));
    }
  }
  return out;
}

export function moduleFiles(): string[] {
  return TREES.flatMap((t) => walk(resolve(ROOT, t))).sort();
}

export function isTestModule(f: string): boolean {
  return /(^|\/)__tests__\//.test(f) || /\.test\.tsx?$/.test(f);
}

/**
 * Static `import`/`export … from`, bare side-effect `import "x"`, and dynamic
 * `import("x")` with a LITERAL specifier. A computed specifier is invisible
 * here and would read as an orphan; `saveFile.ts`'s `@capacitor/browser` is
 * the shape, and it is a bare package rather than a local module, so nothing
 * in these trees is reached only that way today.
 */
const SPECIFIER =
  /(?:^|[\s;}])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|[\s;=({,])import\s*\(\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']/g;

/** Asset imports are real and are not modules; they must not read as broken. */
const ASSET = /\.(svg|png|jpe?g|webp|gif|css|json|mp3|mp4|wav|woff2?|txt|md)(\?.*)?$/;

export function resolveSpecifier(
  fromFile: string,
  spec: string,
  files: Set<string>,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = posix.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(fromFile), spec));
  else return null; // a package, npm: or https: — not ours to walk
  for (const c of [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => `${base}/index${e}`),
  ]) {
    if (files.has(c)) return c;
  }
  return null;
}

export type Graph = {
  readonly files: readonly string[];
  readonly edges: ReadonlyMap<string, ReadonlySet<string>>;
  /** Relative specifiers that resolved to no module — a silent false orphan. */
  readonly unresolved: readonly { from: string; spec: string }[];
};

export function importGraph(files = moduleFiles()): Graph {
  const set = new Set(files);
  const edges = new Map<string, Set<string>>();
  const unresolved: { from: string; spec: string }[] = [];
  for (const f of files) {
    const src = readFileSync(resolve(ROOT, f), "utf8");
    const outs = new Set<string>();
    for (const m of src.matchAll(SPECIFIER)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec || ASSET.test(spec)) continue;
      const target = resolveSpecifier(f, spec, set);
      if (target) outs.add(target);
      else if (spec.startsWith(".") || spec.startsWith("@/")) unresolved.push({ from: f, spec });
    }
    edges.set(f, outs);
  }
  return { files, edges, unresolved };
}

/**
 * What the app and the platform run. Deliberately no test, ever — and the
 * first draft got that wrong: `src/routes/` also matches
 * `src/routes/__tests__/…`, so six test files were entrypoints and anything
 * only they imported counted as shipped. The guard's own "no test is an
 * entrypoint" assertion caught it on its first run. The exclusion is here
 * rather than at the call site so the property holds for every caller.
 */
export function isAppEntrypoint(f: string): boolean {
  if (isTestModule(f)) return false;
  return (
    f === "src/routeTree.gen.ts" ||
    f === "src/router.tsx" ||
    f === "src/server.ts" ||
    f === "src/start.ts" ||
    f.startsWith("src/routes/") ||
    /^supabase\/functions\/[^/]+\/index\.ts$/.test(f) ||
    // The Story compositor. `story-worker.mjs` is the command in
    // `.github/workflows/story-worker.yml`, dispatched per film; `story.ts` is
    // the `entryPoint:` it hands to Remotion's bundler. Both run for a paying
    // user, so they are SHIPPED and not tooling.
    f === "remotion/scripts/story-worker.mjs" ||
    f === "remotion/src/story.ts"
  );
}

/**
 * The four other `entryPoint:` values passed to `bundle()` — the promo, the
 * episodes, the rig proof and the shot renderer. A person renders these on
 * purpose, which is the TOOLING rung, not SHIPPED. Read from the scripts
 * rather than guessed: `grep -o "entryPoint: path.resolve(...)" remotion/scripts`.
 */
const REMOTION_TOOL_ENTRIES = [
  "remotion/src/index.ts",
  "remotion/src/episodes.ts",
  "remotion/src/rigProof.ts",
  "remotion/src/shots.ts",
];

/** A developer runs these by hand; a module they reach has a caller. */
export function isToolEntrypoint(f: string): boolean {
  if (isTestModule(f)) return false;
  return (
    f.startsWith("scripts/") ||
    f.startsWith("remotion/scripts/") ||
    REMOTION_TOOL_ENTRIES.includes(f)
  );
}

/**
 * MIRROR SOURCES: every module whose BYTE-IDENTICAL twin is shipped.
 *
 * A mirror copies rather than imports, so no edge exists to find and the
 * source reads as dead. The first version derived the twin from ONE path
 * convention — `src/oqca/X` -> `_shared/oqca/X` — and that was the same
 * mistake as leaving `remotion/` out of the walk, one layer down: ONIQ has a
 * SECOND mirror, `src/health/X` <-> `_shared/health/X`, whose own headers say
 * "MIRRORED byte for byte" and whose twins `health-api` and `health-ai`
 * import. `consent.ts` and `retention.ts` sat on the frozen list because the
 * rule knew one convention and there were two.
 *
 * So the rule is derived from the CONTENT instead. Identical bytes is not a
 * coincidence: measured across all 910 non-test modules there are 56
 * duplicate-content pairs and every one is a `src/X` <-> `_shared/X` mirror,
 * with no accidental collision anywhere. A third mirror added tomorrow is
 * recognised without an edit, which a path list cannot promise.
 */
export function contentKeys(files: readonly string[]): Map<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const f of files) {
    const h = createHash("sha1")
      .update(readFileSync(resolve(ROOT, f)))
      .digest("hex");
    const at = byHash.get(h);
    if (at) at.push(f);
    else byHash.set(h, [f]);
  }
  return byHash;
}

function reach(roots: readonly string[], edges: Graph["edges"]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const o of edges.get(f) ?? []) if (!seen.has(o)) stack.push(o);
  }
  return seen;
}

export type Reachability = {
  readonly shipped: ReadonlySet<string>;
  readonly tooling: ReadonlySet<string>;
  readonly mirrored: ReadonlySet<string>;
  /** Non-test modules no entrypoint reaches, by any of the three routes. */
  readonly orphans: readonly string[];
};

export function reachability(graph = importGraph()): Reachability {
  const shipped = reach(graph.files.filter(isAppEntrypoint), graph.edges);
  const tooling = reach(graph.files.filter(isToolEntrypoint), graph.edges);
  const byHash = contentKeys(graph.files);
  const mirrored = new Set(
    graph.files.filter((f) => {
      if (shipped.has(f)) return false;
      const twins = byHash.get(
        createHash("sha1")
          .update(readFileSync(resolve(ROOT, f)))
          .digest("hex"),
      );
      return (twins ?? []).some((t) => t !== f && shipped.has(t));
    }),
  );
  const orphans = graph.files.filter(
    (f) =>
      !isTestModule(f) &&
      !isToolEntrypoint(f) &&
      !shipped.has(f) &&
      !tooling.has(f) &&
      !mirrored.has(f),
  );
  return { shipped, tooling, mirrored, orphans };
}
