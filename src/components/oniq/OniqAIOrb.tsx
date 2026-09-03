import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZE: Record<string, string> = {
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-16 w-16",
  xl: "h-24 w-24",
};
const ICON: Record<string, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-5 w-5",
  lg: "h-7 w-7",
  xl: "h-10 w-10",
};

/**
 * THE ONIQ AI ORB. A gradient sphere that breathes — one transform
 * animation on one small element, no blur, no particles; it holds still
 * under prefers-reduced-motion (styles.css). Decorative: aria-hidden.
 */
export function OniqAIOrb({
  size = "md",
  className,
  still = false,
}: {
  size?: keyof typeof SIZE;
  className?: string;
  still?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-grid shrink-0 place-items-center", SIZE[size], className)}
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-world world-glow",
          !still && "animate-breathe",
        )}
      />
      <span className="absolute inset-[18%] rounded-full bg-white/25" />
      <Sparkles className={cn("relative text-white", ICON[size])} />
    </span>
  );
}
