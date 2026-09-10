/**
 * OQCA v1.1 — the benchmark runner. Brief sections 8 and 9.
 *
 * PURE, AND IT TAKES MANIFESTS AS DATA. Nothing here reads a disk or a clock;
 * `loader.ts` does the reading. So the runner is importable from a test, from a
 * script, and from a future report generator without any of them needing a
 * filesystem, and a run is a function of (manifest, generator) alone.
 *
 * WHAT A RESULT IS ALLOWED TO SAY. Every comparison carries n, both accuracies
 * with Wilson intervals, the discordant counts, an effect size and an exact
 * paired p-value, and the headline sentence is `stats.verdict`, which refuses
 * to name a winner when p > 0.05. Brief section 8: "Do not call something an
 * advantage unless the experimental design actually supports that conclusion."
 * The one-row 7-6 of v1.0 could not have produced a sentence here.
 */
import { comparePaired, type ComparisonStats } from "./stats.ts";
import { runArm, untouchedDrift } from "./arms.ts";
import { generatorFor, type Trial } from "./trials.ts";
import { runControl, type ControlOutcome } from "./adversarial.ts";
import type { BaselineId, BenchmarkManifest, MetricId } from "./manifest.ts";

export type MetricSummary = {
  readonly metric: MetricId;
  readonly treatment: number;
  readonly byBaseline: Readonly<Record<string, number>>;
};

export type BenchmarkResult = {
  readonly manifestId: string;
  readonly family: string;
  readonly hypothesis: string;
  readonly nullHypothesis: string;
  readonly informationNote: string;
  readonly expectedBehaviour: string;
  readonly trials: number;
  readonly seeds: readonly number[];
  readonly treatment: string;
  readonly comparisons: Readonly<Record<BaselineId, ComparisonStats>>;
  readonly metrics: readonly MetricSummary[];
  readonly controls: readonly ControlOutcome[];
  /**
   * True only when EVERY declared control that was expected to survive did.
   * A control expected to fail and failing does not make a run invalid — it
   * makes it informative.
   */
  readonly controlsHeld: boolean;
  /** The one sentence. Never says "advantage" without the design to support it. */
  readonly conclusion: string;
};

export function buildTrials(manifest: BenchmarkManifest): Trial[] {
  const gen = generatorFor(manifest.generator);
  return manifest.seeds.map((s) => gen(s, manifest.parameters));
}

function metricValue(metric: MetricId, trials: readonly Trial[], arm: BaselineId | string): number {
  const a = arm as Parameters<typeof runArm>[1];
  if (metric === "accuracy") {
    const hits = trials.filter((t) => runArm(t, a).argmaxLabel === t.truth).length;
    return trials.length ? hits / trials.length : 0;
  }
  if (metric === "confidence") {
    const sum = trials.reduce((acc, t) => {
      const r = runArm(t, a);
      const i = t.labels.indexOf(t.truth);
      return acc + (i < 0 ? 0 : r.probabilities[i]);
    }, 0);
    return trials.length ? sum / trials.length : 0;
  }
  // untouched_drift: the WORST drift over trials, because an average hides the
  // one hypothesis that got drained.
  return trials.reduce((worst, t) => Math.max(worst, untouchedDrift(t, a)), 0);
}

export function runBenchmark(manifest: BenchmarkManifest): BenchmarkResult {
  const trials = buildTrials(manifest);

  const comparisons = {} as Record<BaselineId, ComparisonStats>;
  for (const baseline of manifest.baselines) {
    comparisons[baseline] = comparePaired(
      trials.map((t) => ({
        oqca: runArm(t, manifest.treatment).argmaxLabel === t.truth,
        control: runArm(t, baseline).argmaxLabel === t.truth,
      })),
    );
  }

  const metrics: MetricSummary[] = manifest.metrics.map((metric) => ({
    metric,
    treatment: metricValue(metric, trials, manifest.treatment),
    byBaseline: Object.fromEntries(
      manifest.baselines.map((b) => [b, metricValue(metric, trials, b)]),
    ),
  }));

  const controls = manifest.controls.map((c) => runControl(c, trials, manifest.seeds[0] ?? 1));
  const controlsHeld = controls
    .filter((c) => c.expectation === "expected_to_survive")
    .every((c) => c.survives);

  const falsified = controls.filter((c) => !c.survives).map((c) => c.id);
  const strongest = manifest.baselines
    .map((b) => comparisons[b])
    .filter((s) => s.pValue <= 0.05 && s.difference > 0);

  let conclusion: string;
  if (!controlsHeld) {
    conclusion = `INVALID RUN — a control that was expected to survive did not (${controls
      .filter((c) => c.expectation === "expected_to_survive" && !c.survives)
      .map((c) => c.id)
      .join(", ")}). No claim may rest on these numbers.`;
  } else if (strongest.length === manifest.baselines.length && manifest.baselines.length > 0) {
    conclusion =
      `The treatment beat EVERY declared baseline over ${trials.length} trials. ` +
      `Read ${JSON.stringify(manifest.informationNote)} before reading that as a representation result.`;
  } else if (strongest.length > 0) {
    conclusion =
      `The treatment beat ${strongest.length} of ${manifest.baselines.length} baselines and did NOT beat the rest. ` +
      `The baselines it did not beat are the honest ceiling on what this family shows.`;
  } else {
    conclusion = `NO MEASURED ADVANTAGE over any declared baseline across ${trials.length} trials.`;
  }
  if (falsified.length > 0) {
    conclusion += ` Falsified/closed by controls: ${falsified.join(", ")}.`;
  }

  return {
    manifestId: manifest.id,
    family: manifest.family,
    hypothesis: manifest.hypothesis,
    nullHypothesis: manifest.nullHypothesis,
    informationNote: manifest.informationNote,
    expectedBehaviour: manifest.expectedBehaviour,
    trials: trials.length,
    seeds: manifest.seeds,
    treatment: manifest.treatment,
    comparisons,
    metrics,
    controls,
    controlsHeld,
    conclusion,
  };
}

/** A compact text report. Used by the docs and by a human reading a run. */
export function formatResult(r: BenchmarkResult): string {
  const lines: string[] = [];
  lines.push(`## ${r.manifestId}  (${r.family})`);
  lines.push(`hypothesis      ${r.hypothesis}`);
  lines.push(`null hypothesis ${r.nullHypothesis}`);
  lines.push(`information     ${r.informationNote}`);
  lines.push(`expected        ${r.expectedBehaviour}`);
  lines.push(`trials          ${r.trials} (seeds ${r.seeds.join(", ")})`);
  lines.push("");
  for (const [baseline, s] of Object.entries(r.comparisons)) {
    lines.push(
      `  ${r.treatment} vs ${baseline}: ` +
        `${(s.oqcaAccuracy * 100).toFixed(1)}% [${(s.oqcaInterval[0] * 100).toFixed(0)}–${(s.oqcaInterval[1] * 100).toFixed(0)}] vs ` +
        `${(s.controlAccuracy * 100).toFixed(1)}% [${(s.controlInterval[0] * 100).toFixed(0)}–${(s.controlInterval[1] * 100).toFixed(0)}], ` +
        `discordant ${s.discordantOqcaOnly}/${s.discordantControlOnly}, h=${s.effectSize.toFixed(2)}, p=${s.pValue.toFixed(4)}`,
    );
    lines.push(`      ${s.verdict}`);
  }
  if (r.metrics.length) {
    lines.push("");
    for (const m of r.metrics) {
      const others = Object.entries(m.byBaseline)
        .map(([k, v]) => `${k} ${v.toFixed(4)}`)
        .join(", ");
      lines.push(`  metric ${m.metric}: treatment ${m.treatment.toFixed(4)}; ${others}`);
    }
  }
  lines.push("");
  for (const c of r.controls) {
    const tag = c.expectation === "informational" ? "INFO" : c.survives ? "HELD" : "FELL";
    lines.push(`  [${tag}] ${c.id} (${c.expectation})`);
    lines.push(`      ${c.detail}`);
    if (!c.survives && c.expectation !== "informational") lines.push(`      -> ${c.ifFailed}`);
  }
  lines.push("");
  lines.push(`CONCLUSION: ${r.conclusion}`);
  return lines.join("\n");
}
