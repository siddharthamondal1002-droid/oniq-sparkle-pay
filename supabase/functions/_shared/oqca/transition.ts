/**
 * OQCA v1.1 — the auditable state-transition record. Brief section 5.
 *
 * THE TIMESTAMP IS LOGICAL, NOT A WALL CLOCK, and that is the one place this
 * file deviates from the brief's literal field list. `Date.now()` in a record
 * that feeds `hash()` makes every replay produce a different state id, which
 * destroys exactly the property section 4 asks for. So `timestamp` is the
 * LOGICAL step (a counter), a real clock reading may be attached separately as
 * `wallClock`, and `wallClock` is excluded from the hash. A record whose
 * identity depends on when it was written cannot be replayed, and a
 * reproducibility log that cannot be replayed is a diary.
 *
 * The wire shape below is snake_case exactly as the brief specifies, because
 * that is the machine-readable contract; the TypeScript is camelCase because
 * that is this repo's. `toWireRecord` is the one place they meet.
 */

export type TransitionRecord = {
  readonly fromState: string;
  readonly toState: string;
  /** The COGNITIVE operation name (PHASE, INTERFERE, ...), not the matrix. */
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly evidenceIds: readonly string[];
  readonly contextId: string;
  readonly normBefore: number;
  readonly normAfter: number;
  /** Logical step. Deterministic, hashed, and not a clock — see the header. */
  readonly timestamp: number;
  /** The seed in force, or null when the operation consumed no randomness. */
  readonly seed: number | null;
  readonly implementation: string;
  /** max|U-dagger U - I| for the operator applied, or 0 for a channel. */
  readonly unitarityResidual: number;
  /** Optional real clock reading. NEVER hashed; present for human reading. */
  readonly wallClock?: number;
};

export const CLASSICAL_SIMULATOR = "classical_simulator";

/** The brief's exact JSON shape. Used by the report and by any external log. */
export function toWireRecord(r: TransitionRecord): Record<string, unknown> {
  return {
    from_state: r.fromState,
    to_state: r.toState,
    operation: r.operation,
    parameters: r.parameters,
    evidence_ids: [...r.evidenceIds],
    context_id: r.contextId,
    norm_before: r.normBefore,
    norm_after: r.normAfter,
    timestamp: r.timestamp,
    seed: r.seed,
    implementation: r.implementation,
    unitarity_residual: r.unitarityResidual,
  };
}

/**
 * The fields a state's hash may read. `wallClock` is absent BY CONSTRUCTION
 * rather than by a caller remembering to strip it — the difference between a
 * rule and a convention.
 */
export function hashableRecord(r: TransitionRecord): Record<string, unknown> {
  return toWireRecord(r);
}

export type HistoryProblem = { readonly index: number; readonly problem: string };

/**
 * A history is malformed when it does not CHAIN: record k's `toState` must be
 * record k+1's `fromState`, and the logical timestamps must not go backwards.
 * A list of records that never linked is not an audit trail, and this is the
 * check `validate()` calls for.
 */
export function historyProblems(history: readonly TransitionRecord[]): HistoryProblem[] {
  const problems: HistoryProblem[] = [];
  for (let k = 0; k < history.length; k++) {
    const r = history[k];
    if (!r.fromState || !r.toState) problems.push({ index: k, problem: "missing state id" });
    if (!r.operation) problems.push({ index: k, problem: "missing operation" });
    if (!Number.isFinite(r.normBefore) || !Number.isFinite(r.normAfter)) {
      problems.push({ index: k, problem: "non-finite norm" });
    }
    if (k > 0) {
      const prev = history[k - 1];
      if (prev.toState !== r.fromState) {
        problems.push({ index: k, problem: `broken chain: ${prev.toState} -> ${r.fromState}` });
      }
      if (r.timestamp < prev.timestamp) {
        problems.push({ index: k, problem: "logical timestamp went backwards" });
      }
    }
  }
  return problems;
}
