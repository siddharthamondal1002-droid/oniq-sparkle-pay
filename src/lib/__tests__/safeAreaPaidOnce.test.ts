/**
 * THE STATUS BAR IS PAID FOR ONCE, BY THE SHELL.
 *
 * src/routes/_authenticated/app.tsx pads <main> by env(safe-area-inset-top),
 * covering all 45 screens under it. A screen that ADDS the inset again gets two
 * status bars of gap — reported 2026-08-18 from screenshots as a fat, shifting
 * space above the chat header and a thread that would not "fit in".
 *
 * The history matters, because the offending line was correct when it was
 * written. Until 2026-08-17 MainActivity returned WindowInsetsCompat.CONSUMED,
 * which stopped insets reaching the WebView at all: every env(safe-area-inset-*)
 * in this codebase evaluated to ZERO, and the real inset came from native
 * padding. `calc(env(safe-area-inset-top) + 0.75rem)` therefore meant 0.75rem.
 * The edge-to-edge flip let the insets through and turned that same expression
 * into a second full status bar.
 *
 * TWO FORMS, ONLY ONE OF WHICH IS A BUG:
 *
 *   max(3rem, env(safe-area-inset-top))   FINE. 3rem beats any phone's inset,
 *                                         so it resolves to 3rem on top of the
 *                                         shell's padding — exactly what it did
 *                                         before the flip. 17 screens do this.
 *   calc(env(safe-area-inset-top) + X)    BUG. Adds the inset outright, on top
 *                                         of a shell that already added it.
 *
 * So this guard bans the additive form under the authenticated shell and leaves
 * the max() form alone.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src/routes/_authenticated");
const SHELL = join(process.cwd(), "src/routes/_authenticated/app.tsx");

/** Every screen rendered inside the shell's padded <main>. */
function screenFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => f !== "app.tsx");
}

describe("only the shell pays the top inset", () => {
  it("the shell really is the one paying it", () => {
    // If this ever stops being true the whole premise inverts and the screens
    // below would need their insets back — so it is asserted, not assumed.
    const shell = readFileSync(SHELL, "utf8");
    expect(shell, "the shell no longer pads main by the top inset").toContain(
      'paddingTop: "env(safe-area-inset-top)"',
    );
  });

  it("no screen adds env(safe-area-inset-top) on top of it", () => {
    // The additive form only. `max(3rem, env(...))` is deliberately allowed.
    const additive = /calc\(\s*env\(safe-area-inset-top\)\s*\+/;
    const offenders: string[] = [];
    for (const f of screenFiles()) {
      const src = readFileSync(join(DIR, f), "utf8");
      // Strip comments FIRST, and block comments as blocks rather than by
      // leading character. The note explaining this very fix quotes the banned
      // expression in order to explain it, and a line-prefix filter left the
      // middle lines of that note in the "code" — so the guard failed on its
      // own documentation. Quoting the bug is how these comments earn their
      // keep; the stripper has to be the thing that copes.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (additive.test(code)) offenders.push(f);
    }
    expect(
      offenders,
      "these screens add the status-bar inset the shell already added, so they get two of it",
    ).toEqual([]);
  });

  it("full-bleed screens still cancel it rather than adding it", () => {
    // Clips and Reels go UNDER the status bar on purpose. Their negative margin
    // is the opposite operation and must survive this rule.
    for (const f of ["app.clips.tsx", "app.chat.reels.tsx"]) {
      const src = readFileSync(join(DIR, f), "utf8");
      expect(src, `${f} stopped cancelling the shell inset`).toContain(
        'marginTop: "calc(-1 * env(safe-area-inset-top))"',
      );
    }
  });
});
