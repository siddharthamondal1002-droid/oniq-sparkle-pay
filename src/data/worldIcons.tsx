/**
 * ONE DRAWN ICON, IN ONE COLOUR, PER WORLD.
 *
 * Owner reference, 2026-09-04: the world tiles are rounded-square badges, each
 * a pale wash of its OWN hue with that hue's glyph on top — a green car for
 * Rides, a blue plane for Wanderlust, a pink heart for Vitals. Read the grid
 * and you find the world you want by colour before you finish reading the
 * label. That is the whole point of the treatment, and it is what the previous
 * pass lost by tinting every badge with the screen's world gradient: eighteen
 * distinct worlds came out as eighteen near-identical teal squares.
 *
 * So each entry carries BOTH halves — the glyph and the hue — and the hue is a
 * name from the tint contract in styles.css, never a hex here.
 *
 * Emoji is the fallback, not the design. Emoji rendering varies between
 * Android devices: ✈️ is a blue jet on one handset, a grey outline on another,
 * and a tofu box on a stripped OEM font. A world's identity cannot be a glyph
 * the device gets to reinterpret. Lucide because the app already ships it —
 * a second icon set would be a download nobody needs.
 *
 * Keyed by TileKey so it lines up with tileName()/tileNamePlain() and the
 * worlds directory; a key with no entry falls back to its emoji rather than
 * rendering nothing.
 */
import {
  BookOpen,
  Brain,
  Briefcase,
  Building2,
  Car,
  Clapperboard,
  Film,
  GraduationCap,
  HandHeart,
  HeartPulse,
  Newspaper,
  Plane,
  Plug,
  Sparkles,
  Tv,
  Video,
  Wallet,
} from "lucide-react";
import type { Tint } from "@/components/oniq/OniqIconBadge";
import type { TileKey } from "@/lib/i18n/tileLabel";

export type WorldIcon = {
  Icon: React.ComponentType<{ className?: string }>;
  tint: Tint;
};

export const WORLD_ICON: Partial<Record<TileKey, WorldIcon>> = {
  // The ten in the reference, with the colour it draws each in.
  moments: { Icon: Sparkles, tint: "rose" },
  mast: { Icon: Clapperboard, tint: "violet" },
  ting: { Icon: Sparkles, tint: "sky" },
  faith: { Icon: HandHeart, tint: "amber" },
  vitals: { Icon: HeartPulse, tint: "pink" },
  rides: { Icon: Car, tint: "green" },
  wander: { Icon: Plane, tint: "blue" },
  pulse: { Icon: Newspaper, tint: "red" },
  official: { Icon: Building2, tint: "amber" },
  study: { Icon: BookOpen, tint: "blue" },
  // The rest of ONIQ's worlds, on the same system. Hues are picked to keep
  // neighbours in the grid distinguishable rather than to be decorative.
  university: { Icon: GraduationCap, tint: "indigo" },
  learn: { Icon: Brain, tint: "teal" },
  clips: { Icon: Video, tint: "orange" },
  miniapps: { Icon: Plug, tint: "sky" },
  watch: { Icon: Tv, tint: "teal" },
  lores: { Icon: Film, tint: "pink" },
  earn: { Icon: Wallet, tint: "amber" },
  jobs: { Icon: Briefcase, tint: "indigo" },
};
