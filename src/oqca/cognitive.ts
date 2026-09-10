/**
 * OQCA v1.1 — the COGNITIVE layer. Brief section 3.
 *
 * `operators.ts` knows what a valid transformation is. This file says what one
 * MEANS. The brief's instruction is the important part: "Document clearly which
 * are A. mathematically implemented, B. quantum-inspired semantic analogues,
 * C. not yet physically represented. Do not blur these categories."
 *
 * So the classification below is the deliverable, not the code, and two of the
 * eight are category C — declared and NOT implemented, because implementing a
 * plausible substitute is exactly the blurring the brief forbids. Calling one
 * throws `NotPhysicallyRepresented` naming what is missing.
 *
 *   SUPERPOSE  B  isometry + rotation. Norm-preserving, DIMENSION-CHANGING, so
 *                 not a unitary on the original space. The physics word for the
 *                 embedding C^n -> C^{n+1} is an isometry; calling it a gate
 *                 would be wrong.
 *   ENTANGLE   C  THERE IS NOTHING TO ENTANGLE. Entanglement is a property of a
 *                 state that does not factor across a TENSOR PRODUCT of
 *                 registers. OQCA's state is one flat basis of hypotheses with
 *                 no factorisation, so "entangled" has no referent here. The
 *                 missing piece is a factored register — see `backends/tensor`.
 *   PHASE      A  diag(e^{i.t_k}). A genuine diagonal unitary.
 *   INTERFERE  A  a two-level unitary on a pair. Unitary by construction since
 *                 v1.1 (`rotation`/`mixing`), not by rescue.
 *   CONTROL    B  a CLASSICAL conditional: apply U to (i,j) only if P(k) clears
 *                 a threshold. Conditioning on |a_k|^2 makes the map NONLINEAR
 *                 in the state, so it is emphatically not a controlled-U, which
 *                 is linear and needs a control register. The name is borrowed;
 *                 the mathematics is not.
 *   MEASURE    A  Born-rule readout, and projective collapse (project +
 *                 renormalize) is the textbook operation.
 *   RESET      A  state preparation. A CPTP channel, NOT a unitary — real
 *                 physics, irreversible on purpose.
 *   CORRECT    C  OQCA HAS NO CODE SPACE. Quantum error correction needs a
 *                 logical subspace, stabilizers and a syndrome; none exists
 *                 here. Renormalising floating-point drift is arithmetic
 *                 hygiene and is exposed as `renormalize`, deliberately under
 *                 its own honest name rather than as CORRECT.
 **   EVIDENCE   A  ADDED. diag(sqrt(L_k)) + renormalise: a filtering channel
 *                 whose effect on probabilities is exactly Bayes. The brief's
 *                 eight have no way to fold an observation in, so a loop built
 *                 from them alone can never learn from the world.
 *
 * That leaves five A, two B, two C. A future entry moving something out of C
 * must move it with a test, not with a rename.
 */
import { type Amplitude, cNorm2 } from "./math/complex";
import { type Unitary2, mixing, relativePhase, rotation } from "./math/unitary";
import type { QuantumOperator } from "./operators";
import { type CognitiveState, type TransitionOptions } from "./formalState";

export const COGNITIVE_OPERATIONS = [
  "SUPERPOSE",
  "ENTANGLE",
  "PHASE",
  "INTERFERE",
  "CONTROL",
  "MEASURE",
  "RESET",
  "CORRECT",
  // NINTH, AND NOT IN THE BRIEF'S LIST. See EVIDENCE in the catalogue below:
  // the eight above contain no way to fold an OBSERVATION in, so a loop built
  // from them alone could rotate, mix and read a state forever and never learn
  // anything from the world. That is a gap in the specification rather than a
  // preference, and it is filled under its own name instead of by widening one
  // of the eight.
  "EVIDENCE",
] as const;

export type CognitiveOperation = (typeof COGNITIVE_OPERATIONS)[number];

/** A: real mathematics. B: a semantic analogue. C: declared, not represented. */
export type OperationCategory = "A" | "B" | "C";

export type OperationSpec = {
  readonly operation: CognitiveOperation;
  readonly category: OperationCategory;
  /** What the transformation IS, in the physical layer's vocabulary. */
  readonly mathematics: string;
  /** For B and C: exactly what is borrowed or missing. Never hand-waved. */
  readonly caveat: string;
};

export const OPERATION_CATALOGUE: readonly OperationSpec[] = [
  {
    operation: "SUPERPOSE",
    category: "B",
    mathematics: "isometry C^n -> C^{n+1}, then a two-level rotation into the new coordinate",
    caveat:
      "norm-preserving but dimension-changing, so not a unitary on the original space; an isometry is the correct word",
  },
  {
    operation: "ENTANGLE",
    category: "C",
    mathematics: "none",
    caveat:
      "entanglement is non-factorability across a tensor product; OQCA's basis is flat and unfactored, so the word has no referent here. Needs a factored register (backends/tensor)",
  },
  {
    operation: "EVIDENCE",
    category: "A",
    mathematics:
      "diagonal filtering (Kraus) operator diag(sqrt(L_k)) followed by renormalisation; the probabilities then update by Bayes exactly",
    caveat:
      "a CHANNEL, not a unitary — irreversible, as any measurement-like update must be. ADDED to the brief's list of eight, which had no way to fold an observation in",
  },
  {
    operation: "PHASE",
    category: "A",
    mathematics: "diagonal unitary diag(e^{i.theta_k})",
    caveat: "",
  },
  {
    operation: "INTERFERE",
    category: "A",
    mathematics: "two-level unitary U(theta, phi) on a pair of basis indices",
    caveat: "",
  },
  {
    operation: "CONTROL",
    category: "B",
    mathematics: "classical conditional: apply a pair unitary only if P(control) >= threshold",
    caveat:
      "conditioning on |a_k|^2 is NONLINEAR in the state, so this is not a controlled-U; a real one is linear and needs a control register",
  },
  {
    operation: "MEASURE",
    category: "A",
    mathematics: "Born-rule readout; projective collapse is project + renormalize",
    caveat: "",
  },
  {
    operation: "RESET",
    category: "A",
    mathematics: "state preparation (a CPTP channel)",
    caveat: "irreversible by definition — a channel, not a gate",
  },
  {
    operation: "CORRECT",
    category: "C",
    mathematics: "none",
    caveat:
      "no code space, no stabilizers, no syndrome extraction. Floating-point renormalisation is exposed as `renormalize` and is NOT error correction",
  },
];

export const CATEGORY_OF: Readonly<Record<CognitiveOperation, OperationCategory>> =
  Object.fromEntries(OPERATION_CATALOGUE.map((s) => [s.operation, s.category])) as Record<
    CognitiveOperation,
    OperationCategory
  >;

export class NotPhysicallyRepresented extends Error {
  constructor(
    readonly operation: CognitiveOperation,
    readonly missing: string,
  ) {
    super(`OQCA: ${operation} is category C — not physically represented. Missing: ${missing}`);
    this.name = "NotPhysicallyRepresented";
  }
}

function spec(op: CognitiveOperation): OperationSpec {
  const s = OPERATION_CATALOGUE.find((x) => x.operation === op);
  if (!s) throw new Error(`OQCA: no catalogue entry for ${op}`);
  return s;
}

/** Refuse a category-C operation by NAME, with what is missing. */
export function refuseIfUnrepresented(op: CognitiveOperation): void {
  const s = spec(op);
  if (s.category === "C") throw new NotPhysicallyRepresented(op, s.caveat);
}

type GateOpts = Omit<TransitionOptions, "operation">;

/** PHASE — category A. Rotate one hypothesis in the complex plane. */
export function phase(
  state: CognitiveState,
  label: string,
  theta: number,
  opts: GateOpts = {},
): CognitiveState {
  const i = state.indexOf(label);
  const phases = state.basis.map((_, k) => (k === i ? theta : 0));
  return state.transition(
    { kind: "diagonal", phases },
    { ...opts, operation: "PHASE", parameters: { label, theta, ...(opts.parameters ?? {}) } },
  );
}

/**
 * INTERFERE — category A. A two-level unitary on (a, b): `theta` is the mixing
 * ANGLE and `phi` the relative phase of the off-diagonal. phi = 0 is a real
 * rotation. Nothing is normalized afterwards, because nothing needs to be.
 */
export function interfere(
  state: CognitiveState,
  a: string,
  b: string,
  theta: number,
  phi = 0,
  opts: GateOpts = {},
): CognitiveState {
  const i = state.indexOf(a);
  const j = state.indexOf(b);
  if (i === j) throw new Error("OQCA: a hypothesis cannot interfere with itself");
  const u: Unitary2 = phi === 0 ? rotation(theta) : mixing(theta, phi);
  return state.transition(
    { kind: "pair", i, j, u },
    {
      ...opts,
      operation: "INTERFERE",
      parameters: { a, b, theta, phi, ...(opts.parameters ?? {}) },
    },
  );
}

/**
 * The phase configuration that makes `favoured` win a subsequent
 * `interfere(a, b, +theta)`. Exported because a BENCHMARK must not guess this:
 * the mapping from "the fact says X is reliable" to "which amplitude carries a
 * half-turn" is a property of the OPERATOR, and a fixture that hard-codes it
 * inverts silently the day the operator's orientation changes. That is not
 * hypothetical — the v1.1 suite's first run scored 0% where chance is 50%
 * because exactly this was assumed rather than asked.
 *
 * MEASURED, with equal in-phase amplitudes and theta = atan(0.9):
 *
 *     no phase          -> b wins (0.0018 / 0.6648 / 0.3333)
 *     half-turn on b    -> a wins (0.6648 / 0.0018 / 0.3333)
 *     half-turn on a    -> a wins (0.6648 / 0.0018 / 0.3333)   <- IDENTICAL
 *
 * (the third figure is the UNTOUCHED hypothesis, holding 1/3 exactly through
 * all three — the unitary operator not draining what it was not applied to)
 *
 * The last two lines are the reason this returns a half-turn on ONE member and
 * not on "the other one": only RELATIVE phase is observable, so a half-turn on
 * either member of the pair is the same state up to a global phase and has the
 * same effect. `orientation.test.ts` pins all three rows against the real gate.
 */
export function phasesFavouring(
  size: number,
  pair: readonly [number, number],
  favouredIndex: number,
): number[] {
  const [a, b] = pair;
  if (a === b) throw new Error("OQCA: a pair needs two distinct indices");
  if (favouredIndex !== a && favouredIndex !== b) {
    throw new Error("OQCA: the favoured hypothesis must be a member of the pair");
  }
  // A positive angle already transfers toward the SECOND named, so favouring it
  // needs nothing; favouring the first needs the half-turn that reverses it.
  const flip = favouredIndex === a;
  return Array.from({ length: size }, (_, i) => (flip && i === b ? Math.PI : 0));
}

/**
 * SUPERPOSE — category B. Admit a NEW hypothesis holding `share` of the mass.
 *
 * `share` is what the newcomer holds AFTERWARDS, not a raw amplitude: the
 * brief's version appends an amplitude and renormalizes, so the same argument
 * has a different effect on the third call than the first. Incumbents keep
 * their relative proportions.
 */
export function superpose(
  state: CognitiveState,
  label: string,
  share: number,
  opts: GateOpts = {},
): CognitiveState {
  if (state.basis.includes(label)) throw new Error(`OQCA: ${label} is already a hypothesis`);
  if (!(share > 0 && share < 1)) throw new Error("OQCA: share must be strictly between 0 and 1");
  const keep = Math.sqrt(1 - share);
  const grown: Amplitude[] = [
    ...state.amplitudes.map((a) => ({ re: a.re * keep, im: a.im * keep })),
    { re: Math.sqrt(share), im: 0 },
  ];
  return state.transition(
    { kind: "prepare", amplitudes: grown },
    {
      ...opts,
      operation: "SUPERPOSE",
      basis: [...state.basis, label],
      activeHypotheses: [...state.activeHypotheses, label],
      parameters: { label, share, ...(opts.parameters ?? {}) },
    },
  );
}

/**
 * CONTROL — category B. Apply a pair rotation only when the control hypothesis
 * clears `threshold`. The gate reports whether it FIRED, because a conditional
 * that silently did nothing is indistinguishable from one that ran.
 */
export function control(
  state: CognitiveState,
  controlLabel: string,
  a: string,
  b: string,
  theta: number,
  threshold: number,
  opts: GateOpts = {},
): { readonly state: CognitiveState; readonly fired: boolean } {
  const p = state.probabilities()[state.indexOf(controlLabel)];
  const fired = p >= threshold;
  if (!fired) return { state, fired };
  const i = state.indexOf(a);
  const j = state.indexOf(b);
  return {
    state: state.transition(
      { kind: "pair", i, j, u: rotation(theta) },
      {
        ...opts,
        operation: "CONTROL",
        parameters: {
          controlLabel,
          a,
          b,
          theta,
          threshold,
          controlP: p,
          ...(opts.parameters ?? {}),
        },
      },
    ),
    fired: true,
  };
}

/**
 * MEASURE (collapsing) — category A. Project onto one hypothesis and
 * renormalize. Read-only measurement lives in `measure.ts`; this is the
 * destructive one, and it is separate because most of the loop wants to look
 * without collapsing.
 */
export function collapseOnto(
  state: CognitiveState,
  label: string,
  opts: GateOpts = {},
): CognitiveState {
  const i = state.indexOf(label);
  return state.transition(
    { kind: "project", keep: [i] },
    { ...opts, operation: "MEASURE", parameters: { label, ...(opts.parameters ?? {}) } },
  );
}

/** MEASURE (partial) — category A. Project onto a SUBSET and renormalize. */
export function projectOnto(
  state: CognitiveState,
  labels: readonly string[],
  opts: GateOpts = {},
): CognitiveState {
  const keep = labels.map((l) => state.indexOf(l));
  return state.transition(
    { kind: "project", keep },
    {
      ...opts,
      operation: "MEASURE",
      activeHypotheses: [...labels],
      parameters: { labels: [...labels], ...(opts.parameters ?? {}) },
    },
  );
}

/** RESET — category A. Prepare a known state; a channel, not a gate. */
export function reset(
  state: CognitiveState,
  weights: readonly number[],
  opts: GateOpts = {},
): CognitiveState {
  if (weights.length !== state.basis.length) throw new Error("OQCA: one weight per hypothesis");
  for (const w of weights) {
    if (!Number.isFinite(w) || w < 0) throw new Error("OQCA: weights must be finite and >= 0");
  }
  return state.transition(
    { kind: "prepare", amplitudes: weights.map((w) => ({ re: Math.sqrt(w), im: 0 })) },
    {
      ...opts,
      operation: "RESET",
      parameters: { weights: [...weights], ...(opts.parameters ?? {}) },
    },
  );
}

/** ENTANGLE — category C. Refuses, naming what is missing. */
export function entangle(): never {
  refuseIfUnrepresented("ENTANGLE");
  throw new Error("unreachable");
}

/** CORRECT — category C. Refuses, naming what is missing. */
export function correct(): never {
  refuseIfUnrepresented("CORRECT");
  throw new Error("unreachable");
}

/**
 * Arithmetic hygiene, under its honest name. Rescales away accumulated
 * floating-point drift. This is NOT error correction and is deliberately not
 * called CORRECT — `cognitive.test.ts` asserts the two never merge.
 */
export function renormalize(state: CognitiveState, opts: GateOpts = {}): CognitiveState {
  let sum = 0;
  for (const a of state.amplitudes) sum += cNorm2(a);
  return state.transition(
    { kind: "prepare", amplitudes: state.amplitudes.map((a) => ({ ...a })) },
    {
      ...opts,
      operation: "RESET",
      parameters: { renormalizeFrom: Math.sqrt(sum), ...(opts.parameters ?? {}) },
    },
  );
}

/**
 * EVIDENCE — category A, and the operation the brief's eight left out.
 *
 * Multiply each amplitude by sqrt(likelihood) and renormalise, so the
 * PROBABILITIES update by Bayes' rule exactly. That equality is the bridge the
 * whole benchmark rests on: with only EVIDENCE, OQCA IS the Bayesian control,
 * so any difference the suite finds comes from PHASE and INTERFERE and from
 * nowhere else.
 */
export function evidence(
  state: CognitiveState,
  likelihoods: readonly number[],
  opts: GateOpts = {},
): CognitiveState {
  if (likelihoods.length !== state.basis.length) {
    throw new Error("OQCA: one likelihood per hypothesis");
  }
  for (const l of likelihoods) {
    if (!Number.isFinite(l) || l < 0) throw new Error("OQCA: likelihoods must be finite and >= 0");
  }
  const scaled: Amplitude[] = state.amplitudes.map((a, i) => {
    const k = Math.sqrt(likelihoods[i]);
    return { re: a.re * k, im: a.im * k };
  });
  return state.transition(
    { kind: "prepare", amplitudes: scaled },
    {
      ...opts,
      operation: "EVIDENCE",
      parameters: { likelihoods: [...likelihoods], ...(opts.parameters ?? {}) },
    },
  );
}

/** The operator a gate WOULD apply, without applying it. Used by the backends. */
export function operatorFor(
  op: "PHASE" | "INTERFERE",
  params: {
    readonly i: number;
    readonly j?: number;
    readonly theta: number;
    readonly phi?: number;
    readonly size: number;
  },
): QuantumOperator {
  if (op === "PHASE") {
    const phases = Array.from({ length: params.size }, (_, k) =>
      k === params.i ? params.theta : 0,
    );
    return { kind: "diagonal", phases };
  }
  if (params.j === undefined) throw new Error("OQCA: INTERFERE needs two indices");
  const u = params.phi ? mixing(params.theta, params.phi) : rotation(params.theta);
  return { kind: "pair", i: params.i, j: params.j, u };
}

export { relativePhase };
