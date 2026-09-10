/**
 * OQCA v1.1 — the only backend that runs. A dense state-vector simulator.
 *
 * It is exactly what every OQCA number in this repository was produced by, and
 * `capabilities().caveats` says so in the first line so a result cannot be
 * quoted without it.
 */
import { type Amplitude, cNorm2, cScale } from "../math/complex.ts";
import { canonicalJson } from "../math/hash.ts";
import { type QuantumOperator, applyOperator, vectorNorm } from "../operators.ts";
import { type BackendCapabilities, type QuantumBackend } from "./backend.ts";

/** A dense vector fits in memory; beyond this the honest answer is a refusal. */
export const MAX_SIMULATED_BASIS = 4096;

export class ClassicalSimulatorBackend implements QuantumBackend {
  capabilities(): BackendCapabilities {
    return {
      name: "ClassicalSimulatorBackend",
      implementation: "classical_simulator",
      operators: ["pair", "diagonal", "project", "prepare", "embed"],
      maxBasisSize: MAX_SIMULATED_BASIS,
      physical: false,
      stateVectorReadable: true,
      caveats: [
        "classical simulation of a complex amplitude vector; no physical qubits",
        "no tensor factorisation, so no entanglement is representable",
        "measurement reads amplitudes directly rather than sampling shots",
      ],
    };
  }

  prepareState(amplitudes: readonly Amplitude[]): readonly Amplitude[] {
    if (amplitudes.length > MAX_SIMULATED_BASIS) {
      throw new Error(`OQCA: basis of ${amplitudes.length} exceeds ${MAX_SIMULATED_BASIS}`);
    }
    const n = vectorNorm(amplitudes);
    if (!(n > 0)) throw new Error("OQCA: cannot prepare a zero state");
    return amplitudes.map((a) => cScale(a, 1 / n));
  }

  applyOperator(amplitudes: readonly Amplitude[], op: QuantumOperator): readonly Amplitude[] {
    return applyOperator(amplitudes, op);
  }

  measure(amplitudes: readonly Amplitude[]): readonly number[] {
    return amplitudes.map(cNorm2);
  }

  serialize(amplitudes: readonly Amplitude[]): string {
    return canonicalJson(amplitudes.map((a) => ({ re: a.re, im: a.im })));
  }
}
