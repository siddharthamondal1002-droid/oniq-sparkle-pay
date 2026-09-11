/**
 * THE DURABLE HOME OQCA HAS NEVER HAD — and therefore its first caller in the app.
 *
 * Every OQCA report since v1.5 names the same blocker in the same words:
 * "nothing persists, so nothing ages". `learned` came back EMPTY on every run,
 * the whole maintenance path was unreachable, and the only durable store was a
 * file on a developer's disk written by `scripts/oqca-self-improve.ts` — a file
 * no deployed function can see. This is the other end of that seam.
 *
 * IT IS A STORE OF BYTES, NOT A KNOWLEDGE SCHEMA, AND THAT IS DELIBERATE.
 * `durableStore.ts`'s own header says the sink may be "a file on a host, A
 * COLUMN, a bucket object", and the kernel already owns the serialisation, the
 * schema version and the row validation. A second knowledge model in Postgres
 * would be a second source of truth that drifts from the first — the shape this
 * repo hit again this week with the film-language list living in three places.
 *
 * A READ FAILURE THROWS. That is the one design decision here worth arguing
 * about, and every alternative is worse. `DurableSink.read` and
 * `SnapshotSink.read` both answer `string | null`, and `null` means "empty, and
 * honestly so" — it is what a first run returns. Mapping a failed read onto it
 * would make an unreachable store indistinguishable from a fresh morning: ONIQ
 * would start from zero, report `restored 0 record(s)`, and nothing anywhere
 * would say a backlog had been lost. Both stores' headers already refuse that
 * conflation for the bytes they hold; this refuses it for the transport. The
 * caller catches and reports; a tick that cannot read its own memory is a tick
 * that failed, not a tick that began.
 *
 * NO CLIENT LIVES HERE. `OqcaStateStore` is a seam the host fills, for the same
 * reason `SystemEvidence` is: the runtime tree holds no credential and no
 * network call, and `runtimeWiring.test.ts` asserts that by walking it. The
 * host holds the service-role client; this holds the key names and the rules.
 */
import type { DurableSink } from "./durableStore.ts";
import type { SnapshotSink } from "./autonomous.ts";

/** The one relation these sinks read and write. Named once, here. */
export const OQCA_STATE_TABLE = "oqca_state";

/**
 * A CLOSED SET, because a mistyped key would hand the runtime a fresh empty
 * store and it would start from zero every morning with nothing saying so —
 * the same failure the throwing read above exists to prevent, arriving through
 * the argument instead of the transport.
 */
export const OQCA_STATE_KEYS = ["knowledge", "checkpoint"] as const;
export type OqcaStateKey = (typeof OQCA_STATE_KEYS)[number];

export type StateRead =
  | { readonly ok: true; readonly doc: string | null }
  | { readonly ok: false; readonly reason: string };

export type StateWrite = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * WHAT THE HOST MUST PROVIDE. Two methods, both total: a read that has never
 * been written answers `{ ok: true, doc: null }`, and only a real failure
 * answers `ok: false`.
 */
export type OqcaStateStore = {
  readonly get: (key: OqcaStateKey) => Promise<StateRead>;
  readonly put: (key: OqcaStateKey, doc: string) => Promise<StateWrite>;
};

export const NO_STATE_STORE_REASON =
  "no durable state store is wired to this runtime: nothing will survive the tick";

/**
 * THE REFUSING DEFAULT, which reads as empty and WRITES AS FALSE. The asymmetry
 * is the point: a run with no store must still be able to start (there is
 * genuinely nothing stored), and must never be able to believe it saved
 * anything. `makeSinkDurableStore` turns that false into
 * `"the durable sink did not confirm the write"`, so the episode reports
 * `persisted: []` rather than a count it invented.
 */
export const NO_STATE_STORE: OqcaStateStore = {
  get: async () => ({ ok: true, doc: null }),
  put: async () => ({ ok: false, reason: NO_STATE_STORE_REASON }),
};

export class OqcaStateUnavailable extends Error {
  constructor(
    readonly key: OqcaStateKey,
    readonly detail: string,
  ) {
    super(`the OQCA durable state store could not be read for "${key}": ${detail}`);
    this.name = "OqcaStateUnavailable";
  }
}

/**
 * One key's slot, in the shape BOTH stores take. `DurableSink` and
 * `SnapshotSink` are structurally identical by design — `durableStore.ts` says
 * so in its own header — so one builder serves both rather than two that drift.
 */
export function makeStateSink(
  store: OqcaStateStore,
  key: OqcaStateKey,
  note?: (message: string) => void,
): DurableSink & SnapshotSink {
  return {
    read: async () => {
      const got = await store.get(key);
      if (!got.ok) throw new OqcaStateUnavailable(key, got.reason);
      return got.doc;
    },
    write: async (json: string) => {
      const wrote = await store.put(key, json);
      if (!wrote.ok) note?.(`could not persist "${key}": ${wrote.reason}`);
      return wrote.ok;
    },
    note: (message: string) => note?.(`${key}: ${message}`),
  };
}
