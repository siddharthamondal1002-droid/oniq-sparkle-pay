// Translation dictionaries keyed by BCP-47-ish language codes matching
// profile.language (see src/lib/userLanguage.ts).
//
// Design: any screen can register keys under its own namespace (e.g.
// "home.tile.rides"). Missing keys fall back to English, then to the raw
// key. Add new keys anywhere in this file — no registration ceremony.
//
// Pan-Indian Tier-0 defaults (mast/khabar/safar/khazana/jugaad/batua/chalo)
// are used wherever a language-specific curated word wasn't researched.

export type Dict = Record<string, string>;

// English baseline — same pan-Indian curated words as Hindi (per spec:
// English speakers get the same flavour, not translated-back English).
const en: Dict = {
  "home.transparency": "words from across India, not just English slang 🇮🇳",
  "home.tile.rides": "chalo 🚗",
  "home.tile.upi": "khazana 💰",
  "home.tile.miniapps": "jugaad 🔌",
  "home.tile.pulse": "khabar ☕",
  "home.tile.wander": "safar ✈️",
  "home.tile.wallet": "batua 💳",
  "home.tile.clips": "mast 🎬",
};

const hi: Dict = {
  ...en,
  "home.tile.rides": "चलो",
  "home.tile.upi": "ख़ज़ाना",
  "home.tile.miniapps": "जुगाड़",
  "home.tile.pulse": "ख़बर",
  "home.tile.wander": "सफ़र",
  "home.tile.wallet": "बटुआ",
  "home.tile.clips": "मस्त",
};

const ta: Dict = {
  ...en,
  "home.tile.rides": "வா",
  "home.tile.upi": "காசு",
  "home.tile.miniapps": "கெத்து",
  "home.tile.pulse": "செய்தி",
  "home.tile.wander": "பயணம்",
  "home.tile.wallet": "பணம்",
  "home.tile.clips": "செம்ம",
};

const te: Dict = {
  ...en,
  "home.tile.rides": "చలో",
  "home.tile.upi": "కాసు",
  "home.tile.miniapps": "జుగాడ్",
  "home.tile.pulse": "వార్త",
  "home.tile.wander": "ప్రయాణం",
  "home.tile.wallet": "కాసు",
  "home.tile.clips": "కేక",
};


const bn: Dict = {
  ...en,
  "home.tile.rides": "চলো",
  "home.tile.upi": "খাজানা",
  "home.tile.miniapps": "আড্ডা",
  "home.tile.pulse": "খবর",
  "home.tile.wander": "সফর",
  "home.tile.wallet": "মানিব্যাগ",
  "home.tile.clips": "ফটাফাটি",
};

const mr: Dict = {
  ...en,
  "home.tile.rides": "चला",
  "home.tile.upi": "खजिना",
  "home.tile.miniapps": "कट्टा",
  "home.tile.pulse": "खबर",
  "home.tile.wander": "सफर",
  "home.tile.wallet": "बटवा",
  "home.tile.clips": "भारी",
};

const kn: Dict = {
  ...en,
  "home.tile.rides": "ಚಲೋ",
  "home.tile.upi": "ಕಾಸು",
  "home.tile.miniapps": "ಜುಗಾಡ್",
  "home.tile.pulse": "ಸುದ್ದಿ",
  "home.tile.wander": "ಪ್ರಯಾಣ",
  "home.tile.wallet": "ಕಾಸು",
  "home.tile.clips": "ಸಕ್ಕತ್",
};

const ml: Dict = {
  ...en,
  "home.tile.rides": "ചലോ",
  "home.tile.upi": "പണം",
  "home.tile.miniapps": "ജുഗാഡ്",
  "home.tile.pulse": "വാർത്ത",
  "home.tile.wander": "സഫർ",
  "home.tile.wallet": "പണം",
  "home.tile.clips": "അടിപൊളി",
};


const pa: Dict = {
  ...en,
  "home.tile.rides": "ਗੇੜੀ",
  "home.tile.upi": "ਖਜ਼ਾਨਾ",
  "home.tile.miniapps": "ਜੁਗਾੜ",
  "home.tile.pulse": "ਖ਼ਬਰ",
  "home.tile.wander": "ਸਫ਼ਰ",
  "home.tile.wallet": "ਬਟੂਆ",
  "home.tile.clips": "ਤਸ਼ਨ",
};

const gu: Dict = {
  ...en,
  "home.tile.rides": "ચલો",
  "home.tile.upi": "ખજાનો",
  "home.tile.miniapps": "જુગાડ",
  "home.tile.pulse": "ખબર",
  "home.tile.wander": "સફર",
  "home.tile.wallet": "બટવો",
  "home.tile.clips": "મજા",
};

// Odia & Assamese — pan-Indian Tier-0 fallback (honest: no verified
// regional equivalents for these exact 7 concepts in tonight's research).
const or: Dict = { ...en };
const as: Dict = { ...en };

const ur: Dict = {
  ...en,
  "home.tile.rides": "چلو",
  "home.tile.upi": "خزانہ",
  "home.tile.miniapps": "جگاڑ",
  "home.tile.pulse": "خبر",
  "home.tile.wander": "سفر",
  "home.tile.wallet": "بٹوا",
  "home.tile.clips": "زبردست",
};

export const DICTIONARIES: Record<string, Dict> = {
  en, hi, bn, te, mr, ta, gu, kn, ml, pa, or, as, ur,
};

export const FALLBACK_LANG = "en";

// Runtime extension point — future screens can push keys without editing
// this file. Merged over base dictionaries at read time.
const overlays: Record<string, Dict> = {};

export function registerTranslations(lang: string, entries: Dict) {
  overlays[lang] = { ...(overlays[lang] ?? {}), ...entries };
}

export function lookup(lang: string, key: string): string | undefined {
  return (
    overlays[lang]?.[key] ??
    DICTIONARIES[lang]?.[key] ??
    overlays[FALLBACK_LANG]?.[key] ??
    DICTIONARIES[FALLBACK_LANG]?.[key]
  );
}
