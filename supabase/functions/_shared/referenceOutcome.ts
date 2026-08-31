/**
 * Why a reference-conditioned still failed — and what that failure may cost.
 *
 * THE BUG THIS FIXES, measured 2026-08-31. `story-still` answers 422 to any
 * request carrying `referenceImage`, because the in-house engine cannot
 * condition on one. The worker's ask ladder reads 422 as "the CONTENT is
 * refused: step down", and steps to the next rung. Rung 2 is people-less
 * scenery by construction.
 *
 * So a SUCCESSFULLY RESOLVED character reference made the shot worse: the
 * engine's inability to use a reference was charged against the shot's
 * subject matter, and a shot that was meant to show a person was redrawn as
 * an empty landscape. Nobody chose that; it fell out of two reasonable rules
 * meeting at a status code that could not tell them apart.
 *
 * FOUR OUTCOMES, THREE OF WHICH ARE NOT ABOUT THE CONTENT:
 *
 *   CONTENT_REFUSED           the ask itself was rejected. Stepping down the
 *                             prompt is the correct response — this is the
 *                             only case where it is.
 *   CAPABILITY_UNSUPPORTED    the engine cannot condition on a reference at
 *                             all. Retry the SAME rung without the reference.
 *                             The prompt was never the problem.
 *   INVALID_REFERENCE         this particular reference is unusable (wrong
 *                             shape, unfetchable, not ours). Same rung, no
 *                             reference.
 *   TRANSIENT                 the service hiccuped. Same rung, same
 *                             reference, after a pause.
 *
 * A capability failure must NEVER lower the prompt rung. That sentence is the
 * whole module, and `storyReferenceOutcome.test.ts` holds it.
 */

export type ReferenceOutcome =
  | "CONTENT_REFUSED"
  | "CAPABILITY_UNSUPPORTED"
  | "INVALID_REFERENCE"
  | "TRANSIENT";

/** What the caller should do next. `stepDown` is the expensive one. */
export type ReferenceRecovery = {
  outcome: ReferenceOutcome;
  /** Move to a weaker prompt rung. True for CONTENT_REFUSED and nothing else. */
  stepDown: boolean;
  /** Try again without attaching the reference. */
  dropReference: boolean;
  /** Try again unchanged, after a pause. */
  retrySameAsk: boolean;
};

/**
 * A stable marker the engine returns when it is the CAPABILITY that is
 * missing rather than the ask that is refused. Sent as a field, not sniffed
 * out of prose: an English error message is not an API, and matching on one
 * is how the original confusion survived so long.
 */
export const CAPABILITY_MARKER = "reference-conditioning-unsupported";

export function classifyReferenceFailure(input: {
  status: number;
  /** The machine-readable code the function returned, when it sent one. */
  code?: string | null;
  /** Whether this request actually carried a reference. */
  sentReference: boolean;
}): ReferenceRecovery {
  const { status, code, sentReference } = input;

  // The engine said, in a field, that it cannot do this. Nothing about the
  // content is implicated, so the prompt must not be weakened.
  if (code === CAPABILITY_MARKER) {
    return {
      outcome: "CAPABILITY_UNSUPPORTED",
      stepDown: false,
      dropReference: true,
      retrySameAsk: false,
    };
  }

  if (status === 429 || status >= 500) {
    return {
      outcome: "TRANSIENT",
      stepDown: false,
      dropReference: false,
      retrySameAsk: true,
    };
  }

  if (status === 422 || status === 400) {
    // A 422 on a request that carried a reference is ambiguous by
    // construction — the old engine used it for both meanings. Resolve it in
    // the direction that cannot silently destroy a shot: treat the REFERENCE
    // as the suspect, not the subject matter. If the ask is genuinely refused
    // the retry without the reference will say so again, and only then does
    // the ladder step down. One extra call is cheaper than a person becoming
    // an empty landscape.
    if (sentReference) {
      return {
        outcome: "INVALID_REFERENCE",
        stepDown: false,
        dropReference: true,
        retrySameAsk: false,
      };
    }
    return {
      outcome: "CONTENT_REFUSED",
      stepDown: true,
      dropReference: false,
      retrySameAsk: false,
    };
  }

  // Anything unrecognised is treated as transient rather than as a verdict on
  // the content: guessing "the story is bad" from an unknown status is the
  // same mistake in a new place.
  return {
    outcome: "TRANSIENT",
    stepDown: false,
    dropReference: false,
    retrySameAsk: true,
  };
}
