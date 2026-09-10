/**
 * OQCA v1.1 — the benchmark as a suite. Brief sections 6, 8, 9 and 14.
 *
 * WHAT THIS FILE EXISTS TO PREVENT IS NAMED IN THE BRIEF: "A 1-row score must
 * never again be presented as a general result." v1.0's headline was 7-6 over
 * seven hand-written tasks, one of which scored. So the assertions here are
 * about the DESIGN of a run rather than about any number it produced: every
 * experiment loads its choices from a manifest, declares at least one matched
 * classical control, runs over tens of seeds, and reports an exact paired test
 * whose verdict refuses to name a winner without the design to support it.
 *
 * AND THE CENTRAL RESULT IS A FALSIFICATION, ASSERTED AS ONE. On
 * `contextuality/phase-tie-break` the treatment scores 100% against an
 * uninformed probability vector's 42.5% — and IDENTICALLY to informed Bayes and
 * to a real-valued context vector, on all 40 trials, with zero discordant
 * pairs. All three `expected_to_fail` controls fall. That is pinned below as
 * the expected outcome, not tolerated as one: the day a change makes OQCA beat
 * informed Bayes, this file goes red and somebody has to explain why, which is
 * the only way a suite built by the party it flatters can be trusted.
 *
 * `untouched_drift` GETS ITS OWN SECTION, and it is the one metric that reads
 * 0.0000 on every arm of every run. By this repo's standing rule a check that
 * has never been non-zero has never been tested (CLAUDE.md, 2026-09-08), so it
 * is driven with the SPECIFICATION's own raw operator until it moves.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BENCHMARK_ROOT,
  listFamilies,
  loadAllManifests,
  loadManifestFile,
} from "@/oqca/bench/loader";
import { MANIFEST_VERSION, ManifestError, parseManifest } from "@/oqca/bench/manifest";
import { buildTrials, formatResult, runBenchmark } from "@/oqca/bench/runner";
import { generatorFor, TRIAL_GENERATORS } from "@/oqca/bench/trials";
import { CONTROL_IDS, runControl } from "@/oqca/bench/adversarial";
import { untouchedDrift } from "@/oqca/bench/arms";
import { comparePaired } from "@/oqca/bench/stats";
import {
  NonUnitaryOperatorError,
  type Unitary2,
  assertUnitary2,
  unitarityResidual,
} from "@/oqca/math/unitary";
import { OperatorError, applyOperator, inverseOperator } from "@/oqca/operators";
import { c } from "@/oqca/math/complex";

const MANIFESTS = loadAllManifests();
const byId = (id: string) => MANIFESTS.find((m) => m.id === id)!;

describe("brief section 9 — the runner loads a manifest, it does not hard-code the experiment", () => {
  it("finds manifests at all", () => {
    // The denominator, again: an empty load would make every loop below vacuous.
    expect(MANIFESTS.length).toBeGreaterThanOrEqual(4);
    expect(MANIFESTS.map((m) => m.id)).toContain("contextuality/phase-tie-break");
  });

  it("every manifest pins the version, so a schema change cannot pass silently", () => {
    for (const m of MANIFESTS) expect(m.version).toBe(MANIFEST_VERSION);
  });

  it("every manifest resolves its generator and every one of its controls", () => {
    for (const m of MANIFESTS) {
      expect(() => generatorFor(m.generator), m.id).not.toThrow();
      for (const control of m.controls) {
        expect(CONTROL_IDS, `${m.id} names ${control}`).toContain(control);
      }
    }
  });

  it("every declared generator is reachable from some manifest, or it is dead code", () => {
    const used = new Set(MANIFESTS.map((m) => m.generator));
    for (const name of Object.keys(TRIAL_GENERATORS)) {
      expect(used, `generator ${name} has no manifest`).toContain(name);
    }
  });

  it("the manifest's family matches the directory it was found in", () => {
    for (const m of MANIFESTS) expect(m.id.split("/")[0]).toBe(m.family);
  });

  it("a family that holds no manifest says in writing why not", () => {
    // Brief section 6 names memory, transfer and planning. Each is a directory
    // with a README and no JSON, because inventing a fixture for a capability
    // the kernel does not have is exactly the thing v1.0 was corrected for.
    for (const family of listFamilies()) {
      const dir = join(BENCHMARK_ROOT, family);
      const files = readdirSync(dir);
      if (files.some((f) => f.endsWith(".json"))) continue;
      expect(files, `${family} has neither a manifest nor a README`).toContain("README.md");
      const text = readFileSync(join(dir, "README.md"), "utf8");
      expect(text.length, `${family}/README.md is empty`).toBeGreaterThan(200);
    }
  });
});

describe("brief section 14 — every experiment carries a matched classical control", () => {
  it("no manifest may declare zero baselines", () => {
    for (const m of MANIFESTS) expect(m.baselines.length, m.id).toBeGreaterThan(0);
  });

  it("parseManifest REFUSES a manifest with no baseline", () => {
    // Mutation-checked at the parser rather than at the data: emptying the
    // array in a JSON file must be impossible, not merely absent today.
    const raw = JSON.parse(
      readFileSync(`${BENCHMARK_ROOT}/contextuality/phase-tie-break.json`, "utf8"),
    );
    expect(() => parseManifest({ ...raw, baselines: [] })).toThrow(ManifestError);
    expect(() => parseManifest({ ...raw, baselines: ["not_a_baseline"] })).toThrow(ManifestError);
    expect(() => parseManifest({ ...raw, treatment: "oqca_magic" })).toThrow(ManifestError);
    expect(() => parseManifest({ ...raw, metrics: [] })).toThrow(ManifestError);
    expect(() => parseManifest({ ...raw, version: "1.0" })).toThrow(ManifestError);
    expect(() => parseManifest({ ...raw, seeds: [] })).toThrow(ManifestError);
    expect(() => parseManifest({ ...raw, seeds: [1, 1, 2] })).toThrow(ManifestError);
    expect(() => parseManifest({ ...raw, information_note: "  " })).toThrow(ManifestError);
    expect(() => parseManifest({ ...raw, expected_behaviour: "" })).toThrow(ManifestError);
    // ...and the unmutated file still parses, so the throws above are about the
    // mutation rather than about the fixture being broken.
    expect(() => parseManifest(raw)).not.toThrow();
  });

  it("every manifest explains what information each arm receives", () => {
    // The single most load-bearing field in the file: every honest reading of
    // an OQCA win turns on it.
    for (const m of MANIFESTS) {
      expect(m.informationNote.length, m.id).toBeGreaterThan(80);
      expect(m.expectedBehaviour.length, m.id).toBeGreaterThan(40);
      expect(m.nullHypothesis.length, m.id).toBeGreaterThan(40);
    }
  });
});

describe("brief section 8 — statistics over many seeds, never one row", () => {
  it("no experiment runs on fewer than 20 seeds", () => {
    for (const m of MANIFESTS) {
      expect(m.seeds.length, `${m.id} runs ${m.seeds.length} seeds`).toBeGreaterThanOrEqual(20);
      expect(new Set(m.seeds).size, m.id).toBe(m.seeds.length);
      expect(buildTrials(m).length, m.id).toBe(m.seeds.length);
    }
  });

  it("a run reports n, both intervals, the discordant counts, an effect size and a p-value", () => {
    const r = runBenchmark(byId("contextuality/phase-tie-break"));
    for (const [baseline, s] of Object.entries(r.comparisons)) {
      expect(s.trials, baseline).toBe(40);
      expect(s.oqcaInterval[0]).toBeLessThanOrEqual(s.oqcaAccuracy);
      expect(s.oqcaInterval[1]).toBeGreaterThanOrEqual(s.oqcaAccuracy);
      expect(Number.isFinite(s.effectSize)).toBe(true);
      expect(s.pValue).toBeGreaterThanOrEqual(0);
      expect(s.pValue).toBeLessThanOrEqual(1);
      expect(s.verdict.length).toBeGreaterThan(20);
    }
  });

  it("no discordant pairs means p = 1, not a number produced by dividing by zero", () => {
    const same = comparePaired(Array.from({ length: 40 }, () => ({ oqca: true, control: true })));
    expect(same.discordantOqcaOnly).toBe(0);
    expect(same.discordantControlOnly).toBe(0);
    expect(same.pValue).toBe(1);
    expect(same.verdict).toMatch(/IDENTICAL|never disagreed/);
  });

  it("a run is deterministic — the same manifest twice gives the same numbers", () => {
    // Brief section 8 asks for a reproducible seed. Nothing here reads a clock
    // or Math.random, so this is the check that says so at the level a reader
    // cares about: the report, byte for byte.
    for (const m of MANIFESTS) {
      expect(formatResult(runBenchmark(m)), m.id).toBe(formatResult(runBenchmark(m)));
    }
  });
});

describe("brief section 7 — the adversarial controls, and the falsification they returned", () => {
  const result = runBenchmark(byId("contextuality/phase-tie-break"));
  const control = (id: string) => result.controls.find((c) => c.id === id)!;

  it("every control declares its expectation BEFORE the run", () => {
    for (const c of result.controls) {
      expect(["expected_to_survive", "expected_to_fail", "informational"]).toContain(c.expectation);
      expect(c.ifFailed.length).toBeGreaterThan(30);
      expect(c.question).toMatch(/\?/);
    }
  });

  it("the suite is not decorative — at least one control is expected to FAIL", () => {
    // "The objective is to discover where OQCA fails, not manufacture wins."
    // A suite whose every control is expected to pass has not been adversarial.
    expect(result.controls.filter((c) => c.expectation === "expected_to_fail").length).toBe(3);
  });

  it("the phase is not inert: supplying the fact changes the answer", () => {
    expect(control("phase_provides_no_benefit").survives).toBe(true);
  });

  it("a RANDOM phase scores at chance, so the trials leak nothing", () => {
    const c = control("random_phase_produces_gains");
    expect(c.survives).toBe(true);
    expect(c.detail).toMatch(/50\.0%/);
  });

  it("'always name the first of the pair' scores at chance, which v1.0's fixture did not", () => {
    const c = control("index_order_artifact");
    expect(c.survives).toBe(true);
    expect(c.detail).toMatch(/50\.0%/);
  });

  it("renaming the basis never changes which hypothesis wins", () => {
    const c = control("basis_permutation_changes_the_answer");
    expect(c.survives).toBe(true);
    expect(c.detail).toMatch(/^0 of 40/);
  });

  it("THE CENTRAL FALSIFICATION: informed Bayes matches OQCA exactly", () => {
    // Pinned as the EXPECTED outcome. If this ever starts passing — if OQCA
    // beats a probability vector given the identical fact — the claim changes
    // completely and this test is the place that says so out loud.
    const c = control("bayes_with_equivalent_information");
    expect(c.expectation).toBe("expected_to_fail");
    expect(c.survives).toBe(false);
    expect(c.stats!.discordantOqcaOnly).toBe(0);
    expect(c.stats!.discordantControlOnly).toBe(0);
    expect(c.stats!.oqcaAccuracy).toBe(1);
    expect(c.stats!.controlAccuracy).toBe(1);
  });

  it("a plain real-valued vector with one context channel does the same job", () => {
    const c = control("classical_vector_can_encode_it");
    expect(c.survives).toBe(false);
    expect(c.stats!.controlAccuracy).toBe(1);
  });

  it("so the gap is INFORMATION, not representation, and the suite says so", () => {
    const c = control("information_not_representation");
    expect(c.survives).toBe(false);
    expect(c.detail).toMatch(/INFORMATION, not representation/);
  });

  it("controlsHeld is about the survive-expected controls only", () => {
    // Three controls FELL and the run is still valid: a control expected to
    // fail and failing does not invalidate a run, it informs it.
    expect(result.controlsHeld).toBe(true);
    expect(result.controls.filter((c) => !c.survives).length).toBe(3);
  });

  it("runControl refuses an unknown id rather than silently scoring nothing", () => {
    expect(() => runControl("no_such_control", [], 1)).toThrow(/no adversarial control/);
  });
});

describe("the null condition: with no fact anywhere, nothing beats chance", () => {
  const result = runBenchmark(byId("contextuality/tie-no-fact"));

  it("no arm rises above chance on the tied pair", () => {
    const acc = result.metrics.find((m) => m.metric === "accuracy")!;
    expect(acc.treatment).toBeLessThanOrEqual(0.62);
    for (const v of Object.values(acc.byBaseline)) expect(v).toBeLessThanOrEqual(0.62);
  });

  it("and the conclusion says exactly that", () => {
    expect(result.conclusion).toMatch(/NO MEASURED ADVANTAGE/);
  });
});

describe("the bridge: EVIDENCE is Bayes, so the tie families must tie", () => {
  it("late-admission is identical to a probability vector on every trial", () => {
    const r = runBenchmark(byId("hypothesis/late-admission"));
    const s = r.comparisons.bayes_uninformed;
    expect(s.discordantOqcaOnly).toBe(0);
    expect(s.discordantControlOnly).toBe(0);
    expect(s.pValue).toBe(1);
  });
});

/**
 * `untouched_drift` — THE METRIC THAT HAS NEVER MOVED.
 *
 * It reads 0.0000 for every arm of every run, which is the correct answer and
 * also indistinguishable from a metric that computes nothing. So it is driven
 * with the SPECIFICATION's own operator — `a_i' = a_i + s*a_j`,
 * `a_j' = a_j - s*a_i`, then a GLOBAL renormalize — which is the exact shape
 * v1.0 measured draining an untouched hypothesis from 0.3333 to 0.0774.
 */
describe("brief section 2 — untouched_drift is live, proven with the spec's own operator", () => {
  const PARAMS = { hypotheses: 4, theta: Math.atan(0.5), rounds: 6, lead: 0.55, rival: 0.45 };
  const SEEDS = [1000, 1007, 1014, 1021, 1028, 1035, 1042, 1049, 1056, 1063];
  const trials = SEEDS.map((s) => generatorFor("untouched_hypothesis")(s, PARAMS));

  /** The spec's operator, real-valued: pair map, then the GLOBAL divide. */
  function specRun(trial: (typeof trials)[number], s: number): number[] {
    const unit = (v: number[]) => {
      const k = Math.hypot(...v);
      return v.map((x) => x / k);
    };
    let a = unit(trial.prior.map((w) => Math.sqrt(w)));
    for (const step of trial.steps) {
      a = unit(a.map((x, i) => x * Math.sqrt(step.likelihoods[i])));
      if (step.interfere) {
        const [i, j] = step.interfere;
        const ai = a[i];
        const aj = a[j];
        a[i] = ai + s * aj;
        a[j] = aj - s * ai;
        a = unit(a); // the inflation the pair map added is taken out of EVERYONE
      }
    }
    return a.map((x) => x * x);
  }

  function driftUnder(trial: (typeof trials)[number], run: (t: typeof trial) => number[]): number {
    const withOp = run(trial);
    const stripped = {
      ...trial,
      steps: trial.steps.map(({ interfere: _drop, ...rest }) => rest),
    };
    const withoutOp = run(stripped);
    const [a, b] = trial.interferingPair!;
    let worst = 0;
    for (let i = 0; i < withOp.length; i++) {
      if (i === a || i === b) continue;
      worst = Math.max(worst, Math.abs(withOp[i] - withoutOp[i]));
    }
    return worst;
  }

  it("the kernel's unitary operator leaves untouched hypotheses at floating-point zero", () => {
    for (const t of trials) {
      expect(untouchedDrift(t, "oqca_phase"), t.id).toBeLessThan(1e-12);
    }
  });

  it("the metric itself computes a real difference, not a constant zero", () => {
    // The gap the two assertions around this one leave open: `untouchedDrift`
    // stubbed to `return 0` would satisfy both, because the kernel is unitary
    // and the spec comparison below runs on its own local implementation. The
    // kernel cannot be made to drain, so the metric is exercised by MIS-DECLARING
    // which pair is touched: the step really rotates (3, 2), the trial claims
    // (3, 0), and index 2 is then "outside" while genuinely moving.
    // MEASURED: 0.1040 on seed 1000, against 0 for the honest declaration.
    const t = trials[0];
    const real = t.steps[0].interfere!;
    const misdeclared = {
      ...t,
      interferingPair: [real[0], real[0] === 0 ? 1 : 0] as readonly [number, number],
    };
    expect(untouchedDrift(t, "oqca_phase")).toBeLessThan(1e-12);
    expect(untouchedDrift(misdeclared, "oqca_phase")).toBeGreaterThan(0.05);
  });

  it("the SPEC's operator drains them, and the same metric measures it", () => {
    // MEASURED: 0.2477 worst-case over these ten seeds. If this ever came back
    // near zero the metric would be computing nothing and the assertion above
    // would be worthless.
    const worst = Math.max(...trials.map((t) => driftUnder(t, (x) => specRun(x, 0.5))));
    expect(worst).toBeGreaterThan(0.2);
  });

  it("and the drain is not cosmetic: it loses EVERY trial in this family", () => {
    // The trial's truth is a hypothesis OUTSIDE the pair, favoured by the
    // evidence. A model that drains what it never touched loses it outright.
    let lost = 0;
    for (const t of trials) {
      const p = specRun(t, 0.5);
      let best = 0;
      for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
      if (t.labels[best] !== t.truth) lost++;
    }
    expect(lost).toBe(trials.length);
  });

  it("and the kernel cannot be made to build that operator at all", () => {
    // The connection back to real code: the drain is impossible here rather
    // than merely absent. `M = [[1, s], [-s, 1]]` is not unitary, and both the
    // matrix check and the operator applier refuse it.
    const s = 0.5;
    const M: Unitary2 = [c(1), c(s), c(-s), c(1)];
    expect(() => assertUnitary2(M)).toThrow(NonUnitaryOperatorError);
    expect(() => applyOperator([c(1), c(0), c(0)], { kind: "pair", i: 0, j: 1, u: M })).toThrow(
      NonUnitaryOperatorError,
    );
    // The residual is the number the refusal is made of: M-dagger M = (1+s^2)I,
    // so it is s^2 = 0.25 rather than a rounding wobble.
    expect(unitarityResidual(M)).toBeCloseTo(0.25, 12);
  });

  it("and an operator arriving with an unknown kind is refused, not applied", () => {
    // The hole this test found: the switch is exhaustive over the union, so
    // `tsc` proves no typed caller reaches the default — and a transition
    // record replayed from JSON is not a typed caller. It used to return
    // `undefined`, which the caller would then treat as a state.
    const smuggled = { kind: "drain", i: 0, j: 1 } as unknown as Parameters<
      typeof applyOperator
    >[1];
    expect(() => applyOperator([c(1), c(0)], smuggled)).toThrow(OperatorError);
    expect(() => inverseOperator(smuggled)).toThrow(OperatorError);
  });
});

describe("brief section 1 — the conclusions this suite is allowed to state", () => {
  const BANNED =
    /quantum advantage|\bAGI\b|better reasoning|superior reasoning|outperforms? classical/i;

  it("no run's conclusion or verdict uses a forbidden claim", () => {
    for (const m of MANIFESTS) {
      const r = runBenchmark(m);
      expect(r.conclusion, m.id).not.toMatch(BANNED);
      for (const s of Object.values(r.comparisons)) expect(s.verdict, m.id).not.toMatch(BANNED);
      for (const c of r.controls)
        expect(c.detail + c.ifFailed, `${m.id}/${c.id}`).not.toMatch(BANNED);
      expect(formatResult(r), m.id).not.toMatch(BANNED);
    }
  });

  it("no manifest states one either", () => {
    for (const m of MANIFESTS) {
      expect(
        m.hypothesis + m.nullHypothesis + m.informationNote + m.expectedBehaviour,
        m.id,
      ).not.toMatch(BANNED);
    }
  });

  it("the ban is a real ban", () => {
    // Mutation check on the pattern itself: it must actually catch the phrases
    // the brief forbids, or the four assertions above are decorative.
    expect("OQCA demonstrates quantum advantage").toMatch(BANNED);
    expect("a step toward AGI").toMatch(BANNED);
    expect("it is better reasoning").toMatch(BANNED);
    expect("it outperforms classical models").toMatch(BANNED);
    expect("the treatment beat 1 of 3 baselines").not.toMatch(BANNED);
  });

  it("the phase-tie-break conclusion names the ceiling rather than the win", () => {
    const r = runBenchmark(byId("contextuality/phase-tie-break"));
    expect(r.conclusion).toMatch(/beat 1 of 3 baselines/);
    expect(r.conclusion).toMatch(/honest ceiling/);
    expect(r.conclusion).toMatch(/Falsified\/closed by controls/);
  });

  it("a run whose survive-expected control fell is declared INVALID, not reported", () => {
    // The runner's own refusal path, exercised rather than assumed: a manifest
    // pointing a survive-expected control at the null family, where the phase
    // is stripped and therefore genuinely inert.
    const m = { ...byId("contextuality/tie-no-fact"), controls: ["phase_provides_no_benefit"] };
    const r = runBenchmark(m);
    expect(r.controlsHeld).toBe(false);
    expect(r.conclusion).toMatch(/^INVALID RUN/);
    expect(r.conclusion).toMatch(/No claim may rest on these numbers/);
  });
});

describe("the loader", () => {
  it("reads only .json, and every family directory is walked", () => {
    const families = listFamilies();
    expect(families).toEqual([...families].sort());
    for (const f of families) expect(statSync(join(BENCHMARK_ROOT, f)).isDirectory()).toBe(true);
    expect(families).toContain("memory");
    expect(families).toContain("transfer");
    expect(families).toContain("planning");
  });

  it("a single manifest file round-trips through the parser", () => {
    const m = loadManifestFile(`${BENCHMARK_ROOT}/interference/untouched-hypothesis.json`);
    expect(m.id).toBe("interference/untouched-hypothesis");
    expect(m.metrics).toContain("untouched_drift");
  });
});
