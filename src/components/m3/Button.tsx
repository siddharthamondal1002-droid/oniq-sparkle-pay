/**
 * Material 3's five buttons, plus the touch floor nobody should have to
 * remember.
 *
 * WHY NOT JUST EXTEND THE SHADCN BUTTON. Because M3's variants are not a
 * restyle of shadcn's — they are a different set with different meanings.
 * shadcn has default/outline/ghost/link; Material has filled, tonal,
 * outlined, text and elevated, and the interesting one is TONAL, which has no
 * shadcn equivalent at all. Tonal is the "secondary but still important"
 * button that most apps fake with a washed-out primary. Mapping five onto
 * four would lose it.
 *
 * The existing shadcn button stays exactly where it is. This does not replace
 * it by fiat — screens move over one at a time, and until one does its
 * buttons are untouched.
 *
 * HEIGHT IS 40px AND THE TOUCH TARGET IS 48px, WHICH IS NOT A CONTRADICTION.
 * Material draws a 40px button and requires 48dp of touchable area, so the
 * extra 8px is transparent padding around the visible shape. Getting this
 * wrong in the other direction — drawing a 48px button — is why some apps
 * look chunky; getting it wrong by omitting it is why some buttons are hard
 * to hit.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type M3ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "elevated";

/**
 * One row per Material variant. The comment on each is the question it
 * answers, because "which button do I use" is the decision this table exists
 * to make for people.
 */
const VARIANT: Record<M3ButtonVariant, string> = {
  /** The single most important action on the screen. */
  filled: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
  /** Important, but not the one. Material's own answer to a second button. */
  tonal:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70",
  /** A real action with a boundary, used when a filled one would shout. */
  outlined:
    "border border-border-strong bg-transparent text-foreground hover:bg-foreground/5 active:bg-foreground/10",
  /** The lowest emphasis there is — dismiss, cancel, "not now". */
  text: "bg-transparent text-primary hover:bg-primary/10 active:bg-primary/15",
  /** Filled's quieter cousin, for a button that must separate from its ground. */
  elevated: "m3-elev-1 bg-surface text-foreground hover:bg-surface-2 active:bg-surface-2",
};

export type M3ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: M3ButtonVariant;
  /** Leading icon. Material puts it before the label and never after. */
  icon?: React.ReactNode;
  fullWidth?: boolean;
};

export const M3Button = React.forwardRef<HTMLButtonElement, M3ButtonProps>(function M3Button(
  { variant = "filled", icon, fullWidth, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? "button"}
      data-m3-button={variant}
      className={cn(
        // 40px tall, full pill, label at labelLarge (14px/500) — all three are
        // the spec's numbers, not a preference.
        "relative inline-flex h-10 items-center justify-center gap-2 rounded-full px-6",
        "text-sm font-medium transition-colors",
        // The 48px touch target as a transparent overlay, so the BUTTON stays
        // 40px while the hit area is not. before: is used rather than padding
        // because padding would move the neighbours.
        "before:absolute before:left-0 before:top-1/2 before:h-12 before:w-full",
        "before:-translate-y-1/2 before:content-['']",
        "disabled:pointer-events-none disabled:opacity-38",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        VARIANT[variant],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {icon ? <span className="grid h-[18px] w-[18px] place-items-center">{icon}</span> : null}
      {children}
    </button>
  );
});
