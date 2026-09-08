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
  | "health"
  | "official"
  | "earn"
  | "moots"
  | "university"
  | "jobs"
  | "jobsApps"
  | "lores"
  | "watch"
  | "cv";

/** International English — shown for every locale except `hi`. */
export const TILE_LABELS: Record<TileKey, string> = {
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
  wander: "Wanderlust ✈️",
  faith: "Blessed 🙏",
  vitals: "Vitals 🫀",
  health: "Health 🩺",
  official: "Official 🏛️",
  earn: "earn 💸",
  moots: "Moots",
  university: "Campus",
  jobs: "Jobs",
  jobsApps: "Job apps",
  lores: "Lores 🎬",
  watch: "Watch 📺",
  cv: "CV",
};

/**
 * Rare per-country English overrides. Hindi always wins over these — a Hindi
 * speaker in the US still reads सीवी. Keep this table tiny: it exists for
 * words that are genuinely different in a market, not for flavour.
 */
export const TILE_LABELS_BY_COUNTRY: Partial<Record<TileKey, Partial<Record<Country, string>>>> = {
  // Americans say résumé (one page); everywhere else says CV.
  cv: { US: "Résumé" },
};

/** Hindi tile names — rendered only when the active locale is `hi`. */
export const TILE_LABELS_HI: Record<TileKey, string> = {
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
  health: "स्वास्थ्य 🩺",
  official: "सरकारी 🏛️",
  earn: "कमाई 💸",
  moots: "दोस्त",
  university: "कैंपस",
  jobs: "नौकरी",
  jobsApps: "नौकरी ऐप्स",
  lores: "किस्से 🎬",
  watch: "देखो 📺",
  cv: "सीवी",
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
export function tileName(lang: string, key: TileKey, country?: Country): string {
  return resolveTileLabel(lang, TILE_LABELS[key], TILE_LABELS_HI[key], {
    country,
    labelByCountry: TILE_LABELS_BY_COUNTRY[key],
  });
}

/**
 * The name WITHOUT its trailing emoji — for a tile that already draws a glyph.
 *
 * Every label above carries its emoji inline ("Moments ✨", "मस्त 🎬"), which
 * is right for a heading that stands alone and wrong for a tile whose icon
 * well is already showing one: the person sees the same glyph twice, and on
 * 2026-09-04 the second one wrapped onto its own line under a broken name
 * ("MOMENTS ✨" over a lone "✨"). Stripping is done by Unicode property, not
 * by a list of the emoji we happen to use today, so the Hindi labels and any
 * label added later are covered without a second edit.
 *
 * Only the TRAILING run goes. A name that is deliberately a glyph keeps it,
 * because stripping everything would leave an empty tile.
 */
export function tileNamePlain(lang: string, key: TileKey, country?: Country): string {
  const full = tileName(lang, key, country);
  const bare = full.replace(/[\s‍️\p{Extended_Pictographic}]+$/u, "").trim();
  return bare || full;
}
