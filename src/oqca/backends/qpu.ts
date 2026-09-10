/**
 * OQCA v1.1 — the QPU placeholder. Brief section 15.
 *
 * IT REFUSES, AND THAT IS THE DELIVERABLE. The brief: "Create a placeholder
 * QPUBackend but do not connect it to a vendor... Do not claim QPU
 * compatibility until circuit-level tests demonstrate it."
 *
 * So this class implements the interface and throws `BackendUnavailable` on
 * every method, naming what is missing. It costs nothing, connects to nothing,
 * and cannot be mistaken for working — a stub that quietly ran the simulator
 * would turn "the QPU backend passes its tests" into a sentence about the
 * simulator, which is how a claim gets made by accident.
 *
 * WHAT WOULD ACTUALLY BE NEEDED, so the gap is a list rather than a mood:
 *
 *   1. A vendor SDK and an account. Both are paid; neither is authorized.
 *   2. A QUBIT ENCODING. OQCA's basis is n named hypotheses; a register of k
 *      qubits has 2^k basis states. n is not generally a power of two, so a
 *      padding-and-post-selection scheme has to be chosen and its cost stated.
 *   3. Circuit synthesis. `Unitary2` on indices (i, j) is a two-level unitary;
 *      decomposing that into the vendor's native gate set is the real work, and
 *      the standard route (Givens rotations -> CNOT + single-qubit) is not
 *      written here.
 *   4. SHOT STATISTICS. `measure()` here returns exact probabilities. Hardware
 *      returns counts, so every benchmark number would gain a sampling error
 *      bar that none of the current results carry.
 *   5. Noise. Real devices decohere. `interfere` at theta = 0.73 rad is exact
 *      in simulation and approximate on a device, and nothing in this repo
 *      models that difference.
 *
 * What v1.1 DOES establish toward this: every operator is a genuine unitary
 * (or an explicitly labelled channel), and `unitarityResidual` is recorded on
 * every transition. That is a NECESSARY condition for item 3 and not a
 * sufficient one for any of the five.
 */
import type { Amplitude } from "../math/complex.ts";
import type { QuantumOperator } from "../operators.ts";
import { BackendUnavailable, type BackendCapabilities, type QuantumBackend } from "./backend.ts";

export const QPU_MISSING =
  "a vendor SDK and account (paid, unauthorized), a qubit encoding for a non-power-of-two basis, circuit synthesis from two-level unitaries, shot statistics, and a noise model";

export class QPUBackend implements QuantumBackend {
  capabilities(): BackendCapabilities {
    return {
      name: "QPUBackend",
      implementation: "qpu_placeholder",
      operators: [],
      maxBasisSize: 0,
      physical: true,
      stateVectorReadable: false,
      caveats: [
        "NOT CONNECTED. Every method throws BackendUnavailable.",
        `missing: ${QPU_MISSING}`,
        "no circuit-level test has ever been run, so no QPU compatibility is claimed",
      ],
    };
  }

  prepareState(_amplitudes: readonly Amplitude[]): readonly Amplitude[] {
    throw new BackendUnavailable("QPUBackend", QPU_MISSING);
  }

  applyOperator(_amplitudes: readonly Amplitude[], _op: QuantumOperator): readonly Amplitude[] {
    throw new BackendUnavailable("QPUBackend", QPU_MISSING);
  }

  measure(_amplitudes: readonly Amplitude[]): readonly number[] {
    throw new BackendUnavailable("QPUBackend", QPU_MISSING);
  }

  serialize(_amplitudes: readonly Amplitude[]): string {
    throw new BackendUnavailable("QPUBackend", QPU_MISSING);
  }
}
