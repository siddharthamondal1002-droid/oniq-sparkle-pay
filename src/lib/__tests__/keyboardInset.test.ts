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
    //
    // AMENDED AGAIN 2026-09-07, and this assertion is why the amendment is
    // recorded rather than quietly made. It used to require the literal
    // `Math.round(vv.height)`, pinning --vvh to ONE of the two answers — and
    // 39 production probe rows then showed that answer is wrong on every
    // device whose window shrinks for the IME, because the visual viewport
    // reports a keyboard the layout viewport has already removed. A test that
    // pins an implementation goes red when the implementation is corrected,
    // which is exactly what happened; the fix is to pin the PROPERTY instead.
    //
    // The property: --vvh is a height that was MEASURED, never a subtraction
    // composed here. Both branches return one of the two measured heights.
    // keyboardVisibleHeight.test.ts is what checks WHICH, against the rows.
    expect(SRC).toContain('const VVH = "--vvh"');
    expect(SRC).toContain("export function visibleHeight");
    expect(SRC).toContain("Math.round(m.vvH)");
    expect(SRC).toContain("Math.round(m.docH)");
    expect(SRC).toContain("removeProperty(VVH)");
    // Still not a composition. `docH - kb` in any spelling is the shape that
    // double-subtracted three times; the module only ever RETURNS a measured
    // height, and `raw` stays confined to --kb-inset.
    const decide = SRC.slice(
      SRC.indexOf("export function visibleHeight"),
      SRC.indexOf("let baseDocH"),
    );
    expect(decide, "--vvh became a subtraction again").not.toMatch(/vvH\s*-|docH\s*-\s*(?!m\.)/);
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
