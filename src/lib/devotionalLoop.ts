/**
 * The devotional loop — restored.
 *
 * Owner note, 2026-08-16: "also devotional loop channels and all other
 * features which you have missed from history". The removal commit d879305b
 * lists what went, and its own words name this one: "the second player behind
 * the home Watch tile (with its devotional loop timer)". Everything below is
 * recovered from d879305b^:src/routes/_authenticated/app.index.tsx.
 *
 * WHAT THE LOOP IS FOR, because it is easy to mistake for a sleep timer.
 * Someone puts kirtan or a bayan on and wants it to keep going for a set
 * stretch — through the aarti, through the drive, overnight — without the
 * screen having to stay awake or the app having to stay foregrounded. So the
 * loop is anchored to two REAL TIMESTAMPS in localStorage, not to a running
 * interval: background the app for an hour, come back, and a 3-hour loop is
 * two hours in rather than restarted. An interval-based timer loses that the
 * moment the OS suspends the tab, which is most of the time on a phone.
 *
 * WHILE THE LOOP IS ACTIVE the auto-tour is OFF. That is the whole difference
 * between a loop and a shuffle: every video plays to completion and the ENDED
 * event wraps to the next, instead of a 2-minute timer cutting each one short.
 *
 * WHEN IT ELAPSES nothing is force-stopped mid-video — advancing simply stops,
 * and the user is offered "replay" or "keep browsing". Killing audio in the
 * middle of a recitation would be the wrong end of the trade.
 *
 * FAITH ISOLATION is carried through here rather than re-derived per screen.
 * Strict faith-ID equality, no default list, no index-based access: a faith
 * with no channels shows its own empty state and NEVER another faith's
 * content. That was the Jain bleed bug, and the fix holds whether the
 * destination is an embed or a link.
 */
import type { FaithId } from "@/data/faithContent";

/** The religion key app.faith.tsx persists. Its own list, mirrored. */
export type Religion = "hindu" | "islam" | "christian" | "sikh" | "buddhist" | "jain" | "jewish";

/** Where app.faith.tsx stores the user's choice. Read-only from here. */
export const FAITH_LS_KEY = "oniq.faith.religion.v1";

const LOOP_START_KEY = "oniq.watch.devotionalLoopStartedAt";
const LOOP_DUR_KEY = "oniq.watch.devotionalLoopDurationSec";

/** The devotional tab's id in the Watch/Home genre row. */
export const DEVOTIONAL_GENRE_ID = "devotional";

/** Original durations, recovered verbatim. Changing them is an owner call. */
export const DEVOTIONAL_DURATIONS: { label: string; sec: number }[] = [
  { label: "10 min", sec: 10 * 60 },
  { label: "30 min", sec: 30 * 60 },
  { label: "1 hr", sec: 60 * 60 },
  { label: "3 hr", sec: 3 * 60 * 60 },
  { label: "6 hr", sec: 6 * 60 * 60 },
  { label: "12 hr", sec: 12 * 60 * 60 },
  { label: "24 hr", sec: 24 * 60 * 60 },
];

/**
 * Religion → faith id. STRICT: an unknown value maps to null, never to a
 * default faith. app.faith.tsx has the same mapping at the point it writes
 * the key; this is the read side, and the two are pinned together by
 * src/lib/__tests__/devotionalLoop.test.ts.
 */
export function religionToFaithId(religion: Religion | null): FaithId | null {
  if (!religion) return null;
  if (religion === "islam") return "islamic";
  if (
    religion === "hindu" ||
    religion === "sikh" ||
    religion === "christian" ||
    religion === "buddhist" ||
    religion === "jain" ||
    religion === "jewish"
  )
    return religion;
  return null;
}

/** The user's faith, or null when they have not chosen one. Never a guess. */
export function readFaithPref(): FaithId | null {
  if (typeof window === "undefined") return null;
  try {
    return religionToFaithId(localStorage.getItem(FAITH_LS_KEY) as Religion | null);
  } catch {
    return null;
  }
}

export type LoopState = { startedAt: number; durationSec: number } | null;

export function readLoop(): LoopState {
  if (typeof window === "undefined") return null;
  try {
    const s = localStorage.getItem(LOOP_START_KEY);
    const d = localStorage.getItem(LOOP_DUR_KEY);
    if (!s || !d) return null;
    const startedAt = Number(s);
    const durationSec = Number(d);
    if (!Number.isFinite(startedAt) || !Number.isFinite(durationSec)) return null;
    if (startedAt <= 0 || durationSec <= 0) return null;
    return { startedAt, durationSec };
  } catch {
    return null;
  }
}

export function writeLoop(startedAt: number, durationSec: number): void {
  try {
    localStorage.setItem(LOOP_START_KEY, String(startedAt));
    localStorage.setItem(LOOP_DUR_KEY, String(durationSec));
  } catch {
    /* noop */
  }
}

export function clearLoop(): void {
  try {
    localStorage.removeItem(LOOP_START_KEY);
    localStorage.removeItem(LOOP_DUR_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Where a loop stands RIGHT NOW, given the wall clock.
 *
 * `now` is a parameter rather than a Date.now() call so the caller owns the
 * tick and the behaviour is testable without faking timers.
 */
export function loopPhase(loop: LoopState, now: number): "none" | "active" | "ended" {
  if (!loop) return "none";
  return now - loop.startedAt < loop.durationSec * 1000 ? "active" : "ended";
}

/** Seconds left, floored at zero. For the countdown next to the frame. */
export function loopRemainingSec(loop: LoopState, now: number): number {
  if (!loop) return 0;
  return Math.max(0, Math.round((loop.startedAt + loop.durationSec * 1000 - now) / 1000));
}

/** "2h 45m" / "45m" / "30s" — short enough for a chip. */
export function formatRemaining(sec: number): string {
  if (sec <= 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}
