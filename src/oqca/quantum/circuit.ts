/**
 * ONIQ-NATIVE CIRCUIT REPRESENTATION — quantum brief §5.
 *
 * "qubits, classical bits, operations, parameters, measurements, resets,
 *  controls, conditions, barriers, timing."
 *
 * ALL TEN ARE HERE, and the two that are usually left out are the two that
 * change what a circuit MEANS: a `condition` makes an operation classically
 * controlled, which is what turns a circuit into a program with feedback (and
 * is how QEC actually works); a `barrier` is a compiler instruction, not a
 * physical operation, so a transpiler that reordered across one would be wrong.
 *
 * THIS IS AN INTERMEDIATE REPRESENTATION, NOT A DSL. It is a data structure a
 * backend consumes and an adapter could export — §5's "Support import/export
 * adapters where legally and technically appropriate". Nothing here imports a
 * vendor library; `backends/adapters.ts` is where that boundary sits, and every
 * adapter there refuses.
 */
import type { CMatrix } from "./math/linalg.ts";
import { GATES, controlled, onQubit, rx, ry, rz, phase, u } from "./gates.ts";
import { identity, kron, mul } from "./math/linalg.ts";

export type OpKind = "gate" | "measure" | "reset" | "barrier" | "delay";

/** A classical condition: run the op only if `creg` currently equals `value`. */
export type Condition = { readonly creg: readonly number[]; readonly value: number };

export type Operation = {
  readonly kind: OpKind;
  /** Registry name for a gate, or the op kind for the others. */
  readonly name: string;
  readonly qubits: readonly number[];
  /** Classical bits written (measure) or read (condition). */
  readonly clbits: readonly number[];
  readonly params: readonly number[];
  readonly condition: Condition | null;
  /** Nanoseconds. §5's "timing" — null when the circuit is untimed. */
  readonly durationNs: number | null;
};

export type Circuit = {
  readonly name: string;
  readonly qubits: number;
  readonly clbits: number;
  readonly ops: readonly Operation[];
};

export function circuit(name: string, qubits: number, clbits = 0): Circuit {
  if (qubits < 1) throw new Error("quantum circuit: at least one qubit is required");
  return { name, qubits, clbits, ops: [] };
}

function push(cir: Circuit, op: Operation): Circuit {
  for (const q of op.qubits) {
    if (q < 0 || q >= cir.qubits) throw new Error(`quantum circuit: no qubit ${q}`);
  }
  for (const b of op.clbits) {
    if (b < 0 || b >= cir.clbits) throw new Error(`quantum circuit: no clbit ${b}`);
  }
  return { ...cir, ops: [...cir.ops, op] };
}

const base = {
  clbits: [] as readonly number[],
  params: [] as readonly number[],
  condition: null,
  durationNs: null,
} as const;

export function gate(
  cir: Circuit,
  name: string,
  qubits: readonly number[],
  params: readonly number[] = [],
  condition: Condition | null = null,
): Circuit {
  // THE REGISTRY IS CLOSED. An unknown gate name is refused rather than
  // ignored — a circuit holding an op no backend can run is a circuit that
  // simulates to the wrong answer without ever erroring.
  if (!PARAMETERIC.has(name) && !(name in GATES)) {
    throw new Error(`quantum circuit: unknown gate ${name}`);
  }
  return push(cir, { ...base, kind: "gate", name, qubits, params, condition });
}

export function measure(cir: Circuit, qubit: number, clbit: number): Circuit {
  return push(cir, { ...base, kind: "measure", name: "measure", qubits: [qubit], clbits: [clbit] });
}

export function reset(cir: Circuit, qubit: number): Circuit {
  return push(cir, { ...base, kind: "reset", name: "reset", qubits: [qubit] });
}

export function barrier(cir: Circuit, qubits: readonly number[]): Circuit {
  return push(cir, { ...base, kind: "barrier", name: "barrier", qubits });
}

export function delay(cir: Circuit, qubit: number, ns: number): Circuit {
  return push(cir, { ...base, kind: "delay", name: "delay", qubits: [qubit], durationNs: ns });
}

/** Gates built from parameters rather than looked up. */
export const PARAMETERIC = new Set(["rx", "ry", "rz", "p", "u", "crx", "cry", "crz", "cp"]);

/** The matrix a named operation denotes, embedded in an n-qubit register. */
export function operationMatrix(op: Operation, n: number): CMatrix {
  const [a, b] = op.params;
  const single: Record<string, () => CMatrix> = {
    rx: () => rx(a),
    ry: () => ry(a),
    rz: () => rz(a),
    p: () => phase(a),
    u: () => u(op.params[0], op.params[1], op.params[2]),
  };
  if (single[op.name]) return onQubit(single[op.name](), op.qubits[0], n);

  const ctrl: Record<string, () => CMatrix> = {
    crx: () => controlled(rx(a)),
    cry: () => controlled(ry(a)),
    crz: () => controlled(rz(a)),
    cp: () => controlled(phase(a)),
  };
  const spec = GATES[op.name];
  const m = ctrl[op.name] ? ctrl[op.name]() : spec?.matrix;
  if (!m) throw new Error(`quantum circuit: no matrix for ${op.name}`);
  void b;

  const width = Math.log2(m.rows);
  if (width === 1) return onQubit(m, op.qubits[0], n);
  return embedMulti(m, op.qubits, n);
}

/**
 * EMBEDDING A MULTI-QUBIT GATE ON ARBITRARY, POSSIBLY NON-ADJACENT QUBITS.
 *
 * Done by PERMUTATION rather than by index gymnastics: build the gate on the
 * leading `width` qubits, then conjugate by the permutation that carries those
 * positions to the requested ones. It is slower and it is obviously correct,
 * which for a reference implementation is the right trade — index arithmetic on
 * non-adjacent qubits is the classic source of a simulator that agrees with
 * itself and with nothing else.
 */
function embedMulti(m: CMatrix, targets: readonly number[], n: number): CMatrix {
  const width = Math.log2(m.rows);
  if (targets.length !== width) {
    throw new Error(`quantum circuit: gate needs ${width} qubits, given ${targets.length}`);
  }
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => !targets.includes(i));
  const order = [...targets, ...rest]; // order[newPos] = oldQubit
  const padded = kron(m, identity(2 ** (n - width)));
  const perm = permutationMatrix(order, n);
  // P maps the natural ordering into `order`; conjugating puts the gate back.
  return mul(mul(perm, padded), transposePerm(perm));
}

function permutationMatrix(order: readonly number[], n: number): CMatrix {
  const dim = 2 ** n;
  const data = new Array(dim * dim).fill(null).map(() => ({ re: 0, im: 0 }));
  for (let i = 0; i < dim; i++) {
    // Read the bits of i in the PERMUTED order, write them in natural order.
    let j = 0;
    for (let pos = 0; pos < n; pos++) {
      const bit = (i >> (n - 1 - pos)) & 1;
      j |= bit << (n - 1 - order[pos]);
    }
    data[j * dim + i] = { re: 1, im: 0 };
  }
  return { rows: dim, cols: dim, data };
}

function transposePerm(p: CMatrix): CMatrix {
  const d = new Array(p.rows * p.cols).fill(null).map(() => ({ re: 0, im: 0 }));
  for (let r = 0; r < p.rows; r++) {
    for (let k = 0; k < p.cols; k++) d[k * p.rows + r] = p.data[r * p.cols + k];
  }
  return { rows: p.cols, cols: p.rows, data: d };
}

/* ---------------- metrics the compiler section needs ---------------- */

export function depth(cir: Circuit): number {
  const last = new Array<number>(cir.qubits).fill(0);
  for (const op of cir.ops) {
    if (op.kind === "barrier") continue;
    const d = Math.max(0, ...op.qubits.map((q) => last[q])) + 1;
    for (const q of op.qubits) last[q] = d;
  }
  return Math.max(0, ...last);
}

export function twoQubitCount(cir: Circuit): number {
  return cir.ops.filter((o) => o.kind === "gate" && o.qubits.length === 2).length;
}

/**
 * T-COUNT — §11 names it, and it is the metric that matters for fault tolerance
 * rather than for speed: in a surface-code machine Clifford gates are cheap and
 * every T requires a distilled magic state.
 */
export function tCount(cir: Circuit): number {
  return cir.ops.filter((o) => o.name === "T" || o.name === "TDG").length;
}

export function gateCount(cir: Circuit): number {
  return cir.ops.filter((o) => o.kind === "gate").length;
}

/** The whole circuit as one unitary. Refuses when it is not one. */
export function circuitUnitary(cir: Circuit): CMatrix {
  let m = identity(2 ** cir.qubits);
  for (const op of cir.ops) {
    if (op.kind === "barrier" || op.kind === "delay") continue;
    if (op.kind !== "gate") {
      // A measurement or reset is not unitary — the circuit as a whole is then
      // a channel, and asking for its unitary is a category error rather than
      // something to approximate.
      throw new Error(`quantum circuit: ${op.kind} is not unitary; use a backend to simulate`);
    }
    if (op.condition) throw new Error("quantum circuit: a conditional op has no static unitary");
    m = mul(operationMatrix(op, cir.qubits), m);
  }
  return m;
}
