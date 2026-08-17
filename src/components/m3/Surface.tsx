/**
 * A Material 3 surface — the elevation system as a component.
 *
 * WHY A COMPONENT AND NOT JUST THE UTILITY CLASS. `m3-elev-3` is one string
 * and nothing stops it appearing on a card, which is the drift this whole
 * exercise is meant to end. A surface asks what it IS — a card, a dialog, a
 * drawer — and the level follows from that. Somebody reaching for level 3 on
 * a resting card has to type `role="dialog"` to get it, and will notice.
 *
 * SHAPE COMES WITH IT, because in Material the two are not independent: a
 * dialog is level 3 AND a 28px corner, a card is level 1 AND 12px. Letting a
 * caller pick them separately is how you end up with a dialog-shaped card.
 * `shape` overrides only when a surface genuinely is an exception.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { SHAPE, type ElevationLevel } from "@/design/material";

/**
 * The surfaces this app actually has, each pinned to its Material level and
 * corner. Adding a role is a design decision made once, here, rather than at
 * forty call sites.
 */
export const SURFACE_ROLES = {
  /** The page itself. No shadow, no tint — the ground everything sits on. */
  page: { level: 0 as ElevationLevel, radius: SHAPE.none },
  /** A card at rest. */
  card: { level: 1 as ElevationLevel, radius: SHAPE.md },
  /** A card that is raised, hovered or pressed. */
  raised: { level: 2 as ElevationLevel, radius: SHAPE.md },
  /** Dialogs, menus and bottom sheets — M3's expressive 28px corner. */
  dialog: { level: 3 as ElevationLevel, radius: SHAPE.xl },
  /** The navigation drawer. */
  drawer: { level: 4 as ElevationLevel, radius: SHAPE.lg },
  /** Something dragged above everything else. */
  dragged: { level: 5 as ElevationLevel, radius: SHAPE.md },
} as const;

export type SurfaceRole = keyof typeof SURFACE_ROLES;

const ELEV_CLASS: Record<ElevationLevel, string> = {
  0: "m3-elev-0",
  1: "m3-elev-1",
  2: "m3-elev-2",
  3: "m3-elev-3",
  4: "m3-elev-4",
  5: "m3-elev-5",
};

export type SurfaceProps = React.HTMLAttributes<HTMLDivElement> & {
  role_: SurfaceRole;
  /** Only for a surface that genuinely is an exception to its role's corner. */
  shape?: keyof typeof SHAPE;
  as?: "div" | "section" | "aside" | "article";
};

export const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { role_, shape, as = "div", className, style, ...rest },
  ref,
) {
  const spec = SURFACE_ROLES[role_];
  const radius = shape ? SHAPE[shape] : spec.radius;
  const Tag = as;
  return (
    <Tag
      ref={ref}
      data-m3-surface={role_}
      data-m3-elevation={spec.level}
      className={cn(ELEV_CLASS[spec.level], className)}
      // Inline rather than a Tailwind class because the radius comes from the
      // ROLE, and a role is data. Generating a class per role would put the
      // same number in two places, which is what material.test.ts exists to
      // stop happening.
      style={{ borderRadius: radius === SHAPE.full ? "9999px" : `${radius}px`, ...style }}
      {...rest}
    />
  );
});
