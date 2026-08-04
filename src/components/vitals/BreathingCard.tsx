// Guided breathing — pure client, works offline, no account, no paywall.
// Visual pacer + screen-reader phase announcements via aria-live.
import { useEffect, useRef, useState } from "react";
import { Wind, X } from "lucide-react";

type Phase = { label: string; seconds: number; scale: number };
type Pattern = { id: string; name: string; desc: string; phases: Phase[] };

const PATTERNS: Pattern[] = [
  {
    id: "box",
    name: "Box breathing",
    desc: "4 · 4 · 4 · 4 — steady and grounding",
    phases: [
      { label: "breathe in", seconds: 4, scale: 1 },
      { label: "hold", seconds: 4, scale: 1 },
      { label: "breathe out", seconds: 4, scale: 0.55 },
      { label: "hold", seconds: 4, scale: 0.55 },
    ],
  },
  {
    id: "478",
    name: "4-7-8",
    desc: "long exhale — good before sleep",
    phases: [
      { label: "breathe in", seconds: 4, scale: 1 },
      { label: "hold", seconds: 7, scale: 1 },
      { label: "breathe out", seconds: 8, scale: 0.55 },
    ],
  },
  {
    id: "coherent",
    name: "Coherent",
    desc: "5 in · 5 out — calm rhythm",
    phases: [
      { label: "breathe in", seconds: 5, scale: 1 },
      { label: "breathe out", seconds: 5, scale: 0.55 },
    ],
  },
];

export function BreathingCard() {
  const [active, setActive] = useState<Pattern | null>(null);
  return (
    <section className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Wind className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="font-display text-lg font-bold">breathe 🌬️</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        two minutes of slow breathing settles the nervous system. free, offline, yours.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p)}
            data-testid={`breathe-${p.id}`}
            className="press rounded-2xl border border-border bg-background p-3 text-left"
          >
            <div className="text-sm font-semibold">{p.name}</div>
            <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{p.desc}</div>
          </button>
        ))}
      </div>
      {active && <BreathingOverlay pattern={active} onClose={() => setActive(null)} />}
    </section>
  );
}

function BreathingOverlay({ pattern, onClose }: { pattern: Pattern; onClose: () => void }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [count, setCount] = useState(pattern.phases[0].seconds);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setPhaseIdx(0);
    setCount(pattern.phases[0].seconds);
    let idx = 0;
    let left = pattern.phases[0].seconds;
    timer.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        idx = (idx + 1) % pattern.phases.length;
        left = pattern.phases[idx].seconds;
        setPhaseIdx(idx);
      }
      setCount(left);
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [pattern]);

  const phase = pattern.phases[phaseIdx];

  return (
    <div
      // Full-screen breathing exercise, not a card — opts out of the app-wide
      // modal bounding in styles.css.
      data-full-bleed
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 p-6"
      role="dialog"
      aria-label={`${pattern.name} breathing exercise`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close breathing exercise"
        className="press absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] grid h-10 w-10 place-items-center rounded-full border border-border bg-card"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="text-xs uppercase tracking-wider text-muted-foreground">{pattern.name}</div>

      <div className="relative mt-8 grid h-56 w-56 place-items-center">
        <div
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/15 transition-transform ease-in-out"
          style={{
            transform: `scale(${phase.scale})`,
            transitionDuration: `${phase.seconds * 1000}ms`,
          }}
        />
        <div
          aria-hidden
          className="absolute inset-8 rounded-full bg-primary/25 transition-transform ease-in-out"
          style={{
            transform: `scale(${phase.scale})`,
            transitionDuration: `${phase.seconds * 1000}ms`,
          }}
        />
        <div className="relative text-center" aria-live="polite">
          <div className="font-display text-2xl font-bold">{phase.label}</div>
          <div className="mt-1 text-sm text-muted-foreground">{count}</div>
        </div>
      </div>

      <p className="mt-10 max-w-xs text-center text-xs text-muted-foreground">
        follow the circle — in as it grows, out as it settles. stop anytime.
      </p>
    </div>
  );
}
