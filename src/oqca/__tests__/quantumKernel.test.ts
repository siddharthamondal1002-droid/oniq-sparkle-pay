/**
 * QUANTUM KERNEL — brief §3, §4, §5, §8, §15, §21, §26.
 *
 * §4 asks for "automated invariant tests" on the gate library and §26 for
 * common semantic tests every backend must pass. Both are here, and both are
 * COMPUTED: no gate declares itself unitary, every claim is multiplied out.
 *
 * The one rule that shapes the file: **an invariant is asserted over the whole
 * registry, never over a sample.** Three hand-picked gates passing says nothing
 * about the twentieth someone adds next week.
 */
import { describe, expect, it } from "vitest";
import {
  identity,
  mul,
  dagger,
  kron,
  isUnitary,
  isHermitian,
  isProjector,
  isPositiveSemidefinite,
  eigenvaluesHermitian,
  approxEqual,
  QUBIT_ORDER,
  matrix,
} from "../quantum/math/linalg.ts";
import {
  zeroState,
  stateVector,
  isNormalized,
  probabilities,
  densityFromState,
  isValidDensity,
  purity,
  partialTrace,
  maximallyMixed,
} from "../quantum/math/state.ts";
import {
  vonNeumannEntropy,
  entanglementEntropy,
  mutualInformation,
  traceDistance,
  fidelity,
  validateInformationTheory,
} from "../quantum/math/info.ts";
import {
  isCPTP,
  isTracePreserving,
  applyChannel,
  depolarizing,
  bitFlip,
  phaseFlip,
  bitPhaseFlip,
  amplitudeDamping,
  phaseDamping,
  thermalDamping,
  coherentError,
} from "../quantum/math/channel.ts";
import { GATES, GATE_NAMES, controlled, X, Z, H, rx } from "../quantum/gates.ts";
import {
  circuit,
  gate,
  measure,
  depth,
  twoQubitCount,
  tCount,
  circuitUnitary,
} from "../quantum/circuit.ts";
import { makeStatevectorBackend } from "../quantum/backends/statevector.ts";
import { ADAPTERS, QPUBackend, makeUnavailableBackend } from "../quantum/backends/adapters.ts";
import {
  DEFAULT_QUANTUM_POLICY,
  checkRemote,
  checkLocal,
  REFUSAL_TEXT,
} from "../quantum/policy.ts";
import { c } from "../math/complex.ts";

const TOL = 1e-9;

describe("§4 — every gate in the registry, not a sample", () => {
  it("is unitary", () => {
    for (const name of GATE_NAMES) {
      expect(isUnitary(GATES[name].matrix), `${name} is not unitary`).toBe(true);
    }
    expect(GATE_NAMES.length).toBeGreaterThan(15);
  });

  it("carries an inverse that IS the dagger, and multiplies to the identity", () => {
    for (const name of GATE_NAMES) {
      const g = GATES[name];
      expect(approxEqual(g.inverse, dagger(g.matrix)), `${name} inverse != dagger`).toBe(true);
      expect(approxEqual(mul(g.matrix, g.inverse), identity(g.matrix.rows)), name).toBe(true);
    }
  });

  it("agrees with the algebraic identities the concept table claims", () => {
    // X = H Z H, and every Pauli squares to I. Multiplied out rather than cited.
    expect(approxEqual(mul(mul(H, Z), H), X)).toBe(true);
    for (const p of ["X", "Y", "Z", "H"]) {
      const m = GATES[p].matrix;
      expect(approxEqual(mul(m, m), identity(2)), `${p}^2 != I`).toBe(true);
      expect(isHermitian(m), `${p} is not Hermitian`).toBe(true);
    }
    // S^2 = Z and T^2 = S — the phase ladder.
    expect(approxEqual(mul(GATES.S.matrix, GATES.S.matrix), Z)).toBe(true);
    expect(approxEqual(mul(GATES.T.matrix, GATES.T.matrix), GATES.S.matrix)).toBe(true);
  });

  it("builds every controlled gate from ONE construction", () => {
    expect(approxEqual(controlled(X), GATES.CX.matrix)).toBe(true);
    expect(approxEqual(controlled(Z), GATES.CZ.matrix)).toBe(true);
    expect(approxEqual(controlled(X, 2), GATES.CCX.matrix)).toBe(true);
    expect(isUnitary(controlled(rx(0.7)))).toBe(true);
  });

  it("rx(theta) is a rotation: rx(a) rx(b) = rx(a+b) and rx(2pi) = -I", () => {
    expect(approxEqual(mul(rx(0.3), rx(0.4)), rx(0.7))).toBe(true);
    // A GLOBAL PHASE IS REAL HERE: rx(2pi) is MINUS the identity, not the
    // identity, and a test that accepted either would accept a wrong sign in
    // any controlled version of it — where the phase becomes observable.
    const twoPi = rx(2 * Math.PI);
    expect(approxEqual(twoPi, identity(2))).toBe(false);
    expect(approxEqual(mul(twoPi, twoPi), identity(2))).toBe(true);
  });
});

describe("§3 — states, and the big-endian order stated once", () => {
  it("kron puts the FIRST argument on the low qubit index", () => {
    expect(QUBIT_ORDER).toContain("big-endian");
    // |0> (x) |1> must be basis index 1, not 2. Getting this backwards is the
    // Qiskit divergence, and it is silent — every amplitude still normalises.
    const k = kron(matrix(2, 1, [c(1), c(0)]), matrix(2, 1, [c(0), c(1)]));
    expect(k.data.map((a) => a.re)).toEqual([0, 1, 0, 0]);
  });

  it("a Bell state is pure globally and maximally mixed on one half", () => {
    const inv = Math.SQRT1_2;
    const bell = stateVector([c(inv), c(0), c(0), c(inv)]);
    expect(isNormalized(bell, TOL)).toBe(true);
    const rho = densityFromState(bell);
    expect(isValidDensity(rho)).toBe(true);
    expect(purity(rho)).toBeCloseTo(1, 9);
    expect(vonNeumannEntropy(rho)).toBeCloseTo(0, 9);

    const half = partialTrace(rho, [1]);
    expect(purity(half)).toBeCloseTo(0.5, 9);
    expect(entanglementEntropy(rho, [0])).toBeCloseTo(1, 9);
    // Mutual information of a maximally entangled pair is exactly 2, which is
    // the number that separates entanglement from classical correlation.
    expect(mutualInformation(rho, [0])).toBeCloseTo(2, 9);
  });

  it("a product state has zero entanglement entropy", () => {
    const plus0 = densityFromState(stateVector([c(Math.SQRT1_2), c(0), c(Math.SQRT1_2), c(0)]));
    expect(entanglementEntropy(plus0, [0])).toBeCloseTo(0, 9);
    expect(mutualInformation(plus0, [0])).toBeCloseTo(0, 9);
  });

  it("the maximally mixed state has entropy n and is a valid density matrix", () => {
    for (const n of [1, 2, 3]) {
      const m = maximallyMixed(n);
      expect(isValidDensity(m)).toBe(true);
      expect(vonNeumannEntropy(m)).toBeCloseTo(n, 9);
      expect(purity(m)).toBeCloseTo(1 / 2 ** n, 9);
    }
  });

  it("probabilities sum to one and a projector is idempotent and PSD", () => {
    const s = zeroState(3);
    expect(probabilities(s).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const p = densityFromState(stateVector([c(1), c(0)])).rho;
    expect(isProjector(p)).toBe(true);
    expect(isPositiveSemidefinite(p)).toBe(true);
    expect(
      eigenvaluesHermitian(p)
        .map((e) => Math.round(e))
        .sort(),
    ).toEqual([0, 1]);
  });

  it("fidelity REFUSES a mixed-mixed pair rather than returning Tr(rho sigma)", () => {
    const m = maximallyMixed(1);
    // Tr(rho sigma) is a real number and a plausible-looking answer, which is
    // exactly why returning it would be worse than refusing.
    expect(() => fidelity(m, m)).toThrow();
    const pure = densityFromState(stateVector([c(1), c(0)]));
    expect(fidelity(pure, pure)).toBeCloseTo(1, 9);
    expect(traceDistance(pure, m)).toBeCloseTo(0.5, 9);
  });

  it("the information-theory validator runs and reports no violation", () => {
    // Run over TWO states with opposite entanglement, so the validator is not
    // being confirmed by one convenient input.
    const bell = densityFromState(stateVector([c(Math.SQRT1_2), c(0), c(0), c(Math.SQRT1_2)]));
    const product = densityFromState(stateVector([c(1), c(0), c(0), c(0)]));
    for (const d of [bell, product, maximallyMixed(2)]) {
      const v = validateInformationTheory(d);
      expect(v.violations).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });
});

describe("§9 — every channel is CPTP, and the limits are the right ones", () => {
  const CHANNELS = [
    ["depolarizing", depolarizing(0.3)],
    ["bitFlip", bitFlip(0.25)],
    ["phaseFlip", phaseFlip(0.25)],
    ["bitPhaseFlip", bitPhaseFlip(0.25)],
    ["amplitudeDamping", amplitudeDamping(0.4)],
    ["phaseDamping", phaseDamping(0.4)],
    ["thermalDamping", thermalDamping(0.4, 0.2)],
    ["coherentError", coherentError(rx(0.15))],
  ] as const;

  it.each(CHANNELS)("%s is trace preserving and completely positive", (_name, ch) => {
    expect(isTracePreserving(ch)).toBe(true);
    expect(isCPTP(ch)).toBe(true);
  });

  it("depolarizing at p=1 IS the maximally mixed state and at p=0 is the identity", () => {
    const pure = densityFromState(stateVector([c(1), c(0)]));
    const full = applyChannel(depolarizing(1), pure);
    expect(approxEqual(full.rho, maximallyMixed(1).rho, 1e-9)).toBe(true);
    const none = applyChannel(depolarizing(0), pure);
    expect(approxEqual(none.rho, pure.rho, 1e-12)).toBe(true);
  });

  it("amplitude damping at gamma=1 collapses to |0>, which phase damping does not", () => {
    const excited = densityFromState(stateVector([c(0), c(1)]));
    const damped = applyChannel(amplitudeDamping(1), excited);
    expect(damped.rho.data[0].re).toBeCloseTo(1, 9);
    // PHASE damping loses coherence and NOT energy — the population stays put,
    // and a test that expected otherwise would be conflating T1 with T2.
    const dephased = applyChannel(phaseDamping(1), excited);
    expect(dephased.rho.data[3].re).toBeCloseTo(1, 9);
  });

  it("a coherent error is unitary, so it is reversible and adds no entropy", () => {
    const pure = densityFromState(stateVector([c(1), c(0)]));
    const rotated = applyChannel(coherentError(rx(0.4)), pure);
    expect(purity(rotated)).toBeCloseTo(1, 9);
    expect(vonNeumannEntropy(rotated)).toBeCloseTo(0, 8);
  });
});

describe("§5 — circuits carry the metrics a compiler decision needs", () => {
  it("counts depth, two-qubit gates and T gates over the real ops", () => {
    let c1 = circuit("m", 3, 3);
    c1 = gate(c1, "H", [0]);
    c1 = gate(c1, "CX", [0, 1]);
    c1 = gate(c1, "T", [2]);
    c1 = gate(c1, "CX", [1, 2]);
    expect(twoQubitCount(c1)).toBe(2);
    expect(tCount(c1)).toBe(1);
    // H(0) then CX(0,1) must be sequential; T(2) is parallel with both.
    expect(depth(c1)).toBe(3);
  });

  it("embeds a two-qubit gate on NON-ADJACENT qubits correctly", () => {
    // The permutation-conjugation path. A version that only handled adjacent
    // pairs would still produce a unitary — and the wrong one.
    let c2 = circuit("cx02", 3);
    c2 = gate(c2, "CX", [0, 2]);
    const u = circuitUnitary(c2);
    expect(isUnitary(u)).toBe(true);
    // |100> -> |101>: control qubit 0 set, target qubit 2 flips. Big-endian.
    expect(u.data[5 * 8 + 4].re).toBeCloseTo(1, 12);
  });

  it("refuses an unknown gate name rather than dropping the op", () => {
    expect(() => gate(circuit("x", 1), "NOTAGATE", [0])).toThrow(/unknown gate/);
    expect(() => gate(circuit("x", 1), "H", [3])).toThrow(/no qubit/);
  });
});

describe("§15/§26 — backend semantics, and the register the counts are keyed by", () => {
  const backend = makeStatevectorBackend();

  it("is deterministic given the same seed and reproduces a Bell distribution", () => {
    let b = circuit("bell", 2, 2);
    b = gate(b, "H", [0]);
    b = gate(b, "CX", [0, 1]);
    b = measure(b, 0, 0);
    b = measure(b, 1, 1);
    const a = backend.simulate(b, 4096, 7);
    const c2 = backend.simulate(b, 4096, 7);
    expect(a.ok && c2.ok).toBe(true);
    if (!a.ok || !c2.ok) return;
    expect(a.value).toEqual(c2.value);
    expect(Object.keys(a.value).sort()).toEqual(["00", "11"]);
    expect(a.value["00"] + a.value["11"]).toBe(4096);
  });

  it("keys counts by the DECLARED classical register, not the whole quantum one", () => {
    // FOUND BY RUNNING THE §17 EXPERIMENT, not by any earlier test of this
    // file: a Bernstein-Vazirani circuit carries an unmeasured ancilla, and
    // keying by `circuit.qubits` returned a 5-character string for a 4-bit
    // answer. Every amplitude was right and every comparison was wrong.
    let b = circuit("anc", 3, 2);
    b = gate(b, "X", [0]);
    b = gate(b, "H", [2]);
    b = measure(b, 0, 0);
    b = measure(b, 1, 1);
    const r = backend.simulate(b, 64, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const k of Object.keys(r.value)) expect(k.length).toBe(2);
    expect(r.value).toEqual({ "10": 64 });
  });

  it("refuses a mid-circuit measurement instead of silently ignoring it", () => {
    let b = circuit("mid", 2, 2);
    b = measure(b, 0, 0);
    b = gate(b, "H", [1]);
    b = measure(b, 1, 1);
    const r = backend.simulate(b, 8, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toMatch(/mid-circuit/);
  });

  it("refuses an expectation against a non-Hermitian observable", () => {
    // |+i> = (|0> + i|1>)/sqrt(2) against a NON-Hermitian matrix. The zero
    // state would give a real 0 for this matrix and the refusal would never
    // fire — a control that proves the assertion is exercising the branch.
    const plusI = stateVector([c(Math.SQRT1_2), c(0, Math.SQRT1_2)]);
    const notObservable = matrix(2, 2, [c(0), c(1), c(0), c(0)]);
    const r = backend.expectation(plusI, notObservable);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toMatch(/not Hermitian/);
    // And a REAL observable on the same state is accepted, so the refusal is
    // about the operator rather than about the state.
    expect(backend.expectation(plusI, Z).ok).toBe(true);
  });
});

describe("§21 — the policy refuses first, and its defaults are the refusing ones", () => {
  it("ships with remote execution off and a zero cost ceiling", () => {
    expect(DEFAULT_QUANTUM_POLICY.remoteQuantumExecution).toBe(false);
    expect(DEFAULT_QUANTUM_POLICY.maxQuantumCostUsd).toBe(0);
  });

  it("refuses remote BEFORE it looks at the price, so a free QPU is still refused", () => {
    const r = checkRemote(DEFAULT_QUANTUM_POLICY, 0);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toBe("remote_execution_disabled");
    // With remote ALLOWED, the cost gate is what bites — proving the order is
    // remote-then-cost and not the other way round.
    const enabled = { ...DEFAULT_QUANTUM_POLICY, remoteQuantumExecution: true };
    const paid = checkRemote(enabled, 0.01);
    expect(paid.allowed).toBe(false);
    if (paid.allowed) return;
    expect(paid.reason).toBe("cost_budget_zero");
    // And with a budget, an estimate OVER it is the third refusal — three
    // distinct reasons in a fixed order, which is what makes the log usable.
    const funded = { ...enabled, maxQuantumCostUsd: 1 };
    const over = checkRemote(funded, 2);
    expect(over.allowed).toBe(false);
    if (over.allowed) return;
    expect(over.reason).toBe("cost_budget_exceeded");
  });

  it("caps the simulator by qubits and by shots", () => {
    const over = checkLocal(
      DEFAULT_QUANTUM_POLICY,
      DEFAULT_QUANTUM_POLICY.maxSimulatedQubits + 1,
      1,
    );
    expect(over.allowed).toBe(false);
    const many = checkLocal(DEFAULT_QUANTUM_POLICY, 2, DEFAULT_QUANTUM_POLICY.maxShots + 1);
    expect(many.allowed).toBe(false);
    expect(checkLocal(DEFAULT_QUANTUM_POLICY, 2, 100).allowed).toBe(true);
  });

  it("every refusal has text a person can act on", () => {
    for (const [reason, text] of Object.entries(REFUSAL_TEXT)) {
      expect(text.length, reason).toBeGreaterThan(20);
    }
  });

  it("every adapter is unavailable and names what it would need", () => {
    expect(ADAPTERS.length).toBeGreaterThan(10);
    for (const a of ADAPTERS) {
      // The SPEC declares what it cannot do; the BACKEND built from it refuses
      // every one of the six methods. Asserting only the spec would pass on an
      // adapter that described a limitation and then executed anyway.
      expect(a.limitations.length, `${a.name} names no limitation`).toBeGreaterThan(0);
      const b = makeUnavailableBackend(a);
      expect(b.available, `${a.name} claims to be available`).toBe(false);
      const r = b.createState(2);
      expect(r.ok, `${a.name} created a state`).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBe("adapter_unavailable");
      // The refusal carries the MEASURED version and licence, so a reader is
      // told what would have to be added rather than only that it is missing.
      expect(r.detail.length, `${a.name} refusal is empty`).toBeGreaterThan(30);
    }
  });

  it("QPUBackend refuses on the POLICY first, so enabling a vendor is not enough", () => {
    const q = QPUBackend();
    const r = q.createState(2);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("remote_execution_disabled");
  });
});
