/**
 * ONIQ HEALTH — every door, in one place, shut by one flag.
 *
 * THE LESSON THIS FILE APPLIES is `upiDoors.test.ts`: a feature is where its
 * doors are, there are several of them across several files, and missing one
 * is the default outcome. The Home tile (`worlds.ts`), the bottom tab
 * (`app.tsx`) and the icon (`worldIcons.tsx`) are all declared HERE and only
 * spread into their lists when `healthDoorsOpen()` says so — so the flip is
 * one constant in `flags.ts`, and `healthDoors.test.ts` evaluates the same
 * expressions the app does, both ways: shut today, and openable by that flag
 * alone.
 *
 * HIDDEN IS NOT DELETED. `/app/health` resolves whether or not the doors are
 * open; the layout route answers "not switched on yet" while the flag is off,
 * so a deep link is a sentence rather than a 404.
 */
import { Stethoscope } from "lucide-react";
import type { WorldEntry } from "@/data/worlds";
import type { NavTab } from "@/components/oniq/OniqBottomNav";
import { HEALTH_ENABLED } from "./flags";

export const HEALTH_ROUTE = "/app/health";
export const HEALTH_NAV_PREFIX = HEALTH_ROUTE;

/** The Home / Explore tile. Rendered only through `healthDoorsOpen()`. */
export const HEALTH_WORLD: WorldEntry = {
  key: "health",
  to: HEALTH_ROUTE,
  world: "vitals",
  emoji: "🩺",
  hint: "Your records, documents and consents",
};

/** The bottom-nav tab for every path under /app/health. */
export const HEALTH_NAV: NavTab = {
  to: HEALTH_ROUTE,
  labelKey: "nav.health",
  fallback: "Health",
  icon: Stethoscope,
};

/**
 * The one expression every door evaluates. Takes the flag as an argument so
 * the test can ask "would this open?" without editing the constant.
 */
export function healthDoorsOpen(enabled: boolean = HEALTH_ENABLED): boolean {
  return enabled;
}
