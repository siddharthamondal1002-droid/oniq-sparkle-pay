/**
 * THE TEST GATE'S OWN GUARD RAILS.
 *
 * On 2026-08-24 a full run reported two failures and the next run was green.
 * The identities were never captured, so nothing could be concluded — twelve
 * clean runs cannot turn "two unknown tests failed" into a diagnosis. What that
 * episode actually showed is that the suite's TRUSTWORTHINESS was never itself
 * under test.
 *
 * These are the properties that make a green run mean something. Each one is
 * here because losing it silently is easy and noticing is not:
 *
 *   - no test may depend on how fast the machine is;
 *   - no test may reach a database, so no test can leave residue in one;
 *   - no test may reach the network, so no test can spend money;
 *   - no test may mutate the environment for the test that follows it.
 *
 * They are asserted over test SOURCE rather than by running anything, because a
 * violation must fail the build the moment it is written, not the first time it
 * happens to matter.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Every test file vitest would collect (`src/**./*.test.ts`). */
function testFiles(dir = join(ROOT, "src"), out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) testFiles(p, out);
    else if (entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const FILES = testFiles();
const rel = (p: string) => p.slice(ROOT.length + 1);

/**
 * Source with everything that merely QUOTES code removed: comments, string and
 * template literals, and — the one that matters here — regex literals.
 *
 * A test that asserts `not.toMatch(/insert into provider_budget_config/)` is
 * PROHIBITING that statement, not performing it. Scanning raw source flags it
 * as an offender, and a guard that accuses the tests enforcing the rule is a
 * guard people learn to silence.
 */
function code(src: string): string {
  return (
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`[^`]*`/g, "``")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      // Regex literals: after `(`, `,`, `=` or whitespace, up to an unescaped `/`.
      .replace(/([(,=:]\s*)\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g, "$1/RE/")
  );
}

describe("the suite collects what we think it collects", () => {
  it("finds every test file, and there are enough of them to be the real suite", () => {
    expect(FILES.length).toBeGreaterThan(150);
  });
});

// -------------------------------------------------------------- repo bounds
describe("no test reads outside the repository it ships with", () => {
  it("opens no path that escapes the checkout", () => {
    // MEASURED 2026-08-31, and it is why this exists. A test asserted that
    // oniq-gpu-worker/contract.py states the same reference bounds this repo
    // does — a genuinely valuable cross-check, written as
    // `readFileSync(join(process.cwd(), "../oniq-gpu-worker/contract.py"))`.
    // It passed here, where both repositories are checked out side by side,
    // and failed in CI with ENOENT, where only one of them is. A test that
    // passes locally and fails in CI is worse than no test: it costs a red
    // build and it teaches nobody anything about the code.
    //
    // The repo's own answer to a two-repo contract is already established
    // (gpuVideoAudio.test.ts, MAX_NARRATION_CHARS): pin the number on BOTH
    // sides with a comment naming the other, so each CI enforces its half and
    // a drift fails in whichever repo moved.
    const offenders: string[] = [];
    for (const file of FILES) {
      // Comments only — NOT `code()`, which also blanks string literals and
      // would erase the very path this check reads. The note above quotes the
      // offending line verbatim as its example, and "a guard that accuses the
      // tests enforcing the rule is a guard people learn to silence".
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const m of src.matchAll(/(?:readFileSync|readFile|existsSync|readdirSync)\s*\(\s*join\(\s*process\.cwd\(\)\s*,\s*(["'`])([^"'`]*)\1/g)) {
        if (m[2].startsWith("..") || m[2].startsWith("/")) {
          offenders.push(`${file.replace(process.cwd() + "/", "")}: ${m[2]}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("no source file is secretly binary", () => {
  it("contains no NUL byte anywhere in the tracked source", () => {
    // MEASURED 2026-08-31, during the merge audit. storySeed.ts carried ONE
    // NUL byte, as the separator in `[...].join("\0")`. Everything still
    // worked — esbuild tolerated it and the seeds stayed deterministic — but
    // three things were wrong at once:
    //
    //   1. git classified the file as BINARY, so its diff showed as
    //      "Bin 0 -> 3324 bytes" and could not be reviewed. This repository
    //      treats reviewable diffs as its primary quality control.
    //   2. Deno is the runtime for edge functions and need not agree with
    //      esbuild about a NUL in source.
    //   3. Worst: it is INVISIBLE. A reader sees `join("")` and reasonably
    //      concludes the separator is empty — which would be a real collision
    //      bug, since ("ab","c") and ("a","bc") would then share a seed.
    //
    // A character nobody can see is a character nobody can review.
    const roots = ["src", "supabase/functions", "remotion/scripts"];
    const exts = [".ts", ".tsx", ".mjs", ".js", ".json", ".toml", ".pin"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".git") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (exts.some((e) => entry.endsWith(e))) {
          if (readFileSync(full).includes(0)) {
            offenders.push(full.replace(process.cwd() + "/", ""));
          }
        }
      }
    };
    for (const r of roots) walk(join(process.cwd(), r));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

// ------------------------------------------------------------------- timing
describe("no test measures the machine instead of the code", () => {
  /**
   * The specific defect, kept fixed.
   *
   * `parseRetryAfter` turns an HTTP-date `Retry-After` into a number of
   * seconds, which is a DIFFERENCE between two clock readings. The test used to
   * take one reading and let the function take the other, so its assertion
   * window (50 < got <= 61) was really a ten-second budget for whatever
   * happened in between. Measured: it fails at >= 10s of stall, and per-suite
   * time on this repository inflates ~2.5x under worker oversubscription.
   *
   * No repo-wide heuristic here on purpose. A file-level scan for "reads the
   * clock AND asserts a range" flags three files that are perfectly sound —
   * two assert on source text and one has an hour of slack — and a guard that
   * accuses innocent tests gets its expected-list edited rather than obeyed.
   */
  it("keeps the HTTP-date Retry-After test pinned to a fixed instant", () => {
    // RAW source here, not `code()`: the test is located by its own title, and
    // `code()` blanks string literals — including the title being searched for.
    const src = readFileSync(join(ROOT, "src/lib/__tests__/providerError.test.ts"), "utf8");
    const block = src.slice(src.indexOf("reads an HTTP-date"));
    const body = block.slice(0, block.indexOf("});"));
    expect(body.length, "the HTTP-date test must still exist").toBeGreaterThan(0);
    expect(body, "the test must pin its own clock").toMatch(/Date\.UTC\(/);
    expect(body, "and must not read the live clock").not.toMatch(/Date\.now\(\)/);
    // And the production default must stay live, or callers silently freeze.
    const impl = readFileSync(join(ROOT, "supabase/functions/_shared/providerError.ts"), "utf8");
    expect(impl).toMatch(/parseRetryAfter\([^)]*now = Date\.now\(\)/);
  });

  it("has no test that sleeps on the real clock", () => {
    const offenders = FILES.filter((f) =>
      /await new Promise\(\s*\(?\s*(?:r|res|resolve)\)?\s*=>\s*setTimeout/.test(
        code(readFileSync(f, "utf8")),
      ),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});

// ----------------------------------------------------------------- database
describe("no test can leave residue in a database", () => {
  /**
   * The strongest possible form of database isolation: the suite never opens a
   * connection, so there is nothing to isolate. This matters because a scratch
   * database was once left holding `enabled = true` with cap values that looked
   * exactly like production configuration — see ONIQ_AI_FINANCIAL_CONTROL §7.
   * Every ledger proof runs through psql in a rolled-back transaction or a
   * throwaway database, deliberately outside this suite.
   */
  it("opens no database connection anywhere", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = code(readFileSync(f, "utf8"));
      if (/new\s+Client\s*\(|createClient\s*\(|\.\s*connect\s*\(|new\s+Pool\s*\(/.test(src)) {
        offenders.push(rel(f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never writes a VIDEO budget row, and never enables a capability", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = code(readFileSync(f, "utf8"));
      if (/insert\s+into\s+.*provider_budget_config|update\s+.*provider_budget_config/i.test(src)) {
        offenders.push(rel(f));
      }
      if (/\benabled\s*=\s*true\b/.test(src)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });
});

// ------------------------------------------------------------------ network
describe("no test can spend money", () => {
  it("reaches no provider endpoint", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = code(readFileSync(f, "utf8"));
      if (/generativelanguage\.googleapis|aiplatform\.googleapis|api\.runwayml/.test(src)) {
        offenders.push(rel(f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("restores the real fetch wherever it replaces it", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      if (!/globalThis\.fetch\s*=/.test(code(src))) continue;
      // Replacing global fetch without restoring it hands the next file a mock.
      expect(src, rel(f)).toMatch(/afterEach|afterAll/);
      expect(src, rel(f)).toMatch(/globalThis\.fetch\s*=\s*(realFetch|originalFetch)/);
    }
  });
});

// -------------------------------------------------------------- environment
describe("no test mutates the environment for the next one", () => {
  it("assigns nothing to process.env", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = code(readFileSync(f, "utf8"));
      // vi.stubEnv is fine — vitest unstubs it. A bare assignment is not.
      if (/process\.env\.[A-Za-z_]+\s*=(?!=)/.test(src) || /delete\s+process\.env/.test(src)) {
        offenders.push(rel(f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("carries no real credential in any fixture", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/AIza[0-9A-Za-z_-]{15,}/);
      expect(src, rel(f)).not.toMatch(/sb_secret_[0-9A-Za-z]{10,}/);
      expect(src, rel(f)).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    }
  });
});

// ---------------------------------------------------------------- fake time
describe("fake timers are always handed back", () => {
  it("restores real timers in every file that fakes them", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      if (!/vi\.useFakeTimers\(/.test(code(src))) continue;
      // A leaked fake clock stops the next file's timers dead.
      expect(src, rel(f)).toMatch(/useRealTimers\(/);
    }
  });
});
