import { useEffect, useRef, useState } from "react";

/**
 * Full-bleed reel video. Measures the real aspect on loadedmetadata:
 *  - near-vertical (w/h <= 0.68): object-cover — fills the slot edge to edge
 *  - square/landscape: contained + centered over a blurred, scaled, muted
 *    copy of the same source (Instagram-style ambient fill) — never flat bars
 * The backdrop follows the main video's play/pause so scroll behaviour is
 * driven entirely by the parent (IntersectionObserver stays in the player).
 */
export function ReelVideo({
  src,
  muted,
  videoRef,
  onClick,
}: {
  src: string;
  muted: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onClick?: () => void;
}) {
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const backRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const decide = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setFit(v.videoWidth / v.videoHeight <= 0.68 ? "cover" : "contain");
      }
    };
    if (v.readyState >= 1) decide();
    v.addEventListener("loadedmetadata", decide);
    const sync = () => {
      const b = backRef.current;
      if (!b) return;
      if (v.paused) b.pause();
      else void b.play().catch(() => {});
    };
    v.addEventListener("play", sync);
    v.addEventListener("pause", sync);
    return () => {
      v.removeEventListener("loadedmetadata", decide);
      v.removeEventListener("play", sync);
      v.removeEventListener("pause", sync);
    };
  }, [videoRef, src]);

  return (
    <>
      {fit === "contain" && (
        <video
          ref={backRef}
          src={src}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
        />
      )}
      <video
        ref={videoRef}
        data-testid="reel-video"
        src={src}
        loop
        playsInline
        muted={muted}
        preload="metadata"
        onClick={onClick}
        className={`absolute inset-0 h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
      />
    </>
  );
}
