/**
 * Dark/light mode. One source of truth: the `light` class on <html>, driven by
 * a persisted per-device choice. Dark is the default — it is the design the
 * app was built in, and the owner's 2026-09-03 redesign reference ("use it as
 * given") is dark: a near-black canvas washed with each world's neon pair.
 * Light stays one tap away in Profile → Appearance.
 *
 * The class is applied in TWO places on purpose:
 * - an inline script in the document head (see __root.tsx) applies it before
 *   first paint, so a light-mode user never sees a dark flash;
 * - this module applies it on toggle and re-applies on load as the fallback
 *   for anywhere the inline script did not run.
 */

export type ThemeMode = "dark" | "light";

const KEY = "oniq.theme";

export function getThemeMode(): ThemeMode {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/**
 * Tell Android which way to paint the status/navigation bar icons.
 *
 * The app went edge-to-edge on 2026-08-16, so those bars are transparent and
 * their icons sit directly on whatever this theme paints underneath. Android
 * cannot work that out for itself: the choice lives in localStorage here and
 * can differ from the system setting, because ONIQ ships its own toggle.
 *
 * Light theme => a near-white canvas => the icons must be DARK. Get it the
 * wrong way round and the clock and battery are simply invisible, which is
 * why this is wired into the same function that flips the class rather than
 * left as a step somebody has to remember.
 *
 * Web-only builds have no such plugin; the dynamic import resolves to nothing
 * and this is a silent no-op there.
 */
async function syncSystemBarIcons(mode: ThemeMode) {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const { registerPlugin } = await import(/* @vite-ignore */ "@capacitor/core");
    const SystemBars = registerPlugin<{ setIconStyle(o: { dark: boolean }): Promise<void> }>(
      "SystemBars",
    );
    await SystemBars.setIconStyle({ dark: mode === "light" });
  } catch {
    /* no plugin, no native shell, or an OEM that refuses — keep the default */
  }
}

export function applyThemeMode(mode: ThemeMode) {
  try {
    document.documentElement.classList.toggle("light", mode === "light");
  } catch {
    /* SSR */
  }
  void syncSystemBarIcons(mode);
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode — the toggle still works for this session */
  }
  applyThemeMode(mode);
  try {
    window.dispatchEvent(new CustomEvent("oniq:theme-changed", { detail: { mode } }));
  } catch {
    /* non-browser */
  }
}

/**
 * Sync the system bar icons to the persisted theme, once, on boot.
 *
 * NOT covered by applyThemeMode: that only runs when the user TOGGLES. On a
 * cold start the `light` class comes from THEME_BOOT_SCRIPT in the document
 * head, which runs before any of this module exists and knows nothing about
 * Android. Without this call, a light-mode user relaunching the app would get
 * light icons on a light canvas — an invisible clock and battery until they
 * happened to toggle the theme twice.
 */
export function syncSystemBarsOnBoot() {
  void syncSystemBarIcons(getThemeMode());
}

/**
 * The pre-paint script, inlined into <head>. Kept tiny and dependency-free —
 * it runs before anything else exists.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="light")document.documentElement.classList.add("light")}catch(e){}`;
