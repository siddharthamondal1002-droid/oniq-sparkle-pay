/**
 * v1.4-R — REACHABLE KNOWLEDGE. Items A through H.
 *
 * THE MILESTONE THIS FILE EXISTS TO PIN is not "a substrate exists". It is that
 * SHIPPED ONIQ CODE reads it: the mirrored kernel, built into the runtime the
 * scheduled dispatcher calls, answering a real query with a real fact and
 * closing a real gap. Every earlier version of that sentence was true of a test
 * and false of anything ONIQ deploys, which is this repo's most-recorded
 * failure and would have been its fifth at the largest scale yet.
 *
 * THE ASSERTIONS ARE SPLIT THE WAY THE EVIDENCE IS. Behaviour is exercised
 * against the real modules; the two things a behavioural test cannot see — that
 * a belief never reaches an authorization site, and that the runtime opens no
 * network — are read from source with COMMENTS STRIPPED, because every one of
 * those comments quotes the thing it is avoiding. That is the twelfth prose
 * match in this repo and it is structural: a good comment names its subject.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "@/test/sourceText";

import {
  CODEBASE_SOURCE,
  ENFORCED_BACKOFF_BELIEF,
  INGEST_BUDGET_MS,
  buildSubstrate,
  dispatchRuleRecords,
  eligibilityProbe,
  runtimeSourceRegistry,
  substrateGap,
  type BackoffBelief,
} from "../../../supabase/functions/_shared/oqcaRuntime/substrate.ts";
import {
  believedBackoff,
  runShadow,
} from "../../../supabase/functions/_shared/oqcaRuntime/shadow.ts";
import {
  DISPATCH_BACKOFF_MS,
  DISPATCH_GOAL,
  isDispatchable,
  productionChoice,
  worldFrom,
  type DispatchEnvironment,
  type QueuedJob,
} from "../../../supabase/functions/_shared/oqcaRuntime/dispatchJob.ts";

import { experimentFacts, discoveryFacts } from "../quantum/knowledge.ts";
import {
  CONVENTION_EXPERIMENTS,
  QUBIT_ORDER_EXPERIMENT,
  runConventionExperiment,
  soleOutcome,
} from "../quantum/conventions.ts";
import { makeStatevectorBackend } from "../quantum/backends/statevector.ts";
import type { QuantumBackend } from "../quantum/backends/backend.ts";
import { DEFAULT_QUANTUM_POLICY } from "../quantum/policy.ts";
import { discoverAll } from "../quantum/discovery.ts";
import {
  DIRECTNESS,
  DIRECTNESS_WEIGHT,
  EXTRACTION_WEIGHT,
} from "../knowledge/substrate/evidence.ts";
import {
  RESOLUTION_STRATEGIES,
  applyResolution,
  detectConflicts,
  hasExperimentalSupport,
  hasMeasuredSupport,
  resolveConflict,
} from "../knowledge/substrate/conflict.ts";
import { dependentsOf } from "../knowledge/substrate/store.ts";
import { toKnowledgeState } from "../knowledge/substrate/project.ts";
import { detectGaps } from "../knowledge/gaps.ts";
import { computeMetrics } from "../knowledge/substrate/metrics.ts";
import { DEFAULT_BUDGETS } from "../loop/seams.ts";

const RUNTIME = "supabase/functions/_shared/oqcaRuntime";
const T0 = Date.parse("2026-09-10T12:00:00Z");
const AT = new Date(T0).toISOString();

const code = (p: string) => stripComments(readFileSync(p, "utf8"));

/**
 * What a read-only, zero-spend module may not name. Matches the CLIENT and the
 * call SHAPE rather than the vendor's name — see the narrowing test below.
 */
const BANNED_IN_SUBSTRATE: readonly RegExp[] = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /EventSource/,
  /createClient/,
  /supabase-js/,
  /\.\s*from\s*\(\s*["'`]/,
  /\.\s*rpc\s*\(/,
  /\bDeno\s*[.[]/,
  /process\s*\.\s*env/,
  /SERVICE_ROLE/,
  /\bapi[_-]?key\b/i,
  /https?:\/\//,
];
const build = () => buildSubstrate({ at: AT, nowMs: T0 });

/* ------------------------------------------------------------------ *
 * ITEM E — a convention settled by experiment.
 * ------------------------------------------------------------------ */

describe("item E — the second route to knowledge is an experiment, not a document", () => {
  it("adds exactly one rung, and it is capped at 1 like `fetched`", () => {
    expect(DIRECTNESS).toContain("experimentally_verified");
    expect(DIRECTNESS_WEIGHT.experimentally_verified).toBe(1);
    // The scale is [0,1] by construction and `promotion.ts` sets its threshold
    // from that arithmetic. A rung above 1 would silently rewrite the table.
    for (const d of DIRECTNESS) {
      expect(DIRECTNESS_WEIGHT[d]).toBeGreaterThanOrEqual(0);
      expect(DIRECTNESS_WEIGHT[d]).toBeLessThanOrEqual(1);
    }
  });

  it("refuses the two proposed rungs that already exist on another axis", () => {
    // EXTRACTED is `ExtractionMethod` — how the claim came OUT of the artefact,
    // orthogonal to how far the artefact is from an observation.
    expect(DIRECTNESS).not.toContain("extracted");
    expect(Object.keys(EXTRACTION_WEIGHT).length).toBeGreaterThan(0);
    // CROSS_VERIFIED is a property of the RECORD (independent sources agreeing),
    // carried by `minIndependentSources` and the additive score. As a directness
    // it would let ONE item claim corroboration it cannot have.
    expect(DIRECTNESS).not.toContain("cross_verified");
  });

  it("discriminates: the two conventions predict different bitstrings", () => {
    const p = QUBIT_ORDER_EXPERIMENT.predictions;
    expect(Object.keys(p).sort()).toEqual(["big_endian", "little_endian"]);
    expect(p.big_endian).not.toBe(p.little_endian);
    // And the CONTROL's predictions are the mirror image, so a backend that
    // answers the same whichever qubit moved settles nothing.
    const c = QUBIT_ORDER_EXPERIMENT.controlPredictions;
    expect(c.big_endian).toBe(p.little_endian);
    expect(c.little_endian).toBe(p.big_endian);
  });

  it("runs, and ONIQ's own backend comes back big-endian", () => {
    const o = runConventionExperiment(QUBIT_ORDER_EXPERIMENT, makeStatevectorBackend());
    expect(o.convention).toBe("big_endian");
    expect(o.observed).toBe("01");
    expect(o.controlObserved).toBe("10");
    expect(o.discriminated).toBe(true);
    expect(o.detail).toMatch(/512 shots at seed 7/);
  });

  it("is deterministic — the same seed gives the same counts", () => {
    const be = makeStatevectorBackend();
    const a = runConventionExperiment(QUBIT_ORDER_EXPERIMENT, be);
    const b = runConventionExperiment(QUBIT_ORDER_EXPERIMENT, be);
    expect(a).toEqual(b);
  });

  it("VOIDS the outcome when the control fails to discriminate", () => {
    // A backend that answers "01" to everything matches the big-endian
    // prediction perfectly and proves nothing. Without the control check this
    // is the shape that would have produced a confident wrong record.
    const constant: QuantumBackend = {
      ...makeStatevectorBackend(),
      simulate: () => ({ ok: true, value: { "01": 512 } }),
    };
    const o = runConventionExperiment(QUBIT_ORDER_EXPERIMENT, constant);
    expect(o.convention).toBeNull();
    expect(o.discriminated).toBe(false);
    expect(o.detail).toMatch(/same bitstring/);
  });

  it("VOIDS an outcome no pre-registered convention predicts", () => {
    let call = 0;
    const counts: Record<string, number>[] = [{ "11": 512 }, { "00": 512 }];
    const odd: QuantumBackend = {
      ...makeStatevectorBackend(),
      simulate: () => ({ ok: true, value: counts[Math.min(call++, 1)] }),
    };
    const o = runConventionExperiment(QUBIT_ORDER_EXPERIMENT, odd);
    expect(o.convention).toBeNull();
    // Discriminated (the two differed) and still refused: an outcome outside
    // the pre-registered set is a refusal, never a new entry.
    expect(o.discriminated).toBe(true);
    expect(o.detail).toMatch(/matches 0 of the pre-registered/);
  });

  it("VOIDS a non-unanimous outcome from a deterministic circuit", () => {
    const noisy: QuantumBackend = {
      ...makeStatevectorBackend(),
      simulate: () => ({ ok: true, value: { "01": 300, "10": 212 } }),
    };
    const o = runConventionExperiment(QUBIT_ORDER_EXPERIMENT, noisy);
    expect(o.convention).toBeNull();
    expect(soleOutcome({ "01": 300, "10": 212 })).toBeNull();
    expect(soleOutcome({ "01": 512, "10": 0 })).toBe("01");
  });

  it("records a fact only when the experiment discriminated", () => {
    const good = experimentFacts(AT, makeStatevectorBackend());
    expect(good.length).toBe(CONVENTION_EXPERIMENTS.length);
    expect(good[0].subject).toBe("oniq:statevector-backend");
    expect(good[0].predicate).toBe("qubit_orderIs");
    expect(good[0].object).toBe("big_endian");
    expect(good[0].evidence[0].directness).toBe("experimentally_verified");
    expect(good[0].evidence[0].sourceType).toBe("measurement");
    // A void run writes NOTHING — a fabricated negative result is what v1.3 §12
    // forbids, and "the experiment was inconclusive" is not a fact about the
    // convention.
    const refusing: QuantumBackend = {
      ...makeStatevectorBackend(),
      simulate: () => ({ ok: false, reason: "adapter_unavailable", detail: "refused" }),
    };
    expect(experimentFacts(AT, refusing)).toEqual([]);
  });

  it("lets a measurement of a system outrank a document about it", () => {
    expect(RESOLUTION_STRATEGIES).toContain("experimental_precedence");
    expect(RESOLUTION_STRATEGIES).toContain("measured_precedence");
    const sources = runtimeSourceRegistry();
    const measured = dispatchRuleRecords(AT, ENFORCED_BACKOFF_BELIEF, T0)[0];
    const documented = dispatchRuleRecords(AT, STALE, T0)[0];
    expect(hasMeasuredSupport(measured)).toBe(true);
    expect(hasMeasuredSupport(documented)).toBe(false);
    expect(hasExperimentalSupport(measured)).toBe(false);
    const c = resolveConflict([documented, measured], { sources, nowMs: T0 });
    expect(c.strategy).toBe("measured_precedence");
    expect(c.canonical).toBe(measured.id);
  });

  it("never lets precedence overrule a divergence that is correct on both sides", () => {
    // §23: "never silently normalize conflicting semantics." `divergent_by_design`
    // is answered ABOVE both precedence rules, so an experiment on ONIQ's own
    // backend can never delete Qiskit's convention.
    const sources = runtimeSourceRegistry();
    const measured = dispatchRuleRecords(AT, ENFORCED_BACKOFF_BELIEF, T0)[0];
    const documented = dispatchRuleRecords(AT, STALE, T0)[0];
    const c = resolveConflict(
      [documented, measured],
      { sources, nowMs: T0 },
      "divergent_by_design",
    );
    expect(c.canonical).toBeNull();
    expect(c.strategy).toBe("escalate");
    expect(c.escalated).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * ITEM B — the substrate on the shipped read path.
 * ------------------------------------------------------------------ */

const STALE: BackoffBelief = {
  windowMs: 60 * 60_000,
  evidence: [
    {
      sourceId: CODEBASE_SOURCE.id,
      sourceType: "release_notes",
      locator: "docs/oqca/knowledge-upgrade#stale-release-note-a",
      excerpt: "the dispatcher waits an hour before offering the same film again",
      directness: "fetched",
      extraction: "human_authored",
    },
    {
      sourceId: CODEBASE_SOURCE.id,
      sourceType: "repository_readme",
      locator: "docs/oqca/knowledge-upgrade#stale-release-note-b",
      excerpt: "backoff: 60 minutes between dispatches of one job",
      directness: "fetched",
      extraction: "human_authored",
    },
  ],
};

describe("item B — the runtime reads the substrate, and spends nothing to do it", () => {
  it("builds a store, an adapter and a projected graph in one call", async () => {
    const b = build();
    expect(b.store.all().length).toBeGreaterThan(100);
    expect(b.quantum.total).toBeGreaterThan(100);
    expect(b.dispatchRecords).toBeGreaterThan(0);
    expect(b.state.concepts.size).toBeGreaterThan(0);
    expect(b.state.relations.size).toBeGreaterThan(0);
    const hits = await b.knowledge.lookup(DISPATCH_GOAL.statement, 8);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.sourceRef).not.toBe("");
  });

  it("promotes every record through the policy — nothing writes a status", () => {
    // `evaluatePromotion` is the ONLY path to belief. A literal status in this
    // module would make §21's "do not promote a claim without provenance"
    // unenforceable, exactly as `record.ts` says of `draftRecord`.
    const src = code(`${RUNTIME}/substrate.ts`);
    expect(src).toMatch(/evaluatePromotion/);
    expect(src).not.toMatch(/status:\s*"VERIFIED"/);
    expect(src).not.toMatch(/status:\s*"CONTESTED"/);
  });

  it("opens no network, holds no credential and queries no database", () => {
    const src = code(`${RUNTIME}/substrate.ts`);
    for (const banned of BANNED_IN_SUBSTRATE) {
      expect(banned.test(src), `substrate.ts names ${banned}`).toBe(false);
    }
  });

  it("and the ban is narrowed for a real collision, proven in both directions", () => {
    // A BARE `/supabase/i` FLAGGED THIS FILE, and it was right to: the record's
    // PROVENANCE names its own agent, `supabase/functions/_shared/oqcaRuntime/
    // substrate.ts`, which is a path in a string and not a database client.
    // `stripComments` cannot help — strings are KEPT on purpose, because a
    // masked one hid a real fetch in the health red team. So the ban matches
    // the CLIENT rather than the word, and the narrowing is proven here rather
    // than taken on trust: every shape it exists to catch still trips it.
    for (const real of [
      "const c = createClient(url, key);",
      'import { createClient } from "https://esm.sh/@supabase/supabase-js@2";',
      'await client.from("health_records").select("*");',
      'await client.rpc("health_ai_reserve_request", {});',
      'const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");',
      "await fetch(target);",
    ]) {
      expect(
        BANNED_IN_SUBSTRATE.some((b) => b.test(real)),
        `narrowed past a real one: ${real}`,
      ).toBe(true);
    }
    // And the collision itself does NOT trip it.
    const agent = 'agent: "supabase/functions/_shared/oqcaRuntime/substrate.ts",';
    expect(BANNED_IN_SUBSTRATE.some((b) => b.test(agent))).toBe(false);
  });

  it("labels a paraphrase as one, and the gate refuses it", () => {
    const recs = dispatchRuleRecords(AT, ENFORCED_BACKOFF_BELIEF, T0);
    const sources = runtimeSourceRegistry();
    const b = build();
    const stored = new Map(b.store.all().map((r) => [r.id, r]));

    const paraphrases = recs.filter((r) =>
      r.evidence.every((e) => e.directness === "spec_cited" && e.extraction === "human_authored"),
    );
    expect(paraphrases.length).toBe(3);
    for (const p of paraphrases) {
      // 0.5 x 0.8 x 1.0 = 0.400 -> 0.286, below the 0.45 threshold.
      expect(stored.get(p.id)!.status).toBe("CANDIDATE");
    }
    // And a CANDIDATE never reaches the loop: `byStatus("VERIFIED")` is what
    // both exits read.
    const verified = new Set(b.store.byStatus("VERIFIED").map((r) => r.id));
    for (const p of paraphrases) expect(verified.has(p.id)).toBe(false);
    expect(sources.get(CODEBASE_SOURCE.id)!.reliability).toBe(1);
  });

  it("measures the two rules the decision turns on", () => {
    const b = build();
    const backoff = b.store.bySubject("dispatch-backoff")[0];
    const eligibility = b.store.bySubject("queue-eligibility")[0];
    expect(backoff.status).toBe("VERIFIED");
    expect(backoff.object).toBe(DISPATCH_BACKOFF_MS);
    expect(backoff.evidence[0].sourceType).toBe("measurement");
    expect(eligibility.status).toBe("VERIFIED");
    expect(eligibility.evidence[0].directness).toBe("experimentally_verified");
  });

  it("runs no eligibility probe without a clock, rather than an unmeasured one", () => {
    const withClock = dispatchRuleRecords(AT, ENFORCED_BACKOFF_BELIEF, T0);
    const without = dispatchRuleRecords(AT, ENFORCED_BACKOFF_BELIEF, null);
    expect(withClock.some((r) => r.subject === "queue-eligibility")).toBe(true);
    expect(without.some((r) => r.subject === "queue-eligibility")).toBe(false);
  });

  it("probes the boundary, not the sign of a subtraction", () => {
    // EVERY LEG IS ASSERTED SEPARATELY, and a mutation is why: with the real
    // `isDispatchable` behind it, the VERDICT is true whether two legs ran or
    // three, so an assertion over the verdict alone reported GREEN when the
    // one leg that distinguishes a window from a subtraction was deleted.
    const probe = eligibilityProbe(T0, DISPATCH_BACKOFF_MS);
    expect(probe.justOutside).toBe(true);
    expect(probe.justInside).toBe(false);
    expect(probe.neverDispatched).toBe(true);
    expect(probe.ok).toBe(true);

    // AND THE FAR-SIDE LEG IS SENSITIVE, which the assertions above cannot show
    // on their own: with the real rule behind it, `justInside` is false whether
    // the leg ran or was hard-coded. Handing in a rule that admits EVERYTHING
    // is what separates a probe that measures from one that reports.
    const admitsAll = eligibilityProbe(T0, DISPATCH_BACKOFF_MS, () => true);
    expect(admitsAll.justInside).toBe(true);
    expect(admitsAll.ok).toBe(false);
    // And one that refuses everything fails the other two legs.
    const refusesAll = eligibilityProbe(T0, DISPATCH_BACKOFF_MS, () => false);
    expect(refusesAll.justOutside).toBe(false);
    expect(refusesAll.neverDispatched).toBe(false);
    expect(refusesAll.ok).toBe(false);
    // The probe straddles the window by a minute on each side, so a rule that
    // ignored the window entirely fails it.
    expect(
      isDispatchable(
        {
          id: "p",
          requestedSeconds: 1,
          grade: null,
          createdAtMs: 0,
          dispatchedAtMs: T0 - DISPATCH_BACKOFF_MS - 60_000,
        },
        T0,
      ),
    ).toBe(true);
    expect(
      isDispatchable(
        {
          id: "p",
          requestedSeconds: 1,
          grade: null,
          createdAtMs: 0,
          dispatchedAtMs: T0 - DISPATCH_BACKOFF_MS + 60_000,
        },
        T0,
      ),
    ).toBe(false);
  });

  it("closes the two gaps it can and leaves the one it cannot", () => {
    // BEFORE v1.4-R this station was refused `no_knowledge_state` on every run,
    // so the answer was not "three unknown gaps" — there were no gaps at all.
    const b = build();
    const gaps = detectGaps(DISPATCH_GOAL, b.state);
    const byId = new Map(gaps.map((g) => [g.conceptId, g]));
    expect(byId.get("dispatch-backoff")!.status).toBe("VERIFIED");
    expect(byId.get("queue-eligibility")!.status).toBe("VERIFIED");
    // story-dispatch genuinely cannot see whether a runner is free; its own
    // header records a film sitting queued for half an hour beside an idle GPU.
    // Writing a plausible sentence about it would close the one real gap.
    expect(byId.get("runner-availability")!.status).toBe("UNKNOWN");
    expect(byId.get("runner-availability")!.priority).toBeGreaterThan(
      byId.get("dispatch-backoff")!.priority,
    );
  });

  it("weighs each evidence item at its OWN weight, not the record's aggregate", () => {
    // `model.ts`'s Confidence belongs to ONE Evidence. Writing the record-level
    // aggregate onto every item gave a fetched registry field and a recalled
    // guess the same belief — and capped every substrate-backed gap below the
    // 0.85 VERIFIED threshold, since one source saturates at 0.5.
    const sources = runtimeSourceRegistry();
    const b = build();
    const k = toKnowledgeState(b.store.byStatus("VERIFIED"), T0, sources);
    const values = new Set([...k.evidence.values()].map((e) => e.confidence.value));
    expect(values.size).toBeGreaterThan(1);
    expect(Math.max(...values)).toBeGreaterThanOrEqual(0.85);
  });

  it("reports what it cannot do on every lookup", () => {
    expect(substrateGap()).toMatch(/built per tick and discarded/);
    const wrapper = code(`${RUNTIME}/knowledge.ts`);
    expect(wrapper).toMatch(/gap: ctx\.gap/);
  });

  it("stays well inside its own stated build budget", () => {
    const t = performance.now();
    build();
    expect(performance.now() - t).toBeLessThan(INGEST_BUDGET_MS);
  });
});

/* ------------------------------------------------------------------ *
 * ITEM C — the chain, end to end, through the shipped runtime.
 * ------------------------------------------------------------------ */

const QUEUE: QueuedJob[] = [
  {
    id: "8f2c1a",
    requestedSeconds: 120,
    grade: "movie",
    createdAtMs: T0 - 41 * 60_000,
    dispatchedAtMs: null,
  },
  {
    id: "b71e04",
    requestedSeconds: 60,
    grade: "classic",
    createdAtMs: T0 - 9 * 60_000,
    dispatchedAtMs: null,
  },
];

function fakeEnv(queue: readonly QueuedJob[]) {
  const rows = new Map(queue.map((j) => [j.id, j]));
  let now = T0;
  const env = {
    sent: [] as string[],
    stamped: [] as string[],
    nowMs: () => (now += 7),
    readQueue: async () => [...rows.values()],
    readJob: async (id: string) => rows.get(id) ?? null,
    stampDispatched: async (id: string) => {
      env.stamped.push(id);
    },
    sendDispatch: async (id: string) => {
      env.sent.push(id);
      return null;
    },
  };
  return env as DispatchEnvironment & { sent: string[]; stamped: string[] };
}

const REPLY: Record<string, string> = {
  understand: "Get one queued film onto a runner without asking twice.",
  reason: "The oldest eligible job should go first.",
  verify: "UNVERIFIED",
  imagine:
    "dispatch story job 8f2c1a | a runner claims it | 0.1 | 0.9\n" +
    "hold: dispatch nothing this tick | nothing moves | 0.0 | 0.1",
  evaluate: "The oldest job carries the least risk of a second dispatch.",
  reflect: "Waiting time is the signal.",
  respond: "Dispatched the film that had waited longest.",
};

const provider = (async (req: { kind: string; prompt: string }) => ({
  ok: true,
  text: REPLY[req.kind] ?? "",
  usage: { inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: 40, costUsd: 0 },
  model: "recorded/deterministic",
})) as never;

const BUDGETS = { ...DEFAULT_BUDGETS, maxTokens: 200_000, maxCostUsd: 0, maxToolCalls: 0 };

describe("item C — shipped code -> mirrored substrate -> store -> quantum knowledge -> decision", () => {
  it("retrieves verified QUANTUM knowledge inside a real run", async () => {
    const out = await runShadow({
      runId: "c-1",
      mode: "shadow",
      env: fakeEnv(QUEUE),
      call: provider,
      budgets: BUDGETS,
    });
    // COUNTED FROM THE PERCEPTS THE LOOP TOOK IN, not from what the store
    // holds: a fact nobody retrieved has not reached the decision, which is
    // the distinction a chunk grep cannot make either.
    expect(out.comparison.quantumFactsUsed).toBeGreaterThan(0);
    expect(out.comparison.knowledgeRecords).toBeGreaterThan(100);
    expect(out.comparison.knowledgeVerified).toBeGreaterThan(100);
    expect(out.comparison.knowledgeLookups).toBeGreaterThan(0);
    expect(out.comparison.knowledgeGapsTotal).toBe(DISPATCH_GOAL.requires.length);
    // And the run still decides, and still agrees with production.
    expect(out.comparison.oqcaDecision).toBe("dispatch story job 8f2c1a");
    expect(out.comparison.agreed).toBe(true);
  });

  it("carries the §18 discovery verdict for THIS job, produced by the pipeline", () => {
    const results = discoverAll();
    const recs = discoveryFacts(AT, results);
    const mine = recs.find((r) => r.subject === "problem:story_dispatch")!;
    expect(mine.predicate).toBe("quantumRecommendation");
    // The honest answer for this codebase, and one a recommendation engine
    // could not return.
    expect(mine.object).toBe("no_matching_structure");
    // The SUBJECT is the problem id, so a query about story dispatch reaches
    // it. `discovery:3` would be true and unreachable.
    expect(mine.subject).toMatch(/story_dispatch/);
  });

  it("spends nothing: no tool call is even reachable at the shipped budgets", async () => {
    const env = fakeEnv(QUEUE);
    const out = await runShadow({
      runId: "c-2",
      mode: "shadow",
      env,
      call: provider,
      budgets: { ...DEFAULT_BUDGETS, maxToolCalls: 0, maxCostUsd: 0, maxTokens: 200_000 },
    });
    expect(env.sent).toEqual([]);
    expect(env.stamped).toEqual([]);
    expect(out.comparison.costUsd).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * ITEM D — one controlled knowledge upgrade.
 * ------------------------------------------------------------------ */

describe("item D — K0 -> new evidence -> K1 -> dependents -> world -> replan", () => {
  const k0 = () => buildSubstrate({ at: AT, nowMs: T0, belief: STALE });

  it("K0 is a belief the loop actually holds, not a refused draft", () => {
    // A SINGLE stale note reaches 0.286 and the gate refuses it, so
    // `believedBackoff` falls straight back to the constant and a "stale" run
    // is indistinguishable from a fresh one. The substrate was working; the
    // first fixture was not. Two agreeing notes reach 0.615.
    const b = k0();
    const rec = b.store.bySubject("dispatch-backoff")[0];
    expect(rec.status).toBe("VERIFIED");
    expect(rec.confidence).toBeGreaterThan(0.45);
    expect(believedBackoff(b)).toBe(STALE.windowMs);
  });

  it("falls back to the enforced constant when the record is not believable", () => {
    const one: BackoffBelief = { windowMs: 99, evidence: [STALE.evidence[0]] };
    const b = buildSubstrate({ at: AT, nowMs: T0, belief: one });
    expect(b.store.bySubject("dispatch-backoff")[0].status).toBe("CANDIDATE");
    expect(believedBackoff(b)).toBe(DISPATCH_BACKOFF_MS);
    // A malformed object is not a duration either.
    const bad: BackoffBelief = { windowMs: Number.NaN, evidence: ENFORCED_BACKOFF_BELIEF.evidence };
    expect(believedBackoff(buildSubstrate({ at: AT, nowMs: T0, belief: bad }))).toBe(
      DISPATCH_BACKOFF_MS,
    );
  });

  it("adjudicates the rivals without deleting either, and by MEASUREMENT", () => {
    const sources = runtimeSourceRegistry();
    const store = k0().store;
    const old = store.bySubject("dispatch-backoff")[0];
    const fresh = buildSubstrate({ at: AT, nowMs: T0 }).store.bySubject("dispatch-backoff")[0];
    store.put(fresh);

    expect(detectConflicts(store.bySubject("dispatch-backoff")).length).toBe(1);
    const c = resolveConflict([old, fresh], { sources, nowMs: T0 });
    // ADDITIVE WEIGHT WOULD GET THIS WRONG: 2 x 0.800 = 1.600 documents beat
    // one 0.950 reading of the running module. That is the defect the upgrade
    // fixture exposed, and `measured_precedence` is the rule that answers it.
    expect(c.strategy).toBe("measured_precedence");
    expect(c.canonical).toBe(fresh.id);
    expect(c.competing.length).toBe(2);
    const settled = applyResolution([old, fresh], c);
    expect(settled.find((r) => r.id === old.id)!.status).toBe("CONTESTED");
    expect(settled.find((r) => r.id === fresh.id)!.status).toBe("VERIFIED");
  });

  it("identifies the knowledge that was DERIVED from the retired belief", () => {
    const store = k0().store;
    const old = store.bySubject("dispatch-backoff")[0];
    const dependents = dependentsOf(store, old.id);
    expect(dependents.map((r) => r.subject)).toEqual(["queue-eligibility"]);
    // The edge is real: the eligibility record is PROBED at the believed
    // window, so it genuinely rests on that belief.
    expect(dependents[0].evidence[0].excerpt).toMatch(String(STALE.windowMs));
  });

  it("finds a dependent that has ITSELF been retired", () => {
    // `all()` no longer carries a superseded row, and a retired dependent is
    // exactly what an upgrade needs to find: it is the record that was computed
    // from a belief and then replaced. A `dependentsOf` reading only the
    // current map answers the easy case and misses the one that matters —
    // measured, because a mutation dropping `history()` reported GREEN against
    // the assertion above.
    const store = k0().store;
    const eligibility = store.bySubject("queue-eligibility")[0];
    const backoffId = store.bySubject("dispatch-backoff")[0].id;
    // Re-verified, same assertion, so this is a SUPERSESSION rather than a
    // conflict — `supersede()` requires the shared id and the store keeps both.
    store.supersedeWith(eligibility, { ...eligibility, confidence: 0.9 });
    expect(store.history().length).toBe(1);
    const found = dependentsOf(store, backoffId);
    // Two rows now: the retired v1 and the current v2, both derived from the
    // same belief and both addressable.
    expect(found.length).toBe(2);
    expect(found.map((r) => r.version)).toEqual([1, 2]);
    expect(found.some((r) => r.status === "SUPERSEDED")).toBe(true);
  });

  it("changes the world, the plan and the decision — and restores agreement", async () => {
    const upgradeQueue: QueuedJob[] = [
      {
        id: "8f2c1a",
        requestedSeconds: 120,
        grade: "movie",
        createdAtMs: T0 - 41 * 60_000,
        dispatchedAtMs: T0 - 12 * 60_000,
      },
      {
        id: "b71e04",
        requestedSeconds: 60,
        grade: "classic",
        createdAtMs: T0 - 9 * 60_000,
        dispatchedAtMs: null,
      },
    ];
    const staleWorld = worldFrom(upgradeQueue, T0, STALE.windowMs);
    const trueWorld = worldFrom(upgradeQueue, T0, DISPATCH_BACKOFF_MS);
    expect(staleWorld.availableActions.length).toBeLessThan(trueWorld.availableActions.length);

    const run = async (belief: BackoffBelief, id: string) =>
      runShadow({
        runId: id,
        mode: "shadow",
        env: fakeEnv(upgradeQueue),
        call: provider,
        budgets: BUDGETS,
        substrate: buildSubstrate({ at: AT, nowMs: T0, belief }),
      });

    const before = await run(STALE, "d-k0");
    const after = await run(ENFORCED_BACKOFF_BELIEF, "d-k1");

    expect(before.comparison.believedBackoffMs).toBe(STALE.windowMs);
    expect(after.comparison.believedBackoffMs).toBe(DISPATCH_BACKOFF_MS);
    // The stale belief costs the 41-minute-old film its turn — the exact
    // failure story-dispatch's own header records.
    expect(before.comparison.oqcaDecision).toBe("dispatch story job b71e04");
    expect(before.comparison.agreed).toBe(false);
    expect(after.comparison.oqcaDecision).toBe("dispatch story job 8f2c1a");
    expect(after.comparison.agreed).toBe(true);
  });

  it("never lets a belief reach an authorization site", async () => {
    // PRODUCTION IS DECIDED BY THE CONSTANT whatever ONIQ believes, so a wrong
    // belief can change what the loop CONSIDERS and never what the rule allows.
    const upgradeQueue: QueuedJob[] = [
      {
        id: "8f2c1a",
        requestedSeconds: 120,
        grade: "movie",
        createdAtMs: T0 - 41 * 60_000,
        dispatchedAtMs: T0 - 12 * 60_000,
      },
    ];
    expect(productionChoice(upgradeQueue, T0)).toBe("8f2c1a");

    const src = code(`${RUNTIME}/dispatchJob.ts`);
    // `authorize` re-reads the row and asks the ENFORCED rule — no third
    // argument, so the default constant applies.
    expect(src).toMatch(/if \(!isDispatchable\(fresh, now\)\) return/);
    // The tool REGISTRY is gated the same way: a belief cannot conjure a tool.
    expect(src).toMatch(/\.filter\(\(j\) => isDispatchable\(j, env\.nowMs\(\)\)\)/);
    // And `productionChoice` never takes one.
    expect(src).toMatch(/isDispatchable\(j, nowMs\)\);\n {2}if \(eligible\.length === 0\)/);
  });
});

/* ------------------------------------------------------------------ *
 * ITEMS F, G, H — the three that are refusals.
 * ------------------------------------------------------------------ */

describe("items F, G and H — what stays off", () => {
  it("F: remote quantum execution is off and the quantum cost budget is zero", () => {
    expect(DEFAULT_QUANTUM_POLICY.remoteQuantumExecution).toBe(false);
    expect(DEFAULT_QUANTUM_POLICY.maxQuantumCostUsd).toBe(0);
    // And the loop's own money bounds ship at refuse.
    expect(DEFAULT_BUDGETS.maxCostUsd).toBe(0);
    expect(DEFAULT_BUDGETS.maxTokens).toBe(0);
    expect(DEFAULT_BUDGETS.maxToolCalls).toBe(0);
  });

  it("G: no graph database is added, and no dependency for one", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
      expect(name).not.toMatch(/jena|rdf4j|apache-age|neo4j|blazegraph|graphdb/i);
    }
    // The store the benchmark measured is the one that ships.
    const b = build();
    expect(b.store.journal().length).toBe(b.store.all().length + b.store.history().length);
  });

  it("H: the five labelled metrics stay null until a labelled set exists", () => {
    const b = build();
    const m = computeMetrics(b.store, { nowMs: T0 });
    // §21: "do not confuse confidence with truth". A number here would be a
    // ground-truth claim, and no labelled benchmark set exists — manufacturing
    // one to turn null into 0 destroys exactly the distinction that matters.
    expect(m.knowledgePrecision).toBeNull();
    expect(m.knowledgeRecall).toBeNull();
    expect(m.resolutionAccuracy).toBeNull();
    expect(m.upgradeGain).toBeNull();
    expect(m.falsePromotionRate).toBeNull();
    // The metrics that ARE computable are computed, so `null` means unmeasured
    // rather than unimplemented.
    expect(m.rollbackIntegrity).toBe(1);
    expect(m.stalenessRate).toBeGreaterThanOrEqual(0);
  });
});
