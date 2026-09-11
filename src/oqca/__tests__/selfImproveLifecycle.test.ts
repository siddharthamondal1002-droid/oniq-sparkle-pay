/**
 * OQCA v1.7 §17 / §18 / §24 — the lifecycle, and the compounding claim.
 *
 * §18 asks for four processes sharing NOTHING except the persisted state, and
 * `scripts/oqca-self-improve.ts` is that: six real OS invocations are recorded
 * in `docs/oqca/self-improve/console.txt`. What a script cannot do is CONTROL
 * the conditions, so the load-bearing claim — that a later process starts from
 * a baseline an earlier one lowered — is proven HERE, where both invocations
 * can be handed the same objective and the same sinks and nothing else.
 *
 * The two invocations below share exactly two strings: the JSON in the
 * checkpoint sink and the JSON in the durable sink. No object, no closure and
 * no module state crosses between them, which is what makes it a stand-in for
 * a process boundary rather than a function call with extra steps.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_BOUNDS,
  SNAPSHOT_VERSION,
  emptySnapshot,
  runAutonomousRuntime,
  validateSnapshot,
} from "../autonomy/runtime.ts";
import { userObjective } from "../autonomy/objective.ts";
import { resourcesFor } from "../../../supabase/functions/_shared/oqcaRuntime/selfModel.ts";
import type {
  CapabilityExecutor,
  CapabilityRequest,
} from "../../../supabase/functions/_shared/oqcaRuntime/selfModel.ts";
import {
  type EvidenceItem,
  makeSystemObserver,
} from "../../../supabase/functions/_shared/oqcaRuntime/observe.ts";
import {
  type SubstrateContext,
  makeSinkCheckpointStore,
  makeSubstrateSurvey,
} from "../../../supabase/functions/_shared/oqcaRuntime/autonomous.ts";
import {
  GAP_METRIC,
  makeImprovementEpisode,
} from "../../../supabase/functions/_shared/oqcaRuntime/improvement.ts";
import { makeLocalEvidenceResearch } from "../../../supabase/functions/_shared/oqcaRuntime/research.ts";
import { makeSinkDurableStore } from "../../../supabase/functions/_shared/oqcaRuntime/durableStore.ts";
import type { Observation } from "../autonomy/observation.ts";

const AT = "2026-09-11T00:00:00.000Z";
const ctx: SubstrateContext = { at: () => AT, nowMs: () => Date.parse(AT) };

/** The one concept both invocations work on, and a corpus that can answer it. */
const CONCEPT = "widget-latency";
const CORPUS = [
  {
    locator: "src/demo/widget.ts",
    sourceVersion: "rev-1",
    contentHash: "hash-1",
    text: [
      "// unrelated preamble",
      "the widget latency budget is 250 milliseconds end to end, measured at the edge",
      "// more unrelated text",
    ].join("\n"),
  },
];

const GOAL = {
  id: "learn-widget",
  statement: "establish the widget latency budget",
  requires: [{ conceptId: CONCEPT, importance: 1 }],
};

const PERMIT_KNOWLEDGE: CapabilityExecutor = async (req: CapabilityRequest) =>
  req.id === "UPDATE_KNOWLEDGE"
    ? { ok: true, value: 0, unit: "records", detail: "permitted" }
    : { ok: false, reason: `${req.id} not executed here` };

/** A string cell. The ONLY thing two invocations share — see the header. */
function sink() {
  let held: string | null = null;
  return {
    read: async () => held,
    write: async (json: string) => {
      held = json;
      return true;
    },
    get raw() {
      return held;
    },
  };
}

const ITEM: EvidenceItem = {
  kind: "latency",
  subject: "widget",
  locator: "src/demo/widget.ts",
  sourceVersion: "rev-1",
  contentHash: "hash-1",
  detail: "the widget is over its budget",
  value: 410,
  severity: 0.8,
  requires: ["RUN_BENCHMARK"],
};

function runtimeOver(
  checkpoints: ReturnType<typeof sink>,
  knowledge: ReturnType<typeof sink>,
  opts: { readonly seed?: boolean; readonly episodes?: number } = {},
) {
  return runAutonomousRuntime({
    survey: makeSubstrateSurvey(ctx),
    observe: makeSystemObserver({ read: async () => ({ ok: true, items: [ITEM] }) }, () => AT),
    needs: (o: Observation) => resourcesFor(o.requires),
    seed: opts.seed ? [userObjective(GOAL, 0)] : [],
    runEpisode: makeImprovementEpisode(ctx, {
      research: makeLocalEvidenceResearch(CORPUS),
      durable: makeSinkDurableStore(knowledge),
      executor: PERMIT_KNOWLEDGE,
    }),
    store: makeSinkCheckpointStore(checkpoints),
    clock: () => Date.parse(AT),
    bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: opts.episodes ?? 1 },
  });
}

describe("v1.7 §18 — compounding across a process boundary", () => {
  it("the second invocation starts from a baseline the first one lowered", async () => {
    const checkpoints = sink();
    const knowledge = sink();

    // ---- PROCESS ONE: nothing durable exists yet ------------------------
    const first = await runtimeOver(checkpoints, knowledge, { seed: true });
    const one = first.history.at(-1);
    expect(one?.goalId).toBe(GOAL.id);
    expect(one?.persisted.length).toBeGreaterThan(0);
    expect(first.learned).toContain(CONCEPT);
    const firstExperiment = first.experiments.at(-1);
    expect(firstExperiment?.design.metric).toBe(GAP_METRIC);
    expect(firstExperiment?.baseline?.value).toBe(1);
    expect(firstExperiment?.candidate?.value).toBeLessThan(1);
    expect(firstExperiment?.verdict).toBe("IMPROVED");
    expect(firstExperiment?.improvementVerified).toBe(true);
    expect(first.improvementsVerified).toBe(1);

    // The durable sink now holds real rows with real locators.
    const stored = JSON.parse(knowledge.raw ?? "{}") as {
      rows: { concept: string; evidence: { locator: string }[] }[];
    };
    expect(stored.rows.length).toBeGreaterThan(0);
    expect(stored.rows[0].concept).toBe(CONCEPT);
    expect(stored.rows[0].evidence[0].locator).toBe("src/demo/widget.ts:2");

    // ---- PROCESS TWO: a fresh runtime, sharing only those two strings ---
    // The seed is supplied again exactly as a scheduler would supply the same
    // standing request; `mergeBacklog` keeps the existing row, so what is being
    // re-selected is the objective the first invocation left behind.
    const second = await runtimeOver(checkpoints, knowledge, { seed: true });
    expect(second.restored).toBe(true);
    const two = second.history.at(-1);
    /**
     * THE SECOND INVOCATION PICKED A DIFFERENT OBJECTIVE, AND THAT IS THE
     * RUNTIME BEHAVING CORRECTLY. The first one BLOCKED (the model allowance is
     * zero, as shipped), so it spawned a follow-up naming the concept it could
     * not settle; `selectObjective` then prefers that follow-up, which carries
     * the same requirement. So the claim being made here is about the CONCEPT
     * rather than the objective id — asserting the id would have pinned an
     * incidental scheduling outcome and gone red the day the follow-up rule
     * changed.
     */
    const carriedConcept = second.snapshot.backlog
      .find((o) => o.goal.id === two?.goalId)
      ?.goal.requires.map((r) => r.conceptId);
    expect(carriedConcept).toContain(CONCEPT);

    const secondExperiment = second.experiments.at(-1);
    // THE CLAIM, MEASURED: the second invocation's BASELINE is the first
    // invocation's RESULT. Knowledge produced by one process is what the next
    // one starts from — and nothing but a JSON string crossed between them.
    expect(secondExperiment?.baseline?.value).toBeCloseTo(
      firstExperiment?.candidate?.value ?? -1,
      10,
    );
    expect(secondExperiment?.baseline?.value).toBeLessThan(1);
    // And the second one learns NOTHING, because there was nothing left to
    // learn — §10's settled/learned distinction, proven across the boundary
    // rather than asserted. A runtime that reported this as learning again is
    // the exact over-claim v1.5 had to correct.
    expect(second.learned).toEqual([]);
    expect(secondExperiment?.verdict).toBe("NO_DIFFERENCE");
    expect(second.improvementsVerified).toBe(0);
  });

  it("the experiment ledger and the baselines survive the boundary too", async () => {
    const checkpoints = sink();
    const knowledge = sink();
    const first = await runtimeOver(checkpoints, knowledge, { seed: true });
    const second = await runtimeOver(checkpoints, knowledge, { seed: true });
    expect(second.experiments.length).toBeGreaterThan(first.experiments.length);
    expect(second.snapshot.baselines.some(([m]) => m === GAP_METRIC)).toBe(true);
    // A BETTER reading replaces the baseline; a worse one does not. Taking the
    // latest instead would let a regression quietly become the new normal and
    // then compare clean — a metric that can never report getting worse.
    const best = second.snapshot.baselines.find(([m]) => m === GAP_METRIC)?.[1] ?? -1;
    expect(best).toBeLessThan(1);
  });

  it("a v1 snapshot is REFUSED rather than migrated by guess", () => {
    const stale = { ...emptySnapshot(), version: 1 };
    const codes = validateSnapshot(stale).map((p) => p.code);
    expect(SNAPSHOT_VERSION).toBe(2);
    expect(codes).toContain("version_mismatch");
    // And the fields v1 never had are checked rather than assumed present: a
    // baseline that arrived as `undefined` would be spread into an empty Map
    // and every first reading would look like a win.
    const missing = validateSnapshot({
      ...emptySnapshot(),
      baselines: undefined as never,
    }).map((p) => p.code);
    expect(missing).toContain("bad_baselines");
    expect(
      validateSnapshot({ ...emptySnapshot(), baselines: [["m", "x" as never]] }).map((p) => p.code),
    ).toContain("bad_baseline_value");
  });
});

describe("v1.7 §1 — one loop, extended, not a second one", () => {
  it("improvement objectives land in the SAME backlog as knowledge-gap ones", async () => {
    const report = await runtimeOver(sink(), sink(), { seed: true, episodes: 2 });
    const sources = new Set(report.snapshot.backlog.map((o) => o.source));
    expect(sources.has("improvement")).toBe(true);
    expect(sources.has("user_request")).toBe(true);
    // ONE backlog, one selector, one runtime: the user's request outranks
    // every self-generated chore, unconditionally.
    expect(report.history[0].source).toBe("user_request");
  });

  it("observation is independent of the survey: blindness does not blind ONIQ to itself", async () => {
    const report = await runAutonomousRuntime({
      // The survey REFUSES — ONIQ cannot read its knowledge substrate at all.
      survey: async () => ({ ok: false, reason: "substrate unreadable" }),
      observe: makeSystemObserver({ read: async () => ({ ok: true, items: [ITEM] }) }, () => AT),
      needs: (o: Observation) => resourcesFor(o.requires),
      runEpisode: makeImprovementEpisode(ctx, { executor: PERMIT_KNOWLEDGE }),
      clock: () => Date.parse(AT),
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 1 },
    });
    expect(report.surveyRefusals).toBeGreaterThan(0);
    // It still SAW its own system and still raised work about it. Gating the
    // observer on the survey would have made one refusal blind both.
    expect(report.observations.some((o) => o.state === "OBSERVED")).toBe(true);
    expect(report.concerns.length).toBeGreaterThan(0);
    expect(report.generated).toBeGreaterThan(0);
    expect(report.world?.health.value).toBe("degraded");
  });

  it("the report carries the world, the observations and the ranked concerns", async () => {
    const report = await runtimeOver(sink(), sink(), { seed: true });
    expect(report.world).not.toBeNull();
    expect(report.observations).toHaveLength(19);
    expect(report.world?.system.value.commit).toBeNull();
    // No identity provenance was supplied, so the claim's coverage is 0 rather
    // than a confident 1 over a value nobody read.
    expect(report.world?.system.coverage).toBe(0);
    expect(report.selfEvaluations).toHaveLength(report.episodes);
    expect(report.persisted.length).toBeGreaterThan(0);
  });

  it("a refused UPDATE_KNOWLEDGE persists nothing and says so", async () => {
    const knowledge = sink();
    const report = await runAutonomousRuntime({
      survey: makeSubstrateSurvey(ctx),
      observe: makeSystemObserver({ read: async () => ({ ok: true, items: [ITEM] }) }, () => AT),
      needs: (o: Observation) => resourcesFor(o.requires),
      seed: [userObjective(GOAL, 0)],
      runEpisode: makeImprovementEpisode(ctx, {
        research: makeLocalEvidenceResearch(CORPUS),
        durable: makeSinkDurableStore(knowledge),
        // NO executor: the §12 gate refuses before the store is ever reached.
      }),
      clock: () => Date.parse(AT),
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 1 },
    });
    expect(report.persisted).toEqual([]);
    expect(knowledge.raw).toBeNull();
    expect(report.history[0].note).toContain("knowledge update refused");
    // The retrieval still HAPPENED and is still reported as learning in memory —
    // what did not happen is the durable write, and the two are separate claims.
    expect(report.learned).toContain(CONCEPT);
  });

  /* ============================================================ *
   * THE FOUR ASSERTIONS BELOW WERE WRITTEN BECAUSE MUTATIONS ESCAPED.
   * Every one names the hole its mutation opened; none was written from
   * reading the code. M143, M147, M153 and M161 all reported GREEN on the
   * first run of `scripts/oqca-mutate.sh`.
   * ============================================================ */

  it("M143 — belief comes from the promotion policy, never from the point of creation", async () => {
    const knowledge = sink();
    await runtimeOver(sink(), knowledge, { seed: true });
    const stored = JSON.parse(knowledge.raw ?? "{}") as {
      rows: { verification_status: string; confidence: number }[];
    };
    expect(stored.rows.length).toBeGreaterThan(0);
    for (const row of stored.rows) {
      expect(row.verification_status).toBe("VERIFIED");
      /**
       * 0.5 IS WHAT THE POLICY COMPUTES, AND THAT IS THE POINT. `scoreConfidence`
       * saturates at `w/(w+1)`, so one first-hand item — fetched, quoted
       * verbatim, from a source of reliability 1 — reaches exactly 0.5 and no
       * higher. A record written VERIFIED at construction would carry whatever
       * number its author typed, and `draftRecord`'s guarantee (every record is
       * born CANDIDATE) exists precisely so nobody can. Asserting the STATUS
       * alone would pass on a bypass; asserting the number cannot.
       */
      expect(row.confidence).toBeCloseTo(0.5, 10);
    }
  });

  it("M147 — a refused retrieval is BLOCKED, never a measured negative", async () => {
    const report = await runAutonomousRuntime({
      survey: makeSubstrateSurvey(ctx),
      observe: makeSystemObserver({ read: async () => ({ ok: true, items: [ITEM] }) }, () => AT),
      needs: (o: Observation) => resourcesFor(o.requires),
      seed: [userObjective(GOAL, 0)],
      runEpisode: makeImprovementEpisode(ctx, {
        // AN EMPTY CORPUS REFUSES: nothing was searched, so nothing was learned
        // and nothing was intervened.
        research: makeLocalEvidenceResearch([]),
        durable: makeSinkDurableStore(sink()),
        executor: PERMIT_KNOWLEDGE,
      }),
      clock: () => Date.parse(AT),
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 1 },
    });
    const x = report.experiments.at(-1);
    // Both arms WOULD read the same number, so `compare` would answer
    // NO_DIFFERENCE — a statement that the intervention ran and did nothing.
    // It never ran.
    expect(x?.verdict).toBe("BLOCKED");
    expect(x?.baseline).toBeNull();
    expect(x?.candidate).toBeNull();
    expect(report.learned).toEqual([]);
  });

  it("M161 — the 23 stations get the SAME research adapter the episode used", async () => {
    const report = await runtimeOver(sink(), sink(), { seed: true });
    const ledger = report.history[0].capabilities.filter((c) => c.capability === "research");
    expect(ledger.length).toBeGreaterThan(0);
    /**
     * NOT ONE REFUSAL AMONG THEM. Before this, the episode retrieved while
     * station 10 held `NO_RESEARCH`, so one run reported research as both
     * available and unavailable; `unavailable()` reads the refusal, the
     * successful retrieval became invisible, and every experiment came back
     * BLOCKED while records were being learned and persisted. A run may not
     * contradict its own caller about what it could reach.
     */
    expect(ledger.every((c) => c.availability === "available")).toBe(true);
    expect(report.experiments.at(-1)?.verdict).toBe("IMPROVED");
  });

  it("§17 — the episode bound is on the INVOCATION, not the lifetime", async () => {
    const checkpoints = sink();
    const knowledge = sink();
    await runtimeOver(checkpoints, knowledge, { seed: true, episodes: 2 });
    const carried = JSON.parse(checkpoints.raw ?? "{}") as { episode: number };
    expect(carried.episode).toBeGreaterThanOrEqual(2);
    // A second invocation whose bound is already exceeded by the LIFETIME
    // counter must still run: reading the lifetime here is what made a restored
    // v1.5 runtime dead on arrival.
    const again = await runtimeOver(checkpoints, knowledge, { episodes: 1 });
    expect(again.restored).toBe(true);
    expect(again.episodes).toBe(1);
  });
});
