import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A BOTTOM SHEET, the shape every overlay in the app shares: a fixed,
 * bottom-aligned overlay whose card is bounded by the one rule in
 * styles.css (max-height, scroll, safe-area). Escape and the scrim close
 * it. Hooks stay above the early return.
 */
export function OniqSheet({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  className,
  z = "z-50",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
  z?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className={`fixed inset-0 ${z} flex items-end justify-center bg-black/50`}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "w-full max-w-md rounded-t-3xl oniq-glass p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:max-w-lg lg:max-w-xl",
          className,
        )}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" aria-hidden="true" />
        {title ? <h2 className="font-display text-[15px] text-foreground">{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}
