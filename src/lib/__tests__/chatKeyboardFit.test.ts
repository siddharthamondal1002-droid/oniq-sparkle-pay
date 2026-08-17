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
 * visualViewport.height is immune to the whole argument. It is the space
 * visible right now, whoever shrank it and however many of them did, so it
 * cannot double-count by construction. These guards keep the column sized by
 * that and keep the arithmetic that produced the bug out.
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
  it("takes its height from the visual viewport", () => {
    expect(CODE, "the column is no longer sized by --vvh").toContain(
      'height: "var(--vvh, 100dvh)"',
    );
    expect(CODE, "--vvh is never published").toContain(
      'style.setProperty("--vvh"',
    );
  });

  it("never subtracts the keyboard from a viewport unit again", () => {
    // The exact shape of the bug. Any layer that has already lost the
    // keyboard cannot lose it a second time.
    expect(
      CODE,
      "the double-subtraction is back: screen - keyboard - keyboard",
    ).not.toContain("calc(100dvh - var(--kb");
  });

  it("falls back to 100dvh while pinch-zoomed, rather than to a magnified height", () => {
    // Zoomed, visualViewport.height describes the magnifier, not the layout —
    // sizing the column by it would collapse the thread while the user pans.
    expect(CODE).toContain('if (zoomed) document.documentElement.style.removeProperty("--vvh")');
    expect(CHAT).toContain("vv.scale > 1.01");
  });

  it("still publishes --kb, because the composer's safe-area padding needs it", () => {
    // The bottom inset must not be added on top of a raised keyboard, so the
    // composer subtracts one from the other. That use was always correct; it
    // was the height calculation that was not.
    expect(CODE).toContain('style.setProperty("--kb"');
    expect(CODE).toContain("env(safe-area-inset-bottom) - var(--kb, 0px)");
  });

  it("cleans both custom properties up when the thread unmounts", () => {
    // A stale --vvh left on documentElement would size every later screen to
    // whatever the keyboard was doing when this one closed.
    expect(CODE).toContain('removeProperty("--vvh")');
    expect(CODE).toContain('removeProperty("--kb")');
  });
});
