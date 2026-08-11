/**
 * Dark/light mode. One source of truth: the `light` class on <html>, driven by
 * a persisted per-device choice. Dark is the default — it is the design the
 * app was built in, and every existing user is on it.
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

export function applyThemeMode(mode: ThemeMode) {
  try {
    document.documentElement.classList.toggle("light", mode === "light");
  } catch {
    /* SSR */
  }
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
 * The pre-paint script, inlined into <head>. Kept tiny and dependency-free —
 * it runs before anything else exists.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="light")document.documentElement.classList.add("light")}catch(e){}`;
