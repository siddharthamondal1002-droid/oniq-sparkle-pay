/**
 * COGNITIVE PERSISTENCE — v1.3 sections 2 and 19.
 *
 * "persist event/state sequence -> restore -> replay."
 *
 * TWO IMPLEMENTATIONS, AND THE DIFFERENCE BETWEEN THEM IS DURABILITY, NOT
 * CORRECTNESS. Both complete the round trip; only one survives the process.
 *
 *   makeMemoryPersistence()   real store, real load, real replay — for the
 *                             length of the isolate. `persist` returns TRUE
 *                             because it genuinely stored; the note says where.
 *   makeSinkPersistence(sink) the same over a caller-supplied sink. The shadow
 *                             script hands it a directory; an edge function has
 *                             no disk and hands it nothing.
 *
 * `persist` RETURNS A BOOLEAN rather than `void` for the reason
 * `memory.consolidate` returns a count: a no-op that resolves is
 * indistinguishable from a write, and every later reader would believe a chain
 * was saved that was not. That mistake has a receipt in this repo four times
 * over under the name "built and unit-tested is not reachable".
 *
 * WHAT IS NOT HERE, stated rather than implied: a TABLE. Durable cross-process
 * persistence means a migration, and a migration is a production schema change
 * that a shadow-mode integration does not get to make on its own. The gap is
 * recorded and written up rather than papered over with a store that forgets.
 */
import type { CognitivePersistence } from "../oqca/loop/cognitiveRun.ts";
import type { LoopState } from "../oqca/loop/loopState.ts";

export const PERSISTENCE_GAP =
  "cognitive states are persisted for the life of the process only: durable " +
  "storage needs a table and a migration, which a shadow run may not make";

export type PersistenceSink = {
  readonly write: (stateId: string, json: string) => Promise<boolean>;
  readonly read: (stateId: string) => Promise<string | null>;
};

export type PersistenceContext = {
  readonly record: (note: { stateId: string; persisted: boolean; gap: string }) => void;
};

/**
 * A REPLAY MUST NOT RE-DERIVE THE ID FROM THE OBJECT IT LOADED, or the check is
 * circular: any object at all would "verify". `load` returns exactly what was
 * stored and the CALLER re-seals it — `replayChain` already does that, and it
 * is why this adapter is a dumb store rather than a clever one.
 */
export function makeMemoryPersistence(ctx: PersistenceContext): CognitivePersistence {
  const store = new Map<string, string>();
  return {
    persist: async (state: LoopState) => {
      store.set(state.stateId, JSON.stringify(state));
      ctx.record({ stateId: state.stateId, persisted: true, gap: PERSISTENCE_GAP });
      return true;
    },
    load: async (stateId: string) => {
      const raw = store.get(stateId);
      return raw ? (JSON.parse(raw) as LoopState) : null;
    },
  };
}

export function makeSinkPersistence(
  sink: PersistenceSink,
  ctx: PersistenceContext,
): CognitivePersistence {
  return {
    persist: async (state: LoopState) => {
      const ok = await sink.write(state.stateId, JSON.stringify(state));
      ctx.record({ stateId: state.stateId, persisted: ok, gap: PERSISTENCE_GAP });
      return ok;
    },
    load: async (stateId: string) => {
      const raw = await sink.read(stateId);
      return raw ? (JSON.parse(raw) as LoopState) : null;
    },
  };
}
