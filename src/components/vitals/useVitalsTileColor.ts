import { useEffect, useState } from "react";

const SCORE_KEY = "oniq.vitals.score.v1";
const EXP_KEY = "oniq.vitals.experience.v1";

// interp two hex colors, t in [0..1]
function lerp(a: string, b: string, t: number) {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  const [ar, ag, ab] = [0, 2, 4].map((i) => parseInt(pa.slice(i, i + 2), 16));
  const [br, bg, bb] = [0, 2, 4].map((i) => parseInt(pb.slice(i, i + 2), 16));
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

const NEUTRAL = "#6B7280"; // gray when no data
const RED = "#EF4444";
const MEN_MAX = "#3B82F6";
const WOMEN_MAX = "#EC4899";

export function scoreToColor(score: number | null, experience: "men" | "women" | null): string {
  if (score == null) return NEUTRAL;
  const t = Math.max(0, Math.min(1, score / 100));
  const max = experience === "women" ? WOMEN_MAX : MEN_MAX;
  return lerp(RED, max, t);
}

export function useVitalsTileColor(): string {
  const [color, setColor] = useState<string>(NEUTRAL);
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(SCORE_KEY);
        const exp = localStorage.getItem(EXP_KEY) as "men" | "women" | null;
        const s = raw == null ? null : Number(raw);
        setColor(scoreToColor(Number.isFinite(s as number) ? (s as number) : null, exp));
      } catch { /* noop */ }
    };
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === SCORE_KEY || e.key === EXP_KEY) read();
    };
    const onCustom = () => read();
    window.addEventListener("storage", onStorage);
    window.addEventListener("oniq:vitals-changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("oniq:vitals-changed", onCustom);
    };
  }, []);
  return color;
}

export function writeVitalsCache(score: number | null, experience: "men" | "women" | null) {
  try {
    if (score == null) localStorage.removeItem(SCORE_KEY);
    else localStorage.setItem(SCORE_KEY, String(Math.round(score)));
    if (experience) localStorage.setItem(EXP_KEY, experience);
    window.dispatchEvent(new CustomEvent("oniq:vitals-changed"));
  } catch { /* noop */ }
}
