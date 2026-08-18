/**
 * THE KEYBOARD IS SUBTRACTED BY ONE PLATFORM MECHANISM, NOT TWO.
 *
 * Native ran both at once, and that is what survived three CSS fixes:
 *
 *   MainActivity   pads android.R.id.content by the IME inset, so the WebView
 *                  is physically shorter while the keyboard is up.
 *   viewport meta  interactive-widget=resizes-content makes the WebView ALSO
 *                  shrink its own layout viewport for the same keyboard.
 *
 * On a 2000px screen with a 760px keyboard that leaves 100dvh at roughly
 * 480px — which is the chat column measured off a screenshot on 2026-08-18:
 * header, a sliver of thread, the composer, then a keyboard-sized dead band
 * where the native padding showed through.
 *
 * Nothing in CSS could reach that. By the time any stylesheet ran, 100dvh was
 * already wrong. So the flag now goes on for the WEB ONLY, at runtime, and the
 * static meta must not carry it — otherwise native has both for the frames
 * before hydration, which is exactly when a chat opened from a notification
 * paints.
 *
 * The web genuinely needs the flag: without it a browser keyboard covers the
 * composer instead of shrinking the page. This is not "remove it", it is
 * "exactly one per platform".
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
  it("the STATIC viewport meta does not carry interactive-widget", () => {
    // The static meta is what native parses at boot. If the flag is there,
    // native stacks it on top of MainActivity's padding before any JS runs.
    const meta = /name: "viewport",[\s\S]{0,400}?content:\s*("(?:[^"]|\\")*"|`(?:[^`]|\\`)*`)/.exec(
      code,
    )?.[1];
    expect(meta, "the viewport meta could not be parsed").toBeTruthy();
    expect(
      meta,
      "interactive-widget is back in the static meta — native now subtracts the keyboard twice",
    ).not.toContain("interactive-widget");
    // The rest of the meta still has to be there.
    expect(meta).toContain("viewport-fit=cover");
    expect(meta).toContain("width=device-width");
  });

  it("native STRIPS it, rather than merely not adding it", () => {
    // Leaving it out of the served markup is a weaker guarantee than taking
    // it off when found. On 2026-08-18 the app was still collapsed to ~211 of
    // 832 CSS px with a keyboard-sized dead band under the composer, half an
    // hour after the publish that removed it from the static meta — whatever
    // the phone had loaded, it still carried the flag. Removing it at runtime
    // makes the device correct itself on the next launch regardless.
    expect(code, "native no longer removes the flag when it finds one").toContain(
      'part.startsWith("interactive-widget")',
    );
    expect(code, "the strip is not gated on being native").toMatch(/native && has/);
  });

  it("the web still gets it, gated on not being native", () => {
    // Removing the flag outright would fix native by breaking every browser:
    // the keyboard would cover the composer instead of shrinking the page.
    expect(code, "the web no longer gets interactive-widget at all").toContain(
      "interactive-widget=resizes-content",
    );
    expect(code, "the runtime add is not gated on platform").toContain(
      "Capacitor.isNativePlatform()",
    );
  });

  it("native still pays the IME inset, since it is now the only one paying", () => {
    // If this padding is ever removed, the flag has to come back for native or
    // the keyboard will cover the composer there instead.
    expect(
      mainActivity,
      "MainActivity stopped padding for the IME, so nothing handles the keyboard on native",
    ).toContain("ime.bottom");
  });

  it("native pays it ONCE — never on top of a window the system already resized", () => {
    /*
     * THE ACTUAL CAUSE, PINNED FROM THE DEVICE ON 2026-08-18.
     *
     * `v.setPadding(0, 0, 0, ime.bottom)` pushed the content view off the
     * bottom of a window that had already shrunk by one keyboard, because no
     * windowSoftInputMode is declared and the system resolves it to
     * adjustResize. Probe, with no interactive-widget in the page at all:
     * screenH 832, innerH 211, vvH 0 — the WebView a quarter of the screen,
     * half an hour after the publish that removed the flag.
     *
     * Four web-side fixes chased this first and none could reach it. The
     * padding must subtract only the part the window has not taken.
     */
    expect(
      activity,
      "MainActivity pads by the raw IME inset again — double-subtracted wherever the window resizes",
    ).not.toMatch(/setPadding\(\s*0\s*,\s*0\s*,\s*0\s*,\s*ime\.bottom\s*\)/);
    expect(activity, "the padding no longer measures what the window already lost").toContain(
      "alreadyTaken",
    );
    expect(activity).toContain("getRootView().getHeight()");
  });
});
