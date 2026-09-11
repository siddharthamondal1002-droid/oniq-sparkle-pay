/**
 * OQCA v1.7 — WHAT ONIQ IS ENTITLED TO SAY ABOUT ITS OWN CYCLE.
 *
 * Owner directive 2026-09-11 §19 asks eight questions and adds one condition
 * that decides the whole design: _"The answers must come from recorded
 * evidence."_
 *
 * SO EVERY ANSWER IS A TRI-STATE AND CARRIES ITS RECEIPT. `yes` / `no` /
 * `unestablished`, never a boolean — a boolean forces "did my performance
 * improve?" to be answered `false` by a cycle that measured nothing, and
 * `false` is a claim: it says ONIQ checked and did not improve. The honest
 * answer is that nothing was measured, which is a third thing, and it is the
 * answer that generates the next objective ("build the measurement") instead
 * of the wrong one ("try harder").
 *
 * This is `IMPROVEMENT_UNVERIFIED` and the observation tri-state and
 * `ResearchResult`'s union, in a fourth place. The pattern is not a stylistic
 * preference in this repository: every one of them was added after a collapsed
 * state read as good news.
 *
 * Pure. Reads the episode record it is given and nothing else.
 */
import type { KnowledgeState } from "../knowledge/model.ts";
import type { ExperimentRecord } from "./experiment.ts";
import type { Observation } from "./observation.ts";
import type { SystemWorldState } from "./world.ts";

export type Answer = "yes" | "no" | "unestablished";

export type EvaluatedQuestion = {
  readonly question: string;
  readonly answer: Answer;
  /** What was read to answer it. Empty is only legal with `unestablished`. */
  readonly evidence: readonly string[];
};

export type SelfEvaluation = {
  readonly objectiveId: string;
  readonly questions: readonly EvaluatedQuestion[];
  /** Concepts this cycle could not settle. Feeds the next objective. */
  readonly remainsUnknown: readonly string[];
  /** The next concern by rank, if the world offered one. Never invented. */
  readonly investigateNext: string | null;
  readonly summary: string;
};

export type CycleEvidence = {
  readonly objectiveId: string;
  readonly goalId: string;
  readonly status: "success" | "blocked" | "failure";
  readonly settled: readonly string[];
  readonly learned: readonly string[];
  /** Durable knowledge ids this cycle actually wrote. */
  readonly persisted: readonly string[];
  readonly experiment: ExperimentRecord | null;
  readonly blockedOn: readonly string[];
  readonly blockedCapabilities: readonly string[];
  readonly world: SystemWorldState;
  /** The next-ranked concern the planner produced, or null. */
  readonly nextConcern: string | null;
};

function q(question: string, answer: Answer, evidence: readonly string[]): EvaluatedQuestion {
  return { question, answer, evidence };
}

export function selfEvaluate(e: CycleEvidence): SelfEvaluation {
  const questions: EvaluatedQuestion[] = [];

  questions.push(
    q(
      "Did I solve the objective?",
      e.status === "success" ? "yes" : e.status === "failure" ? "no" : "unestablished",
      [`episode status ${e.status} on ${e.goalId}`],
    ),
  );

  // "LEARNED" IS A STATE TRANSITION, NOT A RESTATEMENT — §10, and v1.5's own
  // correction. A cycle that confirmed two things ONIQ already held settles
  // them and learns nothing, and saying otherwise is the exact over-claim that
  // entry records.
  questions.push(
    q(
      "Did I actually learn something?",
      e.learned.length > 0 ? "yes" : e.settled.length > 0 ? "no" : "unestablished",
      e.learned.length > 0
        ? [`learned ${e.learned.join(", ")}`]
        : e.settled.length > 0
          ? [`settled ${e.settled.length} concept(s) that were already held`]
          : [],
    ),
  );

  questions.push(
    q(
      "Did my knowledge change?",
      e.persisted.length > 0 ? "yes" : "no",
      e.persisted.length > 0
        ? [`${e.persisted.length} durable row(s) written`]
        : ["no durable row was written this cycle"],
    ),
  );

  const x = e.experiment;
  questions.push(
    q(
      "Did my measured performance improve?",
      x === null
        ? "unestablished"
        : x.improvementVerified
          ? "yes"
          : x.verdict === "REGRESSED" || x.verdict === "NO_DIFFERENCE"
            ? "no"
            : "unestablished",
      x === null ? [] : [`${x.design.metric}: ${x.verdict} — ${x.rationale}`],
    ),
  );

  questions.push(
    q(
      "Was the evidence sufficient?",
      x === null
        ? "unestablished"
        : x.verdict === "INCONCLUSIVE" || x.verdict === "BLOCKED"
          ? "no"
          : "yes",
      x === null ? [] : [`verdict ${x.verdict}`],
    ),
  );

  const regressions = e.world.performance.value.regression;
  questions.push(
    q(
      "Did I introduce a regression?",
      // A cycle with no measurement cannot answer this, and `no` would be the
      // dangerous half of the guess: it is the answer that lets a change ship.
      x === null && regressions.length === 0
        ? "unestablished"
        : regressions.length > 0 || x?.verdict === "REGRESSED"
          ? "yes"
          : "no",
      regressions.length > 0 ? [`regressed metrics: ${regressions.join(", ")}`] : [],
    ),
  );

  const unknown = [
    ...new Set([
      ...e.blockedOn,
      ...e.world.observations
        .filter((o: Observation) => o.state !== "OBSERVED")
        .map((o) => `${o.kind}:${o.subject}`),
    ]),
  ].sort();

  questions.push(
    q(
      "What remains unknown?",
      unknown.length > 0 ? "yes" : "no",
      unknown.slice(0, 8).map((u) => `unresolved ${u}`),
    ),
  );

  questions.push(
    q(
      "What should I investigate next?",
      e.nextConcern ? "yes" : "unestablished",
      e.nextConcern ? [`highest-ranked remaining concern: ${e.nextConcern}`] : [],
    ),
  );

  const answered = questions.filter((x2) => x2.answer !== "unestablished").length;
  return {
    objectiveId: e.objectiveId,
    questions,
    remainsUnknown: unknown,
    investigateNext: e.nextConcern,
    summary:
      `${answered}/${questions.length} of the self-evaluation questions are answerable from ` +
      `recorded evidence; ${e.learned.length} learned, ${e.persisted.length} persisted, ` +
      `${x ? `experiment ${x.verdict}` : "no experiment"}`,
  };
}

/* ================================================================ *
 * §20 — A CURRICULUM ONIQ DERIVES RATHER THAN ONE IT IS GIVEN.
 * ================================================================ */

export type CurriculumStep = {
  readonly conceptId: string;
  /** 0 = nothing must be learned first. */
  readonly depth: number;
  readonly dependsOn: readonly string[];
  readonly informationGain: number;
};

/**
 * ORDER WHAT ONIQ SHOULD LEARN BY ITS OWN DEPENDENCY GRAPH.
 *
 * §20: _"The curriculum must emerge from dependencies and information gain."_
 * So the order is a layering of `dependsOn` — a concept sits one level below
 * its deepest prerequisite — with information gain breaking ties WITHIN a
 * layer and never across one. Letting gain cross layers would let ONIQ study
 * multi-agent motion before basic motion because the former looked more
 * interesting, which is the failure the word "curriculum" exists to name.
 *
 * A CYCLE IS NOT AN ERROR, IT IS A FINDING. Concepts in a dependency cycle
 * cannot be layered, so they are reported at the depth their resolvable
 * prerequisites reach and listed as mutually dependent by `curriculumCycles` —
 * throwing here would make one bad edge in a knowledge graph stop the loop.
 */
export function curriculum(
  knowledge: KnowledgeState,
  gain: (conceptId: string) => number,
): readonly CurriculumStep[] {
  const concepts = [...knowledge.concepts.values()];
  const depth = new Map<string, number>();
  const inProgress = new Set<string>();

  const resolve = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (inProgress.has(id)) return 0; // a cycle: see the header
    const c = knowledge.concepts.get(id);
    if (!c || c.dependsOn.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    inProgress.add(id);
    const d = 1 + Math.max(...c.dependsOn.map((p) => resolve(p)));
    inProgress.delete(id);
    depth.set(id, d);
    return d;
  };

  return concepts
    .map((c) => ({
      conceptId: c.id,
      depth: resolve(c.id),
      dependsOn: c.dependsOn,
      informationGain: gain(c.id),
    }))
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        b.informationGain - a.informationGain ||
        a.conceptId.localeCompare(b.conceptId),
    );
}

/** Concepts whose prerequisites reach back to themselves. Reported, not thrown. */
export function curriculumCycles(knowledge: KnowledgeState): readonly string[] {
  const cycles = new Set<string>();
  const visit = (id: string, seen: readonly string[]): void => {
    if (seen.includes(id)) {
      for (const s of seen.slice(seen.indexOf(id))) cycles.add(s);
      return;
    }
    const c = knowledge.concepts.get(id);
    if (!c) return;
    for (const p of c.dependsOn) visit(p, [...seen, id]);
  };
  for (const c of knowledge.concepts.values()) visit(c.id, []);
  return [...cycles].sort();
}
