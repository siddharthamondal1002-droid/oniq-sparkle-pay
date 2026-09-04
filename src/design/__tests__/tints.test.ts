/**
 * A BADGE TINTED WITH A HUE THAT DOES NOT EXIST RENDERS GREY, SILENTLY.
 *
 * [data-tint="pink"] with no matching block in styles.css inherits the base
 * [data-tint] fallback and comes out the same neutral as every other unnamed
 * badge — no error, no warning, and on a screen of twelve badges you would
 * read it as "the design is a bit flat" rather than "one hue is missing". So
 * the two lists are checked against each other here, in both directions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TINTS } from "../tints";

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** Every `[data-tint="x"]` selector in the stylesheet, x captured. */
function declaredTints(): string[] {
  return [...CSS.matchAll(/\[data-tint="([a-z]+)"\]/g)].map((m) => m[1]);
}

describe("the tint contract", () => {
  it("declares a hue for every name a component can pass", () => {
    const declared = new Set(declaredTints());
    const missing = TINTS.filter((t) => !declared.has(t));
    expect(missing, `no [data-tint="…"] block in styles.css for: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("declares no hue that no name can reach", () => {
    const names = new Set<string>(TINTS);
    const orphans = [...new Set(declaredTints())].filter((t) => !names.has(t));
    expect(orphans, `styles.css declares unreachable tints: ${orphans.join(", ")}`).toEqual([]);
  });

  it("gives every hue both inks, so neither theme falls back to the neutral", () => {
    for (const t of TINTS) {
      // Slice the block so a missing ink in ONE hue is not masked by another
      // hue three blocks down that happens to declare it.
      const start = CSS.indexOf(`[data-tint="${t}"]`);
      expect(start, `${t} has no block`).toBeGreaterThan(-1);
      const block = CSS.slice(start, CSS.indexOf("}", start));
      expect(block, `${t} is missing --tint`).toMatch(/--tint:\s*#[0-9a-f]{3,8}/i);
      expect(block, `${t} is missing --tint-ink-light`).toMatch(
        /--tint-ink-light:\s*#[0-9a-f]{3,8}/i,
      );
      expect(block, `${t} is missing --tint-ink-dark`).toMatch(
        /--tint-ink-dark:\s*#[0-9a-f]{3,8}/i,
      );
    }
  });

  it("resolves the light ink under .light, the way the world contract does", () => {
    // Without this rule every badge keeps its DARK ink — a pale pastel glyph
    // on a pale pastel wash, which is the unreadable case.
    expect(CSS).toMatch(/\.light \[data-tint\]\s*\{\s*--tint-ink:\s*var\(--tint-ink-light\);/);
  });
});
