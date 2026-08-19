/**
 * THE KEYBOARD MUST BE SUBTRACTED ONCE, BY EXACTLY ONE LAYER.
 *
 * Reported 2026-08-17: opening a chat's keyboard squeezed the thread into a
 * strip at the top of the screen with a large dead band under the composer.
 * That band was not a styling accident — it was the keyboard's height,
 * removed twice.
 *
 * The two layers each believed the other was not handling it:
 *
 *   MainActivity pads the WebView by the IME inset, so the page's own 100dvh
 *   has ALREADY lost the keyboard.
 *
 *   The chat then computed `calc(100dvh - var(--kb))`, where --kb is derived
 *   from `window.innerHeight - visualViewport.height`. The comment justifying
 *   that said --kb "resolves to 0 wherever the platform already shrinks the
 *   layout viewport (Android with interactive-widget=resizes-content)" — true
 *   of Chrome, and NOT of the Android WebView, which does not implement
 *   interactive-widget at all. There innerHeight stays full while
 *   visualViewport.height shrinks, so --kb is the whole keyboard.
 *
 * Result: screen − keyboard − keyboard.
 *
 * THE FIRST FIX WAS ALSO WRONG, and its justification is worth keeping as a
 * warning. It read: "visualViewport.height is immune to the whole argument. It
 * is the space visible right now, whoever shrank it and however many of them
 * did, so it cannot double-count by construction."
 *
 * It double-counted. visualViewport.height is the space left AFTER the
 * keyboard, so using it as the column height subtracts the keyboard just as
 * surely as `- var(--kb)` did — only with no minus sign to give it away. The
 * same strip-and-dead-band picture came back on 2026-08-18.
 *
 * What both attempts missed is that there was nothing here to fix. The
 * keyboard is handled entirely by the platform, twice over and independently:
 * MainActivity pads the content view by the IME inset on native, and
 * `interactive-widget=resizes-content` shrinks the layout viewport on web. So
 * the correct amount for the chat to subtract is ZERO, and the column takes
 * --app-vh — the viewport less the status bar, no keyboard term at all.
 *
 * These guards keep it that way, and forbid any height that so much as
 * mentions the keyboard, whatever the variable ends up being called.
 *
 * AND THE THIRD FIX STILL WAS NOT ENOUGH, which is the real lesson here.
 * Native was running BOTH platform mechanisms at once: the viewport meta
 * carried interactive-widget=resizes-content unconditionally, so the WebView
 * shrank its own layout viewport, while MainActivity ALSO padded the content
 * view by the same IME inset. 100dvh reached the chat already at about
 * (screen - 2x keyboard), so every fix in this file was correcting a number
 * that was wrong before any stylesheet ran.
 *
 * The claim repeated through this file's history — that "the Android WebView
 * does not implement interactive-widget" — is false. It has since Chromium
 * 108, and believing it is precisely what allowed two layers to stack. The
 * meta is now applied for the web only; see viewportMetaOnce.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CHAT = readFileSync(
  join(ROOT, "src/routes/_authenticated/app.chat.$conversationId.tsx"),
  "utf8",
);

/** Code lines only — the comments here quote the bug in order to explain it. */
const CODE = CHAT.split("\n")
  .filter((l) => {
    const t = l.trimStart();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");

describe("the chat column is sized by what is actually visible", () => {
  const EXPR = 'height: "calc(var(--vvh, var(--app-vh, 100dvh)) - env(safe-area-inset-top))"';

  it("takes its height from the MEASURED visible height, not a subtraction", () => {
    // FIFTH SHAPE, and the last one that can be wrong about who subtracted the
    // keyboard, because it does not subtract it. `--app-vh - --kb-inset` still
    // assumed exactly one of the two carried the keyboard; on the shipped
    // device both did, and the thread collapsed to a strip again (screenshot
    // 2026-08-19 17:07). --vvh is visualViewport.height: whatever combination
    // of native padding, Chromium resizing and overlays-content produced the
    // visible area, that IS the area.
    expect(CODE, "the column is no longer sized by the measured visible height").toContain(EXPR);
  });

  it("never composes a keyboard subtraction into a height again", () => {
    // Only --vvh may appear in a height, and only on its own. --kb-inset,
    // --kb, and any `dvh - keyboard` arithmetic stay banned here: every one of
    // them depends on knowing which layer already took the keyboard off.
    const height = /height: "([^"]*)"/g;
    for (const m of CODE.matchAll(height)) {
      const expr = m[1] ?? "";
      const banned = expr.replace(/--vvh/g, "");
      expect(banned, `a height reads the keyboard: ${expr}`).not.toMatch(/--kb/);
    }
  });

  it("does not publish viewport variables from the route", () => {
    // Measuring belongs in src/lib/keyboardInset.ts, once.
    expect(CODE, "--vvh is being published from the route again").not.toContain(
      'setProperty("--vvh"',
    );
  });

  it("never subtracts the keyboard from a viewport unit again", () => {
    // The exact shape of the bug. Any layer that has already lost the
    // keyboard cannot lose it a second time.
    expect(CODE, "the double-subtraction is back: screen - keyboard - keyboard").not.toContain(
      "calc(100dvh - var(--kb",
    );
  });


  it("still ignores a pinch-zoomed viewport when measuring the keyboard", () => {
    // Zoomed, visualViewport.height describes the magnifier rather than the
    // layout. The column no longer reads it at all, so it can no longer
    // collapse while panning — but --kb is still derived from it, and a
    // magnified reading there would put phantom padding under the composer.
    expect(CHAT).toContain("vv.scale > 1.01");
    // Written as intent rather than as one exact expression. The condition
    // gained a second disqualifier on 2026-08-18 — a reading with vv.height
    // at 0 turned the whole window into "keyboard" and fired the probe three
    // times on something that was not one — and pinning the literal text made
    // that correction look like a regression. What must hold is that a zoomed
    // viewport still yields no inset.
    expect(CODE, "a pinch-zoomed viewport no longer zeroes the inset").toMatch(
      /const inset = zoomed[^;]*\? 0 :/,
    );
  });

  it("refuses a degenerate viewport reading instead of calling it a keyboard", () => {
    // vv.height of exactly 0 is the absence of a measurement, not a keyboard
    // filling the screen. Believing it published --kb equal to the entire
    // window and walked past the probe's "a keyboard is up" guard.
    expect(CODE, "a zero-height visualViewport is trusted again").toContain("vv.height > 0");
    expect(CODE, "an implausibly large keyboard is trusted again").toContain(
      "window.innerHeight * 0.9",
    );
  });

  it("publishes NO keyboard measurement to CSS at all", () => {
    // The answer came from the file's own history, not a fourth theory.
    // Between 6c16f217 (2026-07-02) and b0363564 (2026-08-11) this component
    // ran no viewport JavaScript whatsoever and the thread was smooth for six
    // weeks. --kb, --vvh and the column arithmetic all arrived in b0363564,
    // the same commit that put interactive-widget in the meta — and that is
    // the day it started collapsing into a strip.
    //
    // So nothing here measures the keyboard for CSS any more. The composer
    // pays a plain safe-area inset, exactly as it did for those six weeks.
    expect(CODE, "--kb is being published again").not.toContain('setProperty("--kb"');
    // AMENDED 2026-08-19: the only keyboard variable this file may read is
    // --kb-inset, and only in the column height (guarded above). The old --kb
    // — innerHeight minus visualViewport, i.e. an assumed keyboard — stays
    // banned, and the composer still pays a plain safe-area inset.
    expect(CODE, "the old assumed --kb is back").not.toMatch(/var\(--kb[),\s]/);
    const composerPad = CODE.match(/paddingBottom: "([^"]*)"/g) ?? [];
    for (const p of composerPad) {
      expect(p, `the composer is doing keyboard arithmetic again: ${p}`).not.toContain("--kb");
    }
    expect(CODE, "the composer lost its safe-area padding entirely").toContain(
      "calc(0.75rem + env(safe-area-inset-bottom))",
    );
  });

  it("still cleans up the one variable it does publish", () => {
    // --composer-h is a measurement of the composer, not of the keyboard —
    // the jump-to-latest pill sits above it. A stale one would strand that
    // pill on every later screen.
    expect(CODE).toContain('setProperty(\n          "--composer-h"');
    expect(CODE).toContain('removeProperty("--composer-h")');
    expect(CODE, "a stale --kb cleanup remains for a variable never set").not.toContain(
      'removeProperty("--kb")',
    );
  });
});
