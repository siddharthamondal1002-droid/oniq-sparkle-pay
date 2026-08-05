// ONIQ — the one language registry.
//
// WHY THIS EXISTS
//
// There were two lists and they disagreed, silently.
//
//   - Scout's picker (app.learn.tsx) offered 13 international languages,
//     Arabic among them.
//   - SUPPORTED_LANGS in supabase/functions/_shared/llm.ts, which every AI
//     surface reads, held only English plus twelve Indian languages.
//
// langInstruction() returns an EMPTY STRING for a code it does not recognise.
// So picking Arabic — or Spanish, French, Chinese, anything international —
// produced no instruction at all and the model answered in English. No error,
// no fallback notice, nothing to notice in a log. The UI offered a language
// the AI had never been told to speak.
//
// That affected every AI surface at once, because they all call the same
// helper: ting, study-tutor, study-quiz, study-chapters, study-chapter-notes,
// study-paper-generate, cv-generate, smart-scout, ride-genie, hotel-scout.
//
// So: one list, here, exported to both sides. The edge function keeps its own
// copy of the map because Deno functions cannot import from src/ — but the
// test in src/data/__tests__/languages.test.ts compares the two and fails if
// they drift, which is the guarantee that matters.
//
// CHOOSING WHAT TO INCLUDE
//
// Indian: all 22 languages of the Eighth Schedule to the Constitution. That is
// a defined list rather than a judgement call, which is why it is the right
// boundary — "popular Indian languages" invites someone to quietly drop the
// ones with fewer speakers.
//
// International: the widely-spoken world languages, plus every language that
// one of ONIQ's seven markets actually runs on — Arabic for the UAE, French
// for Canada, and Mandarin, Malay and Tamil for Singapore.

export type LanguageEntry = {
  /** ISO 639-1 where one exists. Used as the wire value everywhere. */
  code: string;
  /** Endonym · English name. The endonym comes first — people scan for it. */
  label: string;
  /** English name alone. This is what the model is instructed with. */
  english: string;
  /** BCP-47 tag for speech recognition and synthesis. */
  speech: string;
  /** Right-to-left script. Drives `dir` on any field that accepts this. */
  rtl?: boolean;
};

/**
 * The 22 scheduled languages of India (Eighth Schedule), plus English which
 * is an associate official language.
 */
export const INDIAN_LANGUAGES: LanguageEntry[] = [
  { code: "as", label: "অসমীয়া · Assamese", english: "Assamese", speech: "as-IN" },
  { code: "bn", label: "বাংলা · Bengali", english: "Bengali", speech: "bn-IN" },
  { code: "brx", label: "बड़ो · Bodo", english: "Bodo", speech: "hi-IN" },
  { code: "doi", label: "डोगरी · Dogri", english: "Dogri", speech: "hi-IN" },
  { code: "gu", label: "ગુજરાતી · Gujarati", english: "Gujarati", speech: "gu-IN" },
  { code: "hi", label: "हिन्दी · Hindi", english: "Hindi", speech: "hi-IN" },
  { code: "kn", label: "ಕನ್ನಡ · Kannada", english: "Kannada", speech: "kn-IN" },
  { code: "ks", label: "کٲشُر · Kashmiri", english: "Kashmiri", speech: "ur-IN", rtl: true },
  { code: "kok", label: "कोंकणी · Konkani", english: "Konkani", speech: "mr-IN" },
  { code: "mai", label: "मैथिली · Maithili", english: "Maithili", speech: "hi-IN" },
  { code: "ml", label: "മലയാളം · Malayalam", english: "Malayalam", speech: "ml-IN" },
  { code: "mni", label: "ꯃꯤꯇꯩꯂꯣꯟ · Manipuri", english: "Manipuri (Meitei)", speech: "hi-IN" },
  { code: "mr", label: "मराठी · Marathi", english: "Marathi", speech: "mr-IN" },
  { code: "ne", label: "नेपाली · Nepali", english: "Nepali", speech: "ne-NP" },
  { code: "or", label: "ଓଡ଼ିଆ · Odia", english: "Odia", speech: "or-IN" },
  { code: "pa", label: "ਪੰਜਾਬੀ · Punjabi", english: "Punjabi", speech: "pa-IN" },
  { code: "sa", label: "संस्कृतम् · Sanskrit", english: "Sanskrit", speech: "hi-IN" },
  { code: "sat", label: "ᱥᱟᱱᱛᱟᱲᱤ · Santali", english: "Santali", speech: "hi-IN" },
  { code: "sd", label: "سنڌي · Sindhi", english: "Sindhi", speech: "ur-IN", rtl: true },
  { code: "ta", label: "தமிழ் · Tamil", english: "Tamil", speech: "ta-IN" },
  { code: "te", label: "తెలుగు · Telugu", english: "Telugu", speech: "te-IN" },
  { code: "ur", label: "اردو · Urdu", english: "Urdu", speech: "ur-IN", rtl: true },
];

/**
 * International languages. Ordered roughly by how many people ONIQ's users
 * are likely to need them for, not by speaker count worldwide.
 */
export const INTERNATIONAL_LANGUAGES: LanguageEntry[] = [
  { code: "en", label: "English", english: "English", speech: "en-IN" },
  { code: "ar", label: "العربية · Arabic", english: "Arabic", speech: "ar-SA", rtl: true },
  { code: "es", label: "Español · Spanish", english: "Spanish", speech: "es-ES" },
  { code: "fr", label: "Français · French", english: "French", speech: "fr-FR" },
  {
    code: "zh",
    label: "中文 · Chinese (Simplified)",
    english: "Simplified Chinese",
    speech: "zh-CN",
  },
  {
    code: "zh-TW",
    label: "繁體中文 · Chinese (Traditional)",
    english: "Traditional Chinese",
    speech: "zh-TW",
  },
  { code: "ms", label: "Bahasa Melayu · Malay", english: "Malay", speech: "ms-MY" },
  { code: "de", label: "Deutsch · German", english: "German", speech: "de-DE" },
  { code: "pt", label: "Português · Portuguese", english: "Portuguese", speech: "pt-BR" },
  { code: "ru", label: "Русский · Russian", english: "Russian", speech: "ru-RU" },
  { code: "ja", label: "日本語 · Japanese", english: "Japanese", speech: "ja-JP" },
  { code: "ko", label: "한국어 · Korean", english: "Korean", speech: "ko-KR" },
  { code: "it", label: "Italiano · Italian", english: "Italian", speech: "it-IT" },
  { code: "tr", label: "Türkçe · Turkish", english: "Turkish", speech: "tr-TR" },
  { code: "id", label: "Bahasa Indonesia · Indonesian", english: "Indonesian", speech: "id-ID" },
  { code: "vi", label: "Tiếng Việt · Vietnamese", english: "Vietnamese", speech: "vi-VN" },
  { code: "th", label: "ไทย · Thai", english: "Thai", speech: "th-TH" },
  { code: "fil", label: "Filipino · Tagalog", english: "Filipino", speech: "fil-PH" },
  { code: "fa", label: "فارسی · Persian", english: "Persian (Farsi)", speech: "fa-IR", rtl: true },
  { code: "he", label: "עברית · Hebrew", english: "Hebrew", speech: "he-IL", rtl: true },
  { code: "nl", label: "Nederlands · Dutch", english: "Dutch", speech: "nl-NL" },
  { code: "pl", label: "Polski · Polish", english: "Polish", speech: "pl-PL" },
  { code: "uk", label: "Українська · Ukrainian", english: "Ukrainian", speech: "uk-UA" },
  { code: "el", label: "Ελληνικά · Greek", english: "Greek", speech: "el-GR" },
  { code: "sv", label: "Svenska · Swedish", english: "Swedish", speech: "sv-SE" },
  { code: "sw", label: "Kiswahili · Swahili", english: "Swahili", speech: "sw-KE" },
  { code: "am", label: "አማርኛ · Amharic", english: "Amharic", speech: "am-ET" },
  { code: "ha", label: "Hausa", english: "Hausa", speech: "ha-NG" },
  { code: "ro", label: "Română · Romanian", english: "Romanian", speech: "ro-RO" },
  { code: "cs", label: "Čeština · Czech", english: "Czech", speech: "cs-CZ" },
  { code: "hu", label: "Magyar · Hungarian", english: "Hungarian", speech: "hu-HU" },
  { code: "no", label: "Norsk · Norwegian", english: "Norwegian", speech: "nb-NO" },
  { code: "da", label: "Dansk · Danish", english: "Danish", speech: "da-DK" },
  { code: "fi", label: "Suomi · Finnish", english: "Finnish", speech: "fi-FI" },
];

export const ALL_LANGUAGES: LanguageEntry[] = [...INDIAN_LANGUAGES, ...INTERNATIONAL_LANGUAGES];

/** Counted, never typed. The marketing stat reads this. */
export const LANGUAGE_COUNT = ALL_LANGUAGES.length;

const BY_CODE = new Map(ALL_LANGUAGES.map((l) => [l.code, l]));

export function languageByCode(code: string): LanguageEntry | null {
  return BY_CODE.get(code) ?? null;
}

export function speechLocaleFor(code: string): string {
  return BY_CODE.get(code)?.speech ?? "en-IN";
}

export function isRtlLanguage(code: string): boolean {
  return BY_CODE.get(code)?.rtl === true;
}

/**
 * The exact map the edge functions need: code -> English name, which is what
 * langInstruction() interpolates into "Respond in ___".
 *
 * supabase/functions/_shared/llm.ts holds a copy because Deno cannot import
 * from src/. The test compares them and fails on any drift — that copy is the
 * one that decides what the AI actually does, so it must never fall behind.
 */
export const AI_LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
  ALL_LANGUAGES.map((l) => [l.code, l.english]),
);
