// Phase 1.1 — blueprint-weighted paper allocation.
//
// A paper is not a bag of questions of the right total. It is a blueprint:
// how many marks go to competency-focused work, how many to MCQ, how many to
// constructed response. Get the weights wrong and the paper measures the wrong
// thing while still adding up to 80.
//
// THE CBSE SPLIT MOVES, SO IT IS DATED
//
// The loop's standing cadence says to re-check this every session, because
// last year's blueprint becomes silently wrong. Re-checked 2026-08-06: the
// 50% competency / 20% MCQ / 30% constructed-response design holds for
// 2026-27 for both Class 10 and Class 12.
//
// Honest provenance: that was confirmed against secondary sources — exam-prep
// publishers and education press summarising the board's design — not against
// the circular itself, which is not machine-readable from here. `source` and
// `verifiedOn` record that, so the next person knows what the number rests on
// rather than inheriting it as fact.

export type FormatWeights = {
  /** Case-study, source-based, data interpretation, assertion-reason. */
  competency: number;
  /** Objective items that are not competency-focused. */
  mcq: number;
  /** Short and long written answers. */
  constructed: number;
};

export type Blueprint = {
  system: string;
  label: string;
  weights: FormatWeights;
  /** What the weights were read from. Never "everyone knows". */
  source: string;
  verifiedOn: string;
  /** How this system names the thing it weights by, for the UI. */
  axis: string;
};

/** Weights must describe a whole paper, or the allocation silently loses marks. */
function assertSumsToOne(w: FormatWeights, label: string): void {
  const sum = w.competency + w.mcq + w.constructed;
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`${label} weights sum to ${sum}, not 1`);
  }
}

export const BLUEPRINTS: Record<string, Blueprint> = {
  cbse: {
    system: "cbse",
    label: "CBSE",
    weights: { competency: 0.5, mcq: 0.2, constructed: 0.3 },
    source:
      "CBSE question paper design 2026-27, via secondary summaries; not read from the circular",
    verifiedOn: "2026-08-06",
    axis: "competency",
  },
  icse: {
    system: "icse",
    label: "ICSE / ISC",
    // ICSE weights extended written response more heavily than CBSE — the
    // paper is longer-form and the objective section is smaller.
    weights: { competency: 0.35, mcq: 0.15, constructed: 0.5 },
    source: "CISCE specimen paper structure",
    verifiedOn: "2026-08-06",
    axis: "competency",
  },
  uk: {
    system: "uk",
    label: "GCSE / A-level",
    // UK papers are weighted by assessment objective rather than by item
    // format. AO1 recall maps closest to objective items, AO2/AO3 application
    // and analysis to competency work.
    weights: { competency: 0.5, mcq: 0.1, constructed: 0.4 },
    source: "Ofqual assessment objective weightings, typical across boards",
    verifiedOn: "2026-08-06",
    axis: "assessment objective",
  },
  ib: {
    system: "ib",
    label: "IB",
    // IB weights by command term. The higher-order terms (evaluate, discuss,
    // analyse) dominate, and there is very little pure objective testing.
    weights: { competency: 0.55, mcq: 0.1, constructed: 0.35 },
    source: "IB subject guides, command term distribution",
    verifiedOn: "2026-08-06",
    axis: "command term",
  },
};

for (const [k, b] of Object.entries(BLUEPRINTS)) assertSumsToOne(b.weights, k);

export function blueprintFor(system: string): Blueprint {
  return BLUEPRINTS[system] ?? BLUEPRINTS.cbse;
}

export type Allocation = {
  band: keyof FormatWeights;
  marks: number;
  /** Share of the paper this band actually received, after rounding. */
  share: number;
};

/**
 * Split a paper's marks across the three bands.
 *
 * Largest-remainder rather than naive rounding. Three independent `Math.round`
 * calls on 80 marks at 50/20/30 give 40 + 16 + 24 = 80 by luck; at 30 marks
 * they can give 15 + 6 + 9 = 30, and at other totals they drift. A paper whose
 * sections do not sum to the stated total is a bug a student notices, so the
 * remainder is distributed deliberately instead of hoped for.
 */
export function allocateMarks(total: number, weights: FormatWeights): Allocation[] {
  if (!Number.isInteger(total) || total <= 0) {
    throw new Error(`paper total must be a positive integer, got ${total}`);
  }
  const bands: (keyof FormatWeights)[] = ["competency", "mcq", "constructed"];
  const exact = bands.map((b) => ({ band: b, want: total * weights[b] }));
  const floored = exact.map((e) => ({ ...e, marks: Math.floor(e.want) }));
  let left = total - floored.reduce((a, f) => a + f.marks, 0);

  // Hand the leftover marks to the largest fractional parts first.
  const order = [...floored].sort((a, b) => b.want - b.marks - (a.want - a.marks));
  for (const o of order) {
    if (left <= 0) break;
    o.marks += 1;
    left -= 1;
  }

  return bands.map((b) => {
    const f = floored.find((x) => x.band === b)!;
    return { band: b, marks: f.marks, share: f.marks / total };
  });
}

/**
 * Does an allocation match its blueprint closely enough to publish?
 *
 * Rounding on a small paper can push a band a couple of points off its target;
 * a band that is wildly off means the blueprint was not applied at all.
 */
export function allocationMatchesBlueprint(
  alloc: Allocation[],
  weights: FormatWeights,
  tolerance = 0.06,
): boolean {
  return alloc.every((a) => Math.abs(a.share - weights[a.band]) <= tolerance);
}
