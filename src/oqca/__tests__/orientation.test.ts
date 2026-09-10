/**
 * OQCA v1.1 — the orientation collision, pinned.
 *
 * THIS FILE EXISTS BECAUSE THE BENCHMARK FOUND A BUG THAT NO UNIT TEST WOULD
 * HAVE. `cognitive.interfere` and `gates.interfere` take the same arguments in
 * the same order under the same verb and transfer amplitude in OPPOSITE
 * directions — the v1.1 suite's first run scored 0% where chance is 50%, which
 * is the signature of a systematic inversion rather than of noise.
 *
 * Both orientations are correct in their own convention and BOTH ARE KEPT: the
 * v1.0 entry point must reproduce every v1.0 number, and the v1.1 operator must
 * be the rotation the brief specifies. What was missing was any test that would
 * notice them disagreeing, so this is that test.
 */
import { describe, expect, it } from "vitest";
import { CognitiveState } from "@/oqca/formalState";
import { interfere as cogInterfere, phase, phasesFavouring } from "@/oqca/cognitive";
import { fromWeights, probabilities } from "@/oqca/state";
import { interfere as v10Interfere } from "@/oqca/gates";
import { ROTATION_TRANSFERS_TOWARD, angleFromStrength } from "@/oqca/math/unitary";

const THETA = angleFromStrength(0.9);
const flat = () => CognitiveState.fromWeights(["A", "B", "C"], [1, 1, 1]);

describe("the two interfere entry points are MIRRORS, deliberately", () => {
  it("v1.1 interfere(A, B, +theta) favours B — the second named", () => {
    const p = cogInterfere(flat(), "A", "B", THETA).probabilities();
    expect(p[1]).toBeGreaterThan(p[0]);
    expect(p[0]).toBeCloseTo(0.0018, 4);
    expect(p[1]).toBeCloseTo(0.6648, 4);
    expect(ROTATION_TRANSFERS_TOWARD).toBe("second");
  });

  it("v1.0 interfere(A, B, strength) favours A — the first named", () => {
    const p = probabilities(v10Interfere(fromWeights(["A", "B", "C"], [1, 1, 1]), "A", "B", 0.9));
    expect(p[0]).toBeGreaterThan(p[1]);
    expect(p[0]).toBeCloseTo(0.6648, 4);
    expect(p[1]).toBeCloseTo(0.0018, 4);
  });

  it("and they are EXACT mirrors: swapping the pair makes them agree", () => {
    // If this ever fails, the two are no longer the same operator with opposite
    // argument order — they have genuinely diverged, which is worse than the
    // collision this file was written for.
    const v11 = cogInterfere(flat(), "B", "A", THETA).probabilities();
    const v10 = probabilities(v10Interfere(fromWeights(["A", "B", "C"], [1, 1, 1]), "A", "B", 0.9));
    v11.forEach((x, i) => expect(x).toBeCloseTo(v10[i], 12));
  });

  it("BOTH leave the untouched hypothesis at exactly one third", () => {
    expect(cogInterfere(flat(), "A", "B", THETA).probabilities()[2]).toBeCloseTo(1 / 3, 14);
    expect(
      probabilities(v10Interfere(fromWeights(["A", "B", "C"], [1, 1, 1]), "A", "B", 0.9))[2],
    ).toBeCloseTo(1 / 3, 14);
  });
});

describe("only RELATIVE phase is observable", () => {
  it("a half-turn on EITHER member of the pair gives the identical state", () => {
    const onB = cogInterfere(phase(flat(), "B", Math.PI), "A", "B", THETA).probabilities();
    const onA = cogInterfere(phase(flat(), "A", Math.PI), "A", "B", THETA).probabilities();
    onA.forEach((x, i) => expect(x).toBeCloseTo(onB[i], 12));
    // ...and both reverse the no-phase outcome.
    expect(onA[0]).toBeCloseTo(0.6648, 4);
  });
});

describe("phasesFavouring is the kernel's own answer, and it is checked against the gate", () => {
  it("returns a configuration that actually makes the named hypothesis win", () => {
    for (const [a, b] of [
      [0, 1],
      [1, 0],
      [0, 2],
      [2, 1],
    ] as const) {
      for (const favoured of [a, b]) {
        const phases = phasesFavouring(3, [a, b], favoured);
        let s = flat();
        phases.forEach((t, i) => {
          if (t !== 0) s = phase(s, s.basis[i], t);
        });
        const p = cogInterfere(s, s.basis[a], s.basis[b], THETA).probabilities();
        const winner = p.indexOf(Math.max(...p));
        expect(winner, `pair ${a},${b} favouring ${favoured}`).toBe(favoured);
      }
    }
  });

  it("refuses a favoured hypothesis that is not in the pair", () => {
    expect(() => phasesFavouring(3, [0, 1], 2)).toThrow(/member of the pair/);
    expect(() => phasesFavouring(3, [1, 1], 1)).toThrow(/distinct/);
  });
});
