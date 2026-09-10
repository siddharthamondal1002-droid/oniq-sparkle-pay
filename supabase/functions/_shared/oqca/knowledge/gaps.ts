/**
 * OQCA v1.1 — knowledge-gap detection. Brief section 11.
 *
 * "The function must be deterministic. Do not perform web research yet. The
 * purpose of this milestone is to prove that OQCA can identify a knowledge gap
 * before adding external acquisition."
 *
 * PURE, and that is the deliverable rather than an implementation taste: given
 * a goal, the concepts it requires, and a knowledge state, it returns the same
 * four-way verdict and the same priority ordering on every machine, every run.
 * Nothing here fetches, and `security.test.ts` asserts this whole directory
 * opens no network path.
 *
 * THE FOUR STATUSES ARE NOT A SCALE, and collapsing them into one number is the
 * mistake this shape exists to avoid:
 *
 *   UNKNOWN      the concept is absent, or nothing bears on it at all
 *   UNCERTAIN    evidence exists and is thin, volatile, or weakly agreed
 *   CONTRADICTED evidence exists on BOTH sides above the dispute threshold
 *   VERIFIED     evidence is strong, settled, and one-sided
 *
 * CONTRADICTED is emphatically not "very uncertain". A claim with two strong
 * opposing sources is a different problem from one with no sources: the first
 * needs adjudication, the second needs a search. A single confidence number
 * cannot tell them apart, which is why `Confidence` carries volatility and why
 * this returns a status rather than a score.
 */
import { evidenceFor, type KnowledgeState } from "./model.ts";

export type GapStatus = "UNKNOWN" | "UNCERTAIN" | "CONTRADICTED" | "VERIFIED";

export type Goal = {
  readonly id: string;
  readonly statement: string;
  /** Concepts the goal cannot be met without, and how much each matters. */
  readonly requires: readonly { readonly conceptId: string; readonly importance: number }[];
};

export type Gap = {
  readonly conceptId: string;
  readonly status: GapStatus;
  readonly importance: number;
  /** 0 = settled, 1 = nothing is known. */
  readonly uncertainty: number;
  /** How many OTHER required concepts depend on this one, normalised. */
  readonly dependency: number;
  /** Expected reduction in uncertainty from one good answer, in [0, 1]. */
  readonly expectedInformationGain: number;
  readonly priority: number;
  readonly supportingEvidence: number;
  readonly opposingEvidence: number;
  /** Why this status, in the words a person would want. */
  readonly reason: string;
};

/** Above this, evidence on both sides is a CONTRADICTION rather than noise. */
export const DISPUTE_THRESHOLD = 0.5;
/** At or above this, one-sided settled evidence is VERIFIED. */
export const VERIFIED_THRESHOLD = 0.85;

function round12(x: number): number {
  // Determinism across runtimes: the priority ordering must not depend on the
  // last bits of a product of four floats.
  return Math.round(x * 1e12) / 1e12;
}

export function detectGaps(goal: Goal, knowledge: KnowledgeState): Gap[] {
  const required = goal.requires.map((r) => r.conceptId);
  const gaps: Gap[] = goal.requires.map(({ conceptId, importance }) => {
    const concept = knowledge.concepts.get(conceptId);
    const evidence = concept ? evidenceFor(knowledge, conceptId) : [];
    const supporting = evidence.filter((e) => e.supports);
    const opposing = evidence.filter((e) => !e.supports);

    const strength = (xs: typeof evidence) =>
      xs.length === 0 ? 0 : Math.max(...xs.map((e) => e.confidence.value));
    const supportStrength = strength(supporting);
    const opposeStrength = strength(opposing);
    const volatility =
      evidence.length === 0
        ? 1
        : evidence.reduce((a, e) => a + e.confidence.volatility, 0) / evidence.length;

    let status: GapStatus;
    let reason: string;
    if (!concept) {
      status = "UNKNOWN";
      reason = "the concept is not in the knowledge state at all";
    } else if (evidence.length === 0) {
      status = "UNKNOWN";
      reason = "the concept exists but no evidence bears on it";
    } else if (supportStrength >= DISPUTE_THRESHOLD && opposeStrength >= DISPUTE_THRESHOLD) {
      status = "CONTRADICTED";
      reason = `evidence on both sides above ${DISPUTE_THRESHOLD} (support ${supportStrength.toFixed(2)}, oppose ${opposeStrength.toFixed(2)})`;
    } else if (supportStrength >= VERIFIED_THRESHOLD && opposeStrength === 0 && volatility <= 0.2) {
      status = "VERIFIED";
      reason = `one-sided evidence at ${supportStrength.toFixed(2)} with low volatility`;
    } else {
      status = "UNCERTAIN";
      reason = `best support ${supportStrength.toFixed(2)}, volatility ${volatility.toFixed(2)}`;
    }

    // Uncertainty: nothing known is 1; a contradiction is held HIGH deliberately
    // (an unresolved dispute is not partial knowledge), and settled one-sided
    // evidence falls away as its confidence rises.
    const uncertainty =
      status === "UNKNOWN"
        ? 1
        : status === "CONTRADICTED"
          ? Math.max(0.75, 1 - Math.abs(supportStrength - opposeStrength))
          : Math.min(1, (1 - supportStrength) * 0.5 + volatility * 0.5);

    // Dependency: how many OTHER required concepts name this one, so a missing
    // foundation outranks a missing leaf even when both matter equally.
    const dependents = required.filter((other) => {
      if (other === conceptId) return false;
      return knowledge.concepts.get(other)?.dependsOn.includes(conceptId) ?? false;
    }).length;
    const dependency = required.length <= 1 ? 1 : 1 + dependents / (required.length - 1);

    // Expected information gain: how much one good answer could move this. A
    // contradiction gains the most (adjudication resolves it), a verified
    // concept the least — asking again about a settled fact gains nothing.
    const expectedInformationGain =
      status === "VERIFIED"
        ? 0.05
        : status === "CONTRADICTED"
          ? 0.9
          : status === "UNKNOWN"
            ? 0.8
            : 0.5;

    return {
      conceptId,
      status,
      importance,
      uncertainty: round12(uncertainty),
      dependency: round12(dependency),
      expectedInformationGain,
      priority: round12(importance * uncertainty * dependency * expectedInformationGain),
      supportingEvidence: supporting.length,
      opposingEvidence: opposing.length,
      reason,
    };
  });

  // Highest priority first; ties broken by concept id so the ORDER is
  // deterministic too, not merely the numbers.
  return gaps.sort((a, b) => b.priority - a.priority || a.conceptId.localeCompare(b.conceptId));
}

/** Only the gaps worth doing something about. VERIFIED is not one. */
export function openGaps(gaps: readonly Gap[]): Gap[] {
  return gaps.filter((g) => g.status !== "VERIFIED");
}
