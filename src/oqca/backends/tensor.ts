/**
 * OQCA v1.1 — the tensor-network seam. Brief section 16.
 *
 * "Do not implement a large dependency unless already available in the
 * repository." None is, so this is an INTERFACE plus a small honest piece of
 * real work: the reshape between a flat amplitude vector and a rank-k tensor,
 * which needs no library and is the one part that can be checked.
 *
 * WHY IT MATTERS BEYOND SIMULATION SPEED, and this is the connection the brief
 * does not spell out: a tensor factorisation is exactly what OQCA lacks, and it
 * is what makes `ENTANGLE` a category-C operation in `cognitive.ts`.
 * Entanglement is non-factorability across a tensor product; a flat basis of
 * hypotheses has no product to be non-factorable across. So this seam is the
 * route by which ENTANGLE could ever leave category C — not a performance
 * optimisation.
 *
 * `contract` and `applyTensorOperator` REFUSE. Contracting a network is where
 * the library would go, and a hand-rolled partial version would be slower than
 * the dense simulator while looking like progress.
 */
import { type Amplitude, C_ZERO, cNorm2 } from "../math/complex.ts";
import { BackendUnavailable } from "./backend.ts";

export const TENSOR_MISSING =
  "a tensor-network contraction library (none is in package.json, which Lovable owns), plus a decision about how hypotheses factor into subsystems";

export type TensorShape = readonly number[];

export type TensorState = {
  readonly shape: TensorShape;
  /** Row-major (C-order) flat data, length = product(shape). */
  readonly data: readonly Amplitude[];
};

export function shapeSize(shape: TensorShape): number {
  return shape.reduce((a, b) => a * b, 1);
}

/**
 * Reshape a flat state into a rank-k tensor. Amplitudes are PADDED with zeros
 * when the shape is larger than the vector — which is exactly the
 * non-power-of-two problem `qpu.ts` lists as item 2, surfacing here first.
 */
export function stateToTensor(amplitudes: readonly Amplitude[], shape: TensorShape): TensorState {
  if (shape.length === 0) throw new Error("OQCA tensor: shape must have at least one axis");
  for (const d of shape) {
    if (!Number.isInteger(d) || d < 1) throw new Error("OQCA tensor: dimensions must be >= 1");
  }
  const size = shapeSize(shape);
  if (size < amplitudes.length) {
    throw new Error(`OQCA tensor: shape holds ${size}, state has ${amplitudes.length}`);
  }
  const data = amplitudes.map((a) => ({ ...a }));
  while (data.length < size) data.push({ ...C_ZERO });
  return { shape, data };
}

/** The inverse, truncating the padding back off. Round-trips exactly. */
export function tensorToState(t: TensorState, basisSize: number): readonly Amplitude[] {
  if (basisSize > t.data.length) {
    throw new Error(`OQCA tensor: cannot recover ${basisSize} from ${t.data.length}`);
  }
  return t.data.slice(0, basisSize).map((a) => ({ ...a }));
}

/** Total probability held in a tensor. Zero-padding contributes nothing. */
export function tensorNorm(t: TensorState): number {
  let sum = 0;
  for (const a of t.data) sum += cNorm2(a);
  return Math.sqrt(sum);
}

export function applyTensorOperator(): never {
  throw new BackendUnavailable("TensorBackend.applyTensorOperator", TENSOR_MISSING);
}

export function contract(): never {
  throw new BackendUnavailable("TensorBackend.contract", TENSOR_MISSING);
}

export function measureTensor(): never {
  throw new BackendUnavailable("TensorBackend.measure", TENSOR_MISSING);
}
