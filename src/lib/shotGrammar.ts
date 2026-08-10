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
 *   1. A LOCKED CAMERA IS THE COMMONEST CHOICE IN FOOTAGE, not a failure to add
 *      movement — roughly half of the ep3 clips do not move at all. But see
 *      FRAMING below: that finding does NOT transfer to stills, because a
 *      locked camera on real footage still shows a person breathing, and a
 *      locked camera on a still shows nothing at all.
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
 * shots move a lot, close shots barely. A close-up at 19% travel would be a
 * whip pan across somebody's face.
 *
 * NOTHING HERE IS ZERO ANY MORE, AND THAT IS THE CORRECTION.
 *
 * medium and close used to be locked off at travel 0, with the comment "this is
 * where a character's own motion should be carrying the frame". That reasoning
 * was sound for the footage it came from and wrong for what it was applied to.
 * The measurements are from Episode 3 CLIPS — real video, where a locked camera
 * still shows a person breathing, blinking and turning. A Story shot is a
 * SINGLE STILL. There is no internal motion for a locked camera to reveal, so
 * travel 0 is not a held shot; it is a frozen JPEG on screen for eight seconds.
 *
 * A grammar measured from moving subjects cannot be transplanted onto stills
 * without changing the one assumption it rested on. Medium and close now drift
 * — slightly, far below the pans — so that every shot in a Story is alive even
 * when nothing in the picture is.
 */
const FRAMING: Readonly<Record<ShotSize, Omit<ShotFraming, "size" | "pan">>> = {
  // The one shot that earns a big move. 12% is under the measured 19.2% max.
  establishing: { travel: 0.12, figureHeight: 0.24, figureCenter: 0.5 },
  wide: { travel: 0.05, figureHeight: 0.42, figureCenter: 0.5 },
  full: { travel: 0.033, figureHeight: 0.62, figureCenter: 0.5 },
  // A push, not a slide: sliding sideways past a figure that nearly fills the
  // frame looks like a mistake. Small enough to read as breath rather than as
  // a zoom, and still an order below the establisher's 12%.
  medium: { travel: 0.022, figureHeight: 0.95, figureCenter: 0.5 },
  close: { travel: 0.016, figureHeight: 1.7, figureCenter: 0.5 },
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
  // A gentle push is the natural move on a shot already close to its subject:
  // sliding sideways past a figure that nearly fills the frame looks like a
  // mistake. These are also exactly the shots that used to be locked, which on
  // a still means frozen. A push still consumes an alternation, so two pans
  // either side of one go opposite ways.
  if (size === "full" || size === "medium" || size === "close") return "in";
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

/**
 * Does this framing move the camera at all?
 *
 * Now always true, and kept because it is the guard: a size added later with
 * travel 0 would be a frozen still, and shotGrammar.test.ts asserts this over
 * every size so that fails loudly rather than shipping.
 */
export function isMoving(framing: ShotFraming): boolean {
  return framing.travel > 0;
}

/**
 * Does this shot SLIDE, as opposed to push in?
 *
 * Only slides consume an alternation. This used to be the same question as
 * `isMoving`, because the shots that did not slide did not move at all — so the
 * caller counted moving shots and got the right answer by coincidence. Now that
 * every shot moves, counting movement would advance the alternation on every
 * push and two slides either side of one would go the same way, which is the
 * drift the alternation exists to prevent.
 */
export function isSlide(framing: ShotFraming): boolean {
  return framing.travel > 0 && framing.pan !== "in";
}
