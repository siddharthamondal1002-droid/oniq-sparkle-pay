/**
 * The device-check screen must never turn a missing measurement into a pass.
 *
 * This screen exists because six [HW] items could not be verified from a
 * desktop. The failure mode it invites is subtle and worse than not having
 * built it: an instrument that renders "0" for an unavailable heap reading, or
 * scores frames against an assumed 16.7 ms, produces confident numbers that
 * are wrong — and a wrong number in a report is harder to undo than a blank.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const ROOT = process.cwd();
const DIAG = "src/routes/_authenticated/app.diag.tsx";
const src = readFileSync(join(ROOT, DIAG), "utf8");
const code = stripComments(src);

describe("the instrument never fakes a reading", () => {
  it("shows a missing heap figure as missing, not as zero", () => {
    // heapMb() returns null where the browser withholds it. Rendering that as
    // 0 MB would read as "we measured, and it was tiny".
    expect(code).toMatch(/heapNow === null/);
    expect(src).toMatch(/not exposed by this browser/);
    expect(src).toMatch(/missing measurement, not a good one/);
  });

  it("warns that a still screen scores perfectly", () => {
    // The probe measures the frames it sees. Tapping start and not scrolling
    // yields a flawless result that means nothing at all.
    expect(src).toMatch(/scroll/i);
    expect(src).toMatch(/still screen reads as perfect|proves nothing/i);
  });

  it("says the heap figure is not process memory", () => {
    // performance.memory is the JS heap. Native-side buffering — the exact
    // thing a 200 MB upload might do — will not appear in it.
    expect(src).toMatch(/not process memory|JS heap only/i);
  });

  it("names the checks it cannot perform at all", () => {
    for (const needed of [/merchant UPI scan/i, /profile scan/i, /resume/i]) {
      expect(src, `missing human-only check: ${needed}`).toMatch(needed);
    }
  });
});

describe("no claim of a specific refresh rate or speed", () => {
  it("promises no hertz", () => {
    // Same rule as everywhere else: the app REQUESTS the display's best mode
    // and the OS grants or refuses it. Reporting a measured fps is fine;
    // promising one is not.
    expect(code).not.toMatch(/\b(60|90|120|144)\s*hz\b/i);
  });

  it("does not describe the app as fast, smooth or optimised", () => {
    // A1 changed how many rows mount. Whether that is faster on a real phone
    // is unmeasured, and this screen is where the temptation to assert it
    // would land.
    expect(code).not.toMatch(/\b(buttery|blazing|silky|lightning)\b/i);
    expect(src).not.toMatch(/now (much )?(faster|smoother)/i);
  });

  it("says desktop numbers do not count", () => {
    expect(src).toMatch(/desktop preview mean nothing|rather than reporting them as passed/i);
  });
});

describe("it stays an instrument, not a feature", () => {
  it("is not linked from the app shell", () => {
    // Reached by typing /app/diag. A tile would put a debug screen in front of
    // users who have no use for it.
    const shell = readFileSync(join(ROOT, "src/routes/_authenticated/app.index.tsx"), "utf8");
    expect(shell).not.toMatch(/app\/diag/);
  });

  it("reads the frame budget from the probe rather than hardcoding one", () => {
    expect(code).toMatch(/report\.budgetMs/);
    expect(code).not.toMatch(/16\.7/);
  });
});
