import { X } from "lucide-react";
import type { RefObject } from "react";

/**
 * Small "×" clear button for search inputs. Renders nothing when the input is
 * empty. On tap, clears the field via `onClear` and refocuses the input.
 * Position it inside a relatively-positioned wrapper alongside the input.
 */
export function SearchClearButton({
  value,
  onClear,
  inputRef,
  className = "",
}: {
  value: string;
  onClear: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  if (!value) return null;
  return (
    <button
      type="button"
      aria-label="Clear"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClear();
        // refocus after state flush
        setTimeout(() => inputRef?.current?.focus(), 0);
      }}
      className={
        "grid h-6 w-6 place-items-center rounded-full bg-muted-foreground/25 text-foreground/80 transition hover:bg-muted-foreground/40 " +
        className
      }
    >
      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  );
}
