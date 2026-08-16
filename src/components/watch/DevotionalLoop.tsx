/**
 * The devotional loop's controls, shared by Watch, Home and the faith tab.
 *
 * Three states, recovered from d879305b^:src/routes/_authenticated/app.index.tsx:
 *   PICKER  — no loop running: "loop for how long?" plus "just browse".
 *   RUNNING — a chip counting down, and a way to stop.
 *   ENDED   — "loop ended", with "replay" and "keep browsing".
 *
 * None of these is ever drawn OVER the player. The original put the picker on
 * an `absolute inset-0 z-30` overlay across the tile, which is exactly what
 * YouTube's embed terms forbid; here it sits above the frame instead. That is
 * the one deliberate departure from the recovered markup, and
 * src/data/__tests__/watchChannels.test.ts is what keeps it that way.
 */
import {
  DEVOTIONAL_DURATIONS,
  formatRemaining,
  loopRemainingSec,
  type LoopState,
} from "@/lib/devotionalLoop";

export function DevotionalPicker({
  onStart,
  onSkip,
  compact = false,
}: {
  onStart: (sec: number) => void;
  onSkip: () => void;
  compact?: boolean;
}) {
  return (
    <div
      data-testid="devotional-picker"
      className="mb-3 rounded-2xl border border-primary/30 bg-primary/5 p-3"
    >
      <div className="text-[11px] uppercase tracking-wider text-primary/90">devotional 🙏</div>
      <div className="mt-0.5 text-xs font-semibold">loop for how long?</div>
      <div className="no-scrollbar mt-2 flex flex-wrap items-center gap-1">
        {DEVOTIONAL_DURATIONS.map((d) => (
          <button
            key={d.sec}
            type="button"
            onClick={() => onStart(d.sec)}
            className="press rounded-full border border-primary/60 bg-primary/20 px-2.5 py-0.5 text-[11px] font-semibold"
          >
            {d.label}
          </button>
        ))}
        <button
          type="button"
          data-testid="devotional-skip"
          onClick={onSkip}
          className="press rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          just browse
        </button>
      </div>
      {!compact && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Keeps playing for the time you pick, even if you leave and come back. Nothing is cut off
          mid-track when it ends.
        </p>
      )}
    </div>
  );
}

export function DevotionalRunning({
  loop,
  now,
  onStop,
}: {
  loop: LoopState;
  now: number;
  onStop: () => void;
}) {
  if (!loop) return null;
  return (
    <div
      data-testid="devotional-running"
      className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      </span>
      looping · {formatRemaining(loopRemainingSec(loop, now))} left
      <button
        type="button"
        onClick={onStop}
        className="press rounded-full border border-border bg-card px-2 py-0.5 font-medium text-muted-foreground"
      >
        stop
      </button>
    </div>
  );
}

export function DevotionalEnded({
  onReplay,
  onBrowse,
}: {
  onReplay: () => void;
  onBrowse: () => void;
}) {
  return (
    <div
      data-testid="devotional-ended"
      className="mb-2 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px]"
    >
      <span className="text-muted-foreground">loop ended</span>
      <button
        type="button"
        onClick={onReplay}
        className="press rounded-full border border-primary/50 bg-primary/20 px-2 py-0.5 font-semibold text-primary"
      >
        replay
      </button>
      <button
        type="button"
        onClick={onBrowse}
        className="press rounded-full border border-border px-2 py-0.5 text-muted-foreground"
      >
        keep browsing
      </button>
    </div>
  );
}
