// Country preference — local only (no Supabase column). Stored under
// `oniq.country` in Capacitor Preferences when the plugin is present,
// mirrored to localStorage so web (and the current shell, which predates the
// plugin) reads it synchronously. Never blocks the UI: the initial value is
// resolved synchronously from localStorage / device locale.
import { useEffect, useState } from "react";
import type { CountryCode } from "@/lib/miniapps";

const KEY = "oniq.country";
const EVENT = "oniq:country-changed";
/**
 * Digital-age-of-consent threshold per country. India's DPDP Act treats
 * everyone under 18 as a child (no behavioural monitoring, profiling or
 * targeted advertising); 13 is the baseline elsewhere. Mirrored in Postgres
 * by `public.minor_age_for_country()` — the database, not the UI, is what
 * actually enforces it.
 */
export const MINOR_AGE: Record<CountryCode, number> = {
  IN: 18,
  US: 13,
  GB: 13,
  AE: 13,
  CA: 13,
  AU: 13,
  SG: 13,
};

/** CountryConfig.minorAge accessor — never hardcode the number at call sites. */
export function getMinorAge(code: CountryCode): number {
  return MINOR_AGE[code] ?? 18;
}


export const COUNTRIES: { code: CountryCode; label: string; flag: string }[] = [
  { code: "IN", label: "India", flag: "🇮🇳" },
  { code: "US", label: "United States", flag: "🇺🇸" },
  { code: "GB", label: "United Kingdom", flag: "🇬🇧" },
  { code: "AE", label: "UAE", flag: "🇦🇪" },
  { code: "CA", label: "Canada", flag: "🇨🇦" },
  { code: "AU", label: "Australia", flag: "🇦🇺" },
  { code: "SG", label: "Singapore", flag: "🇸🇬" },
];

function isCode(v: string | null | undefined): v is CountryCode {
  return !!v && COUNTRIES.some((c) => c.code === v);
}

/** One-time inference from the device locale region; IN when unknown. */
function inferCountry(): CountryCode {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (isCode(region)) return region;
  } catch {
    /* noop */
  }
  return "IN";
}

export function getCountry(): CountryCode {
  try {
    const v = localStorage.getItem(KEY);
    if (isCode(v)) return v;
  } catch {
    /* noop */
  }
  const inferred = typeof window === "undefined" ? "IN" : inferCountry();
  try {
    localStorage.setItem(KEY, inferred);
  } catch {
    /* noop */
  }
  return inferred;
}

export function setCountry(code: CountryCode): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* noop */
  }
  // Best-effort native persistence; plugin absence is fine (localStorage
  // inside the WebView persists too).
  void (async () => {
    try {
      // Plugin may not be bundled in the current shell — resolve at runtime
      // only (string concat keeps tsc/vite from statically requiring it).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(/* @vite-ignore */ "@capacitor" + "/preferences");
      await mod.Preferences.set({ key: KEY, value: code });
    } catch {
      /* plugin not installed */
    }
  })();
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Reactive country preference — updates instantly across all mounted users. */
export function useCountry(): [CountryCode, (c: CountryCode) => void] {
  const [country, setState] = useState<CountryCode>(() =>
    typeof window === "undefined" ? "IN" : getCountry(),
  );

  useEffect(() => {
    // Hydrate from Capacitor Preferences once (covers native reinstalls where
    // WebView storage was cleared but Preferences survived).
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import(/* @vite-ignore */ "@capacitor" + "/preferences");
        const { value } = await mod.Preferences.get({ key: KEY });
        if (isCode(value)) {
          setState(value);
          try {
            localStorage.setItem(KEY, value);
          } catch {
            /* noop */
          }
        }
      } catch {
        /* plugin not installed */
      }
    })();
    const onChange = () => setState(getCountry());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  return [country, setCountry];
}
