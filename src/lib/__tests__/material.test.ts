/**
 * THE TWO COPIES OF THE SCALE MUST AGREE.
 *
 * Material's metrics have to exist twice: as CSS custom properties, because
 * that is the only thing Tailwind can generate utilities from, and as
 * TypeScript, because a number that exists only in CSS cannot be read by a
 * test, by a component choosing an elevation, or by a reviewer asking whether
 * 14px is on the ramp.
 *
 * Two copies of a number drift. This parses styles.css and fails the moment
 * they do — the same arrangement storyPricing.ts has against the pricing SQL,
 * for the same reason.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ELEVATION,
  MIN_TOUCH_PX,
  MIN_TYPE_PX,
  SHAPE,
  TYPE,
  WINDOW_CLASSES,
  windowClassFor,
} from "@/design/material";

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, "src/styles.css"), "utf8");

/** Read a custom property's declared value out of the stylesheet. */
function cssVar(name: string): string | null {
  const m = CSS.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

describe("the CSS and the TypeScript describe the same Material scale", () => {
  it("every shape step matches", () => {
    for (const [name, px] of Object.entries(SHAPE)) {
      const declared = cssVar(`radius-m3-${name}`);
      expect(declared, `--radius-m3-${name} is missing from styles.css`).not.toBeNull();
      expect(declared, `--radius-m3-${name} disagrees with SHAPE.${name}`).toBe(`${px}px`);
    }
  });

  it("every elevation shadow matches", () => {
    for (const step of ELEVATION) {
      const declared = cssVar(`shadow-m3-${step.level}`);
      expect(declared, `--shadow-m3-${step.level} is missing`).not.toBeNull();
      expect(declared, `--shadow-m3-${step.level} disagrees with ELEVATION`).toBe(step.shadow);
    }
  });

  it("every elevation level above 0 carries a surface tint, not just a shadow", () => {
    // The whole point. A black shadow on a #0e0f13 ground is invisible, so an
    // elevation utility that sets only box-shadow would be decorative rather
    // than functional in this app's own theme.
    for (const step of ELEVATION) {
      const block = CSS.slice(CSS.indexOf(`@utility m3-elev-${step.level} {`));
      const body = block.slice(0, block.indexOf("}"));
      if (step.level === 0) continue;
      expect(body, `m3-elev-${step.level} has no surface tint`).toContain("color-mix");
      // Rounded, because 0.05 * 100 is 5.000000000000001 in IEEE 754 and the
      // raw product would look for a percentage no stylesheet could contain.
      const pct = Math.round(step.tint * 1000) / 10;
      expect(body, `m3-elev-${step.level} tints by the wrong amount`).toContain(`${pct}%`);
    }
  });

  it("the touch floor matches", () => {
    expect(cssVar("m3-touch-min")).toBe(`${MIN_TOUCH_PX}px`);
  });

  it("the layout grid's margins and gutters match", () => {
    const compact = WINDOW_CLASSES.find((c) => c.name === "compact")!;
    const medium = WINDOW_CLASSES.find((c) => c.name === "medium")!;
    expect(cssVar("m3-margin-compact")).toBe(`${compact.margin}px`);
    expect(cssVar("m3-gutter-compact")).toBe(`${compact.gutter}px`);
    expect(cssVar("m3-margin-medium")).toBe(`${medium.margin}px`);
    expect(cssVar("m3-gutter-medium")).toBe(`${medium.gutter}px`);
  });
});

describe("the scale is internally coherent", () => {
  it("nothing in the type ramp is below the lint rule's floor", () => {
    // oniq/a11y-type-scale rejects anything under 11px. That rule predates
    // this file; if the ramp ever contradicted it, one of the two would be
    // wrong and components would be caught between them.
    for (const [role, spec] of Object.entries(TYPE)) {
      expect(spec.size, `${role} is below the ${MIN_TYPE_PX}px floor`).toBeGreaterThanOrEqual(
        MIN_TYPE_PX,
      );
    }
  });

  it("labelSmall and bodySmall are exactly the sizes the lint rule names", () => {
    // The rule's message quotes these two. If the ramp moved them, the message
    // would be telling people to use a size that no longer exists.
    expect(TYPE.labelSmall.size).toBe(11);
    expect(TYPE.bodySmall.size).toBe(12);
  });

  it("every shape and spacing step sits on the 4dp grid", () => {
    for (const [name, px] of Object.entries(SHAPE)) {
      if (name === "full") continue; // a pill is not a measurement
      expect(px % 4, `SHAPE.${name} (${px}) is off the 4dp grid`).toBe(0);
    }
  });

  it("window classes are ordered and windowClassFor picks the widest match", () => {
    for (let i = 1; i < WINDOW_CLASSES.length; i++) {
      expect(WINDOW_CLASSES[i].min).toBeGreaterThan(WINDOW_CLASSES[i - 1].min);
    }
    expect(windowClassFor(0)).toBe("compact");
    expect(windowClassFor(599)).toBe("compact");
    expect(windowClassFor(600)).toBe("medium");
    expect(windowClassFor(839)).toBe("medium");
    expect(windowClassFor(840)).toBe("expanded");
    expect(windowClassFor(1600)).toBe("extraLarge");
    expect(windowClassFor(99999)).toBe("extraLarge");
  });

  it("elevation levels run 0..5 with tints that only increase", () => {
    expect(ELEVATION.map((e) => e.level)).toEqual([0, 1, 2, 3, 4, 5]);
    for (let i = 1; i < ELEVATION.length; i++) {
      expect(ELEVATION[i].tint).toBeGreaterThan(ELEVATION[i - 1].tint);
    }
  });
});
