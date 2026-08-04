/**
 * Every modal in the app must be height-bounded.
 *
 * Origin: the Study learner-setup card with "State Boards" expanded is 20
 * options tall. Its overlay centred the card with no height limit, so on a
 * phone it was clipped at BOTH ends with nothing to scroll and the last eight
 * boards — Maharashtra through Telangana, West Bengal among them — could not
 * be reached. A sweep found 48 overlays of that shape and not one was bounded.
 *
 * The fix is a single rule in src/styles.css keyed on layout intent. This test
 * encodes the same classification so the two cannot drift: add a new overlay
 * that centres or bottom-aligns a card and it is bounded automatically; build
 * one the rule cannot see and this fails.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

type Overlay = { file: string; line: number; classes: string; optedOut: boolean };

function overlays(): Overlay[] {
  const found: Overlay[] = [];
  for (const file of tsxFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/className=\{?"([^"]*fixed inset-0[^"]*)"/g)) {
      const before = text.slice(Math.max(0, m.index! - 400), m.index!);
      found.push({
        file: file.slice(SRC.length + 1),
        line: text.slice(0, m.index).split("\n").length,
        classes: m[1],
        // the attribute sits just before className on the same element
        optedOut: /data-full-bleed[^>]*$/.test(before) || before.includes("data-full-bleed"),
      });
    }
  }
  return found;
}

/**
 * Mirrors the selector in src/styles.css. Note `flex-col` is NOT an exclusion:
 * `flex flex-col justify-end` is how several bottom sheets are written
 * (MomentsFeed, app.clips), and treating it as full-bleed let them escape.
 * What separates a modal from a full-screen surface is whether the overlay
 * ALIGNS its child at all — a surface just lets it fill.
 */
const ALIGNMENT = [
  "place-items-center",
  "items-center",
  "items-end",
  "justify-end",
  "justify-center",
];

function boundedByStylesheet(o: Overlay): boolean {
  if (o.optedOut) return false;
  const t = new Set(o.classes.split(/\s+/));
  return ALIGNMENT.some((a) => t.has(a));
}

/** A card-shaped modal: the overlay positions its child rather than letting it fill. */
function isCardModal(o: Overlay): boolean {
  const t = new Set(o.classes.split(/\s+/));
  return ALIGNMENT.some((a) => t.has(a));
}

/**
 * An overlay that aligns its child using a utility the stylesheet does NOT
 * know about — e.g. `place-content-center`. Silence here is the dangerous
 * case: the card is not bounded, and nothing says so. Adding one must force a
 * decision (extend the rule, or mark it data-full-bleed), not pass quietly.
 */
const ALIGNMENT_LIKE = /^(place-(items|content)|items|justify|content)-/;

function usesUnknownAlignment(o: Overlay): boolean {
  if (o.optedOut) return false;
  const t = o.classes.split(/\s+/);
  return t.some((c) => ALIGNMENT_LIKE.test(c) && !ALIGNMENT.includes(c));
}

describe("modal height bounding", () => {
  const all = overlays();

  it("finds the overlays at all (guards against the regex silently breaking)", () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it("bounds every card-shaped modal, or has it explicitly opt out", () => {
    const unbounded = all
      .filter(isCardModal)
      .filter((o) => !boundedByStylesheet(o) && !o.optedOut)
      .map((o) => `${o.file}:${o.line}`);
    expect(unbounded).toEqual([]);
  });

  it("has no overlay aligning its card with a utility the rule cannot see", () => {
    const unknown = all
      .filter(usesUnknownAlignment)
      .map((o) => `${o.file}:${o.line}  [${o.classes.split(/\s+/).filter((c) => ALIGNMENT_LIKE.test(c) && !ALIGNMENT.includes(c)).join(" ")}]`);
    expect(unknown).toEqual([]);
  });

  it("leaves full-bleed surfaces alone (call overlay, camera, media viewers)", () => {
    const fullBleed = ["CallOverlay.tsx", "UpiScannerOverlay.tsx", "PhotoStudio.tsx"];
    for (const name of fullBleed) {
      for (const o of all.filter((x) => x.file.endsWith(name))) {
        expect(boundedByStylesheet(o), `${o.file}:${o.line} must stay unbounded`).toBe(false);
      }
    }
  });

  it("keeps the stylesheet rule and this test in agreement", () => {
    const css = readFileSync(join(SRC, "styles.css"), "utf8");
    expect(css).toContain("data-full-bleed");
    expect(css).toContain("place-items-center");
    expect(css).toContain("overscroll-behavior: contain");
    expect(css).toMatch(/max-height:\s*calc\(100dvh/);
  });
});
