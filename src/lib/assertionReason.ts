// Phase 1.2 — the assertion-reason generator, template-first.
//
// Built first because it is the most templatable exam format there is: the
// four options never change, so the entire generative problem reduces to
// choosing two statements and stating three booleans about them. Rule 3 says
// every exam-shaped item is an instantiated task model with a key derived BY
// CONSTRUCTION, and this format is where that is easiest to honour completely.
//
// WHAT "BY CONSTRUCTION" MEANS HERE
//
// The author does not write down which option is correct. The author states
// three facts about the content — is A true, is R true, does R explain A —
// and the key falls out of them. There is no field to get wrong, because
// there is no field. An author who mislabels the key is not possible; an
// author who mislabels the physics is, and that is what human review is for.
//
// THE FIFTH CASE THAT DOES NOT EXIST
//
// The standard CBSE form has exactly four options and there is NO "both A and
// R are false" case. Students routinely misread (d) as that, and a generator
// that invents a fifth option teaches the misreading. So both-false is not a
// case this module declines to emit — it is unrepresentable. deriveKey throws
// on it, and the type-level shape gives it nowhere to go.
//
// (a) and (b) are the hard discrimination, and both have A and R true. What
// separates them is only whether R EXPLAINS A. So `reasonExplainsAssertion` is
// the field that carries the item's difficulty, and it is meaningless unless
// both statements are true — which the validator enforces rather than trusts.

export const ASSERTION_REASON_OPTIONS = [
  "Both A and R are true, and R is the correct explanation of A.",
  "Both A and R are true, but R is not the correct explanation of A.",
  "A is true but R is false.",
  "A is false but R is true.",
] as const;

export type ARKeyIndex = 0 | 1 | 2 | 3;

export type ARTaskModel = {
  id: string;
  competency: string;
  /** The assertion, without the "Assertion (A):" prefix. */
  assertion: string;
  /** The reason, without the "Reason (R):" prefix. */
  reason: string;
  assertionTrue: boolean;
  reasonTrue: boolean;
  /**
   * Does R actually explain A? Only meaningful when both are true — the
   * validator rejects a model that sets this while either statement is false,
   * because a false statement cannot explain anything and letting it through
   * would hide an authoring error behind a plausible key.
   */
  reasonExplainsAssertion: boolean;
  /** Why the key is the key. Shown after answering, never before. */
  explanation: string;
  /** One named misconception per wrong option, keyed by option index. */
  distractorRationales: Record<number, string>;
  marks: number;
};

export class BothFalseError extends Error {
  constructor(id: string) {
    super(
      `${id}: both A and R are false. The standard assertion-reason form has no such option — rewrite one statement rather than inventing a fifth case.`,
    );
    this.name = "BothFalseError";
  }
}

/**
 * DERIVATION ONE — the truth table, read directly.
 *
 * Deliberately written as an exhaustive table rather than as branching logic,
 * so it can be compared line by line against the published option list.
 */
export function deriveKey(m: ARTaskModel): ARKeyIndex {
  const { assertionTrue: a, reasonTrue: r, reasonExplainsAssertion: x } = m;
  if (a && r && x) return 0;
  if (a && r && !x) return 1;
  if (a && !r) return 2;
  if (!a && r) return 3;
  throw new BothFalseError(m.id);
}

/**
 * DERIVATION TWO — the same conclusion reached a different way.
 *
 * Rule 4 requires two INDEPENDENT derivations, and two copies of the same
 * table would agree about a shared mistake. This one counts true statements
 * first and only then looks at the explanation, so its control flow shares no
 * structure with the table above. If both arrive at the same option, the
 * agreement means something.
 */
export function deriveKeyIndependently(m: ARTaskModel): ARKeyIndex {
  const trueCount = Number(m.assertionTrue) + Number(m.reasonTrue);
  if (trueCount === 0) throw new BothFalseError(m.id);
  if (trueCount === 1) {
    // Exactly one holds; the key says which.
    return m.assertionTrue ? 2 : 3;
  }
  // Both hold, so the item turns entirely on the causal link.
  return m.reasonExplainsAssertion ? 0 : 1;
}

export type ARValidationError = { field: string; message: string };

/**
 * Reject a task model that cannot produce an honest item, before any key is
 * derived. Authoring errors caught here never reach the verification gate.
 */
export function validateARTaskModel(m: ARTaskModel): ARValidationError[] {
  const errs: ARValidationError[] = [];

  if (!m.assertionTrue && !m.reasonTrue) {
    errs.push({
      field: "assertionTrue/reasonTrue",
      message: "Both statements are false, and the four-option form has no case for that.",
    });
  }

  // "R explains A" presupposes both are true. Setting it otherwise is an
  // authoring slip that would otherwise be invisible, because deriveKey
  // ignores the flag once a statement is false — the item would look fine and
  // the author's intent would be silently discarded.
  if (m.reasonExplainsAssertion && !(m.assertionTrue && m.reasonTrue)) {
    errs.push({
      field: "reasonExplainsAssertion",
      message:
        "R is marked as explaining A, but one of them is false. A false statement explains nothing.",
    });
  }

  if (m.assertion.trim().length < 15) {
    errs.push({ field: "assertion", message: "Assertion is too short to be a claim." });
  }
  if (m.reason.trim().length < 15) {
    errs.push({ field: "reason", message: "Reason is too short to be a reason." });
  }

  // The two statements must be distinct claims. A reason that restates the
  // assertion makes (a) trivially correct and teaches nothing.
  if (m.assertion.trim().toLowerCase() === m.reason.trim().toLowerCase()) {
    errs.push({ field: "reason", message: "The reason restates the assertion." });
  }

  if (m.explanation.trim().length < 40) {
    errs.push({ field: "explanation", message: "The explanation does not explain." });
  }

  if (m.marks <= 0) {
    errs.push({ field: "marks", message: "Marks must be positive." });
  }

  // Every option that is not the key needs a named misconception. Only
  // checked once the model is otherwise coherent, since deriveKey throws on
  // the both-false case.
  if (m.assertionTrue || m.reasonTrue) {
    const key = deriveKey(m);
    for (let i = 0; i < ASSERTION_REASON_OPTIONS.length; i++) {
      if (i === key) continue;
      const r = m.distractorRationales[i];
      if (!r || r.trim().length < 12) {
        errs.push({
          field: `distractorRationales[${i}]`,
          message: `Option ${"abcd"[i]} has no named misconception — a distractor nobody can justify is filler.`,
        });
      }
    }
  }

  return errs;
}

export type ARItem = {
  taskModelId: string;
  stem: string;
  options: string[];
  keyIndex: ARKeyIndex;
  explanation: string;
  distractorRationales: string[];
  marks: number;
};

/** Render a validated task model into an item. Throws if it does not validate. */
export function instantiateAR(m: ARTaskModel): ARItem {
  const errs = validateARTaskModel(m);
  if (errs.length) {
    throw new Error(`${m.id}: ${errs.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
  }
  const keyIndex = deriveKey(m);
  return {
    taskModelId: m.id,
    stem: `Assertion (A): ${m.assertion.trim()} Reason (R): ${m.reason.trim()} Select the correct option.`,
    options: [...ASSERTION_REASON_OPTIONS],
    keyIndex,
    explanation: m.explanation,
    // Ordered to match the options minus the key, which is what the lint
    // expects and what feedback iterates.
    distractorRationales: [0, 1, 2, 3]
      .filter((i) => i !== keyIndex)
      .map((i) => m.distractorRationales[i]),
    marks: m.marks,
  };
}
