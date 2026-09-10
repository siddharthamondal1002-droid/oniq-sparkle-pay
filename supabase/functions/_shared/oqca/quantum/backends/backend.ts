/**
 * THE BACKEND INTERFACE — quantum brief §15, with the brief's own six methods.
 *
 * "Every backend should pass common semantic tests" (§26). That is only
 * possible if the interface is narrow enough that two implementations can
 * genuinely agree, so it is six methods and no escape hatch: no `run raw`, no
 * vendor-object passthrough, no options bag. An adapter that needed one would
 * be an adapter whose results could not be compared with the local simulator's,
 * and comparison is the entire reason the interface exists.
 */
import type { Circuit } from "../circuit.ts";
import type { CMatrix } from "../math/linalg.ts";
import type { DensityMatrix, StateVector } from "../math/state.ts";
import type { QuantumRefusal } from "../policy.ts";

export type BackendResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: QuantumRefusal; readonly detail: string };

export const refuse = <T>(reason: QuantumRefusal, detail: string): BackendResult<T> => ({
  ok: false,
  reason,
  detail,
});

export const yes = <T>(value: T): BackendResult<T> => ({ ok: true, value });

/** Counts per bitstring, e.g. { "00": 512, "11": 512 }. */
export type Counts = Readonly<Record<string, number>>;

export type QuantumBackend = {
  readonly name: string;
  /** Is this backend usable at all? A refusing adapter says false. */
  readonly available: boolean;
  readonly createState: (qubits: number) => BackendResult<StateVector>;
  readonly applyOperation: (
    state: StateVector,
    name: string,
    qubits: readonly number[],
    params?: readonly number[],
  ) => BackendResult<StateVector>;
  /** Deterministic given the same `seed`. */
  readonly measure: (state: StateVector, shots: number, seed: number) => BackendResult<Counts>;
  readonly simulate: (circuit: Circuit, shots: number, seed: number) => BackendResult<Counts>;
  readonly expectation: (state: StateVector, observable: CMatrix) => BackendResult<number>;
  readonly reset: (state: StateVector, qubit: number) => BackendResult<DensityMatrix>;
};
