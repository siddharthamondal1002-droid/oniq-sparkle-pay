// Single resolution rule for ONIQ's own tile/category names, used by every
// tile renderer. `label` is international English — the default for every
// non-Hindi locale; `labelHi` renders only for locale `hi`; labelByCountry
// allows rare per-country English overrides.
//
// Brand names (Netflix, Nykaa, Swiggy, IRCTC, Jinvani…) NEVER pass through
// here — they stay Latin script in every locale, including `hi`.
//
// English names are deliberately punchy but not slang-of-the-moment: slang
// dates within months. Transliterated Hindi (Khabar, Jugaad, Lingo) is gone
// from the English set — it reads as noise to a user in Toronto or Singapore.
import type { Country } from "@/data/appRegistry";

/** Every tile ONIQ can render. Source of truth for the label tables below. */
export type TileKey =
  | "watch"
  | "study"
  | "moments"
  | "mast"
  | "pulse"
  | "clips"
  | "ting"
  | "rides"
  | "miniapps"
  | "upi"
  | "learn"
  | "wander"
  | "faith"
  | "vitals"
  | "official"
  | "earn"
  | "moots";

/** International English — shown for every locale except `hi`. */
export const TILE_LABELS: Record<TileKey, string> = {
  watch: "Watch",
  study: "Study 📚",
  moments: "Moments ✨",
  mast: "Mast 🎬",
  pulse: "Pulse",
  clips: "brainrot 🎬",
  ting: "Ting ✨",
  rides: "Rides 🚗",
  miniapps: "Hacks 🔌",
  upi: "tap in 💳",
  learn: "Scout 🧠",
  wander: "touch grass ✈️",
  faith: "Blessed 🙏",
  vitals: "Vitals 🫀",
  official: "Official 🏛️",
  earn: "earn 💸",
  moots: "Moots",
};

/** Hindi tile names — rendered only when the active locale is `hi`. */
export const TILE_LABELS_HI: Record<TileKey, string> = {
  watch: "देखो",
  study: "पढ़ाई",
  moments: "पल",
  mast: "मस्त 🎬",
  pulse: "खबर",
  clips: "मस्त 🎬",
  ting: "टिंग ✨",
  rides: "सवारी 🚗",
  miniapps: "जुगाड़ 🔌",
  upi: "ख़ज़ाना 💳",
  learn: "भाव 🧠",
  wander: "सफ़र ✈️",
  faith: "आस्था 🙏",
  vitals: "सेहत 🫀",
  official: "सरकारी 🏛️",
  earn: "कमाई 💸",
  moots: "दोस्त",
};

export function resolveTileLabel(
  lang: string,
  label: string,
  labelHi?: string,
  opts?: { country?: Country; labelByCountry?: Partial<Record<Country, string>> },
): string {
  if (lang === "hi") return labelHi ?? label;
  const c = opts?.country;
  return (c && opts?.labelByCountry?.[c]) ?? label;
}

/**
 * The one call every renderer should make: name a tile by key and the locale
 * decides. Keeps label copies out of individual screens.
 */
export function tileName(lang: string, key: TileKey): string {
  return resolveTileLabel(lang, TILE_LABELS[key], TILE_LABELS_HI[key]);
}
