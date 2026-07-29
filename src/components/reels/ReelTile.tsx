import { useState } from "react";
import { Eye, Play } from "lucide-react";

/**
 * One reel tile for profile grids. Uniform 9:16, solid background, rounded,
 * with the poster fallback chain:
 *   thumbnail_url → <video preload="metadata" #t=0.1> → branded placeholder.
 * The OS broken-media glyph can never appear: video errors flip to placeholder.
 */
export function ReelTile({
  thumbnailUrl,
  videoUrl,
  viewCount,
  onClick,
  topRight,
  onLongPress,
}: {
  thumbnailUrl: string | null;
  videoUrl: string;
  viewCount: number;
  onClick: () => void;
  topRight?: React.ReactNode;
  onLongPress?: () => void;
}) {
  const [thumbBroken, setThumbBroken] = useState(false);
  const [videoBroken, setVideoBroken] = useState(false);
  const useThumb = !!thumbnailUrl && !thumbBroken;
  const useVideo = !useThumb && !videoBroken;

  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const startPress = () => {
    if (!onLongPress) return;
    pressTimer = setTimeout(onLongPress, 500);
  };
  const endPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };

  return (
    <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-black">
      <button
        type="button"
        onClick={onClick}
        onTouchStart={startPress}
        onTouchEnd={endPress}
        onTouchMove={endPress}
        onContextMenu={(e) => {
          if (onLongPress) {
            e.preventDefault();
            onLongPress();
          }
        }}
        className="absolute inset-0 h-full w-full"
        aria-label="Open reel"
      >
        {useThumb ? (
          <img
            src={thumbnailUrl!}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : useVideo ? (
          <video
            src={`${videoUrl}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            onError={() => setVideoBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1230] via-[#241a40] to-[#0d0a18]">
            <span className="flex flex-col items-center gap-1 text-white/70">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-primary to-fuchsia-500 font-display text-sm font-bold text-white">
                O
              </span>
              <Play className="h-4 w-4" />
            </span>
          </span>
        )}
        {/* legibility scrim behind the stats pill */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/70 to-transparent" />
        <span className="absolute bottom-1 left-1.5 flex items-center gap-1 text-[10px] font-semibold text-white drop-shadow">
          <Eye className="h-3 w-3" /> {viewCount}
        </span>
      </button>
      {topRight && <span className="absolute right-1 top-1">{topRight}</span>}
    </div>
  );
}

export function ReelTileSkeleton() {
  return <div className="aspect-[9/16] animate-pulse rounded-lg bg-muted" />;
}
