/**
 * --kb-inset is a MEASUREMENT, and these guards are about the two properties
 * that make it safe: it is zero whenever a lower layer already subtracted the
 * keyboard, and it never reads layout after writing in the same frame.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "src/lib/keyboardInset.ts"), "utf8");

describe("the measured keyboard inset", () => {
  it("measures the invisible part of the LAYOUT viewport, not innerHeight", () => {
    // innerHeight is what every previous wrong version read. clientHeight is
    // the layout viewport, which is what a lower layer shrinks.
    expect(SRC).toContain("document.documentElement.clientHeight");
    expect(SRC).toContain("docH - vv.height - vv.offsetTop");
    expect(SRC, "innerHeight is back in the measurement").not.toContain("window.innerHeight -");
  });

  it("falls back to zero with no visualViewport API", () => {
    expect(SRC).toMatch(/if \(!vv\) return \{ inset: 0, vvh: 0 \};/);
  });

  it("also publishes --vvh, the visible height itself", () => {
    // AMENDED 2026-08-19: a composed `dvh - inset` height double-subtracted on
    // a real device. --vvh is the visible height rather than a subtraction, so
    // it cannot.
    expect(SRC).toContain('const VVH = "--vvh"');
    expect(SRC).toContain("Math.round(vv.height)");
    expect(SRC).toContain("removeProperty(VVH)");
  });

  it("ignores a pinch-zoomed or degenerate reading", () => {
    expect(SRC).toContain("vv.scale > 1.01");
    expect(SRC).toContain("vv.height > 0");
  });

  it("coalesces into one rAF and writes without reading afterwards", () => {
    expect(SRC).toContain("requestAnimationFrame");
    // The writes are the last statements of the frame: setProperty only,
    // nothing read after them.
    const frame = SRC.slice(SRC.indexOf("const apply"), SRC.indexOf("const schedule"));
    expect(frame).toContain("root.style.setProperty(VAR, `${next.inset}px`)");
    expect(frame, "layout is read after the write").not.toMatch(
      /setProperty[\s\S]*getBoundingClientRect|setProperty[\s\S]*clientHeight/,
    );
  });


  it("listens to both resize and scroll, and cleans the variable up", () => {
    expect(SRC).toContain('addEventListener("resize"');
    expect(SRC).toContain('addEventListener("scroll"');
    expect(SRC).toContain("removeProperty(VAR)");
  });
});
