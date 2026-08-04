// HOME COUNTRY — identity. Sticky and user-chosen: it is NEVER rewritten by
// location detection (see src/lib/region.ts for the transient currentRegion).
// Source of truth is `profiles.country_code` in Supabase; the device copy is
// an offline-first-paint mirror. On login the profile wins.
//
// Home drives language default, currency/number formatting, tile set, faith
// and calendar content, government directory, app registry, legal regime,
// consent notice, retention rules and whether the health hub exists at all.
//
// Stored under
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

/** Best-effort mirror of Home to the Supabase profile (the source of truth). */
async function persistHomeToProfile(code: CountryCode): Promise<void> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from("profiles").update({ country_code: code }).eq("id", data.user.id);
  } catch {
    /* offline / signed out — the device mirror still holds */
  }
}

export function setCountry(code: CountryCode): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* noop */
  }
  void persistHomeToProfile(code);
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
    // Profile wins for Home on login — it survives reinstall and follows the
    // account across devices. Detection never reaches this code path.
    void (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase.auth.getUser();
        if (!data.user) return;
        const { data: row } = await supabase.rpc("get_my_profile_meta").maybeSingle();
        if (isCode(row?.country_code)) {
          setState(row.country_code);
          try {
            localStorage.setItem(KEY, row.country_code);
          } catch {
            /* noop */
          }
        }
      } catch {
        /* signed out or offline */
      }
    })();
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

/** Explicit alias — Home is one of two axes; `useCountry` predates the split. */
export const useHomeCountry = useCountry;
export const getHomeCountry = getCountry;
export const setHomeCountry = setCountry;
