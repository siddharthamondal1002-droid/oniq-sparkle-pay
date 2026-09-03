import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const ASPECT: Record<string, string> = {
  video: "aspect-video",
  wide: "aspect-[21/9]",
  portrait: "aspect-[9/16]",
  square: "aspect-square",
};

/**
 * A CINEMATIC MEDIA CARD. The media fills the frame; the caption sits over
 * a bottom gradient ONLY when `caption` is given — a third-party player
 * (YouTube's embed terms) gets nothing layered over it, so pass no caption
 * and put the text in `footer` instead.
 */
export function OniqMediaCard({
  media,
  caption,
  footer,
  aspect = "video",
  className,
  frameClassName,
  testId,
}: {
  media: ReactNode;
  caption?: ReactNode;
  footer?: ReactNode;
  aspect?: keyof typeof ASPECT;
  className?: string;
  frameClassName?: string;
  testId?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-3xl oniq-surface", className)} data-testid={testId}>
      <div
        className={cn("relative w-full overflow-hidden bg-black", ASPECT[aspect], frameClassName)}
      >
        {media}
        {caption ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-4 pt-10 text-white">
            {caption}
          </div>
        ) : null}
      </div>
      {footer ? <div className="p-3">{footer}</div> : null}
    </div>
  );
}
