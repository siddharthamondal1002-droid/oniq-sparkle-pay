/**
 * A FAILURE THAT LEAVES NO TRACE COSTS MORE THAN THE FAILURE.
 *
 * 2026-09-05, asked why Study showed no chapters. `study_chapters_debug` held
 * 320 cache hits, 52 overrides, 71 generations and exactly ONE failure since
 * July — a table that looked healthy partly because the failure mode being
 * hunted was one it could not record. study-chapters' three validation guards
 * returned before `logDebug` was even defined, so a request rejected for a bad
 * board, class or subject wrote nothing at all. "No rows" then reads as "no
 * problem" when it may equally mean "rejected at the door, silently".
 *
 * The screen had the mirror of the same fault. The function answers HTTP 200
 * with `{ source: "unavailable", chapters: [], reason }` — it always says why —
 * and both components that fetch chapters discarded the reason, rendering one
 * sentence for every cause. An invalid board, a model refusal, a timeout and a
 * genuine "no such syllabus" were indistinguishable to the student and to
 * whoever was asked to explain it.
 *
 * These are source-level assertions because the behaviour they protect is
 * "somebody deleted the call", not a subtle logic error — and because the real
 * paths need a service account and a signed-in session that no unit test has.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Strip comments, so prose about a call is not mistaken for the call. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const FN = codeOnly(read("supabase/functions/study-chapters/index.ts"));

/**
 * The screen is read RAW, and that is deliberate.
 *
 * `codeOnly` strips block comments with a non-greedy /\*…\*\/ match, which
 * assumes they balance. app.study.tsx carries 41 `/*` against 39 `*\/` — the
 * strays live inside strings and regex literals — so the stripper mispairs and
 * swallows 56,033 characters, including the very lines asserted below. The
 * first version of this suite "failed" on code that was present and correct.
 *
 * Stripping is unnecessary here anyway: a `data-testid` and a `setReason(...)`
 * call are not things that appear in prose. The small edge-function file, whose
 * comments DO balance, keeps the stripper because its header discusses the same
 * words the assertions look for.
 */
const SCREEN = read("src/routes/_authenticated/app.study.tsx");

describe("a rejected request is recorded, not silently dropped", () => {
  it("defines logDebug before the first validation guard", () => {
    // The whole bug in one assertion: if the guards move back above the
    // logger, they stop being able to say anything.
    const logger = FN.indexOf("const logDebug");
    const firstGuard = FN.indexOf('reason: "invalid board"');
    expect(logger).toBeGreaterThan(-1);
    expect(firstGuard).toBeGreaterThan(-1);
    expect(logger).toBeLessThan(firstGuard);
  });

  it.each(["invalid board", "invalid classLevel", "invalid subject"])(
    "logs before returning %j",
    (reason) => {
      // The logDebug for this reason must appear BEFORE the return that
      // carries it — i.e. inside the same guard block.
      const ret = FN.indexOf(`reason: "${reason}" }`);
      const log = FN.indexOf(`logDebug({ source: "rejected", reason: "${reason}" })`);
      expect(log, `${reason} is not logged`).toBeGreaterThan(-1);
      expect(log).toBeLessThan(ret);
    },
  );

  it("every unavailable answer is logged except the one that cannot be", () => {
    // Without the service key there is no client to log WITH, so that single
    // return is the documented exception rather than an oversight.
    const unavailable = [...FN.matchAll(/source: "unavailable"/g)].length;
    const logged = [...FN.matchAll(/await logDebug\(/g)].length;
    expect(unavailable).toBeGreaterThan(3);
    expect(logged).toBeGreaterThanOrEqual(unavailable - 1);
    expect(FN).toContain('reason: "backend not configured"');
  });
});

describe("the screen says why the list is empty", () => {
  it("both chapter fetchers read the reason off the response", () => {
    // Two components fetch chapters — the picker and the sheet. Fixing one
    // would leave the surface a student actually studies from still silent.
    const reads = [
      ...SCREEN.matchAll(/setReason\(list\.length === 0 \? \(d\?\.reason \?\? null\) : null\)/g),
    ];
    expect(reads.length, "expected both fetchers to capture the reason").toBe(2);
  });

  it("renders it in both empty states", () => {
    expect(SCREEN).toContain('data-testid="chapters-reason"');
    expect(SCREEN).toContain('data-testid="sheet-chapters-reason"');
  });

  it("distinguishes a thrown request from an empty answer", () => {
    // "the request did not complete" is a different fact from "no chapters
    // exist for this syllabus", and the catch is the only place that knows.
    expect(SCREEN).toContain("the request did not complete");
  });

  it("keeps the usable instruction as the primary line", () => {
    // The student's next move stays "use whole subject"; the reason is
    // secondary. A diagnostic that buries the instruction is a worse screen.
    expect(SCREEN).toContain("no chapter list available — use whole subject");
  });
});
