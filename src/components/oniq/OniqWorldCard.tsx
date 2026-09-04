/**
 * A WORLD, AS A TILE. The badge carries the world's own hue (or the person's
 * own tile skin, which wins), the label comes from tileName() — never inline —
 * and the whole thing is one tap target with the 48dp slop.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { OniqIconBadge, type Tint } from "./OniqIconBadge";
import type { WorldId } from "./OniqCanvas";

type Common = {
  world: WorldId;
  label: ReactNode;
  sublabel?: ReactNode;
  emoji?: string;
  icon?: ReactNode;
  /**
   * The badge hue, from WORLD_ICON. Distinct per world on purpose — the
   * reference makes colour the way you find a world without reading.
   */
  tint?: Tint;
  /** A tile skin the person uploaded; shown instead of the tinted badge. */
  skin?: string | null;
  /** A small status dot colour (e.g. the Vitals mood), any CSS colour. */
  dot?: string | null;
  layout?: "tile" | "row";
  className?: string;
  testId?: string;
};

export function OniqWorldCard({
  world,
  label,
  sublabel,
  emoji,
  icon,
  tint,
  skin,
  dot,
  layout = "tile",
  className,
  testId,
  to,
  search,
  onClick,
}: Common & {
  to?: string;
  search?: Record<string, string | boolean>;
  onClick?: () => void;
}) {
  // THE BADGE. The reference draws every world as a rounded-square badge in
  // its OWN hue — the colour is how you find a world without reading its
  // label. `tint` carries that hue; a card given none falls back to slate
  // rather than borrowing the screen's world gradient, which is what made
  // eighteen worlds render as eighteen of the same colour.
  //
  // A person's own tile skin still wins and still fills the whole badge, so
  // the dot and the radius have to live on a wrapper rather than on the
  // badge itself.
  const inner = skin ? (
    <img src={skin} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
  ) : icon ? (
    icon
  ) : (
    <span className={layout === "tile" ? "text-xl" : "text-lg"}>{emoji}</span>
  );
  const well = (
    <span className="relative shrink-0">
      {skin ? (
        <span
          aria-hidden="true"
          className={cn(
            "grid place-items-center overflow-hidden",
            layout === "tile" ? "h-12 w-12 rounded-[14px]" : "h-11 w-11 rounded-[13px]",
          )}
        >
          {inner}
        </span>
      ) : (
        <OniqIconBadge tint={tint ?? "slate"} size={layout === "tile" ? "lg" : "md"}>
          {inner}
        </OniqIconBadge>
      )}
      {dot ? (
        <span
          className="absolute end-0.5 top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card"
          style={{ background: dot }}
        />
      ) : null}
    </span>
  );
  // `w-full` is load-bearing for the truncate below: inside a centred flex
  // column the span would otherwise shrink to its text and never clip.
  const text = (
    <span className={cn("min-w-0", layout === "tile" ? "mt-1.5 w-full text-center" : "text-start")}>
      {/*
        ONE LINE, NEVER BROKEN MID-WORD.

        `break-words` was here, and it is what rendered "WANDERLUS" over "T":
        overflow-wrap:break-word is allowed to split INSIDE a word once the
        word cannot fit, and at five tiles to a row a long name never fits.
        `truncate` (nowrap + ellipsis) cannot split a word by construction —
        a name too long for its tile ends in "…" and stays readable, which is
        the failure mode worth having. The title attribute keeps the full
        name reachable for anyone who needs it.
      */}
      <span
        className={cn(
          // NORMAL CASE, against the app-wide .font-display uppercase rule.
          // Caps plus 0.02em tracking makes "WANDERLUST" ~68px wide; a tile at
          // five to a 390px row has ~65px, so the name truncated to "WANDERL…"
          // — legible-as-failure, still not a word. Mixed case is ~55px and
          // fits outright, and it is what the reference draws. `truncate`
          // stays as the guard for a longer name in another language.
          "block font-display normal-case leading-tight tracking-normal text-foreground",
          layout === "tile" ? "truncate text-[10.5px]" : "truncate text-[12px]",
        )}
        title={typeof label === "string" ? label : undefined}
      >
        {label}
      </span>
      {sublabel ? (
        <span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground">
          {sublabel}
        </span>
      ) : null}
    </span>
  );
  const cls = cn(
    "press tap flex min-w-0",
    layout === "tile"
      ? "flex-col items-center rounded-2xl px-1 py-2"
      : "items-center gap-3 rounded-2xl oniq-surface p-3",
    className,
  );
  // `data-world` stays on the ROOT, not on the badge: the badge is tinted by
  // its own hue now, but anything world-scoped on the card (the press ripple,
  // a focus ring) still needs the world's pair in scope.
  if (to) {
    return (
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        to={to as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        search={search as any}
        preload="intent"
        data-world={world}
        className={cls}
        onClick={onClick}
        data-testid={testId}
      >
        {well}
        {text}
      </Link>
    );
  }
  return (
    <button type="button" data-world={world} className={cls} onClick={onClick} data-testid={testId}>
      {well}
      {text}
    </button>
  );
}
