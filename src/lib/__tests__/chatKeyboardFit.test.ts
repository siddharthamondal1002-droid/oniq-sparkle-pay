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
  it("takes its height from the viewport, with no keyboard term at all", () => {
    // THIRD AND FINAL SHAPE. --vvh was the second attempt and it was wrong the
    // same way as the first: the platform had already resized the viewport for
    // the keyboard, and visualViewport.height then reported what was left
    // AFTER the keyboard on top of that. Reported 2026-08-18 as the same strip
    // -and-dead-band picture as the original bug.
    //
    // The right amount for this file to subtract is zero. --app-vh is the
    // shell's viewport-less-status-bar figure and contains no keyboard maths.
    expect(CODE, "the column is no longer sized by --app-vh").toContain(
      'height: "var(--app-vh, 100dvh)"',
    );
  });

  it("never reintroduces a keyboard-derived height, in any disguise", () => {
    // The two known disguises, plus the general shape. A height that mentions
    // the keyboard at all is the bug, whatever the variable is called.
    const height = /height: "([^"]*)"/g;
    for (const m of CODE.matchAll(height)) {
      expect(m[1], `a height reads the keyboard: ${m[1]}`).not.toMatch(/--kb|--vvh/);
    }
  });

  it("does not publish --vvh at all any more", () => {
    // A correct-looking variable left lying around is how this got made twice.
    // The way to stop a third time is for there to be nothing to reach for.
    expect(CODE, "--vvh is being published again").not.toContain('setProperty("--vvh"');
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

  it("still publishes --kb, because the composer's safe-area padding needs it", () => {
    // The bottom inset must not be added on top of a raised keyboard, so the
    // composer subtracts one from the other. That use was always correct; it
    // was the height calculation that was not.
    expect(CODE).toContain('style.setProperty("--kb"');
    expect(CODE).toContain("env(safe-area-inset-bottom) - var(--kb, 0px)");
  });

  it("cleans up what it publishes when the thread unmounts", () => {
    // A stale --kb left on documentElement would put phantom padding under
    // every later screen's composer. --vvh is no longer published, so there is
    // nothing of it to clean.
    expect(CODE).toContain('removeProperty("--kb")');
    expect(CODE).toContain('removeProperty("--composer-h")');
  });
});
