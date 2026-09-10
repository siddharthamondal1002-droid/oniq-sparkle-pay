/**
 * THE KNOWLEDGE ADAPTER — v1.3 sections 5 and 11, and v1.4-R item B.
 *
 * WHAT THIS USED TO BE, and why it is no longer that: four hand-written
 * sentences about the dispatch rules, each carrying the module it came from,
 * matched against a query by word overlap. That was honest and it was not
 * knowledge — it could not be superseded, could not carry evidence, could not
 * be weighed against a rival claim, and could not close a gap, because
 * `IDENTIFY_GAPS` reads a `KnowledgeState` and nothing ever supplied one.
 *
 * NOW THE FACTS COME FROM THE SUBSTRATE and this file is what it should always
 * have been: the RECORDING WRAPPER. It owns no facts, decides no relevance and
 * holds no store; it counts what a run asked for and what came back, so a
 * comparison row can say whether the loop consulted its knowledge at all.
 *
 * THE DUPLICATE RELEVANCE FUNCTION IS GONE WITH IT. `overlap` here and
 * `relevance` in `project.ts` were the same eight lines in two files — "never
 * re-derive a policy beside the policy", which this repo has a receipt for
 * (`stalenessRate`, computed twice, two sections of CLAUDE.md ago). The
 * substrate's is the one that ships.
 */
import type { KnowledgeAdapter, KnowledgeFact } from "../oqca/loop/seams.ts";

/**
 * WHAT THE STORE STILL CANNOT DO, reported on every lookup rather than left in
 * a design note. The wording is the substrate's own — one sentence, one owner.
 */
export type KnowledgeContext = {
  /** Called once per lookup, so the bound and the gap are in the run's log. */
  readonly record: (note: { query: string; returned: number; gap: string }) => void;
  /** What this knowledge source cannot do. See `substrate.ts:substrateGap`. */
  readonly gap: string;
};

/**
 * Wraps an adapter so every lookup is counted.
 *
 * IT MUST NOT RE-SORT, RE-SCORE OR RE-BOUND WHAT COMES BACK. `limit` is passed
 * through untouched and the order is the inner adapter's: a wrapper that
 * quietly re-ranked would be a second relevance policy in the one place nobody
 * would look for it, and the run's log would describe a lookup that never
 * happened.
 */
export function recordingKnowledge(
  inner: KnowledgeAdapter,
  ctx: KnowledgeContext,
): KnowledgeAdapter {
  return {
    lookup: async (query, limit): Promise<readonly KnowledgeFact[]> => {
      const hits = await inner.lookup(query, limit);
      ctx.record({ query, returned: hits.length, gap: ctx.gap });
      return hits;
    },
  };
}
