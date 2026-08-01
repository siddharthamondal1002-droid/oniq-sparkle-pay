// Single resolution rule for ONIQ's own tile/category names, used by every
// tile renderer. `label` is international English — the default for every
// non-Hindi locale; `labelHi` renders only for locale `hi`; labelByCountry
// allows rare per-country English overrides. Brand names (Netflix, Nykaa,
// Swiggy, IRCTC…) never pass through this — Latin script in all locales.
import type { Country } from "@/data/appRegistry";

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

/** Hindi tile names — rendered only when the active locale is `hi`
 *  (resolveTileLabel); every other locale shows the international TILE_LABELS. */
export const TILE_LABELS_HI: Partial<
  Record<import("@/components/customize/CustomizeSheet").TileKey, string>
> = {
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
};
