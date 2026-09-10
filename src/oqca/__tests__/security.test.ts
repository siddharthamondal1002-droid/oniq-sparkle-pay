/**
 * OQCA v1.1 — the security boundary. Brief section 18, "Security":
 *
 *   "no unrestricted tool execution, no production credentials, no network
 *    side effects, no deployment, no autonomous external actions"
 *
 * THIS SUBSYSTEM IS INERT BY CONSTRUCTION AND THAT IS WHAT IS ASSERTED. Nothing
 * in ONIQ imports `src/oqca`; it is a measured research kernel, not a feature.
 * But "nothing imports it yet" is a fact about today, and the one thing this
 * repo has learned repeatedly is that a boundary nobody checks is a comment
 * (CLAUDE.md, 2026-09-08: the health isolation seal). So the properties are
 * asserted over the WHOLE tree rather than trusted to stay true: no file here
 * can open a socket, read a credential, run a command, or deploy anything, and
 * the day one tries the build goes red.
 *
 * THE BANS ARE AN ALLOWLIST INVERTED, NOT A BLOCKLIST OF THE OBVIOUS. The
 * health red team (CLAUDE.md, 2026-09-08) opened four real egress paths with
 * every blocklist guard green — a `fetch` inside a template literal, a sibling
 * file the walker never visited, `functions["invoke"]`, an aliased
 * `globalThis.fetch`. So this walks EVERY file under the tree (no name list),
 * scans over comment-stripped source with STRINGS KEPT, and treats a bracket or
 * alias form as the same hit — the kernel has no legitimate use of any of these
 * words, so a false positive costs a rename and a false negative costs the
 * property.
 *
 * COMMENTS ARE STRIPPED AND STRINGS ARE NOT, deliberately and in that
 * combination. `measure.ts`'s header says it was chosen "over Math.random", and
 * `transition.ts`'s says `Date.now()` in a hashed record destroys replay — so a
 * raw grep flags the two files that explain WHY they avoid the thing they are
 * being accused of. That is the eleventh prose match in this repo; the fix is
 * the one CLAUDE.md already prescribes, and it is mutation-checked below so the
 * strip cannot quietly start hiding real code.
 *
 * AND THIS FILE IS THE ONE FILE THAT MUST NAME EVERY BANNED WORD, which is a
 * real problem rather than a nuisance: excluding it would leave a file in the
 * tree that the walker never visits, and that is precisely escape number two
 * from the health red team. So it is excluded from the SUBSTRING scan and
 * checked by a STRICTER rule instead — after string AND regex literals are
 * masked, its executable residue must contain none of the banned shapes. A real
 * `await fetch(u)` added here still goes red; `/\bfetch\b/` in the table below
 * does not.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { executableText, stripComments } from "@/test/sourceText";

const ROOT = "src/oqca";
const SCRIPT = "scripts/oqca-bench.ts";
const SELF = "src/oqca/__tests__/security.test.ts";

/** Every `.ts` under the tree, tests included — a test can open a socket too. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

const FILES = [...walk(ROOT), SCRIPT];
const SOURCE = new Map(FILES.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));

/**
 * Mask regex literals on top of the string masking `executableText` already
 * does, leaving only what actually executes. The `/` disambiguation is the
 * usual heuristic — a literal may open only after an operator, a bracket or
 * whitespace, never after a value — and the limit is accepted for the one file
 * this runs on, whose content is written directly below it. The mutation
 * checks are what make that acceptable rather than merely convenient.
 */
function codeResidue(source: string): string {
  return executableText(source).replace(
    /(^|[\s(,=:!&|?{[])\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g,
    "$1 ",
  );
}

/** Files whose executable text (comments gone, strings kept) matches. */
function offenders(pattern: RegExp): string[] {
  return [...SOURCE]
    .filter(([file]) => file !== SELF)
    .filter(([, text]) => new RegExp(pattern).test(text))
    .map(([f]) => f);
}

/**
 * The banned shapes. Each entry is one capability the brief forbids, and the
 * pattern is written to catch the ALIAS and BRACKET forms as well as the
 * obvious one — `globalThis["fetch"]` is a fetch.
 */
const FORBIDDEN: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  // --- no network side effects -------------------------------------------
  { what: "fetch", pattern: /\bfetch\b/ },
  { what: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
  { what: "WebSocket", pattern: /\bWebSocket\b/ },
  { what: "EventSource", pattern: /\bEventSource\b/ },
  { what: "sendBeacon", pattern: /\bsendBeacon\b/ },
  { what: "the Deno namespace", pattern: /\bDeno\s*[.[]/ },
  { what: "a node network module", pattern: /node:(http|https|net|tls|dgram|dns)\b/ },
  { what: "an http(s) URL", pattern: /https?:\/\// },
  { what: "a Worker", pattern: /\bnew\s+Worker\b|\bWorker\s*\(/ },
  // --- no unrestricted tool execution ------------------------------------
  { what: "child_process", pattern: /child_process/ },
  {
    what: "exec or spawn",
    pattern: /\b(execSync|execFileSync|spawnSync|execFile|spawn|fork)\s*\(/,
  },
  { what: "eval", pattern: /\beval\s*\(/ },
  { what: "new Function", pattern: /\bnew\s+Function\b/ },
  { what: "a dynamic import", pattern: /(^|[^.\w])import\s*\(/ },
  { what: "require", pattern: /\brequire\s*\(/ },
  { what: "node:vm", pattern: /node:vm\b/ },
  // --- no production credentials -----------------------------------------
  { what: "process.env", pattern: /\bprocess\s*[.[]\s*["']?env\b/ },
  { what: "import.meta.env", pattern: /\bimport\s*\.\s*meta\s*\.\s*env\b/ },
  {
    what: "a credential name",
    pattern: /SERVICE_ROLE|SUPABASE_|ANON_KEY|API_KEY|SECRET|PRIVATE_KEY|Bearer\s/i,
  },
  { what: "an auth header", pattern: /\bapikey\b|\bAuthorization\b/i },
  // --- no deployment, no autonomous external actions ----------------------
  {
    what: "a deploy call",
    pattern: /deploy_project|deploy_edge_function|storage_upload|send_message\b/,
  },
  // NARROWED, AND THE NARROWING IS PROVEN BELOW. The first version banned the
  // bare words `supabase` and `lovable` anywhere, and flagged `backends/tensor.ts`
  // — whose refusal message honestly says a contraction library is not in
  // `package.json`, "which Lovable owns". That is a genuine identifier
  // collision, not a prose match: the word is in a STRING and strings are kept
  // on purpose. So the pattern matches the CALL and URL shapes instead, and
  // `narrow a guard and prove the narrowing in the same commit` (CLAUDE.md,
  // 2026-09-10) is why the two directions are asserted together.
  {
    what: "a production surface",
    pattern:
      /\bsupabase\s*[.[]|\blovable\s*[.[]|oniqhub|functions\s*[.[]\s*["']?invoke|\.rpc\s*\(/i,
  },
  { what: "a cloud CLI", pattern: /\bgcloud\b|\bgsutil\b|\bkubectl\b/ },
  // --- no filesystem WRITES anywhere -------------------------------------
  {
    what: "a filesystem write",
    pattern:
      /\b(writeFileSync|writeFile|appendFileSync|appendFile|mkdirSync|rmSync|unlinkSync|rmdirSync|createWriteStream|copyFileSync|renameSync)\s*\(/,
  },
];

describe("brief section 18 — Security", () => {
  it("walks a tree that actually has files in it", () => {
    // A walker that silently returned nothing would pass every ban below. This
    // is the "a check that has never failed has never been tested" guard, in
    // its cheapest form: assert the denominator.
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES).toContain("src/oqca/operators.ts");
    expect(FILES).toContain("src/oqca/bench/loader.ts");
    expect(FILES).toContain(SELF);
    expect(FILES).toContain(SCRIPT);
  });

  for (const { what, pattern } of FORBIDDEN) {
    it(`no file names ${what}`, () => {
      expect(offenders(pattern)).toEqual([]);
    });
  }

  it("this guard's own executable code is subject to every ban it declares", () => {
    // The file excluded from the substring scan, checked by the stricter rule.
    const residue = codeResidue(readFileSync(SELF, "utf8"));
    for (const { what, pattern } of FORBIDDEN) {
      expect(new RegExp(pattern).test(residue), `${SELF} executes ${what}`).toBe(false);
    }
    // ...and the residue is real code rather than an empty string, which would
    // make the loop above vacuous.
    expect(residue).toContain("readFileSync");
    expect(residue).toContain("describe");
  });

  it("reads the filesystem in exactly one non-test file, and only to read", () => {
    // `node:fs` is admitted ONCE in the kernel, in the loader, because a
    // manifest has to come off a disk. Everything else — the runner, the arms,
    // the statistics — is pure, so a future caller in a browser-shaped context
    // cannot pull a filesystem in by importing the benchmark.
    const fsUsers = offenders(/node:fs\b/).filter((f) => !f.includes("__tests__"));
    expect(fsUsers).toEqual(["src/oqca/bench/loader.ts"]);

    const loader = SOURCE.get("src/oqca/bench/loader.ts")!;
    const imported = /import\s*\{([^}]*)\}\s*from\s*["']node:fs["']/.exec(loader);
    expect(imported).not.toBeNull();
    for (const name of imported![1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      expect(["readdirSync", "readFileSync", "statSync"]).toContain(name);
    }
  });

  it("touches no clock and no unseeded randomness, so a replay is a replay", () => {
    // Brief section 4 asks for deterministic replay. A clock reading inside a
    // hashed record makes every replay produce a different state id, and
    // Math.random makes a benchmark unreproducible — so both are banned in
    // code, and both are DISCUSSED in comments by the two files that avoid
    // them. Stripping comments is what separates the mention from the use.
    expect(offenders(/\bDate\s*[.(]|\bnew\s+Date\b|performance\s*\.\s*now/)).toEqual([]);
    expect(offenders(/Math\s*\.\s*random/)).toEqual([]);
  });
});

describe("the guard catches what it claims to — mutation checks, inline", () => {
  // A guard that has never been mutated has never been tested (CLAUDE.md,
  // 2026-09-08). These do not edit the tree: they run the SAME patterns over
  // strings shaped like the escapes the health red team actually found, and
  // assert each is flagged. Narrow a pattern later and one of these goes red in
  // the same file, which is the point.
  const flags = (pattern: RegExp, text: string) => new RegExp(pattern).test(stripComments(text));
  const patternFor = (what: string) => FORBIDDEN.find((f) => f.what === what)!.pattern;

  it("flags a fetch hidden inside a template literal", () => {
    expect(flags(patternFor("fetch"), "const go = `${await fetch(url)}`;")).toBe(true);
  });

  it("flags an aliased or bracketed fetch", () => {
    expect(flags(patternFor("fetch"), "const f = globalThis['fetch'];")).toBe(true);
    expect(flags(patternFor("fetch"), "const { fetch: go } = globalThis;")).toBe(true);
  });

  it("flags a dynamic import but not a static one", () => {
    const p = patternFor("a dynamic import");
    expect(flags(p, "const m = await import('./net');")).toBe(true);
    expect(flags(p, 'import { rotation } from "./math/unitary";')).toBe(false);
  });

  it("flags a credential read however it is spelled", () => {
    expect(flags(patternFor("process.env"), "const k = process.env.X;")).toBe(true);
    expect(flags(patternFor("process.env"), "const k = process['env']['X'];")).toBe(true);
    expect(flags(patternFor("a credential name"), 'const k = "SUPABASE_SERVICE_ROLE_KEY";')).toBe(
      true,
    );
  });

  it("flags a deploy call, and a production surface in its CALL shape", () => {
    expect(flags(patternFor("a deploy call"), "await deploy_project({});")).toBe(true);
    const surface = patternFor("a production surface");
    expect(flags(surface, 'supabase.functions.invoke("health-ai");')).toBe(true);
    expect(flags(surface, 'functions["invoke"]("health-ai");')).toBe(true);
    expect(flags(surface, 'admin.rpc("health_ai_reserve_request");')).toBe(true);
    // The other direction of the narrowing: naming the platform in prose that
    // happens to live in a string is NOT a call to it. This is the exact
    // sentence in `backends/tensor.ts` that the first draft of this guard
    // flagged, kept here so a future widening breaks in the same file.
    expect(flags(surface, 'const why = "none is in package.json, which Lovable owns";')).toBe(
      false,
    );
  });

  it("flags a filesystem write", () => {
    expect(flags(patternFor("a filesystem write"), "writeFileSync(p, s);")).toBe(true);
  });

  it("does NOT flag a word that only appears in a comment", () => {
    // The other direction, and the one that matters for honesty: stripping
    // comments must remove the mention and keep the use. If the first two ever
    // returned true the strip has stopped stripping; if the third stopped being
    // flagged the strip would be eating code.
    expect(flags(patternFor("fetch"), "// chosen over fetch, deliberately\nconst x = 1;")).toBe(
      false,
    );
    expect(flags(patternFor("fetch"), "/**\n * fetch is never used here.\n */\nconst x = 1;")).toBe(
      false,
    );
    expect(flags(patternFor("fetch"), "const x = await fetch(u); // fetch")).toBe(true);
  });

  it("the residue reader masks a pattern table but never a call", () => {
    // The self-check above is only as good as this: a banned word NAMED in a
    // regex literal or a string must vanish, and the same word CALLED must not.
    expect(codeResidue("const p = /\\bfetch\\b/;")).not.toMatch(/fetch/);
    expect(codeResidue('const p = "process.env";')).not.toMatch(/process/);
    expect(codeResidue("const x = await fetch(u);")).toMatch(/fetch/);
    expect(codeResidue("const k = process.env.X;")).toMatch(/process/);
  });
});

/**
 * THE LAYER BOUNDARY. `operators.ts` claims in its own header that it may not
 * import from `cognitive.ts`, `formalState.ts`, `knowledge/` or `bench/`, and
 * that a test reads the import graph — brief section 3, "Do not blur these
 * categories". The claim is checked here rather than believed.
 */
describe("brief section 3 — the physical layer knows nothing about cognition", () => {
  const importsOf = (file: string): string[] =>
    [...(SOURCE.get(file) ?? "").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);

  const COGNITIVE = /cognitive|formalState|knowledge|bench|loop|measure|state|tasks|baseline|gates/;

  it("nothing under math/ imports anything above it", () => {
    const mathFiles = FILES.filter(
      (f) => f.startsWith("src/oqca/math/") && !f.includes("__tests__"),
    );
    expect(mathFiles.length).toBeGreaterThan(0);
    for (const file of mathFiles) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/(complex|unitary|hash)$/);
      }
    }
  });

  it("operators.ts imports only the math layer", () => {
    for (const spec of importsOf("src/oqca/operators.ts")) {
      expect(spec, `operators.ts imports ${spec}`).toMatch(/^\.\/math\//);
      expect(spec).not.toMatch(COGNITIVE);
    }
  });

  it("transition.ts is a record shape and imports nothing at all", () => {
    expect(importsOf("src/oqca/transition.ts")).toEqual([]);
  });

  it("the backends depend on the state, never on the cognitive vocabulary", () => {
    const backends = FILES.filter((f) => f.startsWith("src/oqca/backends/"));
    expect(backends.length).toBeGreaterThan(0);
    for (const file of backends) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/cognitive|knowledge|bench|loop/);
      }
    }
  });

  it("the import reader is reading imports", () => {
    // Same shape as the walker assertion above: a regex that matched nothing
    // would make every layering test vacuous.
    expect(importsOf("src/oqca/operators.ts").length).toBeGreaterThan(0);
    expect(importsOf("src/oqca/bench/runner.ts")).toContain("./stats");
  });
});
