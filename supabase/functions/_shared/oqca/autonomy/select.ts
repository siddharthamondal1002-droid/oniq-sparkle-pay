/**
 * OQCA v1.5 — AUTONOMOUS LEARNING SELECTION. Owner directive 2026-09-10: "The
 * knowledge-gap detector already exists. Now give it a decision function:
 * importance x uncertainty x dependency x information gain x freshness x
 * relevance and let ONIQ choose its next learning target."
 *
 * THE BRIEF SAYS "FRESHNESS" AND THE FACTOR IS ORIENTED AS DEMAND. This is the
 * one place the formula cannot be transcribed literally, and getting it wrong
 * would have been silent. A factor that rises with how FRESH knowledge is would
 * down-rank exactly the stale claims that maintenance exists to find: a record
 * unverified for a year would score near zero and never be looked at again,
 * while one verified this morning would outrank it. So the field is
 * `staleness`, 1 means "overdue now", 0 means "just verified", and
 * `select.test.ts` asserts the direction on two otherwise identical gaps rather
 * than leaving it to the name. `decay.ts` already uses "freshness" for the
 * ASSESSMENT rather than for the quantity, so the vocabulary is consistent with
 * the substrate as well.
 *
 * THE TWO NEW FACTORS MAY RE-RANK AND MAY NOT VETO. Six multiplied terms mean
 * any single zero annihilates the other five — a concept verified an hour ago
 * would be unselectable no matter how important, how contradicted, or how
 * central it is. `detectGaps` handles that for its own four factors by
 * FILTERING (`openGaps` drops VERIFIED) rather than by flooring, which is right
 * for evidence ABOUT the gap. Staleness and relevance are not evidence about
 * the gap; they are context, and context that can silently discard four
 * measurements is not a modifier, it is a gate nobody declared. Both are
 * clamped into [MODIFIER_FLOOR, 1].
 *
 * IT IS A STRICT EXTENSION, AND THAT IS ASSERTED RATHER THAN CLAIMED. With no
 * staleness source and no focus, both new factors are 1 for every candidate and
 * the ranking is `detectGaps`'s own priority ordering, element for element. So
 * a caller who cannot supply the new information loses nothing, and the day the
 * two orderings disagree it is because real information moved them.
 *
 * RELEVANCE IS GRAPH DISTANCE, NEVER STRING SIMILARITY. A similarity score over
 * labels would be a measure invented here and calibrated against nothing — the
 * same mistake as the physiological lab ranges that were written from memory
 * and deleted the same day. The dependency edges already in `KnowledgeState`
 * are a real structure with a real meaning, so relevance walks those and
 * reports UNREACHABLE as the floor rather than guessing a number.
 */
import type { Gap, GapStatus, Goal } from "../knowledge/gaps.ts";
import type { KnowledgeState } from "../knowledge/model.ts";
import { freshness } from "../knowledge/substrate/decay.ts";
import type { KnowledgeRecord } from "../knowledge/substrate/record.ts";

export type LearningFactors = {
  readonly importance: number;
  readonly uncertainty: number;
  readonly dependency: number;
  readonly informationGain: number;
  /** The brief's "freshness", oriented as DEMAND. See the header. */
  readonly staleness: number;
  readonly relevance: number;
};

export type LearningTarget = {
  readonly conceptId: string;
  readonly status: GapStatus;
  readonly factors: LearningFactors;
  readonly score: number;
  readonly reason: string;
};

/**
 * The lowest a CONTEXT factor may push a candidate. Not zero — see the header.
 * The value is deliberately small enough that context dominates ties and large
 * enough that it cannot overturn a difference in the evidence itself.
 */
export const MODIFIER_FLOOR = 0.05;

/**
 * Per hop away from what the runtime is working on.
 *
 * THE VALUE IS ARBITRARY WITHIN (0, 1) AND THE TESTS ASSERT THE PROPERTY, NOT
 * THE NUMBER: relevance falls strictly with distance and never reaches zero.
 * Pinning 0.5 in an assertion would turn a tuning constant into a guarantee,
 * and the next person to tune it would "fix" the test instead of the design.
 */
export const RELEVANCE_DECAY = 0.5;

/** Neutral for a multiplicative factor: absent information re-ranks nothing. */
export const NEUTRAL_FACTOR = 1;

function clampModifier(x: number): number {
  if (!Number.isFinite(x)) return MODIFIER_FLOOR;
  return Math.min(1, Math.max(MODIFIER_FLOOR, x));
}

function round12(x: number): number {
  return Math.round(x * 1e12) / 1e12;
}

/**
 * How overdue one record is, in [0, 1].
 *
 * NEVER VERIFIED IS MAXIMUM DEMAND, not minimum, and that is the substrate's
 * own rule rather than a choice made here: `decay.ts` treats unknown freshness
 * as stale until verified, because the intuitive reading — "we do not know, so
 * leave it alone" — is exactly backwards. Same for a zero interval: an
 * event-driven record is stale from the moment it is written.
 */
export function stalenessDemand(record: KnowledgeRecord, nowMs: number): number {
  const f = freshness(record, nowMs);
  if (f.ageMs === null) return 1;
  if (f.intervalMs === 0) return 1;
  return clampModifier(f.ageMs / f.intervalMs);
}

/**
 * A staleness lookup keyed the way `toKnowledgeState` names concepts — the
 * subject, and `subject:predicate` for the object of each assertion. Keying
 * only one of the two would leave half the graph with no staleness signal and
 * nothing would say so.
 *
 * THE MOST OVERDUE CLAIM SETS THE SUBJECT'S DEMAND. Taking the minimum, or an
 * average, would let one record verified this morning mask ten that have not
 * been checked in a year — which is precisely the state maintenance exists to
 * find.
 */
export function stalenessByConcept(
  records: readonly KnowledgeRecord[],
  nowMs: number,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  const raise = (key: string, value: number) => {
    out.set(key, Math.max(out.get(key) ?? 0, value));
  };
  for (const r of records) {
    const demand = stalenessDemand(r, nowMs);
    raise(r.subject, demand);
    raise(`${r.subject}:${r.predicate}`, demand);
  }
  return out;
}

/**
 * Distance from what the runtime is working on, over the dependency edges that
 * already exist. UNDIRECTED on purpose: a prerequisite of the focus is on the
 * path to it, and something that depends on the focus is affected by it. Both
 * are near; only the direction of the arrow differs.
 */
export function relevanceTo(
  conceptId: string,
  focus: Goal | null,
  knowledge: KnowledgeState,
): number {
  if (focus === null) return NEUTRAL_FACTOR;
  const seeds = focus.requires.map((r) => r.conceptId);
  if (seeds.includes(conceptId)) return 1;

  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  for (const c of knowledge.concepts.values()) {
    for (const dep of c.dependsOn) {
      link(c.id, dep);
      link(dep, c.id);
    }
  }

  const seen = new Set(seeds);
  let frontier = seeds;
  let distance = 0;
  while (frontier.length > 0) {
    distance += 1;
    const next: string[] = [];
    for (const node of frontier) {
      for (const n of neighbours.get(node) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (n === conceptId) return clampModifier(RELEVANCE_DECAY ** distance);
        next.push(n);
      }
    }
    frontier = next;
  }
  return MODIFIER_FLOOR;
}

export type LearningInput = {
  readonly gaps: readonly Gap[];
  readonly knowledge: KnowledgeState;
  /**
   * Concept id -> how overdue, in [0, 1]. A concept the map does not name gets
   * `NEUTRAL_FACTOR`, which re-ranks nothing — the honest answer for "no
   * staleness information", as distinct from "verified just now", which is 0.
   */
  readonly staleness?: ReadonlyMap<string, number>;
  /** What the runtime is working on now, or null on the first cycle. */
  readonly focus?: Goal | null;
};

/**
 * Every open gap, scored and ordered. VERIFIED gaps are dropped by `openGaps`
 * before this sees them; this function does not re-decide that.
 */
export function rankLearningTargets(input: LearningInput): LearningTarget[] {
  const staleness = input.staleness ?? new Map<string, number>();
  const focus = input.focus ?? null;

  const targets: LearningTarget[] = input.gaps.map((gap) => {
    const stale = clampModifier(staleness.get(gap.conceptId) ?? NEUTRAL_FACTOR);
    const relevance = clampModifier(relevanceTo(gap.conceptId, focus, input.knowledge));
    const factors: LearningFactors = {
      importance: gap.importance,
      uncertainty: gap.uncertainty,
      dependency: gap.dependency,
      informationGain: gap.expectedInformationGain,
      staleness: round12(stale),
      relevance: round12(relevance),
    };
    const score = round12(
      factors.importance *
        factors.uncertainty *
        factors.dependency *
        factors.informationGain *
        factors.staleness *
        factors.relevance,
    );
    return {
      conceptId: gap.conceptId,
      status: gap.status,
      factors,
      score,
      reason: `${gap.reason}; staleness ${factors.staleness.toFixed(2)}, relevance ${factors.relevance.toFixed(2)}`,
    };
  });

  // Same tie-break as `detectGaps`: the ORDER is deterministic, not merely the
  // numbers, so two runs over the same knowledge choose the same thing to learn.
  return targets.sort((a, b) => b.score - a.score || a.conceptId.localeCompare(b.conceptId));
}

/** What ONIQ decides to learn next, or `null` when nothing is open. */
export function selectLearningTarget(input: LearningInput): LearningTarget | null {
  return rankLearningTargets(input)[0] ?? null;
}
