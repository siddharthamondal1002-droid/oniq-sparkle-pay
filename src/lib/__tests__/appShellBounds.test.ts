/**
 * A SCREEN INSIDE THE SHELL IS NOT THE VIEWPORT.
 *
 * Reported 2026-08-17 as "app screen moves in the borders". The shell reserves
 * env(safe-area-inset-top) for the status bar and 0–7rem at the bottom for the
 * nav bar; 38 files under it size themselves to 100vh/100dvh anyway. The page
 * ends up taller than the window by the sum of the two, so screens with
 * nothing to scroll scroll regardless — sticky headers ride up, the layout
 * drags and springs back.
 *
 * The fix is one published number, --app-vh, and two unlayered CSS rules that
 * repoint `min-h-screen` / `h-screen` at it. That only holds while the number
 * the shell SUBTRACTS stays equal to the padding it ADDS, which is what these
 * guards check — a future edit that changes `pb-28` to `pb-24` and forgets the
 * other half puts a silent 1rem of dead scroll back on every top-level tab,
 * and nothing on screen would say so.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SHELL = read("src/routes/_authenticated/app.tsx");
const CSS = read("src/styles.css");
const CHAT = read("src/routes/_authenticated/app.chat.$conversationId.tsx");

/** Tailwind's spacing scale is 0.25rem a step, which is the whole mapping. */
function pbToLength(cls: string): string {
  const n = Number(cls.replace("pb-", ""));
  if (n === 0) return "0px";
  return `${n * 0.25}rem`;
}

describe("the app shell hands screens a height that fits inside it", () => {
  it("publishes --app-vh, net of both the status bar and its own bottom chrome", () => {
    const decl = SHELL.match(/"--app-vh":\s*`([^`]+)`/)?.[1];
    expect(decl, "the shell no longer publishes --app-vh").toBeTruthy();
    expect(decl, "the status-bar inset is not subtracted").toContain("env(safe-area-inset-top)");
    expect(decl, "the bottom chrome is not subtracted").toContain("${chromeBottom}");
  });

  it("subtracts exactly the padding it adds, for all three chrome states", () => {
    // Both ternaries are read out of the source rather than restated here, so
    // this compares the file against itself and cannot drift into agreeing
    // with a stale copy of the values.
    const subtracted = [
      ...SHELL.matchAll(
        /const chromeBottom = showNav \? "([^"]+)" : isChatThread \? "([^"]+)" : "([^"]+)"/g,
      ),
    ][0];
    expect(subtracted, "the chromeBottom ternary changed shape").toBeTruthy();

    const padded = [
      ...SHELL.matchAll(/showNav \? "(pb-\d+)" : isChatThread \? "(pb-\d+)" : "(pb-\d+)"/g),
    ][0];
    expect(padded, "the padding ternary changed shape").toBeTruthy();

    for (let i = 1; i <= 3; i += 1) {
      expect(
        subtracted[i],
        `--app-vh subtracts ${subtracted[i]} where the shell pads ${padded[i]}`,
      ).toBe(pbToLength(padded[i]));
    }
  });
});

describe("min-h-screen and h-screen mean the shell, not the window", () => {
  /** CSS with comments removed, so a brace inside prose cannot skew the depth. */
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

  it("both utilities are repointed at --app-vh with a safe fallback", () => {
    for (const prop of ["min-height", "height"]) {
      const cls = prop === "min-height" ? "min-h-screen" : "h-screen";
      const rule = bare.match(
        new RegExp(`\\[data-app-shell\\]\\s+\\.${cls}\\s*\\{([^}]*)\\}`),
      )?.[1];
      expect(rule, `${cls} is not scoped to the shell`).toBeTruthy();
      expect(rule).toContain(`${prop}: var(--app-vh, 100dvh)`);
    }
  });

  it("the rules sit outside every cascade layer, which is what makes them win", () => {
    // Tailwind's utilities are layered. A layered override would have to win a
    // specificity race inside the layer; an unlayered one wins outright. If
    // these ever get wrapped in @layer the fix silently stops applying, and
    // the symptom is the original bug rather than an error.
    const at = bare.indexOf("[data-app-shell] .min-h-screen");
    expect(at, "the rule is gone").toBeGreaterThan(-1);
    let depth = 0;
    for (let i = 0; i < at; i += 1) {
      if (bare[i] === "{") depth += 1;
      else if (bare[i] === "}") depth -= 1;
    }
    expect(depth, "the shell height rules were nested inside a block/@layer").toBe(0);
  });

  it("leaves the real viewport alone outside the shell", () => {
    // Public routes (auth, legal, blog) are the viewport and must keep saying
    // so. An unscoped rule would shrink them by chrome they do not have.
    expect(bare).not.toMatch(/(?<!\])\s\.min-h-screen\s*\{\s*min-height: var\(--app-vh/);
  });
});

describe("screens that set their own height still fit", () => {
  it("the chat thread takes the status bar off visualViewport height", () => {
    // --vvh is the whole WebView, status bar included. The column lives inside
    // <main>, which is padded by exactly that inset, so using --vvh raw made
    // the thread one status bar too tall and pushed the composer off-screen.
    expect(CHAT).toContain('height: "calc(var(--vvh, 100dvh) - env(safe-area-inset-top))"');
  });

  it("the two full-bleed video screens cancel the inset instead of overflowing", () => {
    // Clips and Reels are the exception: they belong UNDER the status bar and
    // reserve it in their own overlays. Cancelling the shell's padding with a
    // negative margin keeps them 100dvh tall AND keeps the page 100dvh tall —
    // dropping the margin gives a coloured band on top and a status bar's
    // worth of dead scroll underneath.
    for (const p of [
      "src/routes/_authenticated/app.clips.tsx",
      "src/routes/_authenticated/app.chat.reels.tsx",
    ]) {
      const src = read(p);
      expect(src, `${p} lost its full-bleed height`).toContain('height: "100dvh"');
      expect(src, `${p} no longer cancels the shell's top inset`).toContain(
        'marginTop: "calc(-1 * env(safe-area-inset-top))"',
      );
    }
  });
});
