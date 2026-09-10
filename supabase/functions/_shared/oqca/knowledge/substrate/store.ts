/**
 * THE KNOWLEDGE STORE — spec §12 and §20 phase 2.
 *
 * **"Given ONIQ's existing production rails, do not replace the current data
 * architecture merely to add a graph. First implement an adapter-backed
 * KnowledgeStore and benchmark Jena/AGE against the actual ONIQ workload."**
 *
 * So this is the abstraction a Jena, RDF4J or AGE adapter would sit behind, and
 * the only implementation shipped is in-memory and deterministic. No triple
 * store, no migration, no new production dependency — which is also what makes
 * `security.test.ts` able to keep walking this tree and finding no network.
 *
 * WHAT "DETERMINISTIC" BUYS, and it is the reason the local one is not a
 * placeholder: §17 asks for rollback/replay tests, and §18 measures "Rollback
 * integrity — percent of historical states reproducibly restored". A store
 * whose iteration order depended on insertion could not answer that, so every
 * read here is sorted by id and every write appends to a journal.
 */
import type { KnowledgeRecord, KnowledgeStatus } from "./record.ts";
import { supersede } from "./record.ts";
import { usableNow } from "./decay.ts";

export type StoreOp =
  | { readonly kind: "put"; readonly record: KnowledgeRecord }
  | { readonly kind: "supersede"; readonly older: string; readonly record: KnowledgeRecord };

/**
 * THE JOURNAL IS THE STORE'S TRUTH, and the map is a projection of it. §21:
 * "Do not erase historical knowledge... so ONIQ can replay previous world
 * states." A store that only kept the current map could not replay, and
 * `replayTo` is what makes the claim checkable instead of aspirational.
 */
export type KnowledgeStore = {
  readonly put: (r: KnowledgeRecord) => void;
  readonly get: (id: string) => KnowledgeRecord | null;
  readonly all: () => readonly KnowledgeRecord[];
  readonly byStatus: (s: KnowledgeStatus) => readonly KnowledgeRecord[];
  readonly bySubject: (subject: string) => readonly KnowledgeRecord[];
  readonly byDomain: (domain: string) => readonly KnowledgeRecord[];
  /** Replaces `older` with `newer`, keeping the retired row. */
  readonly supersedeWith: (older: KnowledgeRecord, newer: KnowledgeRecord) => void;
  /** Every RETIRED version, oldest first. §21: history is never erased. */
  readonly history: () => readonly KnowledgeRecord[];
  /** Every write, oldest first. */
  readonly journal: () => readonly StoreOp[];
  /** The store as it was after the first `n` operations. */
  readonly replayTo: (n: number) => readonly KnowledgeRecord[];
};

/**
 * Where a retired row lives. The current row keeps the bare assertion id, so
 * `get(id)` always answers with what ONIQ believes NOW; every prior version is
 * addressable beside it rather than replacing it.
 */
export function historyKey(id: string, version: number): string {
  return `${id}#v${version}`;
}

/** Is this row a retired version rather than the current belief? */
export function isHistory(r: KnowledgeRecord, key: string): boolean {
  return key !== r.id;
}

export function makeLocalStore(seed: readonly KnowledgeRecord[] = []): KnowledgeStore {
  const ops: StoreOp[] = [];

  const build = (upTo: number): Map<string, KnowledgeRecord> => {
    const m = new Map<string, KnowledgeRecord>();
    for (const op of ops.slice(0, upTo)) {
      if (op.kind === "put") m.set(op.record.id, op.record);
      else {
        const older = m.get(op.older);
        // A supersession whose predecessor is absent is applied as a plain put
        // rather than throwing: a REPLAY must reproduce whatever happened,
        // including a sequence that was already odd. Refusing here would make
        // the journal unreplayable, which defeats the point of keeping it.
        //
        // THE RETIRED ROW NEEDS ITS OWN KEY, AND THE FIRST VERSION LOST IT.
        // It wrote the SUPERSEDED row back under `op.older` and then wrote the
        // current one under `op.record.id` — and `supersede()` REQUIRES those
        // two ids to be equal, because the id hashes the assertion and not the
        // belief. So the second write always overwrote the first, and the
        // retired row vanished from every read: §21's "do not erase historical
        // knowledge. Supersede/version it so ONIQ can replay previous world
        // states" was broken for every supersession there has ever been.
        //
        // Found by a test asserting the retired row survives, not by reading
        // the code — the branch looks correct and is dead whenever it matters.
        // The version qualifier is what makes the two addressable at once.
        if (older) {
          m.set(historyKey(older.id, older.version), {
            ...older,
            status: "SUPERSEDED",
            supersededBy: op.record.id,
          });
        }
        m.set(op.record.id, op.record);
      }
    }
    return m;
  };

  // `all()` IS THE CURRENT BELIEF and history is a separate read. Folding the
  // retired rows in would double-count every superseded assertion in every
  // metric — precision, staleness and provenance coverage all divide by
  // `all().length` — so the split is load-bearing rather than tidy.
  const sorted = (m: Map<string, KnowledgeRecord>, history: boolean) =>
    [...m]
      .filter(([key, r]) => isHistory(r, key) === history)
      .map(([, r]) => r)
      .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);

  for (const r of seed) ops.push({ kind: "put", record: r });

  return {
    put: (r) => {
      ops.push({ kind: "put", record: r });
    },
    get: (id) => build(ops.length).get(id) ?? null,
    all: () => sorted(build(ops.length), false),
    byStatus: (s) => sorted(build(ops.length), false).filter((r) => r.status === s),
    bySubject: (subject) => sorted(build(ops.length), false).filter((r) => r.subject === subject),
    byDomain: (domain) => sorted(build(ops.length), false).filter((r) => r.domain.includes(domain)),
    supersedeWith: (older, newer) => {
      // Goes through `supersede`, so the version increment and the id check
      // cannot be skipped by writing to the store directly.
      const { retired, current } = supersede(older, newer);
      void retired;
      ops.push({ kind: "supersede", older: older.id, record: current });
    },
    journal: () => [...ops],
    history: () => sorted(build(ops.length), true),
    replayTo: (n) => sorted(build(Math.max(0, Math.min(n, ops.length))), false),
  };
}

/**
 * EVERY RECORD THAT WAS DERIVED FROM THIS ONE — the query a knowledge upgrade
 * cannot be done without.
 *
 * §21's "new evidence must be able to ... supersede, or invalidate older
 * knowledge" has a consequence the sentence does not spell out: when a claim is
 * out-weighed, everything COMPUTED FROM it is now resting on a belief ONIQ no
 * longer holds. `derivedFrom` records that edge at write time; this is the only
 * way to walk it, and without it a re-derivation is a guess about which records
 * were affected.
 *
 * It reads history too, deliberately: a retired record's dependents are exactly
 * what an upgrade needs to find, and `all()` no longer carries the retired row.
 */
export function dependentsOf(store: KnowledgeStore, id: string): readonly KnowledgeRecord[] {
  return [...store.all(), ...store.history()]
    .filter((r) => r.derivedFrom.includes(id))
    .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
}

/**
 * WHAT A DECISION MAY READ. One function, so no caller re-derives the rule —
 * the health work's "never re-derive a policy beside the policy", which was a
 * real defect there (`status.aiAvailable` telling people a feature was
 * available that every call would refuse).
 */
export function decisionReadable(
  store: KnowledgeStore,
  domain: string,
  nowMs: number,
): readonly KnowledgeRecord[] {
  return store.byDomain(domain).filter((r) => usableNow(r, nowMs));
}
