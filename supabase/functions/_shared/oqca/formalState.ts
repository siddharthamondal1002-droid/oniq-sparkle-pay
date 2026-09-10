/**
 * OQCA v1.1 — the formal CognitiveState. Brief section 4.
 *
 * v1.0's state was three fields (labels, amplitudes, timestep) and that was
 * honest for what it did. The v1.1 brief asks for a state that can be
 * SERIALISED, HASHED, REPLAYED and AUDITED, which means the things a replay
 * needs have to be IN the state rather than in the caller's head: the context
 * it was reasoning under, which hypotheses are still admitted, which evidence
 * it has seen, what its parent was, and the full chain of transitions.
 *
 * WHAT THIS IS NOT. It is a classical simulation of a complex amplitude vector.
 * No entanglement, no tensor factorisation, no hardware. `OQCA_CLAIMS.md`
 * carries the full list; the one that matters here is that a "cognitive state"
 * is a name for a normalized vector, not a claim about cognition.
 *
 * DETERMINISM IS THE WHOLE POINT, so three things are structural rather than
 * conventional: every field is readonly and every method returns a NEW state;
 * `stateId` is a content hash so two runs of the same operations produce the
 * same ids; and no clock is read anywhere in this file. `transition()` takes a
 * logical timestamp from the state's own timestep. A state whose identity moves
 * when the wall clock moves cannot be replayed.
 */
import { type Amplitude, cArg, cIsFinite, cNorm2 } from "./math/complex.ts";
import { contentHash } from "./math/hash.ts";
import {
  type QuantumOperator,
  applyOperator,
  operatorUnitarityResidual,
  vectorNorm,
} from "./operators.ts";
import { CLASSICAL_SIMULATOR, type TransitionRecord, historyProblems } from "./transition.ts";

/** How far the norm may drift from 1 before `validate()` calls it broken. */
export const NORM_TOLERANCE = 1e-9;

/** Below this the direction is rounding noise rather than a belief. */
export const MIN_NORM = 1e-12;

export type Context = {
  readonly contextId: string;
  /** Free-form situational tags. Part of the hash: context changes identity. */
  readonly tags: Readonly<Record<string, string>>;
};

export const ROOT_CONTEXT: Context = { contextId: "root", tags: {} };

export type ConfidenceMeta = {
  /** The leading hypothesis, or null when the state is empty of admitted ones. */
  readonly top: string | null;
  readonly probability: number;
  /** Gap to the runner-up. Small means the state has not actually decided. */
  readonly margin: number;
  /** Shannon entropy in bits over the full basis. */
  readonly entropy: number;
};

export type StateSnapshot = {
  readonly stateId: string;
  readonly parentId: string | null;
  readonly basis: readonly string[];
  readonly amplitudes: readonly { re: number; im: number }[];
  readonly probabilities: readonly number[];
  readonly phases: readonly number[];
  readonly context: Context;
  readonly activeHypotheses: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly timestep: number;
  readonly history: readonly TransitionRecord[];
  readonly normError: number;
  readonly confidence: ConfidenceMeta;
};

export type ValidationProblem = { readonly code: string; readonly detail: string };
export type ValidationResult = { readonly ok: boolean; readonly problems: ValidationProblem[] };

export type TransitionOptions = {
  readonly operation: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly evidenceIds?: readonly string[];
  readonly seed?: number | null;
  readonly implementation?: string;
  /** Basis labels for the RESULT. Required when the operator changes size. */
  readonly basis?: readonly string[];
  readonly context?: Context;
  readonly activeHypotheses?: readonly string[];
  /** Human-only. Excluded from the hash by `hashableRecord`. */
  readonly wallClock?: number;
};

export class StateError extends Error {
  constructor(message: string) {
    super(`OQCA state: ${message}`);
    this.name = "StateError";
  }
}

export class CognitiveState {
  readonly stateId: string;
  readonly parentId: string | null;
  readonly basis: readonly string[];
  readonly amplitudes: readonly Amplitude[];
  readonly context: Context;
  readonly activeHypotheses: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly timestep: number;
  readonly history: readonly TransitionRecord[];
  /** |1 - sum|a|^2| AS BUILT — the drift, recorded rather than scrubbed. */
  readonly normError: number;

  private constructor(init: {
    parentId: string | null;
    basis: readonly string[];
    amplitudes: readonly Amplitude[];
    context: Context;
    activeHypotheses: readonly string[];
    evidenceIds: readonly string[];
    timestep: number;
    history: readonly TransitionRecord[];
  }) {
    this.parentId = init.parentId;
    this.basis = Object.freeze([...init.basis]);
    this.amplitudes = Object.freeze(init.amplitudes.map((a) => Object.freeze({ ...a })));
    this.context = init.context;
    this.activeHypotheses = Object.freeze([...init.activeHypotheses]);
    this.evidenceIds = Object.freeze([...init.evidenceIds]);
    this.timestep = init.timestep;
    this.history = Object.freeze([...init.history]);
    let sum = 0;
    for (const a of this.amplitudes) sum += cNorm2(a);
    this.normError = Math.abs(1 - sum);
    this.stateId = contentHash(this.hashPayload());
  }

  /**
   * The exact bytes the id is a function of.
   *
   * THE HISTORY IS DELIBERATELY NOT IN HERE, and the reason is a hard one
   * rather than a preference. A record's `toState` names the state it produced;
   * if the state's id also hashed that record, the id would be a function of
   * itself. The first draft of this file tried to break the circle with a
   * provisional hash and `validate()` then failed on EVERY transitioned state,
   * because the id computed with `toState` set can never equal the id the
   * record was told to name.
   *
   * So: the id is the STATE (where you are), the history is the PATH (how you
   * got there), and the chain is verified by `historyProblems` linking from/to
   * rather than by folding the chain into the id. Two paths that genuinely
   * arrive at the same content at the same timestep from the same parent DO
   * hash alike — which is a property worth having, not a collision.
   *
   * No clock is read here, so a run replayed a day later gets the same ids.
   */
  private hashPayload() {
    return {
      basis: [...this.basis],
      amplitudes: this.amplitudes.map((a) => ({ re: a.re, im: a.im })),
      context: { contextId: this.context.contextId, tags: { ...this.context.tags } },
      activeHypotheses: [...this.activeHypotheses],
      evidenceIds: [...this.evidenceIds],
      timestep: this.timestep,
      parentId: this.parentId,
    };
  }

  /**
   * A state from non-negative WEIGHTS: each becomes sqrt(w), so probability is
   * proportional to w. The shape a caller thinks in, and the one place a square
   * root belongs.
   */
  static fromWeights(
    basis: readonly string[],
    weights: readonly number[],
    context: Context = ROOT_CONTEXT,
  ): CognitiveState {
    if (basis.length === 0) throw new StateError("a state needs at least one hypothesis");
    if (basis.length !== weights.length) throw new StateError("one weight per basis element");
    if (new Set(basis).size !== basis.length) throw new StateError("basis labels must be unique");
    for (const w of weights) {
      if (!Number.isFinite(w) || w < 0) throw new StateError("weights must be finite and >= 0");
    }
    return CognitiveState.fromAmplitudes(
      basis,
      weights.map((w) => ({ re: Math.sqrt(w), im: 0 })),
      context,
    );
  }

  static fromAmplitudes(
    basis: readonly string[],
    amplitudes: readonly Amplitude[],
    context: Context = ROOT_CONTEXT,
  ): CognitiveState {
    if (basis.length !== amplitudes.length) throw new StateError("one amplitude per basis element");
    const norm = vectorNorm(amplitudes);
    if (!Number.isFinite(norm) || norm < MIN_NORM) throw new StateError("zero-norm state");
    return new CognitiveState({
      parentId: null,
      basis,
      amplitudes: amplitudes.map((a) => ({ re: a.re / norm, im: a.im / norm })),
      context,
      activeHypotheses: [...basis],
      evidenceIds: [],
      timestep: 0,
      history: [],
    });
  }

  probabilities(): number[] {
    return this.amplitudes.map(cNorm2);
  }

  /** arg(a_i) per basis element — the information a probability vector loses. */
  phases(): number[] {
    return this.amplitudes.map(cArg);
  }

  norm(): number {
    return vectorNorm(this.amplitudes);
  }

  indexOf(label: string): number {
    const i = this.basis.indexOf(label);
    if (i < 0) throw new StateError(`no hypothesis named ${JSON.stringify(label)}`);
    return i;
  }

  confidence(): ConfidenceMeta {
    const p = this.probabilities();
    if (p.length === 0) return { top: null, probability: 0, margin: 0, entropy: 0 };
    const order = p.map((v, i) => ({ i, v })).sort((x, y) => y.v - x.v);
    let h = 0;
    for (const v of p) if (v > 0) h -= v * Math.log2(v);
    return {
      top: this.basis[order[0].i],
      probability: order[0].v,
      margin: order.length > 1 ? order[0].v - order[1].v : order[0].v,
      entropy: h,
    };
  }

  hash(): string {
    return this.stateId;
  }

  snapshot(): StateSnapshot {
    return {
      stateId: this.stateId,
      parentId: this.parentId,
      basis: [...this.basis],
      amplitudes: this.amplitudes.map((a) => ({ re: a.re, im: a.im })),
      probabilities: this.probabilities(),
      phases: this.phases(),
      context: { contextId: this.context.contextId, tags: { ...this.context.tags } },
      activeHypotheses: [...this.activeHypotheses],
      evidenceIds: [...this.evidenceIds],
      timestep: this.timestep,
      history: this.history.map((r) => ({ ...r })),
      normError: this.normError,
      confidence: this.confidence(),
    };
  }

  /**
   * Rebuild from a snapshot. The reconstructed `stateId` MUST equal the
   * snapshot's, and this throws when it does not — a restore that silently
   * produced a different state would make every replay test vacuous, which is
   * the failure mode this repo has hit six times under a different name.
   */
  static restore(snap: StateSnapshot): CognitiveState {
    const restored = new CognitiveState({
      parentId: snap.parentId,
      basis: snap.basis,
      amplitudes: snap.amplitudes.map((a) => ({ re: a.re, im: a.im })),
      context: { contextId: snap.context.contextId, tags: { ...snap.context.tags } },
      activeHypotheses: snap.activeHypotheses,
      evidenceIds: snap.evidenceIds,
      timestep: snap.timestep,
      history: snap.history,
    });
    if (restored.stateId !== snap.stateId) {
      throw new StateError(
        `restore produced a different state (${restored.stateId} != ${snap.stateId})`,
      );
    }
    return restored;
  }

  /**
   * Apply one operator and return the successor, with the transition RECORDED.
   * There is no way to move a state without leaving a record, which is what
   * makes section 5's audit trail a property rather than a discipline.
   */
  transition(op: QuantumOperator, opts: TransitionOptions): CognitiveState {
    const normBefore = this.norm();
    const nextAmps = applyOperator(this.amplitudes, op);
    const basis = opts.basis ?? this.basis;
    if (basis.length !== nextAmps.length) {
      throw new StateError(
        `operator produced ${nextAmps.length} amplitudes for ${basis.length} basis labels`,
      );
    }
    const normAfter = vectorNorm(nextAmps);
    if (!Number.isFinite(normAfter) || normAfter < MIN_NORM) {
      throw new StateError(`${opts.operation} produced a zero-norm state`);
    }
    const context = opts.context ?? this.context;
    const evidenceIds = opts.evidenceIds?.length
      ? [...new Set([...this.evidenceIds, ...opts.evidenceIds])]
      : [...this.evidenceIds];
    const active = opts.activeHypotheses
      ? [...opts.activeHypotheses]
      : this.activeHypotheses.filter((h) => basis.includes(h));

    // The successor is built FIRST, with the history it inherits, so that its
    // id exists before any record has to name it. Because the id does not hash
    // the history (see `hashPayload`), appending the record cannot change it —
    // and `historyHeadNamesState` in the tests pins exactly that.
    const successor = new CognitiveState({
      parentId: this.stateId,
      basis,
      amplitudes: nextAmps,
      context,
      activeHypotheses: active,
      evidenceIds,
      timestep: this.timestep + 1,
      history: this.history,
    });

    const record: TransitionRecord = {
      fromState: this.stateId,
      toState: successor.stateId,
      operation: opts.operation,
      parameters: { ...(opts.parameters ?? {}) },
      evidenceIds: [...(opts.evidenceIds ?? [])],
      contextId: context.contextId,
      normBefore,
      normAfter,
      timestamp: this.timestep + 1,
      seed: opts.seed ?? null,
      implementation: opts.implementation ?? CLASSICAL_SIMULATOR,
      unitarityResidual: operatorUnitarityResidual(op),
      ...(opts.wallClock === undefined ? {} : { wallClock: opts.wallClock }),
    };

    return new CognitiveState({
      parentId: this.stateId,
      basis,
      amplitudes: nextAmps,
      context,
      activeHypotheses: active,
      evidenceIds,
      timestep: this.timestep + 1,
      history: [...this.history, record],
    });
  }

  validate(): ValidationResult {
    const problems: ValidationProblem[] = [];
    if (this.basis.length !== this.amplitudes.length) {
      problems.push({
        code: "dimension_mismatch",
        detail: `${this.basis.length} labels, ${this.amplitudes.length} amplitudes`,
      });
    }
    if (new Set(this.basis).size !== this.basis.length) {
      problems.push({ code: "duplicate_basis", detail: "basis labels are not unique" });
    }
    for (let i = 0; i < this.amplitudes.length; i++) {
      if (!cIsFinite(this.amplitudes[i])) {
        problems.push({ code: "non_finite_amplitude", detail: `index ${i} is NaN or Infinity` });
      }
    }
    if (!(this.normError <= NORM_TOLERANCE)) {
      problems.push({
        code: "norm_drift",
        detail: `|1 - sum|a|^2| = ${this.normError} exceeds ${NORM_TOLERANCE}`,
      });
    }
    for (const h of this.activeHypotheses) {
      if (!this.basis.includes(h)) {
        problems.push({ code: "unknown_active_hypothesis", detail: h });
      }
    }
    for (const p of historyProblems(this.history)) {
      problems.push({ code: "malformed_history", detail: `[${p.index}] ${p.problem}` });
    }
    if (this.history.length > 0 && this.history[this.history.length - 1].toState !== this.stateId) {
      problems.push({
        code: "history_head_mismatch",
        detail: "the last record does not name this state",
      });
    }
    return { ok: problems.length === 0, problems };
  }

  assertValid(): this {
    const r = this.validate();
    if (!r.ok) {
      throw new StateError(
        `invalid: ${r.problems.map((p) => `${p.code}(${p.detail})`).join("; ")}`,
      );
    }
    return this;
  }
}
