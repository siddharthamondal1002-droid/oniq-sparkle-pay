/**
 * LONG-HORIZON CONTINUATION — §18. "Do not start from zero."
 *
 * A checkpoint is the whole cognitive state as JSON plus a schema version.
 * Two properties are worth more than the serialization itself:
 *
 * RESTORE VERIFIES BEFORE IT CONTINUES. A checkpoint from a future schema, or
 * one whose JSON does not carry the fields this build reads, is REFUSED — it
 * does not silently become an empty state. OQCA's durable store learned this
 * the expensive way: mapping a failed read onto "empty" makes a lost backlog
 * indistinguishable from a fresh morning, and nothing anywhere says so.
 *
 * A FAILED READ THROWS; AN ABSENT ONE RETURNS NULL. Those are different facts
 * and a caller must be able to tell them apart.
 */
import { type CognitiveState } from "./cognitiveState.ts";

export const CHECKPOINT_SCHEMA = 1;

export type Checkpoint = {
  readonly schema: number;
  readonly savedAt: string;
  readonly state: CognitiveState;
};

export type RestoreResult =
  | { readonly ok: true; readonly checkpoint: Checkpoint }
  | { readonly ok: false; readonly reason: string };

export function serialize(state: CognitiveState, at: string): string {
  const cp: Checkpoint = { schema: CHECKPOINT_SCHEMA, savedAt: at, state };
  return JSON.stringify(cp);
}

/** Every field the restore path reads. Named once so the check cannot drift. */
const REQUIRED_STATE_FIELDS = [
  "goal",
  "world",
  "hypotheses",
  "conclusions",
  "observations",
  "toolCalls",
  "transitions",
  "uncertainty",
  "iteration",
  "timestamp",
] as const;

export function restore(raw: string | null): RestoreResult {
  if (raw === null) return { ok: false, reason: "no checkpoint: nothing to restore" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `checkpoint is not JSON: ${String(err)}` };
  }
  const cp = (parsed ?? {}) as { schema?: unknown; savedAt?: unknown; state?: unknown };
  if (cp.schema !== CHECKPOINT_SCHEMA) {
    return { ok: false, reason: `checkpoint schema ${String(cp.schema)} != ${CHECKPOINT_SCHEMA}` };
  }
  const state = (cp.state ?? {}) as Record<string, unknown>;
  const missing = REQUIRED_STATE_FIELDS.filter((f) => !(f in state));
  if (missing.length > 0) {
    return { ok: false, reason: `checkpoint state is missing ${missing.join(", ")}` };
  }
  return {
    ok: true,
    checkpoint: {
      schema: CHECKPOINT_SCHEMA,
      savedAt: String(cp.savedAt ?? ""),
      state: state as unknown as CognitiveState,
    },
  };
}

/** A store the kernel can be handed. Read returns null for ABSENT and throws for BROKEN. */
export type CheckpointStore = {
  readonly read: () => Promise<string | null>;
  readonly write: (json: string) => Promise<void>;
};
