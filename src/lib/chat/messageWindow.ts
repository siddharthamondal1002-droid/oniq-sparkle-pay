// Track A1 — render fewer chat rows.
//
// WHY A WINDOW AND NOT A VIRTUALISER
//
// The instinct is @tanstack/react-virtual. Having looked at what the rows
// actually are, a window is the better trade here and the reasoning is worth
// keeping:
//
//   1. The rows are wildly variable in height — a one-word reply, a 16:9
//      video, a quoted reply plus a translation panel underneath. Windowing by
//      measurement needs an estimate per row, and a wrong estimate makes the
//      scroll position jump while you are reading. Janky is annoying; jumping
//      is unusable, and it is the failure mode users report as "it lost my
//      place".
//
//   2. Chat opens at the BOTTOM and is read upward. That is exactly the shape
//      a tail window fits: the recent rows are mounted, older ones are one tap
//      away. A virtualiser solves the harder problem of random access into a
//      long list, which is not the problem this screen has.
//
//   3. Reply-jump (scrollToMessage) has to be able to reach an old message. A
//      window can be widened deterministically to include it; with a
//      virtualiser the target may simply not be mounted when you ask.
//
// The list is already capped at 200 messages server-side, so the worst case is
// bounded either way. This is about how many of those 200 are in the DOM at
// once, which is the cost that actually shows up on a mid-range phone.

/** Rows kept mounted by default. Roughly three screens on a phone. */
export const WINDOW_STEP = 60;

/** The minimum shape this module needs; the screen's Row type is richer. */
export type WindowRow = { kind: string };

export type WindowedRows<T extends WindowRow> = {
  /** The rows to render, oldest first. */
  rows: T[];
  /** How many were left out of the top. Zero means everything is shown. */
  hidden: number;
};

/**
 * Take the last `size` rows, plus the day separator that belongs to them.
 *
 * The separator matters. Cutting the window at an arbitrary index can drop a
 * "Yesterday" header while keeping the messages under it, so the first thing
 * on screen is a message with no date — which reads as a rendering bug rather
 * than as the top of a window.
 */
export function windowRows<T extends WindowRow>(rows: T[], size: number): WindowedRows<T> {
  if (size <= 0) return { rows: [], hidden: rows.length };
  if (rows.length <= size) return { rows, hidden: 0 };

  let start = rows.length - size;

  // If the row just above the cut is a day separator, pull it in rather than
  // orphaning the messages below it.
  if (start > 0 && rows[start - 1].kind === "day" && rows[start].kind !== "day") {
    start -= 1;
  }

  return { rows: rows.slice(start), hidden: start };
}

/**
 * How wide the window must be to include a row that is currently hidden.
 *
 * Used by reply-jump. Returns the existing size when the row is already in
 * view or not present at all, so a caller can compare and skip a re-render.
 */
export function windowSizeToReveal<T extends WindowRow>(
  rows: T[],
  index: number,
  currentSize: number,
): number {
  if (index < 0 || index >= rows.length) return currentSize;
  // Rows from `index` to the end, plus a little context above it so the target
  // does not land flush against the top edge.
  const needed = rows.length - index + 5;
  return Math.max(currentSize, needed);
}
