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
/**
 * THE MIRROR IS WALKED TOO — v1.2, brief section 3: "src/oqca/ must remain
 * incapable of network access, credentials, direct production database access,
 * clock access, direct tool execution, direct model execution... Extend the
 * existing security test rather than weakening it."
 *
 * The loop now runs in Deno, so its closure exists a second time under
 * `supabase/functions/_shared/oqca/`. A guarantee asserted over one copy of a
 * file and not the other is not a guarantee — and the mirror is the copy that
 * ships to production, where a `fetch` would actually reach something. So the
 * SAME 26 bans run over BOTH trees.
 *
 * The runtime adapters that DO hold a fetch, a credential and a clock live in a
 * sibling directory, `_shared/oqcaRuntime/`, which is deliberately not walked.
 * That path IS the boundary: everything on this side is inert, everything on
 * that side is handed in, and `mirror.test.ts` asserts the two directories
 * never merge.
 */
const MIRROR = "supabase/functions/_shared/oqca";
const SCRIPT = "scripts/oqca-bench.ts";
/**
 * THE FILES WHOSE JOB IS TO NAME THE BANNED SHAPES.
 *
 * This file has always been one: it must write `fetch` to ban it. v1.2 added
 * two more — the runtime wiring guard, which asserts that the ADAPTERS contain
 * no deploy call and exactly one host, and the runtime suite, which drives an
 * engine that throws and asserts a router refuses.
 *
 * They are NOT excluded, which would leave three files the walker never visits
 * — escape number two from the health red team. They are held to the STRICTER
 * rule instead: after strings AND regex literals are masked, their executable
 * residue must contain none of the banned shapes. A real `await fetch(u)` added
 * to any of them still goes red; `/\bfetch\b/` in a table does not. The
 * mutation checks at the bottom of this file are what make that a rule rather
 * than a convenience.
 */
/**
 * THE FILES EXCLUDED FROM THE SUBSTRING SCAN AND HELD TO THE STRICTER RESIDUE
 * RULE INSTEAD.
 *
 * The first three are tests that must NAME every banned shape to check for it.
 * The last four are the recovery classifier and the failure record, mirrors
 * included, and they are here for the same reason and not a weaker one:
 *
 *   `classify.ts` matches a thrown error against `fetch failed`, which is what
 *   undici actually says, so the word must appear inside a regex literal for
 *   the classifier to work at all.
 *   `failure.ts` carries the credential SHAPES it redacts — a JWT triple, an
 *   `sbp_` token, a Google key, a bearer header — because a redactor that may
 *   not name a secret cannot remove one.
 *
 * THIS IS A GENUINE IDENTIFIER COLLISION INSIDE REGEX LITERALS, not the prose
 * match this repo has hit eleven times, so stripping comments cannot fix it.
 * The residue rule is STRICTER for these files, not looser: strings and regex
 * literals are masked and a real `await fetch(u)` in either still goes red —
 * asserted below by mutation, in this same file.
 */
const GUARDS = [
  "src/oqca/__tests__/security.test.ts",
  "src/oqca/__tests__/runtimeWiring.test.ts",
  "src/oqca/__tests__/runtime.test.ts",
  // It asserts that a JWT, a management PAT, a Google key and a bearer header
  // are REDACTED from a failure record, so it must contain one of each. A
  // redaction test that may not name a secret cannot test a redactor.
  "src/oqca/__tests__/recovery.test.ts",
  "src/oqca/recovery/classify.ts",
  "supabase/functions/_shared/oqca/recovery/classify.ts",
];

/** The three that are tests; only these carry `describe`/`expect`. */
const GUARD_TESTS = GUARDS.filter((g) => g.includes("__tests__"));
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

const FILES = [...walk(ROOT), ...walk(MIRROR), SCRIPT];
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
  // ORDER MATTERS, AND GETTING IT WRONG WAS A REAL FAILURE. This used to mask
  // strings first and regex literals second, which breaks on the one shape
  // these guards are full of: a regex literal containing a QUOTE, such as
  // `/from "\\.\\.\\/llm\\.ts"/`. The string masker reads that quote as opening a
  // literal, pairs it with the next quote pages later, and every string in
  // between survives unmasked — so a URL or a banned word inside an ordinary
  // string looked like executable code. `sourceText.ts` documents exactly this
  // limit ("a regex literal containing a quote character"); the fix is to
  // remove the regexes BEFORE the strings are read.
  const noComments = stripComments(source);
  const noRegex = noComments.replace(
    /(^|[\s(,=:!&|?{[])\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g,
    "$1 ",
  );
  return executableText(noRegex);
}

/** Files whose executable text (comments gone, strings kept) matches. */
function offenders(pattern: RegExp, alsoExempt: readonly string[] = []): string[] {
  return [...SOURCE]
    .filter(([file]) => !GUARDS.includes(file) && !alsoExempt.includes(file))
    .filter(([, text]) => new RegExp(pattern).test(text))
    .map(([f]) => f);
}

/**
 * TWO FILES CARRY URLs AS DATA, AND THEY ARE EXEMPT FROM THE URL BAN ONLY.
 *
 * The OKS spec's §9 requires every piece of evidence to carry a LOCATOR — "a
 * URL, a file path, a registry endpoint. Never invented" — so a provenance
 * record without one is untraceable by construction. `sources.ts` holds the
 * eighteen ecosystems' repository and documentation addresses as harvested
 * from PyPI, and `knowledge.ts` holds the harvest endpoint it reads them from.
 *
 * THE EXEMPTION IS NARROW AND THE COMPENSATION IS STRICTER, not looser. Every
 * other ban still applies to both files unchanged — a `fetch` in either still
 * goes red, asserted by mutation below — and a dedicated assertion requires
 * that their URLs appear ONLY inside string literals, so nothing is composing
 * one into a call. A URL no code can reach is a citation.
 */
const URL_DATA = ["src/oqca/quantum/sources.ts", "src/oqca/quantum/knowledge.ts"];

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
  {
    what: "an auth header",
    // THE `i` FLAG WAS TOO WIDE, AND `AUTHORIZATION` IS WHY. The failure
    // brief's own `FailureClass` union carries an `AUTHORIZATION` member —
    // a CLASS OF FAULT, not an HTTP header — and a case-insensitive match
    // cannot tell the two apart. No real header is spelled in caps, so the
    // two spellings that actually occur on the wire are listed instead. The
    // narrowing is proven both ways immediately below.
    pattern: /\bapikey\b|\bAPIKey\b|\bAuthorization\b|\bauthorization\b/,
  },
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

/**
 * A CLOCK READING, not the `Date` namespace. `Date.now()`, an argless
 * `new Date()` and `performance.now()` return something different on every
 * call and destroy deterministic replay; `Date.parse`, `Date.UTC` and
 * `new Date(<string>)` are pure functions of their arguments and cannot.
 * Every branch is exercised both ways in the assertion that uses it.
 */
const CLOCK =
  /\bDate\s*\.\s*now\b|\bnew\s+Date\s*\(\s*\)|(?<![.\w$])Date\s*\(\s*\)|performance\s*\.\s*now\b/;

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
      expect(offenders(pattern, what === "an http(s) URL" ? URL_DATA : [])).toEqual([]);
    });
  }

  it("the two URL-carrying files hold citations, not reachable addresses", () => {
    for (const file of URL_DATA) {
      const text = SOURCE.get(file);
      expect(text, `${file} is not in the walk`).toBeDefined();
      // It really does carry one, or the exemption is dead weight sitting
      // there weakening a ban for nothing.
      expect(/https?:\/\//.test(text!)).toBe(true);
      // With strings and regexes masked, no whole scheme survives — so no URL
      // is spelled out in executable position.
      expect(executableText(readFileSync(file, "utf8"))).not.toMatch(/https?:\/\//);
      // Every OTHER ban still applies here, unchanged. THIS LOOP IS THE REAL
      // GUARANTEE and the line above is a secondary signal: see the limit
      // asserted directly below.
      for (const { what, pattern } of FORBIDDEN) {
        if (what === "an http(s) URL") continue;
        expect(new RegExp(pattern).test(text!), `${file} names ${what}`).toBe(false);
      }
    }
  });

  it("the executable-text signal has a stated limit, and it is asserted not described", () => {
    // MEASURED BY MUTATION, NOT REASONED. Appending
    //   export const built = "https" + "://pypi.org/" + HARVESTED_AT;
    // to `sources.ts` left all 50 tests GREEN: `executableText` masks BOTH
    // string literals, so a URL assembled from pieces leaves no scheme in the
    // residue. The assertion above therefore proves "no URL is written out in
    // executable position" and NOT "no URL can be assembled".
    //
    // That is fine, and the reason is worth being explicit about rather than
    // leaving to a reader: an assembled URL is inert here because EVERY
    // network primitive is banned in these files without exemption — `fetch`,
    // `XMLHttpRequest`, `WebSocket`, `import(`, `Deno.connect`. A string that
    // no call can consume is a citation whatever it is made of. The mutation
    // that adds a real `fetch` to `sources.ts` goes red on two tests.
    //
    // Pinned so the limit cannot quietly become a claim: this IS the gap.
    expect(executableText('const u = "https" + "://x.example/";')).not.toMatch(/https?:\/\//);
    expect(executableText("const u = fetch;")).toMatch(/\bfetch\b/);
  });

  it.each(GUARDS)("%s is subject to every ban it declares", (guard) => {
    // The three files excluded from the SUBSTRING scan, checked by the
    // stricter rule: strings and regex literals masked, executable residue
    // only. A real `await fetch(u)` in any of them still goes red.
    const residue = codeResidue(readFileSync(guard, "utf8"));
    for (const { what, pattern } of FORBIDDEN) {
      expect(new RegExp(pattern).test(residue), `${guard} executes ${what}`).toBe(false);
    }
    // ...and the residue is real code rather than an empty string, which would
    // make the loop above vacuous. A test file proves it with its own
    // vocabulary; a source file with `export`, which every one of them has.
    if (GUARD_TESTS.includes(guard)) {
      expect(residue).toContain("expect");
      expect(residue).toContain("describe");
    } else {
      expect(residue).toContain("export");
      expect(residue).toContain("function");
    }
  });

  it("the recovery classifier is excluded for a REGEX collision, and a real call still trips", () => {
    /* ------------------------------------------------------------------ *
     * NARROW A GUARD AND PROVE THE NARROWING IN THE SAME FILE — the rule this
     * repo wrote on 2026-09-10 after `anthropicRetired` was narrowed. Two
     * halves, and the second is the one that matters:
     *
     *   1. the banned word really is present in the raw source, so the
     *      exclusion is load-bearing rather than decorative, and
     *   2. adding a real call to that file would still be caught.
     *
     * ONLY `classify.ts` NEEDED THIS. The failure record tripped the ban on
     * an identifier of its own — `SECRET_PATTERNS` — and that was fixed by
     * renaming it, not by excluding the file. Renaming your own noun is
     * always cheaper than widening a hole.
     * ------------------------------------------------------------------ */
    const fetchBan = FORBIDDEN.find((f) => f.what === "fetch")!.pattern;
    const classify = readFileSync("src/oqca/recovery/classify.ts", "utf8");
    // 1 — the collision is real: undici says "fetch failed", so the classifier
    // must carry those words inside a regex to recognise one.
    expect(classify).toMatch(/fetch failed/);
    // ...and it lives inside a regex literal, so the residue is clean.
    expect(codeResidue(classify)).not.toMatch(/fetch/);
    // 2 — MUTATION, INLINE: a real call in that file trips the same ban.
    const mutated = codeResidue(
      classify + "\nasync function leak(u: string) { return await fetch(u); }",
    );
    expect(new RegExp(fetchBan).test(mutated)).toBe(true);
  });

  it("the auth-header ban still catches both wire spellings, and not the class name", () => {
    // BOTH DIRECTIONS, TOGETHER — 2026-09-10's rule. A narrowing asserted only
    // on what it now permits is a weaker guard with a comment on it.
    const ban = () => new RegExp(FORBIDDEN.find((f) => f.what === "an auth header")!.pattern);
    expect(ban().test("headers: { Authorization: token }")).toBe(true);
    expect(ban().test('h.get("authorization")')).toBe(true);
    expect(ban().test("{ apikey: k }")).toBe(true);
    // The failure brief's class, which is not a header and never was.
    expect(ban().test('case "AUTHORIZATION":')).toBe(false);
  });

  it("the exclusion list is exactly the guard files, and every one is walked", () => {
    // AN EXCLUSION THAT GREW WOULD BE A HOLE. Each of these must NAME the
    // banned shapes to do its job; nothing else may join them, and all three
    // are still in FILES so the residue rule above actually runs on them.
    expect(GUARDS).toEqual([
      "src/oqca/__tests__/security.test.ts",
      "src/oqca/__tests__/runtimeWiring.test.ts",
      "src/oqca/__tests__/runtime.test.ts",
      "src/oqca/__tests__/recovery.test.ts",
      "src/oqca/recovery/classify.ts",
      "supabase/functions/_shared/oqca/recovery/classify.ts",
    ]);
    for (const g of GUARDS) expect(FILES).toContain(g);
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
    expect(offenders(CLOCK)).toEqual([]);
    expect(offenders(/Math\s*\.\s*random/)).toEqual([]);

    // THE NARROWING, PROVEN HERE RATHER THAN ASSERTED (CLAUDE.md, 2026-09-10).
    // `Date.parse` and `new Date(<a string>)` are PURE — same input, same
    // output, forever — so neither can make a replay differ, and the substrate
    // needs them to read an ISO instant off a piece of evidence. The first
    // pattern banned the whole `Date` namespace and flagged three files whose
    // only use is `Date.parse(e.retrievedAt)`. What destroys replay is a
    // READING of the clock, and that is what is banned.
    expect(CLOCK.test("Date.now()")).toBe(true);
    expect(CLOCK.test("new Date()")).toBe(true);
    expect(CLOCK.test("new Date( )")).toBe(true);
    expect(CLOCK.test("performance.now()")).toBe(true);
    expect(CLOCK.test("Date.parse(iso)")).toBe(false);
    expect(CLOCK.test("new Date(iso)")).toBe(false);
    expect(CLOCK.test("Date.UTC(2026, 8, 10)")).toBe(false);
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
        expect(spec, `${file} imports ${spec}`).toMatch(/^\.\/(complex|unitary|hash)\.ts$/);
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
    expect(importsOf("src/oqca/bench/runner.ts")).toContain("./stats.ts");
  });
});
