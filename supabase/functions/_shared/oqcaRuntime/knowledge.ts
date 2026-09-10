/**
 * THE KNOWLEDGE ADAPTER — v1.3 sections 5 and 11.
 *
 * WHAT ONIQ'S KNOWLEDGE ACTUALLY IS, for this job, measured rather than
 * imagined: the dispatch RULES. How long a job waits inside its backoff, what
 * a grade means, what makes a row eligible. Those are constants in
 * `dispatchJob.ts` and `dispatchEnv.ts` — real, checked in, and today invisible
 * to the loop, which is why UNDERSTAND has to infer from a queue snapshot what
 * the code already states outright.
 *
 * SO EVERY FACT HERE CARRIES A `sourceRef` NAMING THE MODULE IT CAME FROM, and
 * the type makes that required. That is the whole anti-fabrication guard: an
 * adapter that could return a statement with no source is an adapter that can
 * invent one. Nothing here is generated, summarised or asked of a model.
 *
 * WHAT THIS IS NOT: a general knowledge base. ONIQ has no such thing — the
 * Study Vault, `story_cast` and `learner_profiles` are three purpose-built
 * stores keyed to their own products and their own users, and serving a
 * cognitive run out of a child's study vault would be worse than serving it
 * nothing. The gap is recorded, exactly as `memory.ts` records its own.
 */
import type { KnowledgeAdapter, KnowledgeFact } from "../oqca/loop/seams.ts";

export const KNOWLEDGE_GAP =
  "ONIQ has no general knowledge store: these facts are the dispatch rules as " +
  "written in code, and nothing else is available to look up";

export type KnowledgeContext = {
  /** Called once per lookup, so the bound and the gap are in the run's log. */
  readonly record: (note: { query: string; returned: number; gap: string }) => void;
};

/**
 * The rules, as facts. `confidence: 1` is honest here and almost nowhere else:
 * these are not estimates about the world, they are statements about what this
 * codebase does, and the code is the authority on that.
 */
export function dispatchRules(backoffMs: number): readonly KnowledgeFact[] {
  return [
    {
      id: "dispatch-backoff",
      statement:
        `A job that was dispatched within the last ${Math.round(backoffMs / 60000)} minute(s) is ` +
        "inside its backoff window and is not eligible again yet.",
      confidence: 1,
      sourceRef: "_shared/oqcaRuntime/dispatchEnv.ts",
    },
    {
      id: "dispatch-reversible",
      statement:
        "story-dispatch does not claim the row: a dispatch that lands on no runner leaves the " +
        "job queued and available. It is reversible AND it writes to production.",
      confidence: 1,
      sourceRef: "_shared/oqcaRuntime/dispatchJob.ts",
    },
    {
      id: "dispatch-hold",
      statement:
        "Holding is a real choice with a real outcome, not the absence of one: a tick that " +
        "dispatches nothing has still decided something.",
      confidence: 1,
      sourceRef: "_shared/oqcaRuntime/dispatchJob.ts",
    },
    {
      id: "dispatch-grade",
      statement:
        "A movie-grade job renders through Veo on the metered Google key; a classic-grade job " +
        "renders Ken Burns over stills and spends nothing there.",
      confidence: 1,
      sourceRef: "supabase/functions/story-clip",
    },
  ];
}

/**
 * RELEVANCE IS WORD OVERLAP, and it is deliberately the dullest thing that
 * satisfies the contract — the same choice `memory.ts` made and for the same
 * reason. Section 5 requires retrieval to be relevance-based rather than a
 * dump, and a store that returned everything up to `limit` would satisfy the
 * type while breaking the rule. Anything cleverer is a provider and a bill.
 */
export function overlap(query: string, text: string): number {
  const terms = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
  if (terms.size === 0) return 0;
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  let hit = 0;
  for (const t of terms) if (words.has(t)) hit++;
  return hit / terms.size;
}

export function makeKnowledge(
  facts: readonly KnowledgeFact[],
  ctx: KnowledgeContext,
): KnowledgeAdapter {
  return {
    lookup: async (query, limit) => {
      const hits = facts
        .map((f) => ({ f, score: overlap(query, f.statement) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.f.id.localeCompare(b.f.id))
        .slice(0, Math.max(0, limit))
        .map((x) => x.f);
      ctx.record({ query, returned: hits.length, gap: KNOWLEDGE_GAP });
      return hits;
    },
  };
}
