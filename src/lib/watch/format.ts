/** Small formatting helpers shared by the Watch library surfaces. */

/** 1052 → "17:32"; 3725 → "1:02:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** "17:32 / 43:08" — the Continue card's line. */
export function formatProgressClock(position: number, duration: number | null): string {
  return duration ? `${formatClock(position)} / ${formatClock(duration)}` : formatClock(position);
}

/** 2588 → "43 min"; 90 → "2 min"; 5400 → "1 h 30 min". */
export function formatMinutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Whole days between two instants, never negative. */
export function daysBetween(from: string | Date, to: Date): number {
  const a = typeof from === "string" ? new Date(from).getTime() : from.getTime();
  if (!Number.isFinite(a)) return 0;
  return Math.max(0, Math.floor((to.getTime() - a) / 86_400_000));
}

/** "today", "yesterday", "12 days ago". */
export function daysAgoLabel(from: string | Date | null, now: Date): string {
  if (!from) return "never";
  const d = daysBetween(from, now);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/** "mm:ss" or "h:mm:ss" typed by a person → seconds, or null when unreadable. */
export function parseClock(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return null;
  const nums = parts.map(Number);
  return parts.length === 3 ? nums[0] * 3600 + nums[1] * 60 + nums[2] : nums[0] * 60 + nums[1];
}
