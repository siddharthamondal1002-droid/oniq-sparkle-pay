// Reads the current user's preferred language from profiles.language.
// Cached in memory for the session; cleared via clearUserLanguage() on save.
import { supabase } from "@/integrations/supabase/client";

export const SUPPORTED_LANGS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  bn: "Bengali",
  te: "Telugu",
  mr: "Marathi",
  ta: "Tamil",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  or: "Odia",
  as: "Assamese",
  ur: "Urdu",
};

export const LANG_NATIVE: Record<string, string> = {
  en: "English",
  hi: "हिन्दी",
  bn: "বাংলা",
  te: "తెలుగు",
  mr: "मराठी",
  ta: "தமிழ்",
  gu: "ગુજરાતી",
  kn: "ಕನ್ನಡ",
  ml: "മലയാളം",
  pa: "ਪੰਜਾਬੀ",
  or: "ଓଡ଼ିଆ",
  as: "অসমীয়া",
  ur: "اردو",
};

let cached: string | null = null;
let inflight: Promise<string> | null = null;

export function clearUserLanguage() {
  cached = null;
  inflight = null;
}

export function setUserLanguageCache(lang: string) {
  cached = SUPPORTED_LANGS[lang] ? lang : "en";
}

export async function getUserLanguage(): Promise<string> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return "en";
      const { data } = await supabase
        .from("profiles")
        .select("language")
        .eq("id", u.user.id)
        .maybeSingle();
      const code = (data?.language ?? "en") as string;
      cached = SUPPORTED_LANGS[code] ? code : "en";
      return cached;
    } catch {
      cached = "en";
      return "en";
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
