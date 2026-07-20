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
  "home.tile.rides": "chalo 🚗",
  "home.tile.upi": "khazana 💰",
  "home.tile.miniapps": "jugaad 🔌",
  "home.tile.pulse": "khabar ☕",
  "home.tile.wander": "safar ✈️",
  "home.tile.wallet": "batua 💳",
  "home.tile.clips": "mast 🎬",
};

const ta: Dict = {
  ...en,
  "home.tile.rides": "vaa 🚗",
  "home.tile.upi": "kaasu 💰",
  "home.tile.miniapps": "gethu 🔌",
  "home.tile.pulse": "seithi ☕",
  "home.tile.wander": "payanam ✈️",
  "home.tile.wallet": "panam 💳",
  "home.tile.clips": "semma 🎬",
};

const te: Dict = {
  ...en,
  "home.tile.rides": "chalo 🚗",
  "home.tile.upi": "kaasu 💰",
  "home.tile.miniapps": "jugaad 🔌",
  "home.tile.pulse": "vaarta ☕",
  "home.tile.wander": "prayanam ✈️",
  "home.tile.wallet": "kaasu 💳",
  "home.tile.clips": "keka 🎬",
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
  "home.tile.rides": "chalo 🚗",
  "home.tile.upi": "khazana 💰",
  "home.tile.miniapps": "katta 🔌",
  "home.tile.pulse": "khabar ☕",
  "home.tile.wander": "safar ✈️",
  "home.tile.wallet": "batua 💳",
  "home.tile.clips": "bhari 🎬",
};

const kn: Dict = {
  ...en,
  "home.tile.rides": "chalo 🚗",
  "home.tile.upi": "kaasu 💰",
  "home.tile.miniapps": "jugaad 🔌",
  "home.tile.pulse": "suddi ☕",
  "home.tile.wander": "prayana ✈️",
  "home.tile.wallet": "kaasu 💳",
  "home.tile.clips": "sakkath 🎬",
};

const ml: Dict = {
  ...en,
  "home.tile.rides": "chalo 🚗",
  "home.tile.upi": "panam 💰",
  "home.tile.miniapps": "jugaad 🔌",
  "home.tile.pulse": "vartha ☕",
  "home.tile.wander": "safar ✈️",
  "home.tile.wallet": "panam 💳",
  "home.tile.clips": "adipoli 🎬",
};


const pa: Dict = {
  ...en,
  "home.tile.rides": "gedi 🚗",
  "home.tile.upi": "khazana 💰",
  "home.tile.miniapps": "jugaad 🔌",
  "home.tile.pulse": "khabar ☕",
  "home.tile.wander": "safar ✈️",
  "home.tile.wallet": "batua 💳",
  "home.tile.clips": "tashan 🎬",
};

const gu: Dict = {
  ...en,
  "home.tile.rides": "chalo 🚗",
  "home.tile.upi": "khazana 💰",
  "home.tile.miniapps": "jugaad 🔌",
  "home.tile.pulse": "khabar ☕",
  "home.tile.wander": "safar ✈️",
  "home.tile.wallet": "batua 💳",
  "home.tile.clips": "majja 🎬",
};

// Odia & Assamese — pan-Indian Tier-0 fallback (honest: no verified
// regional equivalents for these exact 7 concepts in tonight's research).
const or: Dict = { ...en };
const as: Dict = { ...en };

const ur: Dict = {
  ...en,
  "home.tile.rides": "chalo 🚗",
  "home.tile.upi": "khazana 💰",
  "home.tile.miniapps": "jugaad 🔌",
  "home.tile.pulse": "khabar ☕",
  "home.tile.wander": "safar ✈️",
  "home.tile.wallet": "batua 💳",
  "home.tile.clips": "zabardast 🎬",
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
