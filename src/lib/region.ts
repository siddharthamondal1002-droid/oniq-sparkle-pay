// currentRegion — where the user physically is RIGHT NOW.
//
// DEVICE-ONLY. This value is never written to Supabase, never sent in any
// insert/update, and appears in no table. It is transient trip state, not
// identity. Home country lives in src/lib/country.ts.
//
// It drives ONLY: emergency numbers, crisis lines, ride-hailing, delivery and
// nearby utilities. It never changes language, currency, tiles, faith content,
// legal regime or retention rules — those follow HOME.
//
// Detection is country-code only and comes from ONE source: the Cloudflare
// edge header (cf-ipcountry). No GPS, no coordinates, and explicitly NO
// device-language inference — a language tag says what a person reads, never
// where they are standing. When the edge cannot tell, currentRegion is null.

import { useEffect, useState } from "react";
import type { Country } from "@/data/appRegistry";
import { ALL_COUNTRIES } from "@/data/appRegistry";

const KEY = "oniq.currentRegion";
const DISMISS_KEY = "oniq.regionBannerDismissed";
const EVENT = "oniq:region-changed";

function isCountry(v: unknown): v is Country {
  return typeof v === "string" && (ALL_COUNTRIES as string[]).includes(v);
}

// Capacitor Preferences is the system of record on device; the WebView mirror
// keeps first paint synchronous (same pattern as the home-country store).
async function prefs(): Promise<{
  get: (o: { key: string }) => Promise<{ value: string | null }>;
  set: (o: { key: string; value: string }) => Promise<void>;
  remove: (o: { key: string }) => Promise<void>;
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ "@capacitor" + "/preferences");
    return mod.Preferences;
  } catch {
    return null;
  }
}

function readMirror(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeMirror(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
}

/** Synchronous read of the last known current region. null = unknown. */
export function getCurrentRegion(): Country | null {
  const v = readMirror(KEY);
  return isCountry(v) ? v : null;
}

/** Device-only write. Deliberately has no Supabase path. */
export function setCurrentRegion(code: Country | null): void {
  writeMirror(KEY, code);
  void (async () => {
    const p = await prefs();
    if (!p) return;
    if (code) await p.set({ key: KEY, value: code });
    else await p.remove({ key: KEY });
  })();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

export function isRegionBannerDismissed(region: Country): boolean {
  return readMirror(DISMISS_KEY) === region;
}

/** Remembered for this trip — a new detected region shows the offer again. */
export function dismissRegionBanner(region: Country): void {
  writeMirror(DISMISS_KEY, region);
  void (async () => {
    const p = await prefs();
    await p?.set({ key: DISMISS_KEY, value: region });
  })();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * LANGUAGE IS NOT A LOCATION SIGNAL. There is deliberately no device-language
 * fallback here, and none may be added.
 *
 * A phone set to en-US in Mumbai is an en-US phone in Mumbai — nothing more.
 * Inferring 'US' from it would hand an Indian user 988 and 911 on the crisis
 * path: a confident wrong answer at the exact moment it costs the most.
 * A null currentRegion is honest; CrisisCard falls back to HOME, which the
 * user actually chose.
 *
 * The language tag may still seed the HOME country *suggestion* at first run
 * (see src/lib/country.ts) — that is an overridable preference default, not a
 * claim about where the body is.
 */


/**
 * Reactive current region. Refreshes from Preferences on mount, then asks the
 * edge for a genuine location signal exactly once. There is NO second-guess
 * fallback: if the edge cannot tell, the region stays null.
 */
export function useCurrentRegion(): [Country | null, (c: Country | null) => void] {
  const [region, setState] = useState<Country | null>(() =>
    typeof window === "undefined" ? null : getCurrentRegion(),
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const p = await prefs();
      if (p) {
        const { value } = await p.get({ key: KEY });
        if (alive && isCountry(value)) {
          writeMirror(KEY, value);
          setState(value);
        }
      }
      // Detection never touches HOME — it only updates this device value.
      // cf-ipcountry is the ONLY accepted source. null / XX / T1 => stay null.
      let detected: Country | null = null;
      try {
        const { detectRegion } = await import("@/lib/region.functions");
        const res = await detectRegion();
        if (isCountry(res?.country)) detected = res.country;
      } catch {
        /* offline or SSR — region simply stays unknown */
      }

      if (alive && detected && detected !== getCurrentRegion()) {
        setCurrentRegion(detected);
        setState(detected);
      }
    })();

    const onChange = () => setState(getCurrentRegion());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return [region, setCurrentRegion];
}
