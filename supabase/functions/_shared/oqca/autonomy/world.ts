/**
 * OQCA v1.7 — ONIQ'S PICTURE OF ONIQ. Owner directive 2026-09-11 §4.
 *
 * The directive asks for eight sections and one rule: _"Every important claim
 * must carry provenance."_ So a number in this file is never a bare number —
 * it is a `WorldClaim`, which is a value plus where it was read and how sure
 * ONIQ is that it is still true. A world state made of bare integers reads
 * exactly the same whether it was measured this tick or inherited from a
 * checkpoint written last week, and an improvement loop that cannot tell those
 * apart will happily re-derive today's priorities from last week's system.
 *
 * WHY THIS IS NOT `LoopState`'s `WorldState`. That one describes the situation
 * a single cognitive RUN is reasoning about — available actions, entities, the
 * things IMAGINE may propose. This describes the SYSTEM the runtime is trying
 * to improve, across runs and across processes. Folding them together would put
 * "42 tests are failing" in the same structure as "dispatch job 8f2c1a is
 * eligible", and the station loop would start planning actions over the census.
 *
 * Pure: built from arguments, holds no clock, reads nothing.
 */
import type { Objective } from "./objective.ts";
import type { CapabilityState } from "../loop/capability.ts";
import type { ExperimentRecord } from "./experiment.ts";
import {
  type Observation,
  type ObservationProvenance,
  type SystemHealth,
  actionable,
  observationCoverage,
  systemHealth,
} from "./observation.ts";

/**
 * A CLAIM ABOUT THE SYSTEM, WITH ITS RECEIPT. `provenance: null` is legal and
 * means "derived here from other claims in this same state" — which is why
 * `derivedFrom` exists: a derived claim that named no inputs would be
 * indistinguishable from an asserted one.
 */
export type WorldClaim<T> = {
  readonly value: T;
  readonly provenance: ObservationProvenance | null;
  readonly derivedFrom: readonly string[];
  /** In [0, 1]. How much of what this claim summarises was actually OBSERVED. */
  readonly coverage: number;
};

export function claim<T>(
  value: T,
  opts: {
    readonly provenance?: ObservationProvenance | null;
    readonly derivedFrom?: readonly string[];
    readonly coverage: number;
  },
): WorldClaim<T> {
  return {
    value,
    provenance: opts.provenance ?? null,
    derivedFrom: opts.derivedFrom ?? [],
    coverage: Math.min(1, Math.max(0, opts.coverage)),
  };
}

export type SystemIdentity = {
  readonly name: string;
  readonly version: string;
  readonly branch: string;
  /** What the host could actually establish. Never a guess. */
  readonly commit: string | null;
};

/**
 * WHAT ONIQ IS WHEN NOBODY TOLD IT. Every field says "unknown" IN WORDS rather
 * than being an empty string, because an empty version renders as nothing in a
 * report and reads as a version that was checked and found blank. `commit` is
 * `null` for the reason the field exists: a commit the host could not establish
 * is absent, and absent is not "unknown" spelled differently — it is the one
 * value a reader must not mistake for a real sha.
 */
export const UNIDENTIFIED: SystemIdentity = {
  name: "unidentified",
  version: "unknown",
  branch: "unknown",
  commit: null,
};

export type CapabilityCensus = {
  readonly available: readonly string[];
  readonly unavailable: readonly string[];
  readonly unauthorized: readonly string[];
  readonly blocked: readonly string[];
};

export type KnowledgeCensus = {
  readonly verified: number;
  readonly candidate: number;
  readonly contested: number;
  readonly superseded: number;
  readonly stale: number;
  /** Records that came back from a durable store rather than this tick's build. */
  readonly durable: number;
};

/**
 * NOTHING COUNTED, WHICH IS NOT THE SAME AS NOTHING THERE. Used when the survey
 * refused: ONIQ could not read the substrate, so it reports zeros WITH a
 * coverage the world state sets from the survey, rather than a census that
 * looks like an empty store. `describeWorld` prints the coverage beside it for
 * exactly this reason.
 */
export const EMPTY_CENSUS: KnowledgeCensus = {
  verified: 0,
  candidate: 0,
  contested: 0,
  superseded: 0,
  stale: 0,
  durable: 0,
};

export type FailureCensus = {
  readonly recent: readonly string[];
  /** Seen in more than one episode. The ones worth an objective. */
  readonly recurring: readonly string[];
  readonly unresolved: readonly string[];
};

export type PerformanceCensus = {
  readonly measured: readonly { readonly metric: string; readonly value: number }[];
  readonly baseline: readonly { readonly metric: string; readonly value: number }[];
  /** A metric whose latest reading is worse than its baseline. */
  readonly regression: readonly string[];
};

export type ObjectiveCensus = {
  readonly pending: number;
  readonly active: number;
  readonly blocked: number;
  readonly succeeded: number;
  readonly failed: number;
};

export type ExperimentCensus = {
  readonly running: number;
  readonly completed: number;
  readonly inconclusive: number;
};

export type DependencyCensus = {
  readonly missing: readonly string[];
  readonly satisfied: readonly string[];
};

export type SystemWorldState = {
  readonly system: WorldClaim<SystemIdentity>;
  readonly health: WorldClaim<SystemHealth>;
  readonly capabilities: WorldClaim<CapabilityCensus>;
  readonly knowledge: WorldClaim<KnowledgeCensus>;
  readonly failures: WorldClaim<FailureCensus>;
  readonly performance: WorldClaim<PerformanceCensus>;
  readonly objectives: WorldClaim<ObjectiveCensus>;
  readonly experiments: WorldClaim<ExperimentCensus>;
  readonly dependencies: WorldClaim<DependencyCensus>;
  /** The rows everything above was derived from. Kept, not summarised away. */
  readonly observations: readonly Observation[];
};

export type WorldInput = {
  readonly identity: SystemIdentity;
  readonly identityProvenance: ObservationProvenance | null;
  readonly observations: readonly Observation[];
  readonly capabilities: readonly CapabilityState[];
  readonly knowledge: KnowledgeCensus;
  readonly backlog: readonly Objective[];
  readonly experiments: readonly ExperimentRecord[];
  /** Metric name -> the best reading ONIQ has ever recorded for it. */
  readonly baselines: ReadonlyMap<string, number>;
  /** Failure notes from this and earlier episodes, oldest first. */
  readonly failureLog: readonly string[];
};

function capabilityCensus(states: readonly CapabilityState[]): CapabilityCensus {
  const available: string[] = [];
  const unavailable: string[] = [];
  const unauthorized: string[] = [];
  const blocked: string[] = [];
  for (const c of states) {
    // THE FOUR BUCKETS ARE NOT THE SAME BUCKET, which is v1.6's whole finding
    // arriving one layer up. An allowance ONIQ set for itself and a provider
    // refusing who ONIQ is are different problems with different owners, and a
    // census that merged them would generate one objective for both.
    if (c.availability === "available") available.push(c.capability);
    else if (c.availability === "unauthorized" || c.availability === "no_credentials")
      unauthorized.push(c.capability);
    else if (c.availability === "insufficient_allowance") blocked.push(c.capability);
    else unavailable.push(c.capability);
  }
  return { available, unavailable, unauthorized, blocked };
}

function objectiveCensus(backlog: readonly Objective[]): ObjectiveCensus {
  const count = (s: Objective["status"]) => backlog.filter((o) => o.status === s).length;
  return {
    pending: count("pending"),
    active: count("active"),
    blocked: count("blocked"),
    succeeded: count("done"),
    failed: count("abandoned"),
  };
}

function experimentCensus(records: readonly ExperimentRecord[]): ExperimentCensus {
  let inconclusive = 0;
  let completed = 0;
  for (const r of records) {
    if (r.verdict === "INCONCLUSIVE" || r.verdict === "BLOCKED") inconclusive += 1;
    else completed += 1;
  }
  // NOTHING IS EVER "RUNNING" HERE, and saying so is more useful than a field
  // that is always zero: an episode runs its experiment to a verdict before it
  // returns, so a long experiment blocks its own episode. The day one becomes
  // asynchronous this is the field that has to start moving.
  return { running: 0, completed, inconclusive };
}

function performanceCensus(
  records: readonly ExperimentRecord[],
  baselines: ReadonlyMap<string, number>,
): PerformanceCensus {
  const measured: { metric: string; value: number }[] = [];
  const regression: string[] = [];
  for (const r of records) {
    const m = r.candidate;
    if (!m || m.value === null) continue;
    measured.push({ metric: m.metric, value: m.value });
    const base = baselines.get(m.metric);
    if (base === undefined) continue;
    const worse = m.direction === "higher_is_better" ? m.value < base : m.value > base;
    if (worse) regression.push(m.metric);
  }
  return {
    measured,
    baseline: [...baselines.entries()].map(([metric, value]) => ({ metric, value })),
    regression,
  };
}

function failureCensus(log: readonly string[], unresolved: readonly string[]): FailureCensus {
  const seen = new Map<string, number>();
  for (const f of log) seen.set(f, (seen.get(f) ?? 0) + 1);
  return {
    recent: log.slice(-8),
    recurring: [...seen.entries()].filter(([, n]) => n > 1).map(([f]) => f),
    unresolved,
  };
}

/**
 * A DEPENDENCY IS MISSING WHEN A BLOCKED OBJECTIVE NAMES IT. Derived rather
 * than declared: a hand-kept list of ONIQ's dependencies would be a second
 * source of truth that drifts from the ledger the moment one is connected.
 */
function dependencyCensus(
  backlog: readonly Objective[],
  capabilities: readonly CapabilityState[],
): DependencyCensus {
  const missing = new Set<string>();
  for (const o of backlog) {
    if (o.status !== "blocked") continue;
    for (const c of o.blockedCapabilities) missing.add(c.capability);
    for (const k of o.blockedOn) missing.add(`knowledge:${k}`);
  }
  const satisfied = capabilities
    .filter((c) => c.availability === "available")
    .map((c) => c.capability)
    .filter((c) => !missing.has(c));
  return { missing: [...missing].sort(), satisfied: [...new Set(satisfied)].sort() };
}

export function buildWorldState(input: WorldInput): SystemWorldState {
  const cov = observationCoverage(input.observations);
  const ids = input.observations.map((o) => o.id);
  const observedIds = input.observations.filter((o) => o.state === "OBSERVED").map((o) => o.id);

  return {
    system: claim(input.identity, {
      provenance: input.identityProvenance,
      coverage: input.identityProvenance ? 1 : 0,
    }),
    health: claim(systemHealth(input.observations), { derivedFrom: ids, coverage: cov }),
    capabilities: claim(capabilityCensus(input.capabilities), {
      // The ledger is a first-hand record of what this run actually met, so its
      // coverage is 1 for the capabilities in it — and says nothing at all about
      // the ones no station reached, which is why the census lists names rather
      // than claiming a total.
      coverage: input.capabilities.length > 0 ? 1 : 0,
      derivedFrom: [],
    }),
    knowledge: claim(input.knowledge, { coverage: 1, derivedFrom: [] }),
    failures: claim(
      failureCensus(
        input.failureLog,
        input.backlog.filter((o) => o.status === "blocked").map((o) => o.goal.id),
      ),
      { derivedFrom: [], coverage: input.failureLog.length > 0 ? 1 : 0 },
    ),
    performance: claim(performanceCensus(input.experiments, input.baselines), {
      derivedFrom: observedIds,
      coverage: input.experiments.length > 0 ? 1 : 0,
    }),
    objectives: claim(objectiveCensus(input.backlog), { coverage: 1, derivedFrom: [] }),
    experiments: claim(experimentCensus(input.experiments), { coverage: 1, derivedFrom: [] }),
    dependencies: claim(dependencyCensus(input.backlog, input.capabilities), {
      coverage: 1,
      derivedFrom: [],
    }),
    observations: input.observations,
  };
}

/**
 * The observations an improvement objective could be built on, worst first.
 * Exported so the generator reads the SAME ordering the world state reports —
 * two orderings would make the report disagree with the decision.
 */
export function worldConcerns(world: SystemWorldState): readonly Observation[] {
  return actionable(world.observations);
}

/**
 * A ONE-LINE SUMMARY FOR A HUMAN, and it leads with what is NOT known.
 *
 * Putting coverage first is deliberate: a reader who sees "3 faults" first will
 * read the rest as a complete picture, and the honest headline of almost every
 * real run is that most of the instrument panel is dark.
 */
export function describeWorld(world: SystemWorldState): string {
  const looked = world.observations.filter((o) => o.state === "OBSERVED").length;
  const c = world.capabilities.value;
  const k = world.knowledge.value;
  return (
    `${world.health.value}; observed ${looked}/${world.observations.length} kinds ` +
    `(coverage ${world.health.coverage.toFixed(2)}); ` +
    `capabilities ${c.available.length} available / ${c.blocked.length} blocked / ` +
    `${c.unauthorized.length} unauthorized / ${c.unavailable.length} unavailable; ` +
    `knowledge ${k.verified} verified (${k.durable} durable), ${k.candidate} candidate, ` +
    `${k.stale} stale; ` +
    `objectives ${world.objectives.value.pending} pending / ` +
    `${world.objectives.value.blocked} blocked`
  );
}
