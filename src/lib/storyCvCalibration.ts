export type BinaryMetricSummary = {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  fpr: number | null;
  fnr: number | null;
};

export type TemporalMatch = {
  expectedTimestampMs: number;
  observedTimestampMs: number;
  deltaMs: number;
};

export type TemporalMatchResult = {
  tp: number;
  fp: number;
  fn: number;
  matches: TemporalMatch[];
};

function toRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

export function summarizeBinaryMetrics(input: {
  tp: number;
  fp: number;
  fn: number;
  opportunityCount?: number;
}): BinaryMetricSummary {
  const tp = Math.max(0, Math.trunc(input.tp));
  const fp = Math.max(0, Math.trunc(input.fp));
  const fn = Math.max(0, Math.trunc(input.fn));
  const baseOpportunities = Math.max(tp + fp + fn, Math.trunc(input.opportunityCount ?? 0));
  const tn = Math.max(0, baseOpportunities - tp - fp - fn);

  return {
    tp,
    fp,
    fn,
    tn,
    precision: toRate(tp, tp + fp),
    recall: toRate(tp, tp + fn),
    fpr: toRate(fp, fp + tn),
    fnr: toRate(fn, tp + fn),
  };
}

export function matchTemporalEvents(input: {
  expectedTimestampsMs: number[];
  observedTimestampsMs: number[];
  toleranceMs: number;
}): TemporalMatchResult {
  const toleranceMs = Math.max(0, Math.trunc(input.toleranceMs));
  const expected = [...input.expectedTimestampsMs]
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);
  const observed = [...input.observedTimestampsMs]
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .sort((a, b) => a - b);

  const usedExpected = new Set<number>();
  const matches: TemporalMatch[] = [];
  let tp = 0;
  let fp = 0;

  for (const observedTimestampMs of observed) {
    let bestIndex = -1;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (let i = 0; i < expected.length; i += 1) {
      if (usedExpected.has(i)) continue;
      const delta = Math.abs(expected[i] - observedTimestampMs);
      if (delta <= toleranceMs && delta < bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) {
      usedExpected.add(bestIndex);
      tp += 1;
      matches.push({
        expectedTimestampMs: expected[bestIndex],
        observedTimestampMs,
        deltaMs: bestDelta,
      });
    } else {
      fp += 1;
    }
  }

  const fn = Math.max(0, expected.length - usedExpected.size);
  return { tp, fp, fn, matches };
}

export function compareExpectedSignal<T>(input: {
  expected: T | "UNKNOWN";
  observed: T | null | undefined;
  equals?: (a: T, b: T) => boolean;
}): "match" | "mismatch" | "unknown" {
  if (input.expected === "UNKNOWN") return "unknown";
  if (input.observed == null) return "mismatch";
  const equals = input.equals ?? ((a: T, b: T) => a === b);
  return equals(input.expected, input.observed as T) ? "match" : "mismatch";
}
