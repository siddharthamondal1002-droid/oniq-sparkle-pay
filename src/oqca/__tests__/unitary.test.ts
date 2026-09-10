/**
 * OQCA v1.1 — the mathematics. Brief section 18, "Mathematics".
 *
 * Every claim this subsystem makes about physics rests on one property: the
 * operators are unitary. So these are swept rather than sampled — a single
 * theta passing proves nothing about the family — and the reversibility test
 * uses the DAGGER rather than a second call with a negated angle, because the
 * dagger is what a circuit compiler would actually emit.
 */
import { describe, expect, it } from "vitest";
import {
  NonUnitaryOperatorError,
  ROTATION_TRANSFERS_TOWARD,
  type Unitary2,
  angleFromStrength,
  applyPair,
  assertUnitary2,
  dagger,
  identity2,
  inverse,
  isUnitary2,
  matMul2,
  mixing,
  relativePhase,
  rotation,
  unitarityResidual,
} from "@/oqca/math/unitary";
import { type Amplitude, c, cNorm2 } from "@/oqca/math/complex";
import { applyOperator, inverseOperator, vectorNorm } from "@/oqca/operators";

const ANGLES = [
  -3.1, -2.0, -0.7328151017865066, -0.1, 0, 0.1, 0.4636, 0.7328151017865066, 1.5, 2.9, 3.14159,
];
const PHASES = [0, 0.3, 1.2345, Math.PI / 2, Math.PI, -2.2];

describe("unitarity, swept rather than sampled", () => {
  it("rotation(theta) is unitary for every angle in the sweep", () => {
    for (const t of ANGLES) {
      expect(unitarityResidual(rotation(t)), `theta=${t}`).toBeLessThan(1e-15);
      expect(isUnitary2(rotation(t))).toBe(true);
    }
  });

  it("mixing(theta, phi) is unitary across the whole grid", () => {
    for (const t of ANGLES) {
      for (const p of PHASES) {
        expect(unitarityResidual(mixing(t, p)), `theta=${t} phi=${p}`).toBeLessThan(1e-15);
      }
    }
  });

  it("phi = 0 recovers the real rotation exactly", () => {
    for (const t of ANGLES) {
      const r = rotation(t);
      const m = mixing(t, 0);
      for (let i = 0; i < 4; i++) {
        expect(m[i].re).toBeCloseTo(r[i].re, 14);
        expect(m[i].im).toBeCloseTo(r[i].im, 14);
      }
    }
  });

  it("relativePhase and identity are unitary", () => {
    expect(unitarityResidual(identity2())).toBe(0);
    for (const p of PHASES) expect(unitarityResidual(relativePhase(p))).toBeLessThan(1e-15);
  });

  it("assertUnitary2 REFUSES the specification's own operator", () => {
    // M = [[1, s], [-s, 1]] with s = 0.9. This is the matrix v1.0 rescued with a
    // normalising factor and v1.1 replaced outright; it must not pass.
    const spec: Unitary2 = [c(1), c(0.9), c(-0.9), c(1)];
    expect(isUnitary2(spec)).toBe(false);
    expect(() => assertUnitary2(spec)).toThrow(NonUnitaryOperatorError);
    // ...and the residual is exactly s^2, which is what "inflates the pair's
    // norm by sqrt(1 + s^2)" means as a number.
    expect(unitarityResidual(spec)).toBeCloseTo(0.81, 12);
  });

  it("a matrix that is merely close is still refused at the stated tolerance", () => {
    const nearly: Unitary2 = [c(1 + 1e-6), c(0), c(0), c(1)];
    expect(isUnitary2(nearly)).toBe(false);
    expect(isUnitary2(nearly, 1e-3)).toBe(true);
  });
});

describe("reversibility", () => {
  it("U-dagger U is the identity for every angle", () => {
    for (const t of ANGLES) {
      for (const p of PHASES) {
        const prod = matMul2(dagger(mixing(t, p)), mixing(t, p));
        expect(prod[0].re).toBeCloseTo(1, 14);
        expect(prod[3].re).toBeCloseTo(1, 14);
        expect(prod[1].re).toBeCloseTo(0, 14);
        expect(prod[1].im).toBeCloseTo(0, 14);
      }
    }
  });

  it("applying the inverse restores the pair exactly", () => {
    const x = c(0.6, -0.2);
    const y = c(-0.1, 0.75);
    for (const t of ANGLES) {
      for (const p of PHASES) {
        const u = mixing(t, p);
        const [a, b] = applyPair(u, x, y);
        const [x2, y2] = applyPair(inverse(u), a, b);
        expect(x2.re).toBeCloseTo(x.re, 13);
        expect(x2.im).toBeCloseTo(x.im, 13);
        expect(y2.re).toBeCloseTo(y.re, 13);
        expect(y2.im).toBeCloseTo(y.im, 13);
      }
    }
  });

  it("the CHANNELS have no inverse, and say so rather than approximating one", () => {
    expect(inverseOperator({ kind: "pair", i: 0, j: 1, u: rotation(0.5) })).not.toBeNull();
    expect(inverseOperator({ kind: "diagonal", phases: [0.2, 0.3] })).not.toBeNull();
    expect(inverseOperator({ kind: "project", keep: [0] })).toBeNull();
    expect(inverseOperator({ kind: "prepare", amplitudes: [c(1), c(0)] })).toBeNull();
  });
});

describe("norm and probability conservation", () => {
  const start: Amplitude[] = [c(0.5, 0.1), c(-0.3, 0.4), c(0.2), c(0.1, -0.6)];

  it("repeated application never inflates or drains the state", () => {
    let amps = start.map((a) => ({ ...a }));
    const n0 = vectorNorm(amps);
    for (let k = 0; k < 200; k++) {
      amps = applyOperator(amps, { kind: "pair", i: 0, j: 1, u: mixing(0.37, 1.1) });
      amps = applyOperator(amps, { kind: "diagonal", phases: [0.1, -0.2, 0.3, 0] });
    }
    expect(vectorNorm(amps)).toBeCloseTo(n0, 12);
  });

  it("HYPOTHESES OUTSIDE THE PAIR DO NOT MOVE — the v1.0 drain, as a property", () => {
    let amps = start.map((a) => ({ ...a }));
    const before = amps.map(cNorm2);
    for (let k = 0; k < 8; k++) {
      amps = applyOperator(amps, { kind: "pair", i: 0, j: 1, u: rotation(0.4636476090008061) });
    }
    const after = amps.map(cNorm2);
    // Indices 2 and 3 were never touched. Under the specification's operator
    // plus a global renormalize they would have lost most of their mass.
    expect(after[2]).toBeCloseTo(before[2], 14);
    expect(after[3]).toBeCloseTo(before[3], 14);
  });

  it("a phase changes NOTHING a measurement can see", () => {
    const amps = applyOperator(start, { kind: "diagonal", phases: [1.1, -2.2, 0.3, 3.0] });
    start.forEach((a, i) => expect(cNorm2(amps[i])).toBeCloseTo(cNorm2(a), 14));
  });
});

describe("the strength -> angle conversion the v1.0 numbers rest on", () => {
  it("cos(atan s) equals 1/sqrt(1+s^2) to within one ulp", () => {
    for (const s of [0.35, 0.5, 0.6, 0.9, 1.7, 4.2]) {
      const t = angleFromStrength(s);
      expect(Math.abs(Math.cos(t) - 1 / Math.sqrt(1 + s * s))).toBeLessThan(3e-16);
      expect(Math.abs(Math.sin(t) - s / Math.sqrt(1 + s * s))).toBeLessThan(3e-16);
    }
  });
});

describe("the orientation constant is a fact about the operator", () => {
  it("a positive angle transfers toward the SECOND index, as the constant says", () => {
    const [x, y] = applyPair(rotation(angleFromStrength(0.9)), c(1), c(1));
    expect(ROTATION_TRANSFERS_TOWARD).toBe("second");
    expect(cNorm2(y)).toBeGreaterThan(cNorm2(x));
    // The measured figures the constant's own comment quotes.
    expect(Math.abs(x.re)).toBeCloseTo(0.074329, 6);
    expect(Math.abs(y.re)).toBeCloseTo(1.412259, 6);
  });
});
