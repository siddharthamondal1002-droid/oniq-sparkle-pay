/**
 * EXACTLY ONE MECHANISM SUBTRACTS THE KEYBOARD, ON EVERY PLATFORM.
 *
 * AMENDED 2026-08-19 (owner decision). The previous version of this file
 * banned `interactive-widget` from the static meta and required native to
 * strip it at runtime, because native ALSO padded by the IME inset and the
 * two together subtracted the keyboard twice (18 Aug probe: 832 − 310 = 522
 * view, innerHeight 211 = 522 − 311).
 *
 * `interactive-widget=overlays-content` removes the duplicate at the source:
 * Chromium stops resizing the layout viewport for the IME entirely.
 *
 *   installed build (MainActivity still pads): WebView 522 already sits above
 *     the keyboard; clientHeight = visualViewport = 522; --kb-inset 0. One
 *     subtraction, native's.
 *   pending build (no padding): WebView 832, visualViewport 521, --kb-inset
 *     311, subtracted once by the chat column. One subtraction, ours.
 *
 * So the token is now REQUIRED, on both platforms, and --kb-inset remains the
 * only web-side keyboard term. A WebView that does not know the token ignores
 * it and keeps today's behaviour.
 *
 * MainActivity stays out of the keyboard business permanently — those guards
 * are unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const rootTsx = readFileSync(join(ROOT, "src/routes/__root.tsx"), "utf8");
const mainActivity = readFileSync(
  join(ROOT, "android/app/src/main/java/com/oniqhub/app/MainActivity.java"),
  "utf8",
);

/** Source with comments stripped — the notes here quote the flag to explain it. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = strip(rootTsx);
/** Same for the Java: its note quotes the old padding line in order to bury it. */
const activity = strip(mainActivity);

describe("only one layer resizes for the keyboard", () => {
  it("the static viewport meta carries overlays-content, and keeps viewport-fit", () => {
    const meta = /name: "viewport",[\s\S]{0,400}?content:\s*("(?:[^"]|\\")*"|`(?:[^`]|\\`)*`)/.exec(
      code,
    )?.[1];
    expect(meta, "the viewport meta could not be parsed").toBeTruthy();
    expect(
      meta,
      "overlays-content is gone — Chromium will resize the layout viewport for the IME again",
    ).toContain("interactive-widget=overlays-content");
    expect(
      meta,
      "resizes-content is back — that is the token that double-subtracted on native",
    ).not.toContain("resizes-content");
    // env(safe-area-inset-*) depends on this and was broken for weeks.
    expect(meta).toContain("viewport-fit=cover");
    expect(meta).toContain("width=device-width");
  });

  it("the runtime pass enforces the SAME token on every platform, with no native branch", () => {
    expect(code, "the runtime pass no longer republishes the token").toContain(
      'parts.push("interactive-widget=overlays-content")',
    );
    expect(code, "a stale token is no longer removed before the push").toContain(
      '!part.startsWith("interactive-widget")',
    );
    expect(
      code,
      "the keyboard behaviour is platform-branched again — it must be identical everywhere",
    ).not.toMatch(/native\s*&&\s*has/);
  });

  it("no second keyboard mechanism creeps into the root", () => {
    expect(code).not.toMatch(/--kb\b|--vvh/);
  });

  // AMENDED 2026-08-19 (owner decision): native is back IN the keyboard
  // business and consumes the insets again — see systemBars.test.ts for the
  // reasoning. The web tokens above stay because they go inert: with the IME
  // inset consumed Chromium never resizes, so overlays-content governs a
  // resize that does not happen and --kb-inset measures 0.
  it("MainActivity pads by the IME inset and consumes, as it did before 17 Aug", () => {
    expect(activity, "the IME padding is gone again").toContain("Type.ime()");
    expect(activity, "the listener stopped consuming").toContain("WindowInsetsCompat.CONSUMED");
  });
});

