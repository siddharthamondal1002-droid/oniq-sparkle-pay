/**
 * OQCA v1.5 — the autonomous cognitive runtime, tested where it can go wrong.
 *
 * THE SUBJECT OF THIS FILE IS THE REFUSALS AND THE BOUNDS, not the happy path.
 * A runtime that generates its own goals and keeps going without anybody asking
 * is only as safe as the four things that stop it: it may not mint a user
 * request, it may not regress forever on a blocker, it may not spin on one
 * objective, and it may not report a stall as having nothing left to learn. A
 * suite that proved the happy path would be proving the least important half.
 *
 * TWO OF THESE TESTS EXIST BECAUSE THE FIRST LIVE RUN WAS WRONG, and both are
 * marked. `maxEpisodes` was checked against the LIFETIME counter, so a restored
 * runtime was dead on arrival; and an all-blocked backlog reported `idle`,
 * which is a system announcing it has nothing left to learn while it is stuck.
 * Neither is visible from inside a single-process test, which is why
 * `scripts/oqca-autonomous-run.ts` exists and is run rather than described.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { detectGaps, openGaps, type Gap, type Goal } from "../knowledge/gaps.ts";
import {
  type KnowledgeState,
  EMPTY_KNOWLEDGE,
  conf,
  withConcept,
  withEvidence,
  withRelation,
} from "../knowledge/model.ts";
import type { KnowledgeRecord } from "../knowledge/substrate/record.ts";
import {
  MODIFIER_FLOOR,
  NEUTRAL_FACTOR,
  rankLearningTargets,
  relevanceTo,
  selectLearningTarget,
  stalenessByConcept,
  stalenessDemand,
  type LearningTarget,
} from "../autonomy/select.ts";
import {
  AUTONOMOUS_SOURCES,
  MAX_ATTEMPTS,
  MAX_FOLLOW_UP_DEPTH,
  MAX_GENERATED_REQUIREMENTS,
  followUpFor,
  generateObjectives,
  goalForTarget,
  isAutonomous,
  mergeBacklog,
  objectiveId,
  objectivesFromStale,
  selectObjective,
  userObjective,
  type Objective,
} from "../autonomy/objective.ts";
import {
  DEFAULT_RUNTIME_BOUNDS,
  NO_CHECKPOINTS,
  NO_SURVEY,
  REFUSING_EPISODE,
  SNAPSHOT_VERSION,
  emptySnapshot,
  reawaken,
  runAutonomousRuntime,
  validateSnapshot,
  type CheckpointStore,
  type EpisodeOutcome,
  type RunEpisode,
  type RuntimeSnapshot,
  type Survey,
} from "../autonomy/runtime.ts";
import { stripComments } from "@/test/sourceText";
import { DEFAULT_BUDGETS } from "../loop/seams.ts";
import { DISPATCH_GOAL } from "../../../supabase/functions/_shared/oqcaRuntime/dispatchJob.ts";
import { buildSubstrate } from "../../../supabase/functions/_shared/oqcaRuntime/substrate.ts";
import {
  STANDING_GOAL,
  autonomyGap,
  makeLoopEpisode,
  makeSinkCheckpointStore,
  makeSubstrateSurvey,
  objectiveState,
  staleSubjectsFor,
} from "../../../supabase/functions/_shared/oqcaRuntime/autonomous.ts";

/* ---------------------------------------------------------------- *
 * FIXTURES — deterministic, and randomised where a single hand-built
 * case would let the subject pass by coincidence.
 * ---------------------------------------------------------------- */

/** mulberry32: a seeded PRNG, because a clock and `Math.random` both destroy replay. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function knowledgeWith(
  concepts: readonly { id: string; dependsOn?: readonly string[] }[],
  evidence: readonly { concept: string; value: number; volatility?: number; supports?: boolean }[],
): KnowledgeState {
  let k: KnowledgeState = EMPTY_KNOWLEDGE;
  for (const c of concepts) {
    k = withConcept(k, {
      id: c.id,
      label: c.id,
      dependsOn: c.dependsOn ?? [],
      contextIds: ["t"],
    });
  }
  let n = 0;
  for (const e of evidence) {
    const id = `e${n++}`;
    k = withEvidence(k, {
      id,
      source: "document",
      statement: e.concept,
      provenance: "fixture",
      supports: e.supports ?? true,
      confidence: conf(e.value, e.volatility ?? 0),
    });
    k = withRelation(k, {
      id: `r${n}`,
      from: e.concept,
      to: e.concept,
      kind: "about",
      confidence: conf(e.value, e.volatility ?? 0),
      evidenceIds: [id],
      contextId: "t",
      provenance: "fixture",
    });
  }
  return k;
}

function record(over: Partial<KnowledgeRecord> = {}): KnowledgeRecord {
  return {
    id: "rec",
    subject: "s",
    predicate: "p",
    object: 1,
    domain: ["d"],
    sourceIds: [],
    evidence: [],
    confidence: 0.9,
    status: "VERIFIED",
    volatility: "stable",
    validity: { lastVerifiedAt: "2026-09-01T00:00:00Z", validFrom: null, validUntil: null },
    version: 1,
    derivedFrom: [],
    supports: [],
    contradicts: [],
    supersededBy: null,
    provenance: { activities: [] },
    ...over,
  } as KnowledgeRecord;
}

function target(over: Partial<LearningTarget> = {}): LearningTarget {
  return {
    conceptId: "c",
    status: "UNKNOWN",
    factors: {
      importance: 1,
      uncertainty: 1,
      dependency: 1,
      informationGain: 0.8,
      staleness: 1,
      relevance: 1,
    },
    score: 0.8,
    reason: "fixture",
    ...over,
  };
}

function blocked(over: Partial<Objective> = {}): Objective {
  const base = userObjective(
    { id: "g", statement: "do the thing", requires: [{ conceptId: "a", importance: 1 }] },
    0,
  );
  return { ...base, status: "blocked", blockedOn: ["b"], blockedReason: "b is unknown", ...over };
}

/* ================================================================ *
 * CAPABILITY 1 — AUTONOMOUS OBJECTIVE GENERATION
 * ================================================================ */

describe("v1.5 capability 1 — an objective with nobody asking", () => {
  it("never mints a user request, over every shape the generator accepts", () => {
    const k = knowledgeWith([{ id: "a" }, { id: "b", dependsOn: ["a"] }], []);
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const out = generateObjectives({
        targets: [target({ conceptId: r() < 0.5 ? "a" : "b" })],
        knowledge: k,
        stale: [{ conceptId: "a", importance: r(), demand: r(), reason: "old" }],
        at: seed,
      });
      expect(out.length).toBeGreaterThan(0);
      for (const o of out) {
        expect(o.source).not.toBe("user_request");
        expect(isAutonomous(o.source)).toBe(true);
        expect(AUTONOMOUS_SOURCES).toContain(o.source);
      }
    }
  });

  it("the id commits to WHAT the objective is for and to nothing that moves", () => {
    const goal: Goal = { id: "g", statement: "s", requires: [{ conceptId: "a", importance: 1 }] };
    const drifted: Goal = { ...goal, requires: [{ conceptId: "a", importance: 0.37 }] };
    const relabelled: Goal = { ...goal, id: "a-different-label" };
    const reordered: Goal = {
      ...goal,
      requires: [
        { conceptId: "b", importance: 1 },
        { conceptId: "a", importance: 1 },
      ],
    };
    const widened: Goal = {
      ...goal,
      requires: [
        { conceptId: "a", importance: 1 },
        { conceptId: "b", importance: 1 },
      ],
    };

    // Importance drifts with the evidence, and the goal's id is a label. If
    // either reached the hash, an unresolved gap would mint a NEW objective
    // every cycle and the backlog bound would be the only thing left.
    expect(objectiveId("knowledge_gap", drifted)).toBe(objectiveId("knowledge_gap", goal));
    expect(objectiveId("knowledge_gap", relabelled)).toBe(objectiveId("knowledge_gap", goal));
    // The concept SET is the identity, so order cannot make two of one thing.
    expect(objectiveId("knowledge_gap", reordered)).toBe(objectiveId("knowledge_gap", widened));
    // But a different set, a different statement or a different source is a
    // different objective.
    expect(objectiveId("knowledge_gap", widened)).not.toBe(objectiveId("knowledge_gap", goal));
    expect(objectiveId("maintenance", goal)).not.toBe(objectiveId("knowledge_gap", goal));
    expect(objectiveId("knowledge_gap", { ...goal, statement: "other" })).not.toBe(
      objectiveId("knowledge_gap", goal),
    );
  });

  it("merging keeps what is already known and takes only the new priority", () => {
    const stale = objectivesFromStale(
      [{ conceptId: "a", importance: 1, demand: 0.5, reason: "old" }],
      0,
    );
    const inFlight: Objective = {
      ...stale[0]!,
      status: "blocked",
      attempts: 2,
      blockedOn: ["z"],
      blockedReason: "z",
    };
    const regenerated = objectivesFromStale(
      [{ conceptId: "a", importance: 1, demand: 0.9, reason: "older" }],
      9,
    );
    const merged = mergeBacklog([inFlight], regenerated);

    expect(merged).toHaveLength(1);
    // Resurrecting a blocked objective as fresh every cycle would lose the
    // attempt count that bounds it.
    expect(merged[0]!.status).toBe("blocked");
    expect(merged[0]!.attempts).toBe(2);
    expect(merged[0]!.blockedOn).toEqual(["z"]);
    // The score is what the CURRENT evidence says; the old one is stale.
    expect(merged[0]!.priority).toBeCloseTo(0.9, 12);
  });

  it("a follow-up is refused in each of the four ways it can be wrong", () => {
    expect(followUpFor({ ...blocked(), status: "pending" }, 1)).toBeNull();
    expect(followUpFor({ ...blocked(), blockedOn: [] }, 1)).toBeNull();
    expect(followUpFor({ ...blocked(), depth: MAX_FOLLOW_UP_DEPTH }, 1)).toBeNull();
    // THE REGRESS IN ITS PUREST FORM: blocked on exactly what it requires. The
    // content-derived id would hide it — the child dedupes onto its parent and
    // silently resets that objective's own status.
    expect(followUpFor({ ...blocked(), blockedOn: ["a"] }, 1)).toBeNull();
  });

  it("a follow-up names the blocker, inherits the priority and goes one deeper", () => {
    const parent = blocked({ priority: 0.42 });
    const child = followUpFor(parent, 7)!;
    expect(child).not.toBeNull();
    expect(child.source).toBe("follow_up");
    expect(child.goal.requires.map((r) => r.conceptId)).toEqual(["b"]);
    expect(child.parentId).toBe(parent.id);
    expect(child.depth).toBe(parent.depth + 1);
    // No boost: the parent is `blocked` and therefore unselectable, so a
    // number nobody chose is not needed to reach the child.
    expect(child.priority).toBe(parent.priority);
    expect(child.status).toBe("pending");
    // And the chain terminates: the child's own blocker equals its own
    // requirement, so no grandchild is possible.
    expect(followUpFor({ ...child, status: "blocked", blockedOn: ["b"] }, 8)).toBeNull();
  });

  it("a chain of genuinely NEW blockers is stopped by the depth bound alone", () => {
    let current = blocked({ blockedOn: ["k0"] });
    let depth = 0;
    for (let i = 0; i < 10; i++) {
      const next = followUpFor(current, i);
      if (next === null) break;
      depth = next.depth;
      // Each step names a concept nobody has seen, so the id never repeats and
      // dedupe cannot end this. Only MAX_FOLLOW_UP_DEPTH can.
      current = { ...next, status: "blocked", blockedOn: [`k${i + 1}`], blockedReason: "unknown" };
    }
    expect(depth).toBe(MAX_FOLLOW_UP_DEPTH);
  });

  it("a generated goal stays narrow and picks the most-depended-on prerequisite", () => {
    // `wanted` is named by two other concepts, `ignored` by none. Declaration
    // order puts `ignored` first on purpose: SUPERPOSE already keys on
    // declaration order, and choosing the same way would make the two agree by
    // coincidence and hide the mismatch the owner asked to keep visible.
    const k = knowledgeWith(
      [
        { id: "top", dependsOn: ["ignored", "wanted"] },
        { id: "x", dependsOn: ["wanted"] },
        { id: "y", dependsOn: ["wanted"] },
        { id: "ignored" },
        { id: "wanted" },
      ],
      [],
    );
    const goal = goalForTarget(target({ conceptId: "top" }), k);
    expect(goal.requires.length).toBeLessThanOrEqual(MAX_GENERATED_REQUIREMENTS);
    expect(goal.requires.map((r) => r.conceptId)).toEqual(["top", "wanted"]);
    // Half weight: a prerequisite is on the path to the target, not the target.
    expect(goal.requires[1]!.importance).toBeCloseTo(goal.requires[0]!.importance / 2, 12);
  });

  it("a person's request outranks the runtime's own chores, at any priority", () => {
    const chore = objectivesFromStale(
      [{ conceptId: "a", importance: 1, demand: 1, reason: "old" }],
      0,
    )[0]!;
    const person = userObjective(
      { id: "u", statement: "please", requires: [{ conceptId: "z", importance: 1 }] },
      0,
      0.0001,
    );
    expect(chore.priority).toBeGreaterThan(person.priority);
    expect(selectObjective([chore, person])!.id).toBe(person.id);
    // …and only PENDING is selectable, or a runtime spins on one objective.
    for (const status of ["active", "blocked", "done", "abandoned"] as const) {
      expect(
        selectObjective([
          { ...person, status },
          { ...chore, status },
        ]),
      ).toBeNull();
    }
    expect(selectObjective([{ ...person, status: "done" }, chore])!.id).toBe(chore.id);
  });
});

/* ================================================================ *
 * CAPABILITY 2 — AUTONOMOUS LEARNING SELECTION
 * ================================================================ */

describe("v1.5 capability 2 — choosing what to learn next", () => {
  const goal: Goal = {
    id: "g",
    statement: "s",
    requires: [
      { conceptId: "a", importance: 1 },
      { conceptId: "b", importance: 0.6 },
      { conceptId: "c", importance: 0.3 },
    ],
  };

  it("is a STRICT EXTENSION: with no staleness and no focus it is detectGaps' own order", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const k = knowledgeWith(
        [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c" }],
        [
          { concept: "a", value: r(), volatility: r() },
          { concept: "b", value: r(), volatility: r() },
        ],
      );
      const gaps = openGaps(detectGaps(goal, k));
      const ranked = rankLearningTargets({ gaps, knowledge: k });
      expect(ranked.map((t) => t.conceptId)).toEqual(gaps.map((g) => g.conceptId));
      for (const t of ranked) {
        const g = gaps.find((x) => x.conceptId === t.conceptId)!;
        expect(t.factors.staleness).toBe(NEUTRAL_FACTOR);
        expect(t.factors.relevance).toBe(NEUTRAL_FACTOR);
        /**
         * THE ORDER IS EXACT; THE SCORE IS EQUAL TO 10 PLACES AND NOT BIT FOR
         * BIT, and the reason is worth stating rather than tightening. Both
         * functions round to 12 decimals, but at different points in the
         * product: `detectGaps` rounds each factor AND its priority, and this
         * one multiplies the already-rounded factors and rounds again. So the
         * two can differ by one unit in the twelfth place — measured at 1e-12
         * on seed 9. Pinning 12 here would pin the double rounding, and the
         * next person to fix that would fix the test instead of the design.
         * The claim being made is the ORDERING, asserted exactly above.
         */
        expect(t.score).toBeCloseTo(g.priority, 10);
      }
    }
  });

  it("orients the brief's `freshness` as DEMAND: the stale one wins", () => {
    const k = knowledgeWith([{ id: "a" }, { id: "b" }], []);
    const gaps = openGaps(
      detectGaps(
        {
          id: "g",
          statement: "s",
          requires: [
            { conceptId: "a", importance: 1 },
            { conceptId: "b", importance: 1 },
          ],
        },
        k,
      ),
    );
    // Identical in every one of the other five factors.
    const a = gaps.find((g) => g.conceptId === "a")!;
    const b = gaps.find((g) => g.conceptId === "b")!;
    expect(a.priority).toBeCloseTo(b.priority, 12);

    const ranked = rankLearningTargets({
      gaps,
      knowledge: k,
      staleness: new Map([
        ["a", 0.05],
        ["b", 1],
      ]),
    });
    // A factor that rose with how FRESH knowledge is would put `a` first and
    // the overdue claim would never be looked at again.
    expect(ranked[0]!.conceptId).toBe("b");
    expect(selectLearningTarget({ gaps, knowledge: k })).not.toBeNull();
  });

  it("a context factor may re-rank and may NOT veto", () => {
    const k = knowledgeWith([{ id: "a" }, { id: "b" }], []);
    const gaps = openGaps(
      detectGaps(
        {
          id: "g",
          statement: "s",
          requires: [
            { conceptId: "a", importance: 1 },
            { conceptId: "b", importance: 0.01 },
          ],
        },
        k,
      ),
    );
    const ranked = rankLearningTargets({
      gaps,
      knowledge: k,
      // Zero, and a raw multiplication would annihilate four real measurements.
      staleness: new Map([["a", 0]]),
    });
    for (const t of ranked) {
      expect(t.factors.staleness).toBeGreaterThanOrEqual(MODIFIER_FLOOR);
      expect(t.factors.relevance).toBeGreaterThanOrEqual(MODIFIER_FLOOR);
      expect(t.score).toBeGreaterThan(0);
    }
    // The floor is small enough that context loses to a hundredfold difference
    // in the evidence, which is what makes it a modifier rather than a gate.
    expect(ranked.find((t) => t.conceptId === "a")!.score).toBeGreaterThan(
      ranked.find((t) => t.conceptId === "b")!.score,
    );
  });

  it("relevance is graph distance, falls strictly, and never reaches zero", () => {
    const k = knowledgeWith(
      [{ id: "a" }, { id: "b", dependsOn: ["a"] }, { id: "c", dependsOn: ["b"] }, { id: "far" }],
      [],
    );
    const focus: Goal = { id: "f", statement: "s", requires: [{ conceptId: "a", importance: 1 }] };
    const here = relevanceTo("a", focus, k);
    const one = relevanceTo("b", focus, k);
    const two = relevanceTo("c", focus, k);
    expect(here).toBe(1);
    expect(one).toBeLessThan(here);
    expect(two).toBeLessThan(one);
    expect(two).toBeGreaterThan(0);
    // Unreachable is the floor, never zero — see the veto rule above.
    expect(relevanceTo("far", focus, k)).toBe(MODIFIER_FLOOR);
    // No focus is NO INFORMATION, which re-ranks nothing. It is not "far".
    expect(relevanceTo("far", null, k)).toBe(NEUTRAL_FACTOR);
  });

  it("staleness reads never-verified and event-driven as MAXIMUM demand", () => {
    expect(
      stalenessDemand(
        record({ validity: { lastVerifiedAt: null, validFrom: null, validUntil: null } }),
        0,
      ),
    ).toBe(1);
    expect(
      stalenessDemand(record({ volatility: "event_driven" }), Date.parse("2026-09-01T00:00:00Z")),
    ).toBe(1);
    expect(
      stalenessDemand(record({ volatility: "unknown" }), Date.parse("2026-09-01T00:00:00Z")),
    ).toBe(1);
    // `fast` is a one-day interval, so half a day is half the demand.
    const half = stalenessDemand(
      record({ volatility: "fast" }),
      Date.parse("2026-09-01T12:00:00Z"),
    );
    expect(half).toBeCloseTo(0.5, 6);
  });

  it("a subject's demand is set by its MOST overdue claim, on both concept keys", () => {
    const now = Date.parse("2026-09-01T18:00:00Z");
    const map = stalenessByConcept(
      [
        record({ id: "r1", subject: "s", predicate: "fresh", volatility: "fast" }),
        record({
          id: "r2",
          subject: "s",
          predicate: "ancient",
          volatility: "fast",
          validity: { lastVerifiedAt: "2026-08-01T00:00:00Z", validFrom: null, validUntil: null },
        }),
      ],
      now,
    );
    // One record verified this morning must not mask one unchecked for a month.
    expect(map.get("s")).toBe(1);
    // `toKnowledgeState` names both the subject and `subject:predicate`; keying
    // one would leave half the graph with no signal and nothing would say so.
    expect(map.get("s:ancient")).toBe(1);
    expect(map.get("s:fresh")).toBeLessThan(1);
  });

  it("is not declaration order in disguise", () => {
    // v1.4-R found SUPERPOSE admitting prerequisites in declaration order and
    // reading as a decision. A selector that returned `gaps[0]` would pass every
    // test above that does not randomise, so this is the control: over random
    // evidence the choice must differ from the first-listed gap often enough
    // that index order cannot explain it.
    let differs = 0;
    const trials = 80;
    for (let seed = 1; seed <= trials; seed++) {
      const r = rng(seed * 977);
      const k = knowledgeWith(
        [{ id: "a" }, { id: "b" }, { id: "c" }],
        [
          { concept: "a", value: r(), volatility: r() },
          { concept: "b", value: r(), volatility: r() },
          { concept: "c", value: r(), volatility: r() },
        ],
      );
      const gaps: Gap[] = openGaps(detectGaps(goal, k));
      if (gaps.length < 2) continue;
      const chosen = selectLearningTarget({
        gaps: [...gaps].sort((x, y) => x.conceptId.localeCompare(y.conceptId)),
        knowledge: k,
        staleness: new Map([
          ["a", r()],
          ["b", r()],
          ["c", r()],
        ]),
      })!;
      if (
        chosen.conceptId !==
        [...gaps].sort((x, y) => x.conceptId.localeCompare(y.conceptId))[0]!.conceptId
      ) {
        differs += 1;
      }
    }
    expect(differs).toBeGreaterThan(trials / 8);
  });
});

/* ================================================================ *
 * CAPABILITY 3 — THE CONTINUOUS LIFECYCLE
 * ================================================================ */

/** A survey that offers a fixed set of learning targets and nothing stale. */
function surveyOf(concepts: readonly string[]): Survey {
  const k = knowledgeWith(
    concepts.map((id) => ({ id })),
    [],
  );
  const goal: Goal = {
    id: "standing",
    statement: "s",
    requires: concepts.map((c, i) => ({ conceptId: c, importance: 1 - i * 0.1 })),
  };
  return async () => ({
    ok: true as const,
    gaps: openGaps(detectGaps(goal, k)),
    knowledge: k,
    stale: [],
  });
}

/** An episode runner driven by a per-goal script, with a call log. */
function scripted(by: (goalId: string, n: number) => Partial<EpisodeOutcome>): {
  run: RunEpisode;
  seen: string[];
} {
  const seen: string[] = [];
  const run: RunEpisode = async (o) => {
    const n = seen.filter((s) => s === o.goal.id).length;
    seen.push(o.goal.id);
    // NO `as EpisodeOutcome` HERE, deliberately. The cast this replaced is what
    // let `capabilities` be added to the outcome without a single test going
    // red — tsc checks an object literal against the annotated return type and
    // an assertion tells it not to bother. A fixture that silences the compiler
    // stops being a fixture for the shape it is fixing.
    const outcome: EpisodeOutcome = {
      status: "success",
      note: "scripted",
      blockedOn: [],
      blockedReason: null,
      capabilities: [],
      settled: [],
      learned: [],
      ...by(o.goal.id, n),
    };
    return outcome;
  };
  return { run, seen };
}

function memoryStore(): CheckpointStore & { readonly held: () => RuntimeSnapshot | null } {
  let held: RuntimeSnapshot | null = null;
  return {
    checkpoint: async (s) => {
      // Serialised on the way in and out, so a snapshot that cannot survive
      // JSON fails HERE rather than in the process that tries to restore it.
      held = JSON.parse(JSON.stringify(s)) as RuntimeSnapshot;
      return true;
    },
    restore: async () => held,
    held: () => held,
  };
}

describe("v1.5 capability 3 — the lifecycle continues without anyone asking", () => {
  it("a blocked objective ends an OBJECTIVE, never the runtime", async () => {
    const { run, seen } = scripted((goalId) =>
      goalId === "learn:a"
        ? { status: "blocked", blockedOn: ["deep"], blockedReason: "deep is unknown" }
        : { status: "success" },
    );
    const report = await runAutonomousRuntime({
      survey: surveyOf(["a", "b", "c"]),
      runEpisode: run,
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxConsecutiveBlocked: 99 },
    });
    // The owner's sentence, executable: blocked on one != cognitively dead.
    expect(seen).toContain("learn:a");
    expect(seen).toContain("learn:b");
    expect(seen).toContain("learn:c");
    expect(report.history.filter((h) => h.status === "success").length).toBeGreaterThanOrEqual(2);
    // …and the blocker it NAMED earned a follow-up, which then ran.
    expect(report.history.find((h) => h.goalId === "learn:a")!.followUpId).not.toBeNull();
    expect(seen).toContain("unblock:learn:a");
  });

  it("a RUN of blocked objectives is a stall, and says so", async () => {
    const { run } = scripted(() => ({
      status: "blocked",
      blockedOn: [],
      blockedReason: "nothing is possible",
    }));
    const report = await runAutonomousRuntime({
      survey: surveyOf(["a", "b", "c", "d", "e"]),
      runEpisode: run,
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxConsecutiveBlocked: 2 },
    });
    expect(report.stop).toBe("stalled");
    expect(report.episodes).toBe(2);
  });

  it("THE FIRST LIVE RUN REPORTED `idle` WITH WORK STUCK IN THE BACKLOG", async () => {
    // Three empties, and only running it showed the wrong one being chosen. A
    // backlog whose every remaining objective is BLOCKED is not "nothing to
    // learn" — announcing that would be the system claiming it knows everything.
    const { run } = scripted(() => ({
      status: "blocked",
      blockedOn: [],
      blockedReason: "no way in",
    }));
    const stuck = await runAutonomousRuntime({
      survey: surveyOf(["a"]),
      runEpisode: run,
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxConsecutiveBlocked: 99 },
    });
    expect(stuck.stop).toBe("stalled");
    expect(stuck.stopDetail).toContain("blocked");

    // Genuinely nothing open is `idle`…
    const idle = await runAutonomousRuntime({
      survey: async () => ({ ok: true as const, gaps: [], knowledge: EMPTY_KNOWLEDGE, stale: [] }),
      runEpisode: scripted(() => ({})).run,
    });
    expect(idle.stop).toBe("idle");

    // …and being unable to LOOK is a third thing again.
    const blind = await runAutonomousRuntime({ survey: NO_SURVEY });
    expect(blind.stop).toBe("blind");
    expect(blind.surveyRefusals).toBeGreaterThan(0);
    expect(blind.stopDetail).toContain("refused");
  });

  it("blindness stops GENERATION, not execution", async () => {
    const { run, seen } = scripted(() => ({ status: "success" }));
    const queued = userObjective(
      { id: "queued", statement: "s", requires: [{ conceptId: "a", importance: 1 }] },
      0,
    );
    const report = await runAutonomousRuntime({
      survey: NO_SURVEY,
      runEpisode: run,
      seed: [queued],
    });
    // Stopping outright on the first refusal would throw away queued work —
    // the same mistake as ending the runtime on one blocked objective.
    expect(seen).toEqual(["queued"]);
    expect(report.surveyRefusals).toBeGreaterThan(0);
    // And THEN it reports that it cannot look — `blind`, not `idle`. The
    // queued work ran first; the refusal only decided what the empty backlog
    // meant afterwards. (This assertion said `idle` on its first draft and the
    // code was right: a runtime whose survey is still refusing has not
    // established that there is nothing to learn.)
    expect(report.stop).toBe("blind");
  });

  it("THE EPISODE BOUND IS ON THIS INVOCATION, NOT ON THE LIFETIME", async () => {
    // Read against `snapshot.episode` instead, a restored runtime is DEAD ON
    // ARRIVAL: the counter persists across processes, so the second process to
    // open a checkpoint that already reached the bound stops before its first
    // episode, forever, reporting `max_episodes` as though it had done work.
    // Invisible to a single-process test; found by running two.
    const store = memoryStore();
    const bounds = { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 2, maxConsecutiveBlocked: 99 };
    const first = await runAutonomousRuntime({
      survey: surveyOf(["a", "b", "c", "d"]),
      runEpisode: scripted(() => ({ status: "success" })).run,
      store,
      bounds,
    });
    expect(first.episodes).toBe(2);
    expect(first.stop).toBe("max_episodes");

    const second = await runAutonomousRuntime({
      survey: surveyOf(["a", "b", "c", "d"]),
      runEpisode: scripted(() => ({ status: "success" })).run,
      store,
      bounds,
    });
    expect(second.restored).toBe(true);
    expect(second.episodes).toBe(2);
    expect(second.snapshot.episode).toBe(4);
  });

  it("checkpoints, restores, and continues where the previous process stopped", async () => {
    const store = memoryStore();
    const bounds = { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 1, maxConsecutiveBlocked: 99 };
    const survey = surveyOf(["a", "b", "c"]);

    const p1 = await runAutonomousRuntime({
      survey,
      runEpisode: scripted(() => ({ status: "success", settled: ["x"] })).run,
      store,
      bounds,
    });
    expect(p1.restored).toBe(false);
    expect(p1.checkpoints).toBeGreaterThan(0);
    expect(p1.checkpoints).toBeLessThanOrEqual(p1.checkpointAttempts);

    const p2 = await runAutonomousRuntime({
      survey,
      runEpisode: scripted(() => ({ status: "success", settled: ["y"] })).run,
      store,
      bounds,
    });
    expect(p2.restored).toBe(true);
    // The history is CARRIED, not restarted: episode 0 belongs to the first
    // process and is still in the record the second one hands back.
    expect(p2.history.length).toBe(p1.history.length + 1);
    expect(p2.history[0]!.goalId).toBe(p1.history[0]!.goalId);
    expect(p2.history[0]!.settled).toEqual(["x"]);
    // The first process's completed objective is still done, so the second
    // does not redo it.
    const done = p2.snapshot.backlog.filter((o) => o.status === "done").map((o) => o.goal.id);
    expect(done).toContain(p1.history[0]!.goalId);
    expect(p2.history[1]!.goalId).not.toBe(p1.history[0]!.goalId);
  });

  it("a store that keeps nothing reports 0, and cannot be mistaken for one that works", async () => {
    const report = await runAutonomousRuntime({
      survey: surveyOf(["a"]),
      runEpisode: scripted(() => ({ status: "success" })).run,
      store: NO_CHECKPOINTS,
    });
    expect(report.checkpointAttempts).toBeGreaterThan(0);
    expect(report.checkpoints).toBe(0);
    expect(report.restored).toBe(false);
  });

  it("refuses a snapshot from a version it does not know rather than migrating it", () => {
    const good = emptySnapshot();
    expect(validateSnapshot(good)).toEqual([]);
    expect(validateSnapshot({ ...good, version: SNAPSHOT_VERSION + 1 })[0]!.code).toBe(
      "version_mismatch",
    );
    expect(validateSnapshot({ ...good, episode: -1 })[0]!.code).toBe("bad_episode");
    const orphan = { ...blocked(), parentId: "nobody" };
    expect(validateSnapshot({ ...good, backlog: [orphan] })[0]!.code).toBe("orphan_follow_up");
    const dup = blocked();
    expect(validateSnapshot({ ...good, backlog: [dup, dup] })[0]!.code).toBe("duplicate_objective");
  });

  it("a completed follow-up releases its parent, and an exhausted one abandons it", () => {
    const parent = blocked({ attempts: 1 });
    const child = { ...followUpFor(parent, 1)!, status: "done" as const };
    const released = reawaken([parent, child], child.id);
    expect(released.find((o) => o.id === parent.id)!.status).toBe("pending");

    const spent = { ...parent, attempts: MAX_ATTEMPTS };
    const abandoned = reawaken([spent, child], child.id);
    expect(abandoned.find((o) => o.id === spent.id)!.status).toBe("abandoned");

    // A DIFFERENT objective completing releases nothing — otherwise any
    // success anywhere would revive every blocked objective in the backlog.
    expect(reawaken([parent, child], "some-other-id").find((o) => o.id === parent.id)!.status).toBe(
      "blocked",
    );
  });

  it("with nothing wired at all it blocks, names nothing, and stalls honestly", async () => {
    const report = await runAutonomousRuntime({
      survey: surveyOf(["a", "b", "c", "d"]),
      runEpisode: REFUSING_EPISODE,
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxConsecutiveBlocked: 2 },
    });
    expect(report.stop).toBe("stalled");
    // Nothing named means no follow-up: a runtime that generated objectives
    // about a fault it invented would look busy and learn nothing.
    for (const h of report.history) expect(h.followUpId).toBeNull();
    expect(report.learned).toEqual([]);
  });

  it("trimming a full backlog never drops what carries history", async () => {
    const { run } = scripted((goalId) =>
      goalId === "learn:a"
        ? { status: "blocked", blockedOn: [], blockedReason: "stuck" }
        : { status: "success" },
    );
    const report = await runAutonomousRuntime({
      survey: surveyOf(["a", "b", "c", "d", "e", "f"]),
      runEpisode: run,
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxBacklog: 2, maxConsecutiveBlocked: 99 },
    });
    const kept = report.snapshot.backlog.filter((o) => o.status !== "pending");
    expect(kept.length).toBeGreaterThan(0);
    for (const o of kept) expect(["blocked", "done", "abandoned", "active"]).toContain(o.status);
    // Dropping an attempted objective would make the runtime forget what it
    // already tried and re-queue it forever.
    expect(kept.some((o) => o.goal.id === "learn:a")).toBe(true);
  });
});

/* ================================================================ *
 * THE BOUNDARY — the kernel stays inert; the runtime side fills it.
 * ================================================================ */

describe("v1.5 — the autonomy kernel is inert by construction", () => {
  const FILES = [
    "src/oqca/autonomy/objective.ts",
    "src/oqca/autonomy/select.ts",
    "src/oqca/autonomy/runtime.ts",
  ];

  it("every seam that could reach the world has a REFUSING default", async () => {
    // Assembled with nothing at all: it must not throw, must not act, and must
    // say what it could not do rather than reporting success.
    const report = await runAutonomousRuntime({});
    expect(report.stop).toBe("blind");
    expect(report.episodes).toBe(0);
    expect(report.checkpoints).toBe(0);
    expect(report.generated).toBe(0);
    expect(report.learned).toEqual([]);
  });

  it("the kernel is mirrored byte for byte into the tree that ships", () => {
    for (const f of FILES) {
      const mirrored = f.replace("src/oqca/", "supabase/functions/_shared/oqca/");
      expect(readFileSync(mirrored, "utf8")).toBe(readFileSync(f, "utf8"));
    }
  });

  it("nothing in the kernel imports the runtime side", () => {
    // The dependency runs one way. An import back into `_shared/oqcaRuntime`
    // would put a clock and a client inside the tree `security.test.ts` walks,
    // and the walk would still pass because the offending code lives elsewhere.
    for (const f of FILES) {
      const text = stripComments(readFileSync(f, "utf8"));
      expect(text).not.toMatch(/oqcaRuntime/);
      expect(text).not.toMatch(/from\s+["'][^"']*\/functions\//);
    }
  });
});

/* ================================================================ *
 * REACHABILITY — the kernel driven by the code that would ship.
 * ================================================================ */

describe("v1.5 — the autonomous runtime is reachable from the runtime tree", () => {
  const AT = "2026-09-10T12:00:00Z";
  const T0 = Date.parse(AT);
  const ctx = { at: () => AT, nowMs: () => T0, resolved: () => false };

  it("one standing goal, and it is the domain's own", () => {
    // A second standing goal invented for autonomy would be a second answer to
    // what ONIQ is trying to do, and the two would drift the first time either
    // was edited.
    expect(STANDING_GOAL).toBe(DISPATCH_GOAL);
  });

  it("runs a real lifecycle over the real substrate and reaches a real verdict", async () => {
    const report = await runAutonomousRuntime({
      survey: makeSubstrateSurvey(ctx),
      runEpisode: makeLoopEpisode(ctx),
      bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: 3 },
    });
    // It generated an objective with nobody asking, ran it through the 23
    // stations against knowledge it built itself, and reached the honest
    // answer: `runner-availability` is the one thing this function cannot see.
    expect(report.generated).toBeGreaterThan(0);
    expect(report.history.length).toBeGreaterThan(0);
    expect(report.history.every((h) => h.source !== "user_request")).toBe(true);
    const blockedOn = report.snapshot.backlog
      .filter((o) => o.status === "blocked")
      .flatMap((o) => o.blockedOn);
    expect(blockedOn).toContain("runner-availability");
    /**
     * v1.6 CHANGED THIS ASSERTION FROM `stalled`, AND THE CHANGE IS THE POINT
     * RATHER THAN A WEAKENING. At the shipped budgets every model call is
     * refused for want of an allowance, so what actually stopped this lifecycle
     * was a RESOURCE and not the end of ONIQ's ideas. `stalled` said the
     * second; `capability_blocked` says the first, and it names the thing
     * somebody can go and turn on. Both arms stay live — a scripted episode
     * that blocks with no capability refused still reports `stalled`, asserted
     * in the lifecycle tests above.
     */
    expect(report.stop).toBe("capability_blocked");
    expect(report.capabilityBlocks).toBeGreaterThan(0);
    /**
     * TWO REFUSALS, TWO DIFFERENT KINDS, AND THE MEASURED RUN IS WHAT SAYS SO.
     * The model is refused by a number ONIQ set for itself; RESEARCH is refused
     * because no adapter is wired at all. Collapsing those into one "blocked"
     * would send whoever reads the log to raise a budget that would not help.
     * Neither is `unauthorized`: a bound ONIQ owns must never be able to speak
     * for a provider's decision about who ONIQ is (requirement 10).
     */
    const byName = new Map(report.capabilities.map((c) => [c.capability, c]));
    expect(byName.get("model")).toMatchObject({
      availability: "insufficient_allowance",
      bound: "max_tokens",
    });
    expect(byName.get("research")).toMatchObject({
      availability: "provider_unavailable",
      bound: null,
    });
    expect(report.capabilities.some((c) => c.availability === "unauthorized")).toBe(false);
    // And the dependency is PERSISTED on the objective, not merely counted, so
    // the next invocation can reconsider it.
    const waiting = report.snapshot.backlog.filter((o) => o.blockedCapabilities.length > 0);
    expect(waiting.length).toBeGreaterThan(0);
  });

  it("an episode over this substrate LEARNS NOTHING, and that is pinned", async () => {
    // `buildSubstrate` re-ingests deterministically every tick, so there is no
    // write-back and an episode cannot move the store. Reporting the
    // objective's already-verified concepts as `learned` was a real over-claim
    // in the first version of this file, caught by running it. The day a
    // durable knowledge table exists, this assertion is the one that has to be
    // changed deliberately rather than a metric quietly becoming true.
    const episode = makeLoopEpisode(ctx);
    const settledObjective = userObjective(
      {
        id: "already-known",
        statement: "s",
        requires: [{ conceptId: "queue-eligibility", importance: 1 }],
      },
      0,
    );
    const out = await episode(settledObjective, { episode: 0, step: 0, focus: null });
    expect(out.status).toBe("success");
    expect(out.settled).toEqual(["queue-eligibility"]);
    expect(out.learned).toEqual([]);
    expect(out.note).toContain("nothing was learned");
  });

  it("surveys the standing goal AND the focus, not one or the other", async () => {
    const survey = makeSubstrateSurvey(ctx);
    const focus: Goal = {
      id: "focus",
      statement: "s",
      requires: [{ conceptId: "a-concept-the-domain-never-names", importance: 1 }],
    };
    const wide = await survey({ episode: 0, step: 0, focus });
    const narrow = await survey({ episode: 0, step: 0, focus: null });
    expect(wide.ok && narrow.ok).toBe(true);
    if (!wide.ok || !narrow.ok) return;
    const ids = wide.gaps.map((g) => g.conceptId);
    // Only the focus and the runtime narrows onto whatever it happened to pick;
    // only the standing goal and it can never pursue a question it raised itself.
    expect(ids).toContain("a-concept-the-domain-never-names");
    expect(ids).toContain("runner-availability");
    expect(narrow.gaps.map((g) => g.conceptId)).not.toContain("a-concept-the-domain-never-names");
  });

  it("maintenance is scoped to what the current goals depend on", () => {
    const later = T0 + 400 * 86_400_000;
    const build = buildSubstrate({ at: AT, nowMs: T0, resolved: () => false });
    const all = build.store.all();
    expect(all.length).toBeGreaterThan(100);

    // Nothing at all is stale at the instant the records were written — which
    // is production's permanent state, because the store is rebuilt per tick.
    expect(staleSubjectsFor(all, T0, [STANDING_GOAL])).toEqual([]);

    const stale = staleSubjectsFor(all, later, [STANDING_GOAL]);
    expect(stale.length).toBeGreaterThan(0);
    const required = new Set(STANDING_GOAL.requires.map((r) => r.conceptId));
    // Re-verifying everything would put a hundred objectives in the backlog on
    // the first cycle and leave `maxBacklog` deciding what ONIQ cares about.
    for (const s of stale) {
      expect(required.has(s.conceptId)).toBe(true);
      expect(s.demand).toBeGreaterThan(0);
      expect(s.importance).toBeGreaterThan(0);
    }
  });

  it("names the actions that would help as UNAVAILABLE rather than offering them", () => {
    const state = objectiveState(
      {
        id: "g",
        statement: "s",
        requires: [{ conceptId: "runner-availability", importance: 1 }],
      },
      DEFAULT_BUDGETS,
    );
    // A world that OFFERED `research runner-availability` would have the loop
    // plan it, call a router with no such tool, and report a tool failure —
    // which reads as a broken integration. What is true is that ONIQ has no
    // research capability at all, and the world model is where that is said.
    expect(state.worldState.availableActions).toEqual([]);
    expect(state.worldState.unavailableActions).toContain("research runner-availability");
    expect(state.activeHypotheses).toEqual(["runner-availability"]);
  });

  it("a checkpoint from another version is refused and NOTED, not silently dropped", async () => {
    const notes: string[] = [];
    let held: string | null = null;
    const store = makeSinkCheckpointStore({
      write: async (json) => {
        held = json;
        return true;
      },
      read: async () => held,
      note: (m) => notes.push(m),
    });

    const good = { ...emptySnapshot(), episode: 3 };
    expect(await store.checkpoint(good)).toBe(true);
    expect((await store.restore())!.episode).toBe(3);
    expect(notes).toEqual([]);

    // Silently starting fresh would lose an entire backlog with no line
    // anywhere saying it happened.
    held = JSON.stringify({ ...good, version: SNAPSHOT_VERSION + 1 });
    expect(await store.restore()).toBeNull();
    expect(notes.join(" ")).toContain("version");

    held = "{not json";
    expect(await store.restore()).toBeNull();
    expect(notes.length).toBe(2);
  });

  it("says what a durable, hosted runtime still lacks", () => {
    expect(autonomyGap()).toMatch(/no server/);
  });
});
