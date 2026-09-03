/**
 * A WORLD, AS A TILE. The icon well carries the world's gradient (or the
 * person's own tile skin, which wins), the label comes from tileName() —
 * never inline — and the whole thing is one tap target with the 48dp slop.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { WorldId } from "./OniqCanvas";

type Common = {
  world: WorldId;
  label: ReactNode;
  sublabel?: ReactNode;
  emoji?: string;
  icon?: ReactNode;
  /** A tile skin the person uploaded; shown instead of the gradient well. */
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
  const well = (
    <span
      data-world={world}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-2xl text-white world-glow",
        layout === "tile" ? "h-14 w-14" : "h-12 w-12",
        !skin && "bg-world",
      )}
      aria-hidden="true"
    >
      {skin ? (
        <img
          src={skin}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : icon ? (
        icon
      ) : (
        <span className={layout === "tile" ? "text-2xl" : "text-xl"}>{emoji}</span>
      )}
      {dot ? (
        <span
          className="absolute end-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white"
          style={{ background: dot }}
        />
      ) : null}
    </span>
  );
  const text = (
    <span className={cn("min-w-0", layout === "tile" ? "mt-2 text-center" : "text-start")}>
      <span
        className={cn(
          "block font-display leading-tight text-foreground",
          layout === "tile" ? "line-clamp-2 break-words text-[11px]" : "truncate text-[12px]",
        )}
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
  if (to) {
    return (
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        to={to as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        search={search as any}
        preload="intent"
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
    <button type="button" className={cls} onClick={onClick} data-testid={testId}>
      {well}
      {text}
    </button>
  );
}
