// Phase 1.5 — the key verification gate.
//
// This is the highest-consequence rule in the loop. A confidently wrong key
// shown to a fourteen-year-old teaches a misconception, and does it with the
// authority of a right answer — which is worse than showing nothing. Rule 4:
// no item reaches a student without key verification.
//
// TWO INDEPENDENT DERIVATIONS, OR A HUMAN
//
// "Independent" is doing real work in that sentence. Two calls to the same
// function agree about that function's bugs, so a second derivation is only
// worth having if it reaches the answer by a different route — a different
// control flow, or a solver rather than a lookup. assertionReason.ts carries
// two: one reads an exhaustive truth table, the other counts true statements
// and then consults the causal link. They share no branches.
//
// FAILURE IS QUARANTINE, NOT A GUESS
//
// When derivations disagree the item is held. It is never resolved by picking
// one, by majority, or by asking a model to break the tie — a disagreement
// means the item is not understood, and publishing the more popular answer
// would launder that into confidence. The database backs this up: the CHECK
// constraint refuses status='approved' without key_verified_by, and RLS hides
// anything not approved from the client, so a bug in this file cannot leak an
// unverified item on its own.

export type Derivation = {
  /** How this answer was reached. Two derivations with the same name are not independent. */
  method: string;
  /** The derived key, as a string so MCQ indices and numeric answers compare alike. */
  key: string;
};

export type VerificationOutcome = {
  verified: boolean;
  /** Matches the assessment_item.key_verified_by column. */
  verifiedBy: "derivation" | "human" | null;
  key: string | null;
  quarantine: boolean;
  reason: string | null;
};

export type HumanApproval = {
  userId: string;
  key: string;
  approvedAt: string;
};

/**
 * Verify a key from derivations, optionally with a human approval to fall back
 * on.
 *
 * A human approval outranks a derivation disagreement — that is the point of
 * the review queue — but it is recorded as 'human' so the provenance never
 * claims a machine check that did not happen.
 */
export function verifyKey(
  derivations: Derivation[],
  human?: HumanApproval | null,
): VerificationOutcome {
  const distinctMethods = new Set(derivations.map((d) => d.method));

  if (human) {
    return {
      verified: true,
      verifiedBy: "human",
      key: human.key,
      quarantine: false,
      reason: null,
    };
  }

  if (derivations.length < 2) {
    return {
      verified: false,
      verifiedBy: null,
      key: derivations[0]?.key ?? null,
      quarantine: true,
      reason: `Only ${derivations.length} derivation(s); Rule 4 requires two that agree, or a human.`,
    };
  }

  // Two runs of the same method are one derivation twice. Accepting them would
  // turn the gate into a formality that agrees with itself.
  if (distinctMethods.size < 2) {
    return {
      verified: false,
      verifiedBy: null,
      key: derivations[0].key,
      quarantine: true,
      reason: `All derivations used the same method ("${derivations[0].method}") — they are not independent.`,
    };
  }

  const keys = new Set(derivations.map((d) => d.key));
  if (keys.size > 1) {
    const detail = derivations.map((d) => `${d.method}=${d.key}`).join(", ");
    return {
      verified: false,
      verifiedBy: null,
      key: null,
      quarantine: true,
      // Never resolved by majority. A disagreement means the item is not
      // understood, and the popular answer is not therefore the right one.
      reason: `Derivations disagree (${detail}). Quarantined for review; a disagreement is not resolved by vote.`,
    };
  }

  return {
    verified: true,
    verifiedBy: "derivation",
    key: derivations[0].key,
    quarantine: false,
    reason: null,
  };
}

/**
 * The row shape assessment_item expects. Building it here rather than at each
 * call site means the status and the verification columns cannot disagree —
 * the database CHECK would reject that, but failing at the boundary is a
 * clearer error than a constraint violation from three layers away.
 */
export function itemStatusFor(outcome: VerificationOutcome): {
  status: "approved" | "quarantined";
  key_verified_by: "derivation" | "human" | null;
  verified_at: string | null;
  quarantine_reason: string | null;
} {
  if (outcome.verified && outcome.verifiedBy) {
    return {
      status: "approved",
      key_verified_by: outcome.verifiedBy,
      // Caller stamps the real time; a placeholder here would be a lie that
      // satisfies the constraint.
      verified_at: null,
      quarantine_reason: null,
    };
  }
  return {
    status: "quarantined",
    key_verified_by: null,
    verified_at: null,
    quarantine_reason: outcome.reason,
  };
}

/**
 * Running key-error rate, for the Phase 1 gate and the standing cadence.
 *
 * Above 2%, the loop says free generation goes off and the pipeline falls back
 * to pure template instantiation. That is a hard trigger, so it is a function
 * rather than a note in a document.
 */
export const KEY_ERROR_LIMIT = 0.02;

export function freeGenerationAllowed(checked: number, keyErrors: number): boolean {
  // With no evidence, the safe default is template-only. An empty sample is
  // not a passing sample.
  if (checked === 0) return false;
  return keyErrors / checked <= KEY_ERROR_LIMIT;
}
