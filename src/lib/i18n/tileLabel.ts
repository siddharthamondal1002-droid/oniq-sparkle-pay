// Single resolution rule for ONIQ's own tile/category names, used by every
// tile renderer. `label` is the original name (English and every non-Hindi
// locale — never machine-translated); `labelHi` renders only for locale `hi`.
// Brand names (Netflix, Nykaa, Myntra…) never pass through this — they stay
// in Latin script in all locales.
export function resolveTileLabel(lang: string, label: string, labelHi?: string): string {
  return lang === "hi" ? (labelHi ?? label) : label;
}

/** Hindi tile names — rendered only when the active locale is `hi`
 *  (resolveTileLabel); every other locale shows the original TILE_LABELS. */
export const TILE_LABELS_HI: Partial<
  Record<import("@/components/customize/CustomizeSheet").TileKey, string>
> = {
  watch: "देखो",
  study: "पढ़ाई",
  moments: "पल",
  mast: "मस्त 🎬",
  pulse: "ख़बर ☕",
  clips: "मस्त 🎬",
  ting: "टिंग ✨",
  rides: "चलो 🚗",
  miniapps: "जुगाड़ 🔌",
  upi: "ख़ज़ाना 💳",
  learn: "बचत 🧠",
  wander: "सफ़र ✈️",
  faith: "भक्ति 🙏",
  vitals: "सेहत 🫀",
};
