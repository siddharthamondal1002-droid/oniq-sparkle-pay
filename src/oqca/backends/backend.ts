/**
 * OQCA v1.1 — the backend seam. Brief sections 15 and 16.
 *
 * ONE INTERFACE, ONE IMPLEMENTATION, AND TWO HONEST PLACEHOLDERS. The brief
 * asks for a `QuantumBackend` that could later map valid unitaries onto real
 * circuits, and then says in as many words: "Do not claim QPU compatibility
 * until circuit-level tests demonstrate it." So `QPUBackend` and `TensorBackend`
 * exist as TYPES and refuse at runtime, naming what is missing. A stub that
 * silently fell back to the simulator would make every "runs on the QPU
 * backend" test a test of the simulator — the exact shape of "built and
 * unit-tested is not reachable", which CLAUDE.md records four times.
 *
 * `capabilities()` is the load-bearing method: a caller asks what a backend can
 * do rather than assuming, and the benchmark records the answer beside every
 * result. `implementation` is what lands in each `TransitionRecord`.
 */
import type { Amplitude } from "../math/complex.ts";
import type { QuantumOperator } from "../operators.ts";

export type BackendCapabilities = {
  readonly name: string;
  /** What `TransitionRecord.implementation` will say. */
  readonly implementation: string;
  /** Operator kinds this backend can execute. */
  readonly operators: readonly QuantumOperator["kind"][];
  readonly maxBasisSize: number;
  /** True only for a backend that runs on physical qubits. */
  readonly physical: boolean;
  /** True when amplitudes can be read directly (no sampling needed). */
  readonly stateVectorReadable: boolean;
  /** Anything a caller must know before believing a result from here. */
  readonly caveats: readonly string[];
};

export interface QuantumBackend {
  capabilities(): BackendCapabilities;
  prepareState(amplitudes: readonly Amplitude[]): readonly Amplitude[];
  applyOperator(amplitudes: readonly Amplitude[], op: QuantumOperator): readonly Amplitude[];
  /** Born-rule probabilities. On hardware this would require repeated shots. */
  measure(amplitudes: readonly Amplitude[]): readonly number[];
  serialize(amplitudes: readonly Amplitude[]): string;
}

export class BackendUnavailable extends Error {
  constructor(
    readonly backend: string,
    readonly missing: string,
  ) {
    super(`OQCA: ${backend} is not available. Missing: ${missing}`);
    this.name = "BackendUnavailable";
  }
}
