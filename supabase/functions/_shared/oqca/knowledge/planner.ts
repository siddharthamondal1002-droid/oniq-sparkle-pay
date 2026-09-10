/**
 * OQCA v1.1 — information-gain-driven research planning. Brief section 12.
 *
 * "The research planner should select the knowledge gap that is expected to
 * reduce uncertainty the most per unit cost... Do not actually perform network
 * research in this milestone."
 *
 * So this RANKS and nothing else. It returns a plan; it does not execute one,
 * and there is no code path here that could. `security.test.ts` asserts the
 * whole `knowledge/` tree names no network primitive at all — because a planner
 * that could dispatch is one edit away from an autonomous agent, and the brief
 * (section 18, Security) forbids exactly that.
 *
 * THE RANKING IS GAIN PER UNIT COST, NOT GAIN. That is the whole point of
 * section 12 and it changes the order: a contradiction worth 0.9 that costs 10
 * ranks below an unknown worth 0.5 that costs 1. A planner that sorted by gain
 * alone would spend its whole budget on the single most interesting question,
 * which is how a research loop stops making progress.
 *
 * COST IS SUPPLIED, NEVER GUESSED. `estimateCost` is a caller-provided function
 * and the default is uniform 1 — because a cost model this file invented would
 * be a number nobody measured driving a decision, and CLAUDE.md carries the
 * receipt for what that costs (the invented lab ranges, deleted 2026-09-09).
 */
import type { Gap } from "./gaps.ts";

export type ResearchCandidate = {
  readonly concept: string;
  readonly reason: string;
  readonly expectedInformationGain: number;
  readonly dependencyCount: number;
  readonly uncertainty: number;
  readonly costEstimate: number;
  /** priority / cost — what the plan is actually sorted by. */
  readonly valuePerCost: number;
};

export type ResearchPlan = {
  readonly goalId: string;
  readonly candidates: readonly ResearchCandidate[];
  /** The single best next question, or null when nothing is worth asking. */
  readonly next: ResearchCandidate | null;
  readonly totalCost: number;
  readonly rationale: string;
};

export type CostModel = (gap: Gap) => number;

/** The honest default: every question costs the same until somebody measures. */
export const UNIFORM_COST: CostModel = () => 1;

export function planResearch(
  goalId: string,
  gaps: readonly Gap[],
  estimateCost: CostModel = UNIFORM_COST,
  budget = Number.POSITIVE_INFINITY,
): ResearchPlan {
  const candidates: ResearchCandidate[] = gaps
    .filter((g) => g.status !== "VERIFIED")
    .map((g) => {
      const costEstimate = estimateCost(g);
      if (!(costEstimate > 0)) throw new Error("OQCA planner: cost must be positive");
      return {
        concept: g.conceptId,
        reason: `${g.status}: ${g.reason}`,
        expectedInformationGain: g.expectedInformationGain,
        dependencyCount: g.supportingEvidence + g.opposingEvidence,
        uncertainty: g.uncertainty,
        costEstimate,
        valuePerCost: Math.round((g.priority / costEstimate) * 1e12) / 1e12,
      };
    })
    .sort((a, b) => b.valuePerCost - a.valuePerCost || a.concept.localeCompare(b.concept));

  // The budget truncates the PLAN, not the ranking, and what was dropped is
  // named in the rationale — a silent truncation reads as "we covered
  // everything" when it did not.
  const affordable: ResearchCandidate[] = [];
  let spent = 0;
  let dropped = 0;
  for (const c of candidates) {
    if (spent + c.costEstimate <= budget) {
      affordable.push(c);
      spent += c.costEstimate;
    } else {
      dropped++;
    }
  }

  const rationale =
    candidates.length === 0
      ? "nothing to research: every required concept is VERIFIED"
      : `${affordable.length} of ${candidates.length} candidates fit a budget of ${budget}` +
        (dropped > 0 ? `; ${dropped} dropped as unaffordable` : "") +
        `. Ranked by priority/cost, not by gain — see planner.ts.`;

  return {
    goalId,
    candidates: affordable,
    next: affordable[0] ?? null,
    totalCost: spent,
    rationale,
  };
}
