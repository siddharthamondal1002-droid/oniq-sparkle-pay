/**
 * ONE DRAWN ICON PER WORLD.
 *
 * Owner mission, 2026-09-04: "Replace excessive emoji dependence... emoji
 * appearance varies between Android devices." That variance is the real
 * argument — ✈️ is a blue jet on one handset, a grey outline on another, and
 * a tofu box on a stripped OEM font. A world's identity cannot be a glyph the
 * device gets to reinterpret, so every tile draws a vector instead and the
 * emoji stays only where it is decoration.
 *
 * Lucide, because the app already ships it (`lucide-react` is a dependency and
 * the bottom nav, Create sheet and half the screens draw from it) — adding a
 * second icon set for this would be a download nobody needs.
 *
 * Keyed by TileKey so it lines up with tileName()/tileNamePlain() and with the
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
import type { TileKey } from "@/lib/i18n/tileLabel";

export const WORLD_ICON: Partial<Record<TileKey, React.ComponentType<{ className?: string }>>> = {
  moments: Sparkles,
  mast: Clapperboard,
  clips: Video,
  study: BookOpen,
  university: GraduationCap,
  learn: Brain,
  rides: Car,
  wander: Plane,
  pulse: Newspaper,
  official: Building2,
  ting: Sparkles,
  faith: HandHeart,
  vitals: HeartPulse,
  miniapps: Plug,
  watch: Tv,
  lores: Film,
  earn: Wallet,
  jobs: Briefcase,
};
