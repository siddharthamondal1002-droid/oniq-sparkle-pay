// Phase 1.4 — retrieval practice.
//
// The cheapest thing in this loop and one of only two techniques the
// literature rates high-utility: testing yourself beats re-reading, and Study
// already quizzes. What was missing is the half that makes it work.
//
// FEEDBACK NAMES THE MISCONCEPTION
//
// "Incorrect. The answer was C" teaches nothing. The student who picked B did
// so for a reason, and that reason is still intact after being told they were
// wrong — they will make the same mistake next week. So feedback here says
// what the chosen answer would be right about, or what wrong step produces it:
//
//   not  "Incorrect, the answer is 18 km/h"
//   but  "18 km/h is right. 30 comes from dividing 12 by 40 and reading the
//         result as km/h — the minutes have to become hours first."
//
// That is why distractors must carry named misconceptions all the way from the
// task model: this module is where the naming is spent.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// No score presented as a grade, no streak, no leaderboard, no comparison with
// anyone. Rule 6, and the audience is mostly under 18. A quiz result here is a
// list of what to look at again, which is the only thing formative practice
// should produce.

export type PracticeItem = {
  id: string;
  stem: string;
  options: string[];
  keyIndex: number;
  /** Why the key is the key. */
  explanation: string;
  /**
   * One entry per option, keyed by index, naming the misconception that
   * produces it. The key's own entry is optional and unused.
   */
  misconceptions: Record<number, string>;
};

export type ItemFeedback = {
  itemId: string;
  correct: boolean;
  chosenIndex: number;
  keyIndex: number;
  /** What the student sees. Never bare "incorrect". */
  message: string;
  /** The named misconception behind their choice, when they were wrong. */
  misconception: string | null;
  /** Why the key is the key — shown either way, since being right by luck is common. */
  explanation: string;
};

export class MissingMisconceptionError extends Error {
  constructor(itemId: string, index: number) {
    super(
      `${itemId}: option ${index} has no named misconception, so feedback would degrade to "incorrect". Fix the item rather than the feedback.`,
    );
    this.name = "MissingMisconceptionError";
  }
}

/**
 * Feedback for one answered item.
 *
 * Throws when a chosen distractor has no named misconception. That is
 * deliberate and is the opposite of defensive: silently falling back to
 * "incorrect" would let an item with filler distractors reach a student and
 * look fine, which is exactly the failure the lint and this module exist to
 * prevent. A missing rationale is an authoring bug, and it should surface as
 * one.
 */
export function feedbackFor(item: PracticeItem, chosenIndex: number): ItemFeedback {
  const correct = chosenIndex === item.keyIndex;
  if (correct) {
    return {
      itemId: item.id,
      correct: true,
      chosenIndex,
      keyIndex: item.keyIndex,
      message: `Right — ${item.options[item.keyIndex]}.`,
      misconception: null,
      explanation: item.explanation,
    };
  }

  const misconception = item.misconceptions[chosenIndex];
  if (!misconception || misconception.trim().length < 12) {
    throw new MissingMisconceptionError(item.id, chosenIndex);
  }

  return {
    itemId: item.id,
    correct: false,
    chosenIndex,
    keyIndex: item.keyIndex,
    // Names what they did, then what is true. Not a verdict.
    message: `${item.options[item.keyIndex]} is right. ${misconception}`,
    misconception,
    explanation: item.explanation,
  };
}

/**
 * Feedback for every wrong option at once, for a review screen.
 *
 * The loop asks that feedback explain why EACH distractor is wrong, not only
 * the one chosen — a student who guessed correctly still benefits from seeing
 * why the other three fail.
 */
export function allDistractorFeedback(item: PracticeItem): { option: string; why: string }[] {
  return item.options
    .map((option, i) => ({ option, i }))
    .filter(({ i }) => i !== item.keyIndex)
    .map(({ option, i }) => {
      const why = item.misconceptions[i];
      if (!why || why.trim().length < 12) throw new MissingMisconceptionError(item.id, i);
      return { option, why };
    });
}

export type PracticeOutcome = {
  answered: number;
  correct: number;
  /** Competencies to revisit, in the order they were met. Never a ranking. */
  revisit: string[];
  /** Per-item feedback, for the review screen. */
  feedback: ItemFeedback[];
};

/**
 * Summarise a completed set.
 *
 * Returns what to look at again. There is deliberately no percentage, no
 * grade, no streak and no comparison — a formative practice aid is not a
 * measurement instrument, and presenting a five-item result as a score
 * invites a minor to read it as one.
 */
export function summarise(
  items: PracticeItem[],
  answers: Record<string, number>,
  competencyOf: (itemId: string) => string,
): PracticeOutcome {
  const feedback: ItemFeedback[] = [];
  const revisit: string[] = [];
  let correct = 0;

  for (const item of items) {
    const chosen = answers[item.id];
    if (chosen === undefined) continue;
    const f = feedbackFor(item, chosen);
    feedback.push(f);
    if (f.correct) {
      correct += 1;
    } else {
      const c = competencyOf(item.id);
      if (!revisit.includes(c)) revisit.push(c);
    }
  }

  return { answered: feedback.length, correct, revisit, feedback };
}

/**
 * Which items to bring back, and when.
 *
 * Wrong answers return; right ones do not. That is the whole scheduling rule
 * at this stage, and it is deliberately not a spaced-repetition algorithm —
 * FSRS is Phase 2.1 and belongs there, with the review history it needs. A
 * half-built scheduler now would have to be unpicked then.
 */
export function itemsToRevisit(outcome: PracticeOutcome): string[] {
  return outcome.feedback.filter((f) => !f.correct).map((f) => f.itemId);
}
