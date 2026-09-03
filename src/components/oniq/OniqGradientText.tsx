import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function OniqGradientText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("text-gradient-world", className)}>{children}</span>;
}
