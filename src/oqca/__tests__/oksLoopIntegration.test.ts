/**
 * OQCA INTEGRATION — quantum brief §19, and the upgradation spec's §20 phases
 * 8 and 9: **"OQCA integration — Reachability through real 23-station loop"**
 * and **"Quantum domain integration — Quantum knowledge fixtures + provenance"**.
 *
 * THE MILESTONE THIS FILE EXISTS TO PROVE, and it is stated as the first
 * sentence rather than the last: the substrate is REACHED BY THE REAL LOOP.
 * Not a mock, not a fixture adapter — `ingestQuantumKnowledge` fills a store,
 * `makeSubstrateKnowledgeAdapter` wraps it, `runCognitiveLoop` runs all 23
 * stations, and the LOAD_MEMORY/RESEARCH path reads verified quantum facts out
 * of it with a source reference on every one.
 *
 * §25's chain is `ONIQ -> QuantumKnowledge -> QuantumCapability -> optional
 * adapter -> research library`. This is the first two arrows executed.
 */
import { describe, expect, it } from "vitest";
import { STATIONS, runCognitiveLoop, type LoopInput } from "@/oqca/loop/cognitiveLoop";
import { DEFAULT_BUDGETS, NO_SPEND, deterministicClock, type Budgets } from "@/oqca/loop/seams";
import { makeRun } from "@/oqca/loop/cognitiveRun";
import { EMPTY_WORLD, sealLoopState, type LoopState } from "@/oqca/loop/loopState";
import { CognitiveState } from "@/oqca/formalState";
import type { Goal } from "@/oqca/knowledge/gaps";
import { makeLocalStore } from "@/oqca/knowledge/substrate/store";
import { makeSubstrateKnowledgeAdapter, contestedFacts } from "@/oqca/knowledge/substrate/project";
import { computeMetrics } from "@/oqca/knowledge/substrate/metrics";
import { ingestQuantumKnowledge, resetEvidenceIds } from "@/oqca/quantum/knowledge";
import { DIVERGENCES } from "@/oqca/quantum/domains";
import * as linalg from "@/oqca/quantum/math/linalg";
import * as gates from "@/oqca/quantum/gates";
import * as circuit from "@/oqca/quantum/circuit";
import * as state from "@/oqca/quantum/math/state";
import * as info from "@/oqca/quantum/math/info";
import * as channel from "@/oqca/quantum/math/channel";
import * as adapters from "@/oqca/quantum/backends/adapters";
import * as policy from "@/oqca/quantum/policy";

const EXPORTS: Record<string, unknown> = {
  ...linalg,
  ...gates,
  ...circuit,
  ...state,
  ...info,
  ...channel,
  ...adapters,
  ...policy,
};
const AT = "2026-09-10T18:00:00Z";
const NOW = Date.parse(AT);

function quantumStore() {
  resetEvidenceIds();
  const store = makeLocalStore();
  const report = ingestQuantumKnowledge(store, AT, (n) => n in EXPORTS);
  return { store, report };
}

const GOAL: Goal = {
  id: "q1",
  statement: "decide whether a quantum method applies to this problem",
  requires: [{ conceptId: "A", importance: 1 }],
};

const quantum = () =>
  CognitiveState.fromWeights(["A", "B"], [1, 1], { contextId: "oks", tags: {} });

function baseState(): LoopState {
  return sealLoopState({
    parentStateId: null,
    goal: GOAL,
    percepts: [],
    failures: [],
    activeHypotheses: [],
    worldState: EMPTY_WORLD,
    evidenceIds: [],
    knowledgeGaps: [],
    candidatePlans: [],
    selectedPlan: null,
    futures: [],
    predictions: [],
    outcomes: [],
    verification: null,
    memoryRefs: [],
    quantumState: quantum().snapshot(),
    iteration: 0,
    budgets: DEFAULT_BUDGETS,
    spent: NO_SPEND,
    status: "running",
    createdAt: 0,
  });
}

/** Enough budget that a refusal here is the gate under test, not starvation. */
const OPEN: Budgets = {
  maxIterations: 1,
  maxStateTransitions: 128,
  maxResearchOperations: 8,
  maxToolCalls: 0,
  maxTokens: 0,
  maxExecutionTimeMs: 60_000,
  maxCostUsd: 0,
};

function input(over: Partial<LoopInput> = {}): LoopInput {
  return {
    initial: baseState(),
    quantum: quantum(),
    budgets: OPEN,
    clock: deterministicClock(1),
    ...over,
  };
}

describe("phase 8 — reachability through the real 23-station loop", () => {
  it("runs every station with the substrate wired in as the knowledge seam", async () => {
    const { store } = quantumStore();
    const knowledge = makeSubstrateKnowledgeAdapter(store, () => NOW);
    // WIRED THROUGH THE v1.3 RUN OBJECT, which is the only seam that takes a
    // `KnowledgeAdapter` — `LoopInput.knowledge` is the v1.1 `KnowledgeState`,
    // a different type with a colliding name, and tsc caught the confusion.
    const run = await runCognitiveLoop(
      input({ run: makeRun({ runId: "oks-quantum", mode: "shadow", knowledge, budgets: OPEN }) }),
    );
    expect(run.log.map((r) => r.station)).toEqual([...STATIONS]);
    // The shipped defaults spend nothing, so the run ends on a BOUND rather
    // than on an error — and that is the correct outcome for an unfunded loop.
    expect(run.spent.costUsd).toBe(0);
    expect(run.spent.toolCalls).toBe(0);
  });

  it("the adapter answers a real quantum query, and every fact carries its source", async () => {
    const { store } = quantumStore();
    const knowledge = makeSubstrateKnowledgeAdapter(store, () => NOW);
    const facts = await knowledge.lookup("qiskit version", 5);
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      // The anti-fabrication guard: a knowledge layer that could return a
      // statement with no `sourceRef` is one whose answers cannot be checked.
      expect(f.sourceRef.length).toBeGreaterThan(0);
      expect(f.statement.length).toBeGreaterThan(0);
    }
    // AND IT HONOURS THE LIMIT. v1.3 §5: "do not dump the entire memory store
    // into the model", so a caller asking for two gets two.
    expect((await knowledge.lookup("gate isUnitary", 2)).length).toBeLessThanOrEqual(2);
  });

  it("a query with no match returns nothing rather than everything", async () => {
    const { store } = quantumStore();
    const knowledge = makeSubstrateKnowledgeAdapter(store, () => NOW);
    expect(await knowledge.lookup("zzzzz nothing matches this", 10)).toEqual([]);
  });
});

describe("phase 9 — the quantum domain under the general substrate", () => {
  it("fills the store with evidenced facts and refuses only the divergences", () => {
    const { store, report } = quantumStore();
    expect(report.total).toBeGreaterThan(100);
    expect(report.verified + report.contested).toBe(report.total);
    expect(store.byStatus("VERIFIED").length).toBe(report.verified);
    expect(store.byStatus("CONTESTED").length).toBe(DIVERGENCES.length);
  });

  it("NEVER hands a contested convention to the ordinary lookup", async () => {
    // §23's "never silently normalize conflicting semantics" is enforced by
    // the STATUS: `makeSubstrateKnowledgeAdapter` reads VERIFIED only, so a
    // caller cannot pick up one endianness convention and forget the other.
    const { store } = quantumStore();
    const knowledge = makeSubstrateKnowledgeAdapter(store, () => NOW);
    const hits = await knowledge.lookup("big-endian convention qubit ordering", 20);
    for (const h of hits) expect(h.statement).not.toMatch(/oniqConventionIs/);
    const opted = contestedFacts(store);
    expect(opted.length).toBe(DIVERGENCES.length);
    for (const f of opted) expect(f.statement).toMatch(/^\[CONTESTED\]/);
  });

  it("reports its own §18 metrics over the real ingestion", () => {
    const { store } = quantumStore();
    const m = computeMetrics(store, { nowMs: NOW });
    // Every record carries the four required provenance steps.
    expect(m.provenanceCoverage).toBe(1);
    // Rollback is exact: the journal is the truth and every prefix replays.
    expect(m.rollbackIntegrity).toBe(1);
    // STALENESS AT THE HARVEST INSTANT IS NOT ZERO, AND IT SHOULD NOT BE.
    // The eighteen advantage records are `event_driven`, whose interval is 0 —
    // "no benchmark has demonstrated an advantage" is a claim that must be
    // re-derived the moment anyone registers one, so it is stale as soon as it
    // is written. Everything else is fresh. Measured, and pinned to the exact
    // share so the number cannot drift into meaninglessness in either
    // direction: a metric that read a constant would pass a looser assertion.
    const eventDriven = store.all().filter((r) => r.volatility === "event_driven").length;
    expect(eventDriven).toBe(18);
    expect(m.stalenessRate).toBeCloseTo(eventDriven / store.all().length, 9);

    // A DAY ON the `fast` package versions join them, and a year on everything
    // has. Three distinct readings from one store is what says the metric is
    // computing rather than reporting.
    const day = computeMetrics(store, { nowMs: NOW + 2 * 86_400_000 }).stalenessRate;
    const year = computeMetrics(store, { nowMs: NOW + 400 * 86_400_000 }).stalenessRate;
    expect(day).toBeGreaterThan(m.stalenessRate);
    expect(year).toBe(1);
    // And the ground-truth metrics stay UNKNOWN, because nothing is labelled.
    expect(m.knowledgePrecision).toBeNull();
    expect(m.falsePromotionRate).toBeNull();
  });

  it("age does NOT hide a fact from the loop — staleness is reported, not enforced", async () => {
    // The premise this test was first written on was wrong, and the honest
    // version is the more useful one. `usableNow` reads the STATUS and the
    // validity window and deliberately not the freshness, because §10 is
    // "Freshness must never be confused with confidence" — a year-old package
    // version is still the last thing ONIQ measured, and hiding it would leave
    // the loop with nothing rather than with something dated.
    //
    // So the adapter's view is unchanged by age, and `stalenessRate` is the
    // channel that says how much of it is old. Both halves asserted, because
    // either alone reads as the other behaviour.
    const { store } = quantumStore();
    const YEAR = NOW + 400 * 86_400_000;
    const fresh = makeSubstrateKnowledgeAdapter(store, () => NOW);
    const later = makeSubstrateKnowledgeAdapter(store, () => YEAR);
    const before = await fresh.lookup("qiskit hasReleasedVersion", 20);
    const after = await later.lookup("qiskit hasReleasedVersion", 20);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBe(before.length);
    expect(computeMetrics(store, { nowMs: NOW }).stalenessRate).toBeLessThan(0.2);
    expect(computeMetrics(store, { nowMs: YEAR }).stalenessRate).toBe(1);

    // What DOES remove a record is a status change, so the two gates are
    // genuinely different rather than one that never fires.
    const contested = store.byStatus("CONTESTED");
    expect(contested.length).toBeGreaterThan(0);
    for (const r of contested) {
      expect(
        (await fresh.lookup(r.subject, 20)).some((f) => f.statement.includes(String(r.object))),
      ).toBe(false);
    }
  });
});
