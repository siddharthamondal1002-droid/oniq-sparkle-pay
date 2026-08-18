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

  it("MainActivity is OUT of the keyboard business — no IME padding, in any form", () => {
    /*
     * THE FINAL SHAPE, and the timeline that forced it (2026-08-18, after
     * versionCode 17 AND 18 both shipped remainder arithmetic that changed
     * nothing on the device):
     *
     *   Jul 29 – Aug 17   MainActivity padded by ime.bottom AND returned
     *                     WindowInsetsCompat.CONSUMED. The WebView never saw
     *                     an IME inset, so the padding was the ONLY
     *                     subtraction. The chat worked the whole time.
     *
     *   Aug 17            198a3f2d stopped consuming — correctly, so env()
     *                     stopped reading zero. Side effect: the WebView now
     *                     receives the IME inset, and modern Chromium resizes
     *                     its own viewport for it. Two subtractions. Reported
     *                     broken THAT DAY.
     *
     * The probe's numbers admit only that story: view = 832 − 310 (padding)
     * = 522 CSS, innerHeight 211 = 522 − 311 — the WebView took a second
     * keyboard off its OWN height. The window never resized, which is why
     * vc17/vc18's decor-height measurements both computed zero.
     *
     * So native pads NOTHING for the keyboard, ever. Chromium is the one
     * mechanism, by construction. If a keyboard ever covers the composer on
     * some device, the fix is in the WEB layer — never a padding here.
     */
    expect(
      activity,
      "MainActivity reads the IME inset again — the padding is coming back",
    ).not.toContain("Type.ime()");
    expect(activity, "a keyboard-derived padding is back in some disguise").not.toMatch(
      /setPadding\([^)]*ime/,
    );
    // The one padding write left is the stale-state reset to zero.
    expect(activity).toMatch(/setPadding\(0,\s*0,\s*0,\s*0\)/);
  });

  it("the insets still reach the WebView unconsumed — env() AND the keyboard depend on it", () => {
    // CONSUMED is what made all 54 env(safe-area-inset-*) reads zero before
    // 2026-08-17, and it would ALSO blind Chromium to the keyboard — which is
    // now the only thing handling it. Consuming again breaks both at once.
    expect(activity, "the inset listener is swallowing insets again").not.toMatch(
      /return\s+WindowInsetsCompat\.CONSUMED/,
    );
    expect(activity).toContain("return insets;");
  });
});
