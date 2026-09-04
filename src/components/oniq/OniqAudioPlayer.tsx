/**
 * THE TRANSPORT the reference draws on "Your Music" and "Your Voice":
 * a scrubber, elapsed and total time, and back-10 / play / forward-10.
 *
 * A REAL <audio> ELEMENT DOES THE WORK. Only its default chrome is replaced.
 * That matters for more than looks: the element handles streaming, range
 * requests, codec support and the OS media session, none of which a
 * hand-rolled player would, and it keeps working if this component's state
 * ever gets out of step with it. Everything below listens to the element
 * rather than trying to predict it — `timeupdate` and `durationchange` are
 * the sources of truth, so a seek performed by the OS or a headset button
 * still moves the bar.
 *
 * KEYBOARD AND SCREEN READERS COME FREE from using a real <input type=range>
 * for the scrubber and real <button>s for the transport, which is why they
 * are not divs with click handlers. The range is labelled, and the time is
 * announced as a live region so a person not watching the bar still hears
 * where they are.
 */
import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** mm:ss, and "0:00" for the NaN a not-yet-loaded element reports. */
export function clockTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** How far the skip buttons jump, in seconds. */
const SKIP = 10;

export function OniqAudioPlayer({
  src,
  className,
  label = "Your audio",
}: {
  src: string;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [total, setTotal] = useState(0);

  // Listen to the ELEMENT, never to our own guesses about it. A seek from the
  // lock screen, an autoplay block, or the track ending all arrive here.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onTime = () => setAt(el.currentTime);
    const onMeta = () => setTotal(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
    };
  }, []);

  const seek = (to: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(to, total || el.duration || 0));
    setAt(el.currentTime);
  };

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    // play() rejects when the browser blocks autoplay; swallowing it would
    // leave the button looking broken, so the element's own pause event is
    // what resets the icon.
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  const pct = total > 0 ? Math.min(100, (at / total) * 100) : 0;

  return (
    <div className={cn("w-full", className)}>
      {/* preload="metadata" so the duration is known without pulling the whole
          file down on a screen somebody may never press play on. */}
      <audio ref={ref} src={src} preload="metadata" className="hidden">
        <track kind="captions" />
      </audio>

      <label htmlFor="oniq-audio-seek" className="sr-only">
        Seek within {label}
      </label>
      <input
        id="oniq-audio-seek"
        type="range"
        min={0}
        max={Math.max(total, 0.01)}
        step={0.01}
        value={at}
        onChange={(e) => seek(Number(e.target.value))}
        data-testid="audio-seek"
        className="oniq-range w-full"
        style={{ ["--pct" as string]: `${pct}%` }}
      />

      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span data-testid="audio-at" aria-live="polite">
          {clockTime(at)}
        </span>
        <span>{clockTime(total)}</span>
      </div>

      <div className="mt-3 flex items-center justify-center gap-6">
        <button
          type="button"
          onClick={() => seek(at - SKIP)}
          aria-label={`Back ${SKIP} seconds`}
          data-testid="audio-back"
          className="press text-foreground"
        >
          <RotateCcw className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          data-testid="audio-play"
          className="press grid h-14 w-14 place-items-center rounded-full bg-world text-on-world world-glow"
        >
          {playing ? (
            <Pause className="h-6 w-6 fill-current" aria-hidden="true" />
          ) : (
            <Play className="h-6 w-6 translate-x-0.5 fill-current" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => seek(at + SKIP)}
          aria-label={`Forward ${SKIP} seconds`}
          data-testid="audio-forward"
          className="press text-foreground"
        >
          <RotateCw className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
