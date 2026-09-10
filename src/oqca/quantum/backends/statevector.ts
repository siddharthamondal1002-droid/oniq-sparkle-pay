/**
 * THE LOCAL STATEVECTOR BACKEND — the one backend that actually computes.
 *
 * Dense, exact, ONIQ-native, zero dependencies. It is the reference every other
 * adapter would be compared against (§26: "Every backend should pass common
 * semantic tests"), which is why it is exact rather than fast: a reference
 * implementation's job is to be obviously right.
 *
 * MEASUREMENT IS SEEDED AND DETERMINISTIC. `Math.random` is banned in this tree
 * — `security.test.ts` walks it — and the ban is not bureaucratic here: §17
 * requires experiments to be reproducible, and a sampler nobody can re-run
 * produces evidence nobody can check. Same seed, same counts, always.
 */
import { operationMatrix } from "../circuit.ts";
import { type CMatrix } from "../math/linalg.ts";
import {
  type DensityMatrix,
  applyMatrix,
  densityFromState,
  expectation as expectationOf,
  isNormalized,
  partialTrace,
  probabilities,
  zeroState,
} from "../math/state.ts";
import { GATES, controlled, onQubit, phase, rx, ry, rz, u } from "../gates.ts";
import { type QuantumPolicy, DEFAULT_QUANTUM_POLICY, checkLocal } from "../policy.ts";
import { type Counts, type QuantumBackend, refuse, yes } from "./backend.ts";
import { c, C_ZERO } from "../../math/complex.ts";

/**
 * A SMALL DETERMINISTIC PRNG (mulberry32). Chosen because it is eight lines,
 * has no state to get wrong, and gives the same stream on every runtime — which
 * a hash-based sampler would not, and `Math.random` could not.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bitstring(index: number, qubits: number): string {
  return index.toString(2).padStart(qubits, "0");
}

/** Sample `shots` outcomes from a probability vector, deterministically. */
export function sampleCounts(
  probs: readonly number[],
  shots: number,
  seed: number,
  qubits: number,
): Counts {
  const rng = mulberry32(seed);
  const cumulative: number[] = [];
  let acc = 0;
  for (const p of probs) {
    acc += p;
    cumulative.push(acc);
  }
  const counts: Record<string, number> = {};
  for (let s = 0; s < shots; s++) {
    const r = rng() * acc;
    let idx = cumulative.findIndex((cp) => r <= cp);
    if (idx < 0) idx = probs.length - 1;
    const key = bitstring(idx, qubits);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function matrixFor(name: string, params: readonly number[]): CMatrix | null {
  const p = params;
  switch (name) {
    case "rx":
      return rx(p[0]);
    case "ry":
      return ry(p[0]);
    case "rz":
      return rz(p[0]);
    case "p":
      return phase(p[0]);
    case "u":
      return u(p[0], p[1], p[2]);
    case "crx":
      return controlled(rx(p[0]));
    case "cry":
      return controlled(ry(p[0]));
    case "crz":
      return controlled(rz(p[0]));
    case "cp":
      return controlled(phase(p[0]));
    default:
      return GATES[name]?.matrix ?? null;
  }
}

export function makeStatevectorBackend(
  policy: QuantumPolicy = DEFAULT_QUANTUM_POLICY,
): QuantumBackend {
  return {
    name: "LocalStatevectorBackend",
    available: true,

    createState: (qubits) => {
      const gate = checkLocal(policy, qubits, 0);
      if (!gate.allowed) return refuse(gate.reason, `${qubits} qubits`);
      return yes(zeroState(qubits));
    },

    applyOperation: (state, name, qubits, params = []) => {
      const m = matrixFor(name, params);
      if (!m) return refuse("adapter_unavailable", `unknown gate ${name}`);
      const width = Math.log2(m.rows);
      const embedded =
        width === 1
          ? onQubit(m, qubits[0], state.qubits)
          : operationMatrix(
              {
                kind: "gate",
                name,
                qubits,
                clbits: [],
                params,
                condition: null,
                durationNs: null,
              },
              state.qubits,
            );
      return yes(applyMatrix(embedded, state));
    },

    measure: (state, shots, seed) => {
      const gate = checkLocal(policy, state.qubits, shots);
      if (!gate.allowed) return refuse(gate.reason, `${shots} shots`);
      return yes(sampleCounts(probabilities(state), shots, seed, state.qubits));
    },

    simulate: (circuit, shots, seed) => {
      const gate = checkLocal(policy, circuit.qubits, shots);
      if (!gate.allowed) return refuse(gate.reason, `${circuit.qubits}q x ${shots} shots`);
      let state = zeroState(circuit.qubits);
      for (const op of circuit.ops) {
        if (op.kind === "barrier" || op.kind === "delay") continue;
        if (op.kind === "gate") {
          if (op.condition) {
            // A CLASSICALLY CONDITIONED GATE NEEDS A MEASURED REGISTER, which
            // a pure statevector does not carry. Refusing is the honest answer:
            // silently applying it unconditionally would change the circuit's
            // meaning and still return plausible counts.
            return refuse(
              "adapter_unavailable",
              "conditional operations need a density-matrix or trajectory backend",
            );
          }
          state = applyMatrix(operationMatrix(op, circuit.qubits), state);
          continue;
        }
        if (op.kind === "measure" || op.kind === "reset") {
          // Mid-circuit measurement collapses the state, which is a different
          // simulation mode. Terminal measurement is handled by sampling below.
          //
          // TERMINAL MEANS NOTHING COMPUTATIONAL FOLLOWS IT, and that has to be
          // read from the ops rather than from a count. The first version
          // compared this op's index against `ops.length - circuit.qubits`,
          // which is wrong twice: it uses the QUBIT count where the number of
          // measurements belongs, and `indexOf` finds the first structurally
          // equal op rather than this one.
          const i = circuit.ops.indexOf(op);
          const terminal = circuit.ops
            .slice(i + 1)
            .every((o) => o.kind === "measure" || o.kind === "barrier" || o.kind === "delay");
          if (!terminal) {
            return refuse(
              "adapter_unavailable",
              `mid-circuit ${op.kind} needs a trajectory backend`,
            );
          }
        }
      }

      const probs = probabilities(state);
      // THE COUNTS ARE KEYED BY THE CLASSICAL REGISTER THE CIRCUIT DECLARED,
      // not by the whole quantum one — and the difference is not cosmetic. A
      // Bernstein-Vazirani circuit carries an ancilla it never measures; keying
      // by all `circuit.qubits` returned a 5-bit string for a 4-bit answer, and
      // a caller comparing it against the hidden string read a mismatch on a
      // circuit that was perfectly correct. Found by running the §17
      // experiment, not by any test of this file.
      //
      // Bit order is ONIQ's own, stated in `domains.ts` DIVERGENCES: clbit 0 is
      // the MOST significant character, matching the big-endian `QUBIT_ORDER`.
      const measured = circuit.ops.filter((o) => o.kind === "measure");
      if (measured.length === 0) return yes(sampleCounts(probs, shots, seed, circuit.qubits));

      const full = sampleCounts(probs, shots, seed, circuit.qubits);
      const byClbit = [...measured].sort((a, b) => a.clbits[0] - b.clbits[0]);
      const out: Record<string, number> = {};
      for (const [key, n] of Object.entries(full)) {
        const projected = byClbit.map((o) => key[o.qubits[0]]).join("");
        out[projected] = (out[projected] ?? 0) + n;
      }
      return yes(out);
    },

    expectation: (state, observable) => {
      if (!isNormalized(state, 1e-8))
        return refuse("adapter_unavailable", "state is not normalised");
      const e = expectationOf(observable, state);
      // A HERMITIAN OBSERVABLE HAS A REAL EXPECTATION. A stray imaginary part
      // means the caller passed something that is not an observable, so it is
      // refused rather than silently dropped with `.re`.
      if (Math.abs(e.im) > 1e-8) {
        return refuse(
          "adapter_unavailable",
          `expectation has imaginary part ${e.im}; not Hermitian`,
        );
      }
      return yes(e.re);
    },

    reset: (state, qubit) => {
      // Reset is NOT unitary — the honest return type is a density matrix.
      // Tracing out the qubit and re-attaching |0> is exactly what a physical
      // reset does to the rest of the register.
      const rho = densityFromState(state);
      const rest = partialTrace(rho, [qubit]);
      const n = rest.qubits + 1;
      const dim = 2 ** n;
      const data = new Array(dim * dim).fill(C_ZERO);
      const kd = 2 ** rest.qubits;
      const insert = (idx: number): number => {
        // Put a 0 bit back at position `qubit` (big-endian, qubit 0 leftmost).
        const high = idx >> (rest.qubits - qubit);
        const low = idx & ((1 << (rest.qubits - qubit)) - 1);
        return (high << (rest.qubits - qubit + 1)) | low;
      };
      for (let r = 0; r < kd; r++) {
        for (let k = 0; k < kd; k++) {
          data[insert(r) * dim + insert(k)] = rest.rho.data[r * kd + k];
        }
      }
      void c;
      return yes({ qubits: n, rho: { rows: dim, cols: dim, data } } as DensityMatrix);
    },
  };
}
