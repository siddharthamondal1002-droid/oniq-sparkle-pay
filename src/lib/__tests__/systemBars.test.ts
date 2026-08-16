/**
 * Edge-to-edge is TWO changes that only work as a pair.
 *
 * The Android shell stopped padding the content view and stopped consuming
 * window insets; the web shell started applying them. Either half on its own
 * is a bug, and a bad one:
 *
 *   native alone  -> nothing holds content off the status bar, and every
 *                    screen's header sits under the clock.
 *   web alone     -> insets are padded twice and the app has a dead band at
 *                    the top of every screen.
 *
 * Nobody looking at one file would see the other, so the pairing is asserted
 * here. These are source-shape checks, which is a weak form of test — they
 * catch a half-revert, not a rendering mistake. The rendering has to be
 * checked on a device; there is no substitute and this file does not pretend
 * to be one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MAIN_ACTIVITY = read("android/app/src/main/java/com/oniqhub/app/MainActivity.java");
const APP_SHELL = read("src/routes/_authenticated/app.tsx");
const ROOT_ROUTE = read("src/routes/__root.tsx");
const THEME = read("src/lib/theme.ts");

/** Java with the comment lines stripped — a comment naming a call is not one. */
function javaCode(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("the window really is edge-to-edge", () => {
  const code = javaCode(MAIN_ACTIVITY);

  it("asks the decor to stop fitting system windows", () => {
    expect(code).toMatch(/WindowCompat\.setDecorFitsSystemWindows\(\s*getWindow\(\),\s*false\s*\)/);
  });

  it("paints neither bar, and enforces no scrim behind them", () => {
    expect(code).toMatch(/setStatusBarColor\(Color\.TRANSPARENT\)/);
    expect(code).toMatch(/setNavigationBarColor\(Color\.TRANSPARENT\)/);
    expect(code).toMatch(/setNavigationBarContrastEnforced\(false\)/);
    expect(code).toMatch(/setStatusBarContrastEnforced\(false\)/);
  });

  it("no longer paints the content view a colour of its own", () => {
    // It was #1a1230 — a leftover purple matching neither theme, and with the
    // bars transparent it showed THROUGH them as a coloured strip.
    expect(code, "the hardcoded content background is back").not.toMatch(/#1a1230/i);
    expect(code).toMatch(/content\.setBackgroundColor\(Color\.TRANSPARENT\)/);
  });
});

describe("the insets reach the WebView, and the web layer uses them", () => {
  const code = javaCode(MAIN_ACTIVITY);

  it("does NOT consume the insets", () => {
    // WindowInsetsCompat.CONSUMED was why all 54 env(safe-area-inset-*) reads
    // in the CSS returned zero. Returning them is the entire fix.
    expect(code, "the inset listener is swallowing insets again").not.toMatch(
      /WindowInsetsCompat\.CONSUMED/,
    );
  });

  it("pads for the keyboard and nothing else", () => {
    // A WebView cannot resize itself around an IME it does not own, so that
    // one stays native. Top/left/right are the web layer's job now.
    expect(code).toMatch(/setPadding\(0,\s*0,\s*0,\s*ime\.bottom\)/);
  });

  it("the document opts into drawing under the bars", () => {
    // Without viewport-fit=cover the env() values are zero no matter what the
    // native side does.
    expect(ROOT_ROUTE).toContain("viewport-fit=cover");
  });

  it("the app shell applies top AND side insets", () => {
    // 28 of the 45 screens under this Outlet handle no inset of their own, so
    // this single <main> is what keeps their headers off the status bar.
    expect(APP_SHELL).toMatch(/paddingTop:\s*"env\(safe-area-inset-top\)"/);
    // Side insets are new: the native shell used to cover display cutouts in
    // landscape and no longer does.
    expect(APP_SHELL).toMatch(/paddingInlineStart:\s*"env\(safe-area-inset-left\)"/);
    expect(APP_SHELL).toMatch(/paddingInlineEnd:\s*"env\(safe-area-inset-right\)"/);
  });
});

describe("system bar icons follow the app's own theme", () => {
  it("registers the bridge the web layer calls", () => {
    expect(javaCode(MAIN_ACTIVITY)).toMatch(/registerPlugin\(SystemBarsPlugin\.class\)/);
    const plugin = read("android/app/src/main/java/com/oniqhub/app/SystemBarsPlugin.java");
    expect(plugin).toMatch(/setAppearanceLightStatusBars/);
    expect(plugin).toMatch(/setAppearanceLightNavigationBars/);
  });

  it("asks for DARK icons in LIGHT theme, which is the way round that matters", () => {
    // Backwards means a white clock on a #faf9f7 canvas — no clock at all.
    expect(THEME).toMatch(/setIconStyle\(\{\s*dark:\s*mode === "light"\s*\}\)/);
  });

  it("syncs on boot, not only on toggle", () => {
    // The pre-paint script in <head> applies the theme class before this
    // module exists, so a relaunch in light mode would otherwise keep
    // whatever icon style the system last had.
    expect(THEME).toMatch(/export function syncSystemBarsOnBoot/);
    expect(APP_SHELL).toMatch(/syncSystemBarsOnBoot\(\)/);
  });
});

describe("display cutouts", () => {
  it("declares shortEdges only where the attribute exists", () => {
    // android:windowLayoutInDisplayCutoutMode is API 27; this project is
    // minSdk 24, so putting it in the base theme is a link error, not a
    // graceful ignore.
    const base = read("android/app/src/main/res/values/styles.xml");
    const v27 = read("android/app/src/main/res/values-v27/styles.xml");
    expect(base, "cutout mode declared below its API level").not.toMatch(
      /windowLayoutInDisplayCutoutMode/,
    );
    expect(v27).toMatch(/windowLayoutInDisplayCutoutMode">shortEdges/);
  });

  it("both theme variants keep the bars transparent", () => {
    for (const p of [
      "android/app/src/main/res/values/styles.xml",
      "android/app/src/main/res/values-v27/styles.xml",
    ]) {
      const xml = read(p);
      expect(xml, `${p}: opaque status bar`).toMatch(/statusBarColor">@android:color\/transparent/);
      expect(xml, `${p}: opaque navigation bar`).toMatch(
        /navigationBarColor">@android:color\/transparent/,
      );
    }
  });
});
