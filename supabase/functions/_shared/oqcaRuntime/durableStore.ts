/**
 * OQCA v1.7 §8 — THE DURABLE KNOWLEDGE STORE, OVER A HOST-OWNED SINK.
 *
 * The directive: _"Implement the smallest production-appropriate durable
 * knowledge store compatible with the existing Knowledge Substrate. Do NOT add
 * a graph database merely because this loop exists."_ So this is rows in and
 * rows out, over the same sink shape `makeSinkCheckpointStore` already uses —
 * a file on a host, a column, a bucket object. No dependency, no engine, no
 * second knowledge model; `durable.ts` in the kernel owns the serialisation and
 * this owns nothing but the read, the write and the refusals.
 *
 * REFUSALS ARE DISTINGUISHED FROM EMPTINESS, three ways, because §8's whole
 * claim is that the NEXT process can use what this one learned — and a store
 * that answered "nothing yet" to a read error would make a runtime silently
 * start from zero every morning with nothing anywhere saying so:
 *
 *   the sink held nothing            ok, rows: []     first run, honestly empty
 *   the sink held unparseable bytes  NOT ok, reason   corrupted, and it says so
 *   the sink held a wrong shape      NOT ok, reason   a version this cannot read
 *
 * AND A WRITE REPORTS WHAT THE SINK CONFIRMED. `save` returns the sink's own
 * boolean; a sink that writes nothing reports `ok: false` rather than the count
 * it was handed. `NO_CHECKPOINTS` and `consolidate` carry the identical rule,
 * and this repo has the receipt for what believing a silent no-op costs.
 */
import {
  type DurableKnowledgeStore,
  type DurableProblem,
  type DurableLoad,
  type DurableRecord,
  type DurableSave,
  DURABLE_SCHEMA_VERSION,
  validateDurable,
} from "../oqca/knowledge/substrate/durable.ts";

export type DurableSink = {
  readonly write: (json: string) => Promise<boolean>;
  readonly read: () => Promise<string | null>;
  readonly note?: (message: string) => void;
};

/** What the sink holds, versioned so a future shape is refused and not guessed. */
export type DurableFile = {
  readonly schema: number;
  readonly rows: readonly DurableRecord[];
};

/**
 * UPSERT BY `knowledge_id`, KEEPING THE HIGHER `version`.
 *
 * A blind append would let two processes that both learned the same assertion
 * leave two rows, and `hydrate` would then hand the substrate the same id
 * twice — which the store would silently collapse to whichever came last,
 * making the outcome depend on write order. Keeping the higher version is the
 * substrate's own supersession rule applied at the boundary: a record that has
 * been re-verified carries a higher version, and it wins.
 *
 * EQUAL VERSIONS TAKE THE INCOMING ROW, deliberately. A re-persist of the same
 * version is the same assertion re-read, and its `updated_at` and evidence are
 * the fresher of the two; keeping the older would make a re-verification
 * invisible. Exported because that rule is worth testing directly.
 */
export function mergeDurable(
  existing: readonly DurableRecord[],
  incoming: readonly DurableRecord[],
): readonly DurableRecord[] {
  const byId = new Map(existing.map((r) => [r.knowledge_id, r] as const));
  for (const r of incoming) {
    const prior = byId.get(r.knowledge_id);
    if (prior === undefined || r.version >= prior.version) byId.set(r.knowledge_id, r);
  }
  return [...byId.values()].sort((a, b) => a.knowledge_id.localeCompare(b.knowledge_id));
}

export function makeSinkDurableStore(sink: DurableSink): DurableKnowledgeStore {
  const readFile = async (): Promise<DurableLoad> => {
    const raw = await sink.read();
    if (raw === null) return { ok: true, rows: [] };
    let parsed: DurableFile;
    try {
      parsed = JSON.parse(raw) as DurableFile;
    } catch {
      const reason = "the durable knowledge store could not be parsed";
      sink.note?.(reason);
      return { ok: false, reason };
    }
    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.rows)) {
      const reason = "the durable knowledge store does not hold a row array";
      sink.note?.(reason);
      return { ok: false, reason };
    }
    if (parsed.schema !== DURABLE_SCHEMA_VERSION) {
      const reason =
        `the durable knowledge store is schema ${String(parsed.schema)}, ` +
        `this build reads ${DURABLE_SCHEMA_VERSION}`;
      sink.note?.(reason);
      return { ok: false, reason };
    }
    return { ok: true, rows: parsed.rows };
  };

  return {
    load: readFile,
    save: async (rows: readonly DurableRecord[]): Promise<DurableSave> => {
      /**
       * A ROW THIS BUILD WOULD REFUSE TO READ BACK IS REFUSED AT THE WRITE.
       * Writing one would produce a store that loads with a `rejected` entry
       * every time forever — a permanent, silent shrink of what ONIQ knows,
       * discovered only by somebody counting. Failing the write instead makes
       * it one loud failure at the moment it was caused.
       */
      for (const r of rows) {
        const problems = validateDurable(r);
        if (problems.length > 0) {
          return {
            ok: false,
            reason:
              `refusing to persist ${r.knowledge_id}: ` +
              problems.map((p: DurableProblem) => `${p.code} ${p.detail}`).join(", "),
          };
        }
      }
      const current = await readFile();
      if (!current.ok) return { ok: false, reason: current.reason };
      const merged = mergeDurable(current.rows, rows);
      const file: DurableFile = { schema: DURABLE_SCHEMA_VERSION, rows: merged };
      const wrote = await sink.write(JSON.stringify(file));
      if (!wrote) return { ok: false, reason: "the durable sink did not confirm the write" };
      return { ok: true, written: rows.length };
    },
  };
}
