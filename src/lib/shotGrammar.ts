/**
 * How a shot is framed and how the camera moves, from what the shot IS.
 *
 * The worker used to pick camera travel with `i % 3 === 0 ? 0 : 0.03` and pan
 * direction with `i % 2`. That is a pattern, not a decision — it produces a
 * camera that alternates on a metronome regardless of whether the shot is a
 * city-wide establisher or a face two feet from the lens.
 *
 * Ting already writes the shot size at the front of every `still` prompt,
 * because the plot system prompt asks it to. So the grammar is already in the
 * plan and only needs reading.
 *
 * THE NUMBERS ARE MEASURED, not chosen. End-to-end camera drift across six
 * Episode 3 clips ran 0.0, 0.0, 0.0, 1.7, 3.3, 5.1 and 19.2 percent of frame —
 * median 3.3, and half of them locked completely. Two things follow, and both
 * contradict what a stills pipeline would do:
 *
 *   1. A LOCKED CAMERA IS THE COMMONEST CHOICE, not a failure to add movement.
 *      Roughly half of shots should not move at all.
 *   2. When it moves, it varies by an order of magnitude. A uniform 6% Ken
 *      Burns on everything — which is what the episodes do — is a substitute
 *      for motion in a still, not a description of how a shot behaves.
 *
 * The other half of that measurement: the clip with the largest camera move
 * (19.2%) had the LOWEST subject motion (0.51), and the one that barely moved
 * (3.3%) had the highest (1.32). Camera and subject trade off. So the wider
 * shots here move the camera and the closer ones hold it, letting the character
 * carry the frame.
 *
 * PURE. No plan object, no rendering, no clock — a string in, a framing out, so
 * the whole grammar is testable without a browser.
 */

export type ShotSize = "establishing" | "wide" | "full" | "medium" | "close";

export type ShotFraming = {
  size: ShotSize;
  /** Camera travel as a fraction of frame. 0 is a locked shot. */
  travel: number;
  pan: "left" | "right" | "up" | "down" | "in";
  /** Figure height as a fraction of frame height, when a character is present. */
  figureHeight: number;
  /** Horizontal centre, as a fraction of frame width. */
  figureCenter: number;
};

/**
 * Words Ting actually uses, longest first.
 *
 * Longest-first matters: "extreme close" contains "close", and "medium wide"
 * contains both "medium" and "wide". Scanning shortest-first would classify a
 * medium wide as a close-up because "close" happened to appear later in the
 * sentence.
 */
const SIZE_WORDS: ReadonlyArray<readonly [string, ShotSize]> = [
  ["extreme close", "close"],
  ["extreme wide", "establishing"],
  ["establishing", "establishing"],
  ["full shot", "full"],
  ["full body", "full"],
  ["close-up", "close"],
  ["closeup", "close"],
  ["medium", "medium"],
  ["close", "close"],
  ["wide", "wide"],
  ["full", "full"],
];

/** The default when Ting says nothing recognisable. */
export const DEFAULT_SIZE: ShotSize = "medium";

export function readShotSize(stillPrompt: string): ShotSize {
  const text = stillPrompt.toLowerCase();
  // First OCCURRENCE wins, not first pattern in the list — a prompt is written
  // "Medium shot of a courtyard, the wide sky above" and the size is the word
  // at the front, which is where the system prompt asks for it.
  let best: { at: number; size: ShotSize } | null = null;
  for (const [word, size] of SIZE_WORDS) {
    const at = text.indexOf(word);
    if (at < 0) continue;
    if (!best || at < best.at) best = { at, size };
  }
  return best?.size ?? DEFAULT_SIZE;
}

/**
 * Framing per size.
 *
 * `travel` sits inside the measured range and follows the trade-off: wide
 * shots move, close shots hold. A close-up at 19% travel would be a whip pan
 * across somebody's face.
 */
const FRAMING: Readonly<Record<ShotSize, Omit<ShotFraming, "size" | "pan">>> = {
  // The one shot that earns a big move. 12% is under the measured 19.2% max.
  establishing: { travel: 0.12, figureHeight: 0.24, figureCenter: 0.5 },
  wide: { travel: 0.05, figureHeight: 0.42, figureCenter: 0.5 },
  full: { travel: 0.033, figureHeight: 0.62, figureCenter: 0.5 },
  // Locked. Half the measured clips were, and this is where a character's own
  // motion should be carrying the frame.
  medium: { travel: 0, figureHeight: 0.95, figureCenter: 0.5 },
  close: { travel: 0, figureHeight: 1.7, figureCenter: 0.5 },
};

/**
 * Pan direction, alternating across the shots that actually move.
 *
 * Alternating is deliberate and it is NOT the metronome this replaces: only
 * moving shots consume an alternation, so two pans in a row go opposite ways
 * however many locked shots sit between them. A film that pans right every
 * time reads as a drift; one that alternates reads as coverage.
 *
 * `movingIndex` is the count of moving shots BEFORE this one — the caller
 * tracks it, because a pure function cannot.
 */
export function panFor(size: ShotSize, movingIndex: number): ShotFraming["pan"] {
  // A gentle push is the natural move on a shot already close to its subject;
  // sliding sideways past a figure that nearly fills frame looks like a
  // mistake. It still consumes an alternation, so two pans either side of a
  // push go opposite ways.
  if (size === "full") return "in";
  // ONE rule for every sliding size. An earlier version gave each size its own
  // starting direction, which meant an establisher at index 0 and a wide at
  // index 1 both panned right — the exact drift the alternation exists to stop,
  // reintroduced by the thing meant to prevent it.
  return movingIndex % 2 === 0 ? "right" : "left";
}

export function framingFor(stillPrompt: string, movingIndex: number): ShotFraming {
  const size = readShotSize(stillPrompt);
  const base = FRAMING[size];
  return { size, pan: panFor(size, movingIndex), ...base };
}

/** Does this framing move the camera at all? */
export function isMoving(framing: ShotFraming): boolean {
  return framing.travel > 0;
}
