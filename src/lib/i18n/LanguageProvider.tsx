// LanguageProvider — reads profile.language (via existing getUserLanguage
// cache) and exposes `t(key, fallback?)` to any component tree.
//
// Scales: any screen may call registerTranslations() at module scope OR
// pass a per-render namespace to useT — new keys don't require touching
// the provider itself.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getUserLanguage, clearUserLanguage } from "@/lib/userLanguage";
import { lookup, FALLBACK_LANG } from "@/lib/i18n/dictionaries";
import { supabase } from "@/integrations/supabase/client";

type Ctx = {
  lang: string;
  t: (key: string, fallback?: string) => string;
  refresh: () => void;
};

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<string>(FALLBACK_LANG);

  const load = () => {
    getUserLanguage().then(setLang).catch(() => setLang(FALLBACK_LANG));
  };

  useEffect(() => {
    load();
    // Refetch on auth transitions so switching accounts picks up their lang.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        clearUserLanguage();
        load();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Reflect selected language on <html lang> so :lang() CSS selectors and
  // assistive tech can adapt (e.g. larger sizing for non-Latin scripts).
  useEffect(() => {
    if (typeof document !== "undefined" && lang) {
      document.documentElement.lang = lang;
    }
  }, [lang]);


  const value = useMemo<Ctx>(
    () => ({
      lang,
      t: (key, fallback) => lookup(lang, key) ?? fallback ?? key,
      refresh: () => {
        clearUserLanguage();
        load();
      },
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useT() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Safe fallback — components rendered outside the provider still work.
    return {
      lang: FALLBACK_LANG,
      t: (key: string, fallback?: string) => lookup(FALLBACK_LANG, key) ?? fallback ?? key,
      refresh: () => {},
    } as Ctx;
  }
  return ctx;
}
