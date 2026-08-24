// videoBenchmark — everything the first real Lite-vs-Fast benchmark needs,
// built to cost nothing until someone with authority says go.
//
// WHAT THIS IS NOT. It is not a benchmark result, it does not contain an
// acceptance rate, and nothing in it is evidence about video quality. Every
// acceptance field starts null and only a real, scored, unblinded run may fill
// one in. If you are reading this looking for "how good is Lite" — the answer
// is still NOT MEASURED.
//
// WHY BLINDING IS INFRASTRUCTURE AND NOT A HABIT. The previous benchmark was
// discarded because the evaluator could see which tier produced which clip, and
// the inputs were character-design sheets chosen because they looked good. Both
// faults are unfixable after the fact — you cannot un-see a label, and you
// cannot un-bias a sample. So the blinding has to be built into the plan the
// run is generated FROM, not applied to the results afterwards.
//
// PURE. No sockets, no secrets, no randomness that is not seeded. A plan built
// twice from the same inputs is byte-identical, which is what makes a frozen
// manifest meaningful.

import type { AudioMode, ProviderSurface } from "./videoAudio.ts";

// ------------------------------------------------------------------- status
/**
 * How close the benchmark is to being runnable. Deliberately NOT a boolean:
 * "not ready" and "ready but unauthorised" need different actions from
 * different people.
 */
export type BenchmarkStatus =
  /** Static prerequisites are incomplete. An engineer's problem. */
  | "NOT_READY"
  /** Everything ONIQ controls is done. Waiting on credentials. */
  | "READY_FOR_CREDENTIALS"
  /** Credentials exist and VIDEO is enabled. Waiting on a human to say go. */
  | "READY_FOR_CONTROLLED_PROBE"
  /** A real run happened and produced scored, unblinded evidence. */
  | "LIVE_EVIDENCE_COLLECTED";

// ------------------------------------------------------------------- corpus
/**
 * ONE benchmark input.
 *
 * `remotion/public/sheets/cut/*.png` MUST NOT be used. Those are
 * character-design sheets: they were authored to look good, they have already
 * been evaluated, and several were hand-picked for earlier demos. Using them
 * measures how flattering the input was, not how capable the model is. They are
 * left in the repository because they are legitimate production assets — they
 * are simply not evidence.
 */
export type CorpusSample = {
  /** Stable identity of the INPUT. Never shown to an evaluator. */
  sourceId: string;
  /** Which of the repository's seven motion classes this exercises. */
  motionClass: MotionClass;
  /** Prompt text. Identical across every tier — that is the whole comparison. */
  prompt: string;
  /** Content hash of the starting frame, so a swapped input is detectable. */
  startFrameSha256: string;
  /** Seconds requested. Identical across tiers. */
  seconds: number;
};

/**
 * The repository's seven motion classes, from `src/lib/motionProvider.ts`.
 * Mirrored (not redefined) so the benchmark cannot quietly invent its own set.
 */
export type MotionClass =
  "STATIC" | "CAMERA_ONLY" | "CHARACTER_MOTION" | "WALKING" | "TALKING" | "GESTURE" | "INTERACTION";

export const MOTION_CLASSES: readonly MotionClass[] = [
  "STATIC",
  "CAMERA_ONLY",
  "CHARACTER_MOTION",
  "WALKING",
  "TALKING",
  "GESTURE",
  "INTERACTION",
] as const;

/** Classes that cannot be answered by a still and therefore need a clip. */
export const GENERATIVE_MOTION_CLASSES: readonly MotionClass[] = MOTION_CLASSES.filter(
  (c) => c !== "STATIC" && c !== "CAMERA_ONLY",
);

export type CorpusManifest = {
  manifestVersion: string;
  /** Frozen manifests cannot be edited; a change means a new version. */
  frozen: boolean;
  createdAt: string;
  samples: CorpusSample[];
};

/** Why a corpus is not usable as benchmark evidence. */
export type CorpusProblem =
  | "EMPTY"
  | "NOT_FROZEN"
  | "DUPLICATE_SOURCE_ID"
  | "CONTAMINATED_SOURCE"
  | "MISSING_HASH"
  | "INCONSISTENT_SECONDS"
  | "NO_GENERATIVE_CLASS";

/** Inputs whose provenance disqualifies them. Substring match, case-folded. */
export const CONTAMINATED_SOURCE_PATTERNS: readonly string[] = [
  "sheets/cut/",
  "character-sheet",
  "charactersheet",
] as const;

export function validateCorpus(m: CorpusManifest | null): {
  valid: boolean;
  problems: CorpusProblem[];
} {
  const problems: CorpusProblem[] = [];
  if (!m || m.samples.length === 0) return { valid: false, problems: ["EMPTY"] };
  if (!m.frozen) problems.push("NOT_FROZEN");

  const seen = new Set<string>();
  for (const s of m.samples) {
    if (seen.has(s.sourceId)) problems.push("DUPLICATE_SOURCE_ID");
    seen.add(s.sourceId);
    const hay = s.sourceId.toLowerCase();
    if (CONTAMINATED_SOURCE_PATTERNS.some((p) => hay.includes(p))) {
      problems.push("CONTAMINATED_SOURCE");
    }
    if (!/^[0-9a-f]{64}$/.test(s.startFrameSha256)) problems.push("MISSING_HASH");
  }

  // Every tier must be asked for the same duration, or the cost comparison is
  // between different products.
  if (new Set(m.samples.map((s) => s.seconds)).size > 1) problems.push("INCONSISTENT_SECONDS");
  if (!m.samples.some((s) => GENERATIVE_MOTION_CLASSES.includes(s.motionClass))) {
    problems.push("NO_GENERATIVE_CLASS");
  }

  const uniq = [...new Set(problems)];
  return { valid: uniq.length === 0, problems: uniq };
}

// ------------------------------------------------------------------- matrix
/**
 * The four cells worth comparing. Prices are NOT restated here — they live in
 * `videoRouting.VIDEO_RATES` and are looked up, so a rate correction cannot
 * leave a stale copy behind in the benchmark.
 */
export type BenchmarkCell = {
  cellId: string;
  surface: ProviderSurface;
  model: string;
  tier: "LITE" | "FAST";
  audioMode: AudioMode;
};

export const BENCHMARK_MATRIX: readonly BenchmarkCell[] = [
  {
    cellId: "ai-studio-lite",
    surface: "google-ai-studio",
    model: "veo-3.1-lite-generate-preview",
    tier: "LITE",
    // The Developer API cannot be asked to skip audio, so the honest label for
    // what is being bought here is the with-audio product.
    audioMode: "VEO_NATIVE_AUDIO",
  },
  {
    cellId: "ai-studio-fast",
    surface: "google-ai-studio",
    model: "veo-3.1-fast-generate-preview",
    tier: "FAST",
    audioMode: "VEO_NATIVE_AUDIO",
  },
  {
    cellId: "agent-platform-lite-video-only",
    surface: "google-agent-platform",
    model: "veo-3.1-lite",
    tier: "LITE",
    audioMode: "VIDEO_ONLY",
  },
  {
    cellId: "agent-platform-fast-video-only",
    surface: "google-agent-platform",
    model: "veo-3.1-fast",
    tier: "FAST",
    audioMode: "VIDEO_ONLY",
  },
] as const;

// ------------------------------------------------------------------ blinding
/**
 * The evaluator sees this and nothing else.
 *
 * Never a surface, a tier, a model, a price, or an ordinal that correlates with
 * any of them. `B007` must be as uninformative as it looks.
 */
export type BlindLabel = string;

export function blindLabel(n: number): BlindLabel {
  return `B${String(n + 1).padStart(3, "0")}`;
}

/** Terms that would unblind an evaluator if they leaked into what they see. */
export const UNBLINDING_TERMS: readonly string[] = [
  "gemini",
  "veo",
  "agent-platform",
  "agent platform",
  "ai-studio",
  "ai studio",
  "lite",
  "fast",
  "google",
  "vertex",
  "usd",
  "$",
  "price",
  "cost",
  "tier",
  "surface",
] as const;

/** True if a string would tell the evaluator something it must not. */
export function leaksBlinding(text: string): boolean {
  const t = text.toLowerCase();
  return UNBLINDING_TERMS.some((term) => t.includes(term));
}

export type BlindAssignment = {
  label: BlindLabel;
  /** Hidden until scoring is frozen. */
  cellId: string;
  sourceId: string;
  motionClass: MotionClass;
  seconds: number;
};

export type BlindPlan = {
  planId: string;
  manifestVersion: string;
  /** Presentation order. Shuffled, so tier never correlates with position. */
  order: BlindLabel[];
  /** The mapping. Kept SEPARATE from what the evaluator is handed. */
  assignments: BlindAssignment[];
  totalGenerations: number;
};

/**
 * Deterministic shuffle — a seeded LCG, not Math.random().
 *
 * Determinism is not a nicety here. A plan that cannot be regenerated cannot be
 * audited, and a benchmark nobody can re-derive is one more thing to take on
 * trust.
 */
function seededShuffle<T>(items: T[], seed: number): T[] {
  // The seed is AVALANCHED (splitmix32 finalizer) rather than fed to a bare
  // LCG. A plain LCG advanced from a raw seed moves its low bits very little
  // over the first few steps, and `next() % (i+1)` reads exactly those low bits
  // — so over a short plan, nearby seeds correlate. Re-seeding has to actually
  // re-randomise, or "we re-ran it with a different seed" means nothing.
  let s = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = z ^ (z >>> 15);
    return z >>> 0;
  };

  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Every sample through every cell, labelled opaquely and presented in an order
 * that carries no information.
 */
export function buildBlindPlan(
  manifest: CorpusManifest,
  cells: readonly BenchmarkCell[],
  seed: number,
  planId = "plan-1",
): BlindPlan {
  const raw: Omit<BlindAssignment, "label">[] = [];
  for (const cell of cells) {
    for (const sample of manifest.samples) {
      raw.push({
        cellId: cell.cellId,
        sourceId: sample.sourceId,
        motionClass: sample.motionClass,
        seconds: sample.seconds,
      });
    }
  }
  // Shuffle FIRST, then label. Labelling first would make B001..B00n a
  // contiguous run of one cell, which is a label with the answer written on it.
  const shuffled = seededShuffle(raw, seed);
  const assignments = shuffled.map((a, i) => ({ label: blindLabel(i), ...a }));
  return {
    planId,
    manifestVersion: manifest.manifestVersion,
    order: assignments.map((a) => a.label),
    assignments,
    totalGenerations: assignments.length,
  };
}

/** What the evaluator is handed. Carries no cell, no tier, no price. */
export function evaluatorView(plan: BlindPlan): Array<{ label: BlindLabel; seconds: number }> {
  return plan.order.map((label) => {
    const a = plan.assignments.find((x) => x.label === label)!;
    return { label: a.label, seconds: a.seconds };
  });
}

// ---------------------------------------------------------------- acceptance
/**
 * One scored sample. `accepted` is a judgement a human made about a clip that
 * actually exists; there is no way to compute it and no default for it.
 */
export type AcceptanceRecord = {
  sampleId: BlindLabel;
  motionClass: MotionClass;
  accepted: boolean;
  /** Required whenever `accepted` is false. Never invented. */
  rejectionReason: string | null;
  evaluationVersion: string;
  evaluator: string;
  timestamp: string;
};

export type AcceptanceProblem =
  | "UNKNOWN_LABEL"
  | "MISSING_REJECTION_REASON"
  | "REJECTION_REASON_ON_ACCEPTED"
  | "DUPLICATE_SCORE"
  | "INCOMPLETE_COVERAGE"
  | "MISSING_EVALUATION_VERSION"
  | "MISSING_EVALUATOR";

/**
 * A scoring set is only usable if it covers the whole plan.
 *
 * Partial coverage is how a benchmark accidentally reports the samples someone
 * felt like scoring — which skews toward the memorable ones, in either
 * direction.
 */
export function validateAcceptance(
  plan: BlindPlan,
  records: AcceptanceRecord[],
): { valid: boolean; problems: AcceptanceProblem[] } {
  const problems: AcceptanceProblem[] = [];
  const known = new Set(plan.order);
  const seen = new Set<string>();

  for (const r of records) {
    if (!known.has(r.sampleId)) problems.push("UNKNOWN_LABEL");
    if (seen.has(r.sampleId)) problems.push("DUPLICATE_SCORE");
    seen.add(r.sampleId);
    if (!r.accepted && !r.rejectionReason) problems.push("MISSING_REJECTION_REASON");
    if (r.accepted && r.rejectionReason) problems.push("REJECTION_REASON_ON_ACCEPTED");
    if (!r.evaluationVersion) problems.push("MISSING_EVALUATION_VERSION");
    if (!r.evaluator) problems.push("MISSING_EVALUATOR");
  }
  if (seen.size !== plan.order.length) problems.push("INCOMPLETE_COVERAGE");

  const uniq = [...new Set(problems)];
  return { valid: uniq.length === 0, problems: uniq };
}

/**
 * Unblind — ONLY after scoring is complete and validated.
 *
 * Refuses on an invalid scoring set rather than returning a partial answer,
 * because a partially-unblinded benchmark is the one that gets quoted.
 */
export function unblind(
  plan: BlindPlan,
  records: AcceptanceRecord[],
):
  | { ok: false; problems: AcceptanceProblem[] }
  | {
      ok: true;
      byCell: Record<
        string,
        {
          motionClass: MotionClass;
          accepted: number;
          total: number;
        }[]
      >;
    } {
  const check = validateAcceptance(plan, records);
  if (!check.valid) return { ok: false, problems: check.problems };

  const byCell: Record<string, { motionClass: MotionClass; accepted: number; total: number }[]> =
    {};
  for (const r of records) {
    const a = plan.assignments.find((x) => x.label === r.sampleId)!;
    const rows = (byCell[a.cellId] ??= []);
    let row = rows.find((x) => x.motionClass === a.motionClass);
    if (!row) {
      row = { motionClass: a.motionClass, accepted: 0, total: 0 };
      rows.push(row);
    }
    row.total += 1;
    if (r.accepted) row.accepted += 1;
  }
  return { ok: true, byCell };
}

// ------------------------------------------------------------ probe preflight
/**
 * THE GATE THAT PROTECTS THE FIRST PAID PROBE.
 *
 * Every condition must hold. This is deliberately an AND with no override: the
 * first real benchmark is the moment ONIQ starts spending on video, and the
 * cheapest possible time to discover a missing precondition is before the
 * request leaves.
 *
 * Note what is NOT here: "the caps are configured" does not imply permission,
 * and neither does "the credentials exist". `generationAllowed` is a separate
 * owner decision and it is listed separately on purpose.
 */
export type ProbePreconditions = {
  credentialsPresent: boolean;
  providerConfigured: boolean;
  /** provider_budget_status(...).generationAllowed — the owner's switch. */
  generationAllowed: boolean;
  spendCapsConfigured: boolean;
  jobBudgetAvailable: boolean;
  dailyBudgetAvailable: boolean;
  attemptAvailable: boolean;
  manifestFrozen: boolean;
  evaluationVersionFrozen: boolean;
};

export type ProbeVerdict =
  { allowed: true } | { allowed: false; verdict: "NO_PROVIDER_CALL"; blockers: string[] };

export function firstProbePreflight(p: Partial<ProbePreconditions>): ProbeVerdict {
  const required: Array<[keyof ProbePreconditions, string]> = [
    ["credentialsPresent", "provider credentials absent"],
    ["providerConfigured", "provider configuration incomplete"],
    ["generationAllowed", "generation_allowed is false — owner has not authorised generation"],
    ["spendCapsConfigured", "VIDEO spend caps not configured"],
    ["jobBudgetAvailable", "job budget exhausted or unknown"],
    ["dailyBudgetAvailable", "daily budget exhausted or unknown"],
    ["attemptAvailable", "attempt ceiling reached"],
    ["manifestFrozen", "benchmark corpus manifest is not frozen"],
    ["evaluationVersionFrozen", "evaluation version is not frozen"],
  ];
  // An ABSENT precondition counts as unmet. Omission is not permission — the
  // same rule chooseTier() applies to its routing gate.
  const blockers = required.filter(([k]) => p[k] !== true).map(([, why]) => why);
  return blockers.length === 0
    ? { allowed: true }
    : { allowed: false, verdict: "NO_PROVIDER_CALL", blockers };
}

/**
 * Overall benchmark readiness. Reports the WEAKEST link rather than an
 * average, because a benchmark is not partly runnable.
 */
export function benchmarkStatus(p: Partial<ProbePreconditions>): BenchmarkStatus {
  const staticReady = p.manifestFrozen === true && p.evaluationVersionFrozen === true;
  if (!staticReady) return "NOT_READY";
  if (p.credentialsPresent !== true || p.providerConfigured !== true) {
    return "READY_FOR_CREDENTIALS";
  }
  if (p.generationAllowed !== true) return "READY_FOR_CREDENTIALS";
  return "READY_FOR_CONTROLLED_PROBE";
}
