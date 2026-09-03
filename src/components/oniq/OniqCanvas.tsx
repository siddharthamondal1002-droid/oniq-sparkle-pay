/**
 * THE CANVAS — every world screen's outermost element.
 *
 * Sets the world (src/styles.css `[data-world]`), which is the only way a
 * screen gets its colours: the accent pair, the text-safe ink and the wash
 * strength all resolve from that one attribute, so a world never names a
 * hex of its own. `min-h-screen` is deliberate — inside the app shell it
 * means `--app-vh`, the height a screen actually gets.
 */
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type WorldId =
  | "home"
  | "chat"
  | "moments"
  | "mast"
  | "study"
  | "campus"
  | "rides"
  | "wanderlust"
  | "ting"
  | "scout"
  | "blessed"
  | "vitals"
  | "plug"
  | "pulse"
  | "official"
  | "earn"
  | "jobs"
  | "create"
  | "watch"
  | "lores"
  | "clips"
  | "profile";

export function OniqCanvas({
  world = "home",
  wash,
  className,
  style,
  children,
}: {
  world?: WorldId;
  /** 0–100: how much of the world's pair the canvas shows. Calm worlds turn it down. */
  wash?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const vars = wash === undefined ? undefined : ({ "--wash": `${wash}%` } as CSSProperties);
  return (
    <div
      data-world={world}
      className={cn("oniq-canvas min-h-screen text-foreground", className)}
      style={vars || style ? { ...vars, ...style } : undefined}
    >
      {children}
    </div>
  );
}
