/**
 * THE MEMORY SEAM — brief section 12, and the gap it asks to be recorded.
 *
 * "Do not fabricate a memory system. Record the persistence gap rather than
 * building a parallel memory system."
 *
 * MEASURED 2026-09-10, BEFORE ANYTHING WAS WRITTEN: **ONIQ HAS NO GENERAL
 * MEMORY STORE.** What it has are three purpose-built ones — `story_cast`
 * (a film's characters), the Study Vault (`study_notes` under FTS, read before
 * a tutor answers) and `learner_profiles` — and every one of them is keyed to
 * its own product and its own user. None is a place a cognitive run's episodes
 * belong, and writing them into one would be putting a loop's working notes
 * into a child's study vault.
 *
 * SO THE GAP IS REAL AND IT IS STATED RATHER THAN PAPERED OVER: **episodic
 * memory does not persist across runs.** `recall` serves this run's own
 * observations, which is genuine working memory and is what stations 3 and 20
 * actually consume; `consolidate` durably stores NOTHING and returns 0.
 *
 * IT RETURNS 0 RATHER THAN A COUNT, and that is the whole point of the file. A
 * `consolidate` that returned `records.length` would report success for a write
 * that never happened, and every later reader — the episode, the report, the
 * next session — would believe ONIQ remembers something it does not. This repo
 * has the receipt for that shape: "built and unit-tested is not reachable",
 * four times over.
 *
 * WHAT WOULD CLOSE IT is a table and a migration, which is a production schema
 * change and therefore not something a shadow-mode integration gets to make on
 * its own. It is written up in the report instead.
 */
import type { MemoryRecord, MemoryStore } from "../oqca/loop/seams.ts";

export type MemoryContext = {
  /** Called once per consolidate, so the gap is visible in the run's own log. */
  readonly record: (note: { attempted: number; persisted: number; reason: string }) => void;
};

export const PERSISTENCE_GAP =
  "episodic memory is not persisted: ONIQ has no general memory store, and " +
  "writing a run's notes into a product-specific one would be worse than not " +
  "storing them";

/**
 * Relevance is WORD OVERLAP, and it is deliberately the dullest thing that
 * satisfies the contract. Section 6 requires retrieval to be relevance-based
 * rather than "dumping the entire history into the model", and a store that
 * returned everything up to `limit` would satisfy the type while breaking the
 * rule. Anything cleverer — embeddings, a vector index — is a provider and a
 * bill, which is the owner's call and not this brief's.
 */
export function relevance(query: string, text: string): number {
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

export function makeMemory(seed: readonly MemoryRecord[], ctx: MemoryContext): MemoryStore {
  const working: MemoryRecord[] = [...seed];
  return {
    recall: async (query, limit) =>
      working
        .map((r) => ({ r, score: relevance(query, r.text) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id))
        .slice(0, Math.max(0, limit))
        .map((x) => x.r),
    consolidate: async (records) => {
      // In-run only. The records ARE available to a later `recall` in the same
      // run, which is what makes this working memory rather than a stub — and
      // they are gone when the isolate ends, which is the gap.
      for (const r of records) if (!working.some((w) => w.id === r.id)) working.push(r);
      ctx.record({ attempted: records.length, persisted: 0, reason: PERSISTENCE_GAP });
      return 0;
    },
  };
}
