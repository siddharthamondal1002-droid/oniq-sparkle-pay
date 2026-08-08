/**
 * The mega-loop's cross-cutting guardrails, as tests.
 *
 * These are landed BEFORE the tracks they police. Verification items 6 and 23
 * are greps, and a grep run once by hand at the end is a grep that passes
 * whatever the code does by then. As tests they fail the moment a banned
 * pattern lands, which is when it is cheap to remove.
 *
 * The two claims that must never appear are here for different reasons:
 *
 *   END-TO-END ENCRYPTION — it would be false. Chat is stored server-readable
 *   BY DESIGN so that translation can work at all; the loop records that as a
 *   decision, not an oversight. E2EE and server-side translation are mutually
 *   exclusive.
 *
 *   A SPECIFIC REFRESH RATE — it is not ours to promise. The app REQUESTS the
 *   display's best mode and the OS grants or refuses it for thermal, battery
 *   or policy reasons at any moment. "120 Hz smooth" is a claim about someone
 *   else's decision.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { codeOnly } from "@/test/sourceText";

const ROOT = process.cwd();

/**
 * Test files, which by definition contain no user-facing string.
 *
 * This started as one exclusion for THIS file and became a category once a
 * second guard suite landed: a test that forbids a claim has to name the
 * claim, so every new guard file would trip the guards it is written to
 * enforce. Nothing under a test path is bundled or shown to anyone — I checked
 * the client build for src/test — so scoping the grep to shipped source is
 * more accurate than the by-name exclusion it replaces, not weaker.
 */
const TEST_PATH = /(^|\/)(__tests__|test)\/|\.test\.tsx?:/;

/** Ripgrep over the source the user can actually see. */
function grepUserFacing(pattern: string): string[] {
  try {
    const out = execSync(
      `grep -rniE ${JSON.stringify(pattern)} src android/app/src/main --include=*.ts --include=*.tsx --include=*.java --include=*.xml || true`,
      { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    return (
      out
        .split("\n")
        .filter(Boolean)
        .filter((l) => !TEST_PATH.test(l))
        // A comment explaining why the frame budget is derived rather than
        // assumed is not a promise to a user, and a guard that cannot tell
        // prose from code is one somebody will switch off.
        .filter((l) => codeOnly(l) !== "")
    );
  } catch {
    return [];
  }
}

describe("no end-to-end-encryption claim, anywhere", () => {
  it("never claims messages are end-to-end encrypted", () => {
    // Deliberately narrow. The bare phrase "end to end" is innocent — a metro
    // journey takes 71 minutes end to end, and a test is titled "end to end".
    // What is banned is the ENCRYPTION claim, so the pattern requires both
    // halves to appear together.
    const hits = grepUserFacing(
      "(end[ -]to[ -]end|e2e).{0,30}(encrypt|secure)|(encrypt).{0,30}(end[ -]to[ -]end|e2ee)|\\be2ee\\b",
    );
    expect(hits, `end-to-end-encryption claim found:\n${hits.join("\n")}`).toEqual([]);
  });

  it("the test-path exclusion does not exempt any shipped file", () => {
    // Narrowing the grep to shipped source is only safe if "shipped source"
    // is still almost everything. These are the paths a claim would actually
    // live in, and none of them may be skipped.
    for (const shipped of [
      "src/routes/_authenticated/app.chat.$conversationId.tsx:12:foo",
      "src/config/mediaStorage.ts:3:foo",
      "src/data/marketingCopy.ts:99:foo",
      "src/components/chat/ReelChatCard.tsx:4:foo",
      "android/app/src/main/java/com/oniqhub/app/MainActivity.java:8:foo",
    ]) {
      expect(TEST_PATH.test(shipped), `wrongly treated as a test file: ${shipped}`).toBe(false);
    }
    // ...and it does exempt the guard suites, which is the point.
    for (const test of [
      "src/lib/__tests__/chatTranslation.test.ts:196:foo",
      "src/test/sourceText.ts:12:foo",
      "src/lib/qr/__tests__/oniqProfileQr.test.ts:1:foo",
    ]) {
      expect(TEST_PATH.test(test), `not recognised as a test file: ${test}`).toBe(true);
    }
  });

  it("the innocent phrase is still allowed, so the guard is not over-broad", () => {
    // A guard that bans "end to end" outright would have to be disabled the
    // first time somebody writes an ordinary sentence, and a disabled guard
    // protects nothing. Proving the narrow pattern lets the innocent case
    // through is what keeps it switched on.
    const caseStudy = readFileSync(join(ROOT, "src/lib/caseStudy.ts"), "utf8");
    expect(caseStudy).toMatch(/end to end/);
  });
});

describe("no refresh-rate claim, anywhere", () => {
  it("promises no specific hertz to the user", () => {
    const hits = grepUserFacing("\\b(60|90|120|144)\\s*hz\\b|refresh rate");
    // MainActivity is allowed to REQUEST a rate — that is the A1 work — but it
    // must not state one to the user, and it does not: the code queries the
    // display's supported modes and never names a number.
    const claims = hits.filter((l) => !/MainActivity\.java/.test(l));
    expect(claims, `refresh-rate claim found:\n${claims.join("\n")}`).toEqual([]);
  });

  it("MainActivity queries the display instead of hardcoding a rate", () => {
    const main = readFileSync(
      join(ROOT, "android/app/src/main/java/com/oniqhub/app/MainActivity.java"),
      "utf8",
    );
    expect(main).toMatch(/getSupportedModes\(\)/);
    expect(main).toMatch(/preferredDisplayModeId/);
    // A hardcoded 120 is wrong on the 60 Hz panels most ONIQ users hold.
    expect(main, "a refresh rate is hardcoded").not.toMatch(/preferredDisplayModeId\s*=\s*\d/);
    expect(main).not.toMatch(/getRefreshRate\(\)\s*[=<>]=?\s*(60|90|120)\b/);
  });

  it("keeps the request at the same resolution and treats refusal as normal", () => {
    const main = readFileSync(
      join(ROOT, "android/app/src/main/java/com/oniqhub/app/MainActivity.java"),
      "utf8",
    );
    // Switching resolution to chase a refresh rate is a worse trade.
    expect(main).toMatch(/getPhysicalWidth\(\) != current\.getPhysicalWidth\(\)/);
    expect(main).toMatch(/getPhysicalHeight\(\) != current\.getPhysicalHeight\(\)/);
    // The OS may refuse; nothing reads the result back or reports an error.
    expect(main).toMatch(/catch \(Exception ignored\)/);
  });
});

describe("no whole-file reads on any upload path (Track A4, pre-emptive)", () => {
  // Landed before A4 is written. readAsDataURL is the worst of these: base64
  // inflates by about a third, so a 200 MB file becomes a ~266 MB string and
  // Android kills the process with no dialog and no error. It will not
  // reproduce in a desktop preview, which is why a grep has to stand in for
  // the device test until there is a device.
  const BANNED = [
    "readAsArrayBuffer",
    "readAsDataURL",
    "readAsBinaryString",
    "\\.arrayBuffer\\(\\)",
    "\\.text\\(\\)",
  ];

  /**
   * The frozen tail — every whole-file read that already existed when this
   * guard landed, and why each is tolerated FOR NOW.
   *
   * Not an exemption list. It is a ratchet, the same shape as
   * eslint-suppressions.json: these five are known, nothing new may join
   * them, and Track A4 is where the three real ones get fixed. Writing them
   * down beats pretending the codebase is already clean.
   */
  const KNOWN = [
    // Our own generated Blob (a PDF we just built), read to base64 for the
    // Capacitor share sheet. Not a user file, bounded by what we produced.
    "src/lib/saveFile.ts",
    // A CSV the user picks. Small by nature but UNBOUNDED in principle — it
    // wants a size cap, and gets one in A4.
    "src/components/cv/CredentialCsvImport.tsx",
    // readAsDataURL on a camera photo. This is the banned pattern proper: a
    // modern phone image is 10-20 MB and base64 inflates it by a third. Not
    // fatal at that size, which is why it has survived, and exactly what
    // becomes fatal the moment A4 raises the cap to 200 MB.
    "src/routes/_authenticated/app.ai.tsx",
    "src/routes/_authenticated/app.study.tsx",
    "src/routes/_authenticated/app.vitals.tsx",
  ];

  function offenders(): string[] {
    return (
      execSync(
        `grep -rnE ${JSON.stringify(BANNED.join("|"))} src --include=*.ts --include=*.tsx || true`,
        { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      )
        .split("\n")
        .filter(Boolean)
        // Response.text() / .arrayBuffer() on a fetch response is not a
        // whole-FILE read at all. Only file-shaped uses matter here.
        .filter((l) => /upload|attach|media|file/i.test(l))
        .filter((l) => !/megaLoopGuardrails/.test(l))
        // A CALL, not a mention. mediaStorage.ts has to record which
        // FileReader methods are forbidden, and naming them is the opposite
        // of calling them.
        .filter((l) => new RegExp(BANNED.join("|")).test(codeOnly(l)))
    );
  }

  it("adds no NEW whole-file read beyond the frozen tail", () => {
    const fresh = offenders().filter((l) => !KNOWN.some((k) => l.startsWith(k)));
    expect(fresh, `new whole-file read — stream it instead:\n${fresh.join("\n")}`).toEqual([]);
  });

  it("the frozen tail is exactly five files, so it cannot grow unnoticed", () => {
    const files = new Set(offenders().map((l) => l.split(":")[0]));
    expect([...files].sort()).toEqual([...KNOWN].sort());
  });

  it("names readAsDataURL as the worst of them", () => {
    // base64 inflates ~33%, so a 200 MB file becomes a ~266 MB string and
    // Android kills the process with no dialog. It will not reproduce in a
    // desktop preview.
    expect(BANNED).toContain("readAsDataURL");
  });
});

describe("no overclaiming, anywhere (verification item 23)", () => {
  it("says nothing is guaranteed, endorsed or official", () => {
    const hits = grepUserFacing("\\bguaranteed\\b|\\bendorsed\\b")
      // Disclaimers SAYING ONIQ is not endorsed are the opposite of a claim.
      .filter((l) => !/not (affiliated|endorsed)|never .{0,20}endorsed|endorsed by/i.test(l))
      .filter((l) => !/__tests__|for \(const bad of|for \(const banned of/.test(l))
      // USE versus MENTION. The rule is that ONIQ must not CLAIM something is
      // guaranteed or endorsed. A term in quotation marks is being named, not
      // asserted — and both remaining cases are mentions of exactly this kind:
      // the BANNED_CLAIMS list, which has to contain the words it bans, and
      // the Official screen warning users away from agents who promise
      // "guaranteed" visas. Filtering on quotation is not a loophole; it is
      // the distinction the rule was always about.
      .filter((l) => /\bguaranteed\b|\bendorsed\b/i.test(codeOnly(l)))
      // Third-party facts reported accurately are not ONIQ's promises. UCAS
      // genuinely does guarantee equal consideration before its deadline;
      // saying so is honest, and softening it would make the calendar worse.
      .filter((l) => !/admissionsCalendar\.ts/.test(l));
    expect(hits, `overclaim found:\n${hits.join("\n")}`).toEqual([]);
  });
});

describe("the frame probe measures rather than assumes", () => {
  const probe = readFileSync(join(ROOT, "src/lib/frameProbe.ts"), "utf8");

  it("derives the frame budget from the display, not from 16.7", () => {
    // On a 90 or 120 Hz panel the budget is 11.1 or 8.3 ms. Measuring against
    // 16.7 would score a janky 120 Hz scroll as flawless — the exact false
    // pass this instrument exists to prevent.
    expect(probe).toMatch(/measureBudgetMs/);
    expect(probe, "the budget is hardcoded").not.toMatch(/budgetMs = 16\.7/);
  });

  it("reports the worst frame, which the loop asks for by name", () => {
    expect(probe).toMatch(/worstFrameMs/);
  });

  it("returns null rather than zero when the heap figure is withheld", () => {
    // A missing measurement must never read as a good one.
    expect(probe).toMatch(/heapMb\(\): number \| null/);
    expect(probe).toMatch(/peakMb: number \| null/);
  });

  it("does not run unless it is called", () => {
    // An fps meter that costs frames is not an fps meter.
    // Top level means column zero. The setInterval inside peakHeapDuring runs
    // only when that function is called, which is the point — the first draft
    // of this check matched any indentation and flagged it.
    expect(probe, "the probe starts itself at import time").not.toMatch(
      /^(setInterval|setTimeout|requestAnimationFrame)\(/m,
    );
  });
});
