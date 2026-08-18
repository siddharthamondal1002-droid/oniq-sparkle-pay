/**
 * THE APP MUST NEVER PAN SIDEWAYS INSIDE ITS OWN WINDOW.
 *
 * Four screenshots, 2026-08-18 15:47: the whole app dragged left — bubbles
 * cut off at the left edge, a black band down the right where the wallpaper
 * ends, the composer's mic button pushed clean off the screen, and in two of
 * them the header ridden up underneath the status-bar clock.
 *
 * The chain: an <input> will not shrink below its intrinsic size (~20
 * characters) unless every flex ancestor grants min-width: 0, because flex
 * items default min-width to auto. On a 384-CSS-px phone the composer row —
 * paperclip + emoji + that floor + circle-dot + mic — is wider than the
 * screen. That one row made the DOCUMENT wider than the viewport, and the
 * Android WebView then lets the user pan the entire app inside its window:
 * "the screen moves in the borders", the complaint this session opened with.
 *
 * Three legs, and each is guarded because each fails independently:
 *  1. the input and its field container yield (min-w-0) so the row fits;
 *  2. the root refuses horizontal overflow outright (overflow-x: clip), so
 *     the NEXT too-wide element cannot reopen the pan;
 *  3. the chat snaps the root back to (0,0) when the viewport settles, so a
 *     scroll offset acquired during a keyboard cannot outlive it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CHAT = readFileSync(
  join(ROOT, "src/routes/_authenticated/app.chat.$conversationId.tsx"),
  "utf8",
);
const CSS = readFileSync(join(ROOT, "src/styles.css"), "utf8");

const CODE = CHAT.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

describe("the composer row fits the screen", () => {
  it("the input yields instead of forcing the row wide", () => {
    const input = /data-testid="chat-input"[\s\S]{0,900}?className="([^"]*)"/.exec(CHAT)?.[1];
    expect(input, "the chat input could not be found").toBeTruthy();
    expect(input, "the input reverts to its ~20ch intrinsic floor").toContain("min-w-0");
  });

  it("the field container yields too — min-w-0 must hold on every flex level", () => {
    // min-w-0 on the input alone does nothing if the container between it and
    // the row still refuses to shrink.
    const field = /className="relative flex ([^"]*)items-center gap-2 rounded-\[22px\]/.exec(
      CHAT,
    )?.[1];
    expect(field, "the composer field container could not be found").toBeTruthy();
    expect(field, "the field container no longer yields").toContain("min-w-0");
  });
});

describe("the root refuses to pan", () => {
  it("clips horizontal overflow on html and body, for every direction", () => {
    // The RTL-only rule was already there; LTR — every current user — had
    // nothing. `clip` and not `hidden`: hidden makes body a scroll container
    // and changes what position: sticky sticks to.
    // Anchor on the overscroll rule — styles.css has more than one html,body
    // block, and the first is about background colours.
    const rule = /html,\s*body\s*\{[^{}]*overscroll-behavior-x: none;[\s\S]{0,1200}?\}/.exec(
      CSS,
    )?.[0];
    expect(rule, "the overscroll html,body rule is gone").toBeTruthy();
    expect(rule, "the root can scroll horizontally again").toContain("overflow-x: clip");
  });

  it("the chat snaps the root back to origin when the viewport settles", () => {
    // The document offset acquired while a keyboard resized things survives
    // the keyboard's dismissal — that is the header stuck under the clock.
    expect(CODE, "the root-scroll snap-back is gone").toContain("window.scrollTo(0, 0)");
    expect(CODE, "the snap-back stopped respecting pinch-zoom panning").toMatch(
      /!zoomed && \(window\.scrollX !== 0 \|\| window\.scrollY !== 0\)/,
    );
  });
});
