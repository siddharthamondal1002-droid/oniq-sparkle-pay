/**
 * INSIGHTS — what ONIQ can honestly say about a person from their own logs.
 *
 * Owner reference, 2026-09-04: the reference drew an Insights screen. This is
 * the arithmetic behind it, kept pure so every claim it makes is testable
 * without a network or a render.
 *
 * TWO RULES SHAPE THE WHOLE FILE.
 *
 * FIRST, A TREND NEEDS ENOUGH DATA TO BE ONE. Two readings a fortnight apart
 * are not a direction, and a chart that draws them as one is inventing
 * confidence out of sparsity. Every summary therefore reports `unknown` rather
 * than `flat` when the window is too thin — the screen says "not enough yet",
 * which is true, instead of "steady", which is a claim nobody measured.
 *
 * SECOND, NO JUDGEMENT. Direction is reported; goodness is not. More sleep is
 * usually better and more sleep can be a symptom, and this file has no way to
 * tell which — so it says "up" and stops. app.vitals.tsx already carries the
 * standing disclaimer that none of this is a diagnosis, and colouring a
 * person's own numbers green and red would quietly contradict it.
 *
 * WHAT IS ABSENT AND WHY. The reference also drew Steps and Meditation. ONIQ
 * holds neither: `health_checkins` has no step count and no session log, and
 * both need a device sensor nothing in this app talks to. They are left out
 * rather than filled with a placeholder — see the "no steps" note already in
 * app.vitals.tsx, which is the same decision made once before.
 */

/** One day's value for one metric. */
export type Reading = { day: string; value: number };

/** Which way a metric moved. Never a judgement about whether that is good. */
export type Trend = "up" | "down" | "flat" | "unknown";

export type Summary = {
  count: number;
  latest: Reading | null;
  average: number | null;
  trend: Trend;
  /** Recent half's mean minus the earlier half's, when both halves qualify. */
  change: number | null;
};

/**
 * Readings each half of the window needs before a direction is reported.
 *
 * Three is the smallest number where one odd day cannot carry the answer on
 * its own. Below it the honest reply is that we do not know yet.
 */
export const MIN_PER_HALF = 3;

/**
 * The metrics ONIQ actually records, with the movement each one has to make
 * before it counts as movement.
 *
 * `flatBand` is in the metric's own unit and is deliberately per-metric: half
 * an hour of sleep is a real change, half a point of mood on a five-point
 * scale is how people answer the same question twice. A single shared epsilon
 * would call one of them noise and the other a trend.
 */
export type MetricId = "mood" | "energy" | "sleep_hrs" | "water_glasses";

export type Metric = {
  id: MetricId;
  label: string;
  /** Suffix shown after the number. Empty for a bare score. */
  unit: string;
  /** Decimal places worth showing — a mood of 3.47 is false precision. */
  places: number;
  flatBand: number;
};

export const METRICS: Metric[] = [
  { id: "mood", label: "Mood", unit: "/5", places: 1, flatBand: 0.3 },
  { id: "energy", label: "Energy", unit: "/5", places: 1, flatBand: 0.3 },
  { id: "sleep_hrs", label: "Sleep", unit: "h", places: 1, flatBand: 0.25 },
  { id: "water_glasses", label: "Water", unit: " glasses", places: 1, flatBand: 0.5 },
];

/** Oldest first, so "the recent half" means what it says. */
function byDay(readings: Reading[]): Reading[] {
  return [...readings].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * What can be said about one metric over one window.
 *
 * The window is split in half and the halves are compared, rather than fitting
 * a line: a fit reports a slope for any two points, which is exactly the false
 * confidence this file exists to refuse. A half that is too thin yields
 * `unknown` and a null change — not zero, which would read as "no movement".
 */
export function summarise(readings: Reading[], flatBand: number): Summary {
  const sorted = byDay(readings.filter((r) => Number.isFinite(r.value)));
  if (sorted.length === 0) {
    return { count: 0, latest: null, average: null, trend: "unknown", change: null };
  }

  const latest = sorted[sorted.length - 1];
  const average = mean(sorted.map((r) => r.value));

  const half = Math.floor(sorted.length / 2);
  const earlier = sorted.slice(0, half);
  const recent = sorted.slice(sorted.length - half);
  if (half < MIN_PER_HALF) {
    return { count: sorted.length, latest, average, trend: "unknown", change: null };
  }

  const change = mean(recent.map((r) => r.value)) - mean(earlier.map((r) => r.value));
  const trend: Trend = Math.abs(change) < flatBand ? "flat" : change > 0 ? "up" : "down";
  return { count: sorted.length, latest, average, trend, change };
}

/**
 * Where each reading sits inside a box, oldest on the leading edge.
 *
 * A run of identical values would divide by a zero range, so a flat series is
 * drawn down the middle rather than at the top — a line pinned to the ceiling
 * looks like a maximum, which is a different claim.
 */
export function sparkPoints(
  readings: Reading[],
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const sorted = byDay(readings.filter((r) => Number.isFinite(r.value)));
  if (sorted.length === 0) return [];
  const values = sorted.map((r) => r.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  const step = sorted.length === 1 ? 0 : width / (sorted.length - 1);
  return sorted.map((r, i) => ({
    x: sorted.length === 1 ? width / 2 : i * step,
    // SVG y grows downward, so a bigger value sits nearer the top.
    y: span === 0 ? height / 2 : height - ((r.value - low) / span) * height,
  }));
}

/**
 * Consecutive days of exercise, counting back from the most recent log.
 *
 * Counts back from the LATEST ROW, not from today: a person who logged
 * yesterday and has not opened the app since has not lost their streak, they
 * have simply not answered yet. Deciding otherwise would punish the gap
 * between opening the app and living the day.
 */
export function exerciseStreak(rows: Array<{ day: string; exercised: boolean | null }>): number {
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  let streak = 0;
  let expected: string | null = null;
  for (const row of sorted) {
    if (expected !== null && row.day !== expected) break;
    if (row.exercised !== true) break;
    streak += 1;
    expected = dayBefore(row.day);
  }
  return streak;
}

/** The calendar day before an ISO `YYYY-MM-DD`, in UTC so no zone can shift it. */
export function dayBefore(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Date(t - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type CycleSummary = {
  lastStart: string | null;
  /** Mean days between starts, when there are at least two to measure. */
  averageLength: number | null;
  /** How many gaps that mean was taken over — the honesty of the number. */
  measuredOver: number;
};

/**
 * What the cycle log supports saying.
 *
 * An average over one gap is that gap, and calling it an average dresses a
 * single observation as a pattern — so `averageLength` stays null until there
 * are two, and `measuredOver` travels with it so the screen can say how many.
 */
export function cycleSummary(starts: string[]): CycleSummary {
  const sorted = [...starts].filter(Boolean).sort();
  if (sorted.length === 0) return { lastStart: null, averageLength: null, measuredOver: 0 };
  const lastStart = sorted[sorted.length - 1];

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    const b = Date.parse(`${sorted[i]}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const days = Math.round((b - a) / (24 * 60 * 60 * 1000));
    if (days > 0) gaps.push(days);
  }
  if (gaps.length < 2) return { lastStart, averageLength: null, measuredOver: gaps.length };
  return { lastStart, averageLength: mean(gaps), measuredOver: gaps.length };
}
