/**
 * Colour contrast, measured against the actual tokens in styles.css.
 *
 * WHY A TEST AND NOT A REVIEW. Contrast is the one accessibility property
 * that is fully computable from the source, and the one most likely to be
 * broken by a well-meant "let's brighten the teal". Light mode's primary was
 * #008f7a until 2026-08-16 and failed at 3.83:1 as text — nobody caught it in
 * a year of design passes, because a designer with good eyesight on a good
 * screen cannot see the difference between 3.8 and 4.5.
 *
 * THE THRESHOLDS ARE WCAG 2.1 AA, which is what the Android guidance cites:
 *   4.5:1  normal-size text
 *   3:1    large text (>=18.66px bold or >=24px), and non-text UI that
 *          carries meaning (WCAG 1.4.11)
 *
 * The parser reads styles.css rather than a duplicated table, so a token
 * edited there is checked here without anyone remembering to mirror it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

/** The `:root {}` block holds dark; `.light {}` holds light. */
function block(name: ":root" | ".light"): string {
  const i = CSS.indexOf(`${name} {`);
  if (i < 0) throw new Error(`${name} block not found in styles.css`);
  return CSS.slice(i, CSS.indexOf("\n}", i));
}

function token(scope: string, name: string): string {
  const m = scope.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`--${name} not found`);
  return m[1].trim();
}

type RGB = [number, number, number];

function parse(value: string): RGB {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
  }
  const rgba = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])] as RGB;
  throw new Error(`cannot parse colour: ${value}`);
}

function alphaOf(value: string): number {
  const m = value.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/i);
  return m ? Number(m[1]) : 1;
}

/** Flatten a translucent colour onto an opaque one — what the eye sees. */
function composite(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK = block(":root");
const LIGHT = block(".light");

/** Dark-mode borders are white over the surface; light-mode are near-black. */
const BORDER_INK: Record<string, RGB> = {
  dark: [255, 255, 255],
  light: [17, 24, 39],
};

describe.each([
  ["dark", DARK],
  ["light", LIGHT],
])("%s mode — text contrast (WCAG AA, 4.5:1)", (mode, scope) => {
  const bg = parse(token(scope, "background"));
  const card = parse(token(scope, "card"));

  it.each([
    ["foreground on background", "foreground", bg],
    ["foreground on card", "foreground", card],
    ["muted-foreground on background", "muted-foreground", bg],
    ["muted-foreground on card", "muted-foreground", card],
    ["primary on background", "primary", bg],
    ["primary on card", "primary", card],
    ["destructive on card", "destructive", card],
  ])("%s", (_label, name, surface) => {
    const r = contrast(parse(token(scope, name)), surface);
    expect(r, `${mode}: ${name} scored ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("a filled primary button's own label is readable", () => {
    // The case that made this whole pass necessary: white on #008f7a was
    // 4.03:1, so every primary CTA in light mode failed while looking fine.
    const r = contrast(parse(token(scope, "primary-foreground")), parse(token(scope, "primary")));
    expect(r, `${mode}: primary-foreground on primary is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

describe.each([
  ["dark", DARK],
  ["light", LIGHT],
])("%s mode — non-text contrast (WCAG 1.4.11, 3:1)", (mode, scope) => {
  const bg = parse(token(scope, "background"));
  const card = parse(token(scope, "card"));

  it("primary works as a UI element against the canvas", () => {
    const r = contrast(parse(token(scope, "primary")), bg);
    expect(r, `${mode}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it("border-strong clears 3:1 on both card and canvas", () => {
    // The border used where the outline IS the control's identity — a text
    // field, an unfilled toggle. --border (the decorative card edge) is
    // deliberately NOT held to this; see the note in styles.css.
    const raw = token(scope, "border-strong");
    const ink = BORDER_INK[mode];
    const a = alphaOf(raw);
    for (const [name, surface] of [
      ["card", card],
      ["background", bg],
    ] as const) {
      const r = contrast(composite(ink, a, surface), surface);
      expect(r, `${mode}: border-strong on ${name} is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the plain border is at least visible, even though it is not held to 3:1", () => {
    // A floor, not the AA bar. It was 1.52:1 before this pass; anything that
    // drops it back toward invisible is a regression worth failing on.
    const a = alphaOf(token(scope, "border"));
    const r = contrast(composite(BORDER_INK[mode], a, card), card);
    expect(r, `${mode}: border on card is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.4);
  });
});

describe("the accessibility mechanisms are actually wired up", () => {
  it("honours prefers-reduced-motion", () => {
    // WCAG 2.3.3. There was no handling at all before 2026-08-16 — the
    // pinging LIVE dot, the Pulse ticker and every fade-up ran regardless.
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(CSS).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });

  it("ships a 48px hit-slop utility that does not resize the visual", () => {
    // Material: 48dp "even if this extends past the UI element visual".
    expect(CSS).toMatch(/@utility tap/);
    expect(CSS).toMatch(/\.tap::after/);
    // Symmetric geometry, no transform: the first version used a
    // [dir="rtl"] override that the build silently stripped, which shifted
    // every hit area sideways. Keep it direction-agnostic.
    const rule = CSS.slice(
      CSS.indexOf(".tap::after"),
      CSS.indexOf("}", CSS.indexOf(".tap::after")),
    );
    expect(rule, "the hit-slop grew a direction-dependent transform again").not.toMatch(
      /transform|inset-inline/,
    );
    expect(rule).toMatch(/inset:\s*calc\(50% - 24px\)/);
  });

  it("the Android shell passes the system font scale into the WebView", () => {
    // WebView ignores Settings > Display > Font size unless textZoom is set
    // explicitly, so without this the OS control does nothing whatsoever.
    const main = readFileSync(
      join(process.cwd(), "android/app/src/main/java/com/oniqhub/app/MainActivity.java"),
      "utf8",
    );
    expect(main).toMatch(/setTextZoom/);
    expect(main).toMatch(/configuration\.fontScale|getConfiguration\(\)\.fontScale/);
  });
});

/* ------------------------------------------------------- the world accents
 * MEASURED IN A BROWSER 2026-09-04, and it is why this block exists. An
 * active OniqChip in the `create` world drew white on a cyan-to-pink gradient
 * and was barely readable — 1.7:1 at the cyan end. `--world-on` is #ffffff for
 * almost every world, and the one exception had already been overridden to a
 * dark ink, so somebody had hit this before and fixed it one world at a time.
 *
 * The chip's "soft" tone (a pale wash of the world, with the world's own ink
 * on top) is what the owner's reference draws for OPTION chips, and it is the
 * legible one. This block holds BOTH treatments to the standard so neither
 * can drift, and it names each world in the failure message — a bare "world
 * contrast failed" would send the next person hunting through twelve blocks.
 * -------------------------------------------------------------------------- */

/** Every `[data-world="x"]` block, with the tokens it sets. */
function worldBlocks(): { name: string; a: RGB; b: RGB; inkLight: RGB; inkDark: RGB }[] {
  const out: { name: string; a: RGB; b: RGB; inkLight: RGB; inkDark: RGB }[] = [];
  for (const m of CSS.matchAll(/\[data-world="([a-z-]+)"\]\s*\{([^}]*)\}/g)) {
    const body = m[2];
    const pick = (n: string) => body.match(new RegExp(`--${n}:\\s*([^;]+);`))?.[1]?.trim();
    const a = pick("world-a");
    const b = pick("world-b");
    const inkLight = pick("world-ink-light");
    const inkDark = pick("world-ink-dark");
    if (!a || !b || !inkLight || !inkDark) continue;
    out.push({
      name: m[1],
      a: parse(a),
      b: parse(b),
      inkLight: parse(inkLight),
      inkDark: parse(inkDark),
    });
  }
  return out;
}

const WORLDS = worldBlocks();

/** `bg-world-soft`: 16% of the accent mixed into the card. */
function softFill(accent: RGB, card: RGB): RGB {
  return accent.map((c, i) => Math.round(c * 0.16 + card[i] * 0.84)) as RGB;
}

describe("world accents", () => {
  it("finds every world block, so a broken parser cannot pass vacuously", () => {
    expect(WORLDS.length).toBeGreaterThanOrEqual(8);
    expect(WORLDS.map((w) => w.name)).toContain("create");
  });

  describe.each([
    ["light", LIGHT, "inkLight" as const],
    ["dark", DARK, "inkDark" as const],
  ])("%s mode — the soft chip a person actually reads", (mode, scope, inkKey) => {
    const card = parse(token(scope, "card"));
    it.each(WORLDS.map((w) => [w.name, w] as const))("%s", (name, w) => {
      // The worst case is the END OF THE GRADIENT THE INK LIKES LEAST, so both
      // stops are checked rather than an average that hides one of them.
      for (const stop of [w.a, w.b]) {
        const r = contrast(w[inkKey], softFill(stop, card));
        expect(
          r,
          `${mode}: ${name} ink on its soft fill scored ${r.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});
