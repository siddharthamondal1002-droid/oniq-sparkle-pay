/**
 * THE ICON BADGE — the one shape every icon in the owner's 2026-09-04
 * reference is drawn in.
 *
 * A rounded square, a pale wash of one hue, that hue's saturated glyph on top.
 * It appears in four places in the reference and is identical in all of them:
 * the ten world tiles on Home, the seven Create cards, the five Explore rows,
 * and the six rows of the attachment sheet. Making it one component is what
 * keeps them identical — the previous pass drew each screen's badge by hand
 * and they drifted in radius, size and tint within a week.
 *
 * The colour comes from `tint`, which sets [data-tint] and nothing else; the
 * hues live in styles.css next to the world contract. A badge NEVER names a
 * hex of its own.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tint } from "@/design/tints";

/**
 * Re-exported so components can take the hue straight from the badge, while
 * the data files that NAME a hue (create capabilities, world icons) import it
 * from @/design/tints and stay free of React.
 */
export type { Tint };

/**
 * Three sizes, measured off the reference rather than picked:
 * - `sm` (36px) the attachment sheet and stat chips,
 * - `md` (44px) the world tiles and Explore rows,
 * - `lg` (48px) the Create cards, which carry two lines of text beside them.
 */
type Size = "sm" | "md" | "lg";

const BOX: Record<Size, string> = {
  // The radius is ~30% of the box in the reference — squarish with soft
  // corners, NOT a circle. rounded-2xl (16px) on a 44px box reads as a
  // circle, which is what the previous pass shipped.
  sm: "h-9 w-9 rounded-[11px]",
  md: "h-11 w-11 rounded-[13px]",
  lg: "h-12 w-12 rounded-[14px]",
};

/**
 * Written out in full because Tailwind scans SOURCE TEXT: a class built by
 * interpolation (`[&>svg]:${…}`) is never generated, and the badge would ship
 * with no glyph sizing at all. Every variant a component can emit has to
 * appear literally somewhere in the file.
 */
const GLYPH: Record<Size, string> = {
  sm: "[&>svg]:h-[18px] [&>svg]:w-[18px]",
  md: "[&>svg]:h-[21px] [&>svg]:w-[21px]",
  lg: "[&>svg]:h-[22px] [&>svg]:w-[22px]",
};

export function OniqIconBadge({
  tint,
  size = "md",
  children,
  solid = false,
  className,
}: {
  tint: Tint;
  size?: Size;
  /** A lucide icon element; sized by the badge, so pass it without classes. */
  children: ReactNode;
  /** Filled hue with white glyph — the reference uses this only for Create. */
  solid?: boolean;
  className?: string;
}) {
  return (
    <span
      data-tint={tint}
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center [&>svg]:shrink-0",
        BOX[size],
        GLYPH[size],
        solid ? "bg-tint text-white" : "bg-tint-soft text-tint",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The glyph size for a given badge size, for callers that size their own. */
export function badgeGlyphClass(size: Size = "md") {
  return GLYPH[size];
}
