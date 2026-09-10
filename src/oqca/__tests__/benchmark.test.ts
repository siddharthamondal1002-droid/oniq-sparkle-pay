/**
 * OQCA vs a Bayesian control, on the same tasks and the same likelihoods.
 *
 * This file is written so it can FAIL THE BRIEF. If the contextual tasks tie,
 * the amplitude representation adds nothing over a probability vector and that
 * is what gets reported — the value here is the control, not the score.
 *
 * FOUR OF THESE ASSERTIONS EXIST TO STOP THE RESULT BEING OVERSOLD, and each
 * pins a number that was MEASURED rather than expected: an informed Bayes given
 * the same fact decides just as well; a confident answer on a tie is set by the
 * caller's argument order; reversing the steps of a contextual task changes
 * NOTHING; and genuine order-sensitivity needs a condition none of the scored
 * tasks meet. Three of the four contradict what was written here before it was
 * run.
 */
import { describe, expect, it } from "vitest";
import { runBayes, runOqca, runSuite, scoreTask, type Task } from "@/oqca/benchmark";
import { TASKS } from "@/oqca/tasks";
import { probabilities } from "@/oqca/state";
import { beliefArgmax } from "@/oqca/baseline";

const REWEIGHT_ONLY = TASKS.filter((t) => t.steps.every((s) => !s.phases && !s.interfere));
const CONTEXTUAL = TASKS.filter((t) => t.steps.some((s) => s.phases || s.interfere));

const factPresent = TASKS.find((t) => t.name.includes("a fact that breaks it"))!;
const factAbsent = TASKS.find((t) => t.name.includes("the fact absent"))!;

describe("the control is a real control", () => {
  it("there are tasks of both kinds, or the suite proves nothing", () => {
    expect(REWEIGHT_ONLY.length).toBeGreaterThanOrEqual(3);
    expect(CONTEXTUAL.length).toBeGreaterThanOrEqual(2);
  });

  it("on reweight-only tasks the two models agree to the last decimal", () => {
    // Not merely "both correct" — IDENTICAL distributions. reweight is Bayes,
    // so any divergence here is a bug in the harness rather than a result.
    for (const task of REWEIGHT_ONLY) {
      const oqca = probabilities(runOqca(task));
      const bayes = runBayes(task).p;
      oqca.forEach((v, i) => expect(v, `${task.name} [${i}]`).toBeCloseTo(bayes[i], 12));
    }
  });

  it("Bayes is commutative on every task in the suite, contextual ones included", () => {
    // The property that makes the contextual tasks the only place the two
    // representations CAN differ. Asserted over ALL tasks, not just the
    // reweight-only ones, because Bayes never sees a phase at all.
    for (const task of TASKS) {
      const forward = beliefArgmax(runBayes(task));
      const reversed = beliefArgmax(runBayes({ ...task, steps: [...task.steps].reverse() }));
      expect(reversed.label, task.name).toBe(forward.label);
      expect(reversed.probability).toBeCloseTo(forward.probability, 12);
    }
  });
});

describe("the measured verdict", () => {
  const verdict = runSuite(TASKS);

  it("every task is scored and the summary reports the scores it actually computed", () => {
    // The summary is the sentence anyone reads instead of the numbers, so it is
    // pinned to the numbers rather than to a shape. Matching /TIE|OQCA \\d/ — the
    // first version of this assertion — would pass a summary that always claimed
    // OQCA won, which is exactly the sentence nobody would check.
    expect(verdict.total).toBe(TASKS.length);
    expect(verdict.oqcaScore).toBe(verdict.results.filter((r) => r.oqcaCorrect).length);
    expect(verdict.bayesScore).toBe(verdict.results.filter((r) => r.bayesCorrect).length);
    expect(verdict.summary).toContain(String(verdict.oqcaScore));
    expect(verdict.summary).toContain(String(verdict.bayesScore));
    if (verdict.oqcaScore === verdict.bayesScore) expect(verdict.summary).toMatch(/^TIE/);
    if (verdict.oqcaScore > verdict.bayesScore) expect(verdict.summary).toMatch(/^OQCA/);
    if (verdict.oqcaScore < verdict.bayesScore) expect(verdict.summary).toMatch(/the control wins/);
    // MEASURED on the suite as it stands: one row separates them, and it is the
    // row where OQCA was handed a fact Bayes never saw.
    expect(verdict.oqcaScore).toBe(TASKS.length);
    expect(verdict.bayesScore).toBe(TASKS.length - 1);
  });

  it("both models get the uncontroversial tasks right", () => {
    for (const r of verdict.results.filter((x) => REWEIGHT_ONLY.some((t) => t.name === x.task))) {
      expect(r.oqcaCorrect, `oqca: ${r.task}`).toBe(true);
      expect(r.bayesCorrect, `bayes: ${r.task}`).toBe(true);
    }
  });

  it("the PAIR is the result: identical likelihoods, the fact present or absent, opposite answers", () => {
    // THIS IS THE WHOLE FINDING, and it is narrower than the brief claims.
    // Two tasks with byte-identical likelihoods, differing only in whether a
    // half-turn of phase is applied. Bayes returns the SAME dead tie for both,
    // because the likelihoods it sees are the same. OQCA returns opposite
    // decisive answers, so the phase carries a BIT rather than a bias.
    expect(factAbsent.steps.map((s) => s.likelihoods)).toEqual(
      factPresent.steps.map((s) => s.likelihoods),
    );
    // ...and they differ ONLY in the phase. If a future edit changes the
    // interference too, this stops being a controlled comparison.
    expect(factAbsent.steps.map((s) => s.interfere)).toEqual(
      factPresent.steps.map((s) => s.interfere),
    );
    expect(factPresent.steps.some((s) => s.phases?.some((p) => p !== 0))).toBe(true);
    expect(factAbsent.steps.every((s) => s.phases?.every((p) => p === 0) ?? true)).toBe(true);

    const presentBayes = runBayes(factPresent).p;
    const absentBayes = runBayes(factAbsent).p;
    absentBayes.forEach((v, i) => expect(v).toBeCloseTo(presentBayes[i], 12));
    // And the control's answer is an artifact of index order, not a decision.
    expect(presentBayes[0]).toBeCloseTo(presentBayes[1], 12);

    const presentOqca = probabilities(runOqca(factPresent));
    const absentOqca = probabilities(runOqca(factAbsent));
    expect(presentOqca[1]).toBeGreaterThan(0.9);
    expect(absentOqca[0]).toBeGreaterThan(0.9);
    // Mirror images: the phase moved the mass across, it did not create any.
    expect(presentOqca[1]).toBeCloseTo(absentOqca[0], 12);

    expect(scoreTask(factPresent).oqcaCorrect).toBe(true);
    expect(scoreTask(factAbsent).oqcaCorrect).toBe(true);
  });

  it("but the extra information came from the CALLER, not from the model", () => {
    // The honest caveat, asserted so it cannot be quietly dropped from the
    // story. The phase is a free parameter someone supplies. Give Bayes the
    // same third fact as a likelihood and it decides just as well — so what
    // the amplitude state buys is a PLACE TO PUT the fact, not new inference.
    const informedBayes = runBayes({
      ...factPresent,
      steps: [factPresent.steps[0], { likelihoods: [0.05, 0.95, 0.2] }],
    });
    expect(beliefArgmax(informedBayes).label).toBe("B");
    expect(beliefArgmax(informedBayes).probability).toBeGreaterThan(0.8);
  });

  it("and OQCA does not win the tasks it has no business winning", () => {
    // A suite where OQCA sweeps would mean the tasks were built to flatter it.
    // Divergence must be CONFINED to the contextual rows, and to exactly one.
    for (const r of verdict.divergent) {
      expect(
        CONTEXTUAL.some((t) => t.name === r.task),
        `${r.task} diverged`,
      ).toBe(true);
    }
    expect(verdict.divergent).toHaveLength(1);
    expect(verdict.divergent[0].task).toBe(factPresent.name);
  });
});

describe("what the confident number is NOT", () => {
  it("on a genuine tie the winner is chosen by the caller's argument order", () => {
    // MEASURED, and it is the sharpest limit on the whole result. `interfere`
    // rotates mass from the SECOND named hypothesis into the first, so naming
    // the pair (B, A) instead of (A, B) hands back the opposite label at the
    // identical confidence, from evidence that has not changed by one bit.
    // 0.9234 is therefore a fact about the operator's orientation, never about
    // the evidence — and a caller who does not know that will read it as one.
    const asWritten = probabilities(runOqca(factAbsent));
    const swapped = probabilities(
      runOqca({
        ...factAbsent,
        steps: factAbsent.steps.map((s) =>
          s.interfere ? { ...s, interfere: [s.interfere[1], s.interfere[0], s.interfere[2]] } : s,
        ),
      } as Task),
    );
    expect(asWritten[0]).toBeGreaterThan(0.9);
    expect(swapped[1]).toBeCloseTo(asWritten[0], 12);
    expect(swapped[0]).toBeCloseTo(asWritten[1], 12);
  });

  /**
   * Whether every step scales BOTH members of the interfering pair by the same
   * likelihood. Derived from the task rather than hard-coded, so a future task
   * lands in whichever arm it belongs to instead of quietly breaking the claim.
   */
  function pairScaledEqually(task: Task): boolean {
    const step = task.steps.find((s) => s.interfere);
    if (!step) return true;
    const [i, j] = step.interfere!;
    return task.steps.every((s) => s.likelihoods[i] === s.likelihoods[j]);
  }

  it("step order matters EXACTLY when the interfering pair is reweighted unequally", () => {
    // These tasks were called "ORDER MATTERS" until this was run, and the
    // blanket claim was wrong in BOTH directions — the first correction said
    // reversal never mattered, and task 5 falsified that too. A `reweight` that
    // scales both members of the pair by the SAME likelihood is a scalar on
    // that 2-D subspace, and a scalar commutes with the rotation; an unequal
    // one does not. So the condition is the finding, not the verdict.
    const equal = CONTEXTUAL.filter(pairScaledEqually);
    const unequal = CONTEXTUAL.filter((t) => !pairScaledEqually(t));
    expect(equal.length, "no equal-pair task to check").toBeGreaterThan(0);
    expect(unequal.length, "no unequal-pair task to check").toBeGreaterThan(0);

    for (const task of equal) {
      const forward = probabilities(runOqca(task));
      const reversed = probabilities(runOqca({ ...task, steps: [...task.steps].reverse() }));
      forward.forEach((v, i) => expect(v, `${task.name} [${i}]`).toBeCloseTo(reversed[i], 12));
    }
    for (const task of unequal) {
      const forward = probabilities(runOqca(task));
      const reversed = probabilities(runOqca({ ...task, steps: [...task.steps].reverse() }));
      const drift = Math.max(...forward.map((v, i) => Math.abs(v - reversed[i])));
      expect(drift, `${task.name} did not move`).toBeGreaterThan(1e-3);
    }
  });

  it("but no scored task's ANSWER turns on step order — only its confidence", () => {
    // MEASURED: task 5 moves A 0.8711 -> 0.8597 when reversed and still says A.
    // So the suite demonstrates non-commutativity as an EFFECT and nowhere
    // demonstrates it deciding anything, which is a weaker claim than the
    // brief's and the one the numbers actually support.
    for (const task of TASKS) {
      const argmax = (p: readonly number[]) => p.indexOf(Math.max(...p));
      const forward = probabilities(runOqca(task));
      const reversed = probabilities(runOqca({ ...task, steps: [...task.steps].reverse() }));
      expect(argmax(reversed), task.name).toBe(argmax(forward));
    }
  });

  it("and Bayes cannot see the difference at all, on a task built to show it", () => {
    // The control for the row above: an unequal pair, phase and interference,
    // reversed. OQCA moves; the probability vector is byte-identical, because
    // multiplication commutes and there is nowhere to record which came first.
    const unequal: Task = {
      name: "unequal likelihoods across the interfering pair",
      labels: ["A", "B", "C"],
      prior: [1, 1, 1],
      steps: [
        { likelihoods: [0.8, 0.2, 0.4], phases: [0, 0, 0] },
        { likelihoods: [0.3, 0.7, 0.4], phases: [0, Math.PI, 0], interfere: [0, 1, 0.6] },
      ],
      truth: "B",
      rationale: "measured in the test, not scored",
    };
    const backwards: Task = { ...unequal, steps: [...unequal.steps].reverse() };
    const forward = probabilities(runOqca(unequal));
    const reversed = probabilities(runOqca(backwards));
    // MEASURED: 0.0959 / 0.6078 / 0.2963 forward, 0.0034 / 0.5533 / 0.4433 back.
    expect(forward[0]).toBeCloseTo(0.0959, 4);
    expect(reversed[0]).toBeCloseTo(0.0034, 4);
    expect(Math.abs(forward[2] - reversed[2])).toBeGreaterThan(0.1);

    const bf = runBayes(unequal).p;
    const br = runBayes(backwards).p;
    bf.forEach((v, i) => expect(v).toBeCloseTo(br[i], 12));
  });
});
