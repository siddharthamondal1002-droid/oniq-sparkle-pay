/**
 * ONIQ AGI MEGA QUANTUM LOOP — the 23 stations. Owner brief sections 1–2, 32.
 *
 * TWO OF THE BRIEF'S STATIONS SHARE A NAME WITH A CATEGORY-C QUANTUM OPERATION
 * AND ARE NOT IT. This is the first thing to get right, because v1.1 refuses
 * `ENTANGLE` and `CORRECT` by name and the obvious reading is that stations 07
 * and 19 inherit that refusal. They do not:
 *
 *   07 RELATIONAL BINDING  "represent dependencies between concepts" — a graph
 *                          over `WorldState.relations`. Performable. It is NOT
 *                          `cognitive.entangle`, which is category C because
 *                          nothing here factors a basis into subsystems.
 *   19 CORRECT             "determine why prediction != reality and correct the
 *                          appropriate layer" — a diagnosis over the outcome
 *                          record. Performable. It is NOT quantum error
 *                          correction, which is category C because there is no
 *                          code space and no syndrome.
 *
 * Blurring those would either cripple two working stations or claim two
 * physical operations ONIQ does not have. Both names are therefore distinct
 * from the quantum ones in `cognitive.ts`, and `cognitiveLoop.test.ts` asserts
 * the loop never calls the category-C functions.
 *
 * WHAT SPENDS, AND WHERE. Six stations can reach the model and one can reach
 * the world. Every one of them is bounded BEFORE the call, never after — the
 * health gateway's rule, which exists because a receipt written after the
 * provider ran cannot refuse anything. `breach` is checked at the top of every
 * station and `wouldBreach` again immediately before each spend.
 *
 * NOTHING IN THIS FILE CAN REACH A NETWORK. The engine, the router, the clock
 * and the memory store are arguments with refusing defaults; `security.test.ts`
 * still walks this directory and still finds no fetch, no credential and no
 * clock. That is what makes "the loop may write to production" and "the kernel
 * provably cannot" both true at once.
 */
import { CognitiveState } from "../formalState";
import { evidence, interfere, phase, superpose } from "../cognitive";
import { detectGaps, openGaps, type Gap } from "../knowledge/gaps";
import { planResearch, type ResearchPlan } from "../knowledge/planner";
import type { KnowledgeState } from "../knowledge/model";
import {
  type Budgets,
  type Clock,
  type Engine,
  type EngineKind,
  type MemoryStore,
  type Spent,
  type ToolResult,
  type ToolRouter,
  DEFAULT_BUDGETS,
  EMPTY_MEMORY,
  NO_SPEND,
  REFUSING_ENGINE,
  REFUSING_ROUTER,
  addUsage,
  type BoundBreach,
  breachRun,
  deterministicClock,
  wouldBreach,
} from "./seams";
import {
  type ImaginedFuture,
  type LoopState,
  type Outcome,
  type Percept,
  type Plan,
  type Prediction,
  advance,
  isTerminal,
} from "./loopState";

/** The brief's diagram, in order. 19 is a branch and records which arm ran. */
export const STATIONS = [
  "PERCEIVE",
  "UNDERSTAND",
  "LOAD_MEMORY",
  "BUILD_WORLD_STATE",
  "REPRESENT",
  "SUPERPOSE",
  "RELATE",
  "REASON",
  "IDENTIFY_GAPS",
  "RESEARCH",
  "VERIFY",
  "UPDATE_STATE",
  "IMAGINE",
  "PLAN",
  "EVALUATE",
  "ACT",
  "OBSERVE",
  "MEASURE",
  "LEARN_OR_CORRECT",
  "CONSOLIDATE",
  "REFLECT",
  "CHECK_GOAL",
  "RESPOND",
] as const;

export type Station = (typeof STATIONS)[number];

/** The six stations permitted to call the model, and nothing else may. */
export const ENGINE_STATIONS: Readonly<Record<string, EngineKind>> = {
  UNDERSTAND: "understand",
  REASON: "reason",
  VERIFY: "verify",
  IMAGINE: "imagine",
  EVALUATE: "evaluate",
  REFLECT: "reflect",
  RESPOND: "respond",
};

export type StationRecord = {
  readonly iteration: number;
  readonly station: Station;
  readonly note: string;
  /** Non-null when the station could not do its job, naming why. */
  readonly refused: string | null;
  readonly stateId: string;
  readonly spent: Spent;
};

/**
 * The evidence and the contextual fact for ONE iteration, supplied by the
 * CALLER. Nothing in this loop derives a likelihood vector or a phase from
 * prose: v1.1 measured that `interfere(a, b, theta)` returns the opposite label
 * at the identical confidence when the pair is named the other way round, so a
 * phase invented here would be the loop asserting a fact about evidence that is
 * really a fact about its own argument order. An iteration with no entry folds
 * in no evidence and says so.
 */
export type IterationEvidence = {
  /** One likelihood per basis element, or null for an iteration with no news. */
  readonly likelihoods?: readonly number[] | null;
  /** Section 15's "update phase/context" — radians per hypothesis. */
  readonly phases?: readonly number[];
  /** [i, j, theta] — the interference that reads a phase back out. */
  readonly interfere?: readonly [number, number, number];
  readonly evidenceIds?: readonly string[];
};

export type LoopInput = {
  readonly initial: LoopState;
  readonly quantum: CognitiveState;
  readonly percepts?: readonly (readonly Percept[])[];
  readonly evidence?: readonly IterationEvidence[];
  readonly knowledge?: KnowledgeState;
  readonly budgets?: Budgets;
  readonly engine?: Engine;
  readonly router?: ToolRouter;
  readonly clock?: Clock;
  readonly memory?: MemoryStore;
  /** Pause after N stations, for a resumable run. */
  readonly stopAfterStations?: number;
};

export type LoopRun = {
  readonly state: LoopState;
  readonly quantum: CognitiveState;
  readonly log: readonly StationRecord[];
  readonly research: ResearchPlan | null;
  readonly gaps: readonly Gap[];
  readonly answer: string | null;
  readonly spent: Spent;
  /** Why it stopped. "completed" only when CHECK_GOAL said so. */
  readonly terminated: string;
};

/**
 * The engine's reply is TEXT and this loop never pretends otherwise. A station
 * that needs structure asks for one line and takes the first; a station that
 * needs prose keeps the prose. Nothing here parses JSON out of a model reply
 * and treats a parse failure as an empty answer — that is how a refusal becomes
 * a fact with no evidence behind it.
 */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ""
  );
}

export async function runCognitiveLoop(input: LoopInput): Promise<LoopRun> {
  const budgets = input.budgets ?? DEFAULT_BUDGETS;
  const engine = input.engine ?? REFUSING_ENGINE;
  const router = input.router ?? REFUSING_ROUTER;
  const clock = input.clock ?? deterministicClock();
  const memory = input.memory ?? EMPTY_MEMORY;

  let state = input.initial;
  let quantum = input.quantum;
  let spent: Spent = { ...NO_SPEND };
  let gaps: Gap[] = [];
  let research: ResearchPlan | null = null;
  let answer: string | null = null;
  let terminated = "completed";
  let stationsRun = 0;
  const log: StationRecord[] = [];
  // Carried from ACT to OBSERVE within one iteration and never hashed: the
  // environment's answer is not part of the committed record until OBSERVE
  // has judged it against the prediction. LOCAL, not module-level — a
  // module-level binding would be shared by two concurrent runs, which is a
  // cross-run data leak that no test with one run could ever see.
  let lastResults: { step: string; result: ToolResult }[] = [];
  // Set when a model call was refused for lack of tokens or money. The loop
  // does NOT break out on it: the non-spending stations still have work to
  // do and RESPOND can still say what was reached. CHECK_GOAL turns it into
  // a terminal status so the run ends cleanly at the end of its cycle.
  let starvedBy: BoundBreach | null = null;

  const note = (station: Station, text: string, refused: string | null = null) => {
    log.push({
      iteration: spent.iterations,
      station,
      note: text,
      refused,
      stateId: state.stateId,
      spent: { ...spent },
    });
  };

  /** Every model call goes through here, so no station can skip the gate. */
  const ask = async (station: Station, prompt: string, maxOutputTokens: number) => {
    const kind = ENGINE_STATIONS[station];
    if (!kind) return { ok: false as const, text: "", reason: `${station} may not call the model` };
    const b = wouldBreach(spent, budgets, { tokens: maxOutputTokens });
    if (b) {
      starvedBy = b;
      return { ok: false as const, text: "", reason: b };
    }
    const reply = await engine({ kind, prompt, maxOutputTokens });
    spent = addUsage(spent, reply.usage);
    if (!reply.ok)
      return { ok: false as const, text: "", reason: reply.reason ?? "engine refused" };
    return { ok: true as const, text: reply.text, reason: undefined };
  };

  outer: while (spent.iterations < budgets.maxIterations) {
    const percepts = input.percepts?.[spent.iterations] ?? [];

    for (const station of STATIONS) {
      if (input.stopAfterStations !== undefined && stationsRun >= input.stopAfterStations) {
        terminated = "paused";
        break outer;
      }
      stationsRun++;

      // The elapsed reading is taken once per station, from the seam, and
      // recorded — so a replay is driven by the recording rather than by a
      // second real clock that will not agree with the first.
      spent = { ...spent, elapsedMs: clock() };
      const bound = breachRun(spent, budgets);
      if (bound) {
        terminated = bound;
        state = advance(state, { status: "budget_exhausted", spent });
        note(station, `stopped: ${bound}`, bound);
        break outer;
      }

      switch (station) {
        case "PERCEIVE":
          state = advance(state, { percepts: [...state.percepts, ...percepts], spent });
          note(
            station,
            `${percepts.length} percepts this iteration, ${state.percepts.length} held`,
          );
          break;

        case "UNDERSTAND": {
          // The goal is SUPPLIED, and the model's job is to say what is
          // ambiguous about it — not to replace it. A station that let a model
          // rewrite the objective would make every later success criterion the
          // model's own, which is not a goal, it is a mark it set itself.
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nPercepts:\n${state.percepts.map((p) => `- [${p.kind}] ${p.content}`).join("\n") || "- none"}\n\nName in one line what is AMBIGUOUS about this goal, or say NOTHING AMBIGUOUS.`,
            120,
          );
          note(station, r.ok ? firstLine(r.text) : "goal taken as given", r.ok ? null : r.reason!);
          break;
        }

        case "LOAD_MEMORY": {
          const recalled = await memory.recall(state.goal.statement, 8);
          state = advance(state, { memoryRefs: recalled, spent });
          note(station, `${recalled.length} records recalled (relevance-bounded at 8)`);
          break;
        }

        case "BUILD_WORLD_STATE":
          note(
            station,
            `${state.worldState.entities.length} entities, ${state.worldState.relations.length} relations, ` +
              `${state.worldState.availableActions.length} actions available and ${state.worldState.unavailableActions.length} not`,
          );
          break;

        case "REPRESENT":
          note(station, `basis ${quantum.basis.length}, norm ${quantum.norm().toFixed(12)}`);
          break;

        case "SUPERPOSE": {
          const admit = state.goal.requires.find((r) => !quantum.basis.includes(r.conceptId));
          if (admit) {
            quantum = superpose(quantum, admit.conceptId, 1 / (quantum.basis.length + 1));
            spent = { ...spent, transitions: spent.transitions + 1 };
            note(station, `admitted ${admit.conceptId}`);
          } else {
            note(station, "no new hypothesis admitted");
          }
          break;
        }

        case "RELATE":
          // Performable — see the header. A graph over the world model, not
          // `cognitive.entangle`, which is category C and is never called here.
          note(station, `${state.worldState.relations.length} dependencies bound`);
          break;

        case "REASON": {
          const c = quantum.confidence();
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nLeading hypothesis: ${c.top} at ${c.probability.toFixed(4)} (entropy ${c.entropy.toFixed(4)} bits)\nWhat single step most advances the goal? One line.`,
            200,
          );
          note(
            station,
            r.ok
              ? `${firstLine(r.text)} [leading ${c.top} p=${c.probability.toFixed(4)}]`
              : `leading ${c.top} at ${c.probability.toFixed(4)}, margin ${c.margin.toFixed(4)}`,
            r.ok ? null : r.reason!,
          );
          break;
        }

        case "IDENTIFY_GAPS":
          if (input.knowledge) {
            gaps = detectGaps(state.goal, input.knowledge);
            state = advance(state, { knowledgeGaps: gaps, spent });
            note(station, `${openGaps(gaps).length} open of ${gaps.length}`);
          } else {
            note(station, "no knowledge state supplied", "no_knowledge_state");
          }
          break;

        case "RESEARCH":
          if (gaps.length === 0) {
            note(station, "no gaps to research");
          } else if (spent.researchOperations >= budgets.maxResearchOperations) {
            terminated = "max_research_operations";
            note(station, "research bound reached", "max_research_operations");
            break outer;
          } else {
            spent = { ...spent, researchOperations: spent.researchOperations + 1 };
            research = planResearch(state.goal.id, gaps);
            // Section 13 asks for acquisition. Planning is what happens without
            // a router that may reach a source; the acquisition itself is a
            // tool call and goes through ACT under the same budget as any other.
            note(station, `next question: ${research.next?.concept ?? "nothing worth asking"}`);
          }
          break;

        case "VERIFY": {
          // Section 14: unverified information stays EXPLICITLY uncertain. The
          // station therefore records a verdict per claim and never upgrades a
          // claim it could not check.
          const claims = research?.next ? [research.next.concept] : [];
          if (claims.length === 0) {
            note(station, "nothing to verify this iteration");
            break;
          }
          const r = await ask(
            station,
            `For each claim, answer SUPPORTED, CONTRADICTED or UNVERIFIED and nothing else.\n${claims.map((c) => `- ${c}`).join("\n")}`,
            160,
          );
          note(
            station,
            r.ok ? firstLine(r.text) : "claims remain UNVERIFIED",
            r.ok ? null : r.reason!,
          );
          break;
        }

        case "UPDATE_STATE": {
          // Section 15, in its own order: evidence, then probabilities, then
          // phase/context. All three come from the CALLER — see IterationEvidence.
          const ev = input.evidence?.[spent.iterations];
          const parts: string[] = [];
          if (ev?.likelihoods) {
            if (ev.likelihoods.length !== quantum.basis.length) {
              // Refused by name rather than padded. Padding would invent a
              // likelihood for a hypothesis nobody has evidence about, which is
              // the v1.1 lesson from SUPERPOSE running before EVIDENCE_UPDATE.
              note(
                station,
                `${ev.likelihoods.length} likelihoods against a basis of ${quantum.basis.length}`,
                "likelihood_width_mismatch",
              );
              break;
            }
            quantum = evidence(quantum, ev.likelihoods, { evidenceIds: ev.evidenceIds });
            spent = { ...spent, transitions: spent.transitions + 1 };
            parts.push("evidence folded in (Bayes-exact)");
          }
          if (ev?.phases) {
            ev.phases.forEach((theta, i) => {
              if (theta !== 0 && i < quantum.basis.length) {
                quantum = phase(quantum, quantum.basis[i], theta);
                spent = { ...spent, transitions: spent.transitions + 1 };
              }
            });
            if (ev.phases.some((t) => t !== 0)) parts.push("context applied as phase");
          }
          if (ev?.interfere) {
            const [i, j, theta] = ev.interfere;
            if (i < quantum.basis.length && j < quantum.basis.length && i !== j) {
              quantum = interfere(quantum, quantum.basis[i], quantum.basis[j], theta);
              spent = { ...spent, transitions: spent.transitions + 1 };
              parts.push(`interfered (${quantum.basis[i]}, ${quantum.basis[j]})`);
            }
          }
          note(station, parts.join("; ") || "no evidence this iteration");
          break;
        }

        case "IMAGINE": {
          const actions = state.worldState.availableActions;
          if (actions.length === 0) {
            note(station, "no available actions to imagine", "no_available_actions");
            break;
          }
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nAvailable actions:\n${actions.map((a) => `- ${a}`).join("\n")}\nFor each, one line: ACTION | expected result | risk 0-1 | goal progress 0-1.`,
            400,
          );
          // The futures are built from the ACTION LIST, not from the reply, so a
          // model cannot invent an action that is not available. Its text only
          // supplies the expectation; an unparsed reply leaves the honest
          // default rather than dropping the action.
          const lines = r.ok ? r.text.split("\n") : [];
          const futures: ImaginedFuture[] = actions.map((action, i) => {
            const said = lines.find((l) => l.includes(action)) ?? "";
            const nums = said.match(/0?\.\d+|[01](?!\d)/g)?.map(Number) ?? [];
            const risk = nums[0] ?? 0.5;
            const goalProgress = nums[1] ?? 0.5;
            return {
              action,
              expectedResult: said.split("|")[1]?.trim() || "unknown",
              risk: Math.min(1, Math.max(0, risk)),
              cost: 0,
              uncertainty: r.ok ? 0.5 : 1,
              reversible: !/delete|drop|purge|overwrite/i.test(action),
              goalProgress: Math.min(1, Math.max(0, goalProgress)),
              expectedValue:
                Math.min(1, Math.max(0, goalProgress)) * (1 - Math.min(1, Math.max(0, risk))),
            } satisfies ImaginedFuture;
          });
          state = advance(state, { futures, spent });
          note(
            station,
            `${futures.length} futures scored${r.ok ? "" : " (engine refused; defaults used)"}`,
            r.ok ? null : r.reason!,
          );
          break;
        }

        case "PLAN": {
          const best = [...state.futures].sort((a, b) => b.expectedValue - a.expectedValue)[0];
          if (!best) {
            note(station, "nothing to plan", "no_futures");
            break;
          }
          const plan: Plan = {
            id: `plan-${state.iteration}-${best.action}`,
            objective: state.goal.statement,
            steps: [
              {
                id: "s1",
                describes: best.action,
                dependsOn: [],
                call: {
                  tool: best.action,
                  input: {},
                  reversible: best.reversible,
                  touchesProduction: !best.reversible,
                  rationale: best.expectedResult,
                },
              },
            ],
            requiredTools: [best.action],
            risks: best.risk > 0.5 ? [`risk ${best.risk.toFixed(2)}`] : [],
            rollback: best.reversible ? "action is reversible" : null,
            successCriteria: [state.goal.statement],
          };
          state = advance(state, { candidatePlans: [plan], selectedPlan: plan, spent });
          note(station, `selected ${plan.id} (EV ${best.expectedValue.toFixed(3)})`);
          break;
        }

        case "EVALUATE": {
          const plan = state.selectedPlan;
          if (!plan) {
            note(station, "no plan to evaluate", "no_plan");
            break;
          }
          // Section 18's questions, answered in code rather than by the model,
          // because "is this reversible" and "is there budget" are facts the
          // runtime holds and a model would be guessing at.
          const irreversible = plan.steps.filter((s) => s.call && !s.call.reversible);
          const wouldSpend = wouldBreach(spent, budgets, {});
          if (wouldSpend) {
            state = advance(state, { selectedPlan: null, status: "budget_exhausted", spent });
            note(station, `refused: ${wouldSpend}`, wouldSpend);
            terminated = wouldSpend;
            break outer;
          }
          if (irreversible.length > 0 && !plan.rollback) {
            state = advance(state, { selectedPlan: null, spent });
            note(
              station,
              `refused: ${irreversible.length} irreversible step(s) with no rollback`,
              "irreversible_no_rollback",
            );
            break;
          }
          note(station, "plan valid, budget available, rollback present or unneeded");
          break;
        }

        case "ACT": {
          const plan = state.selectedPlan;
          if (!plan) {
            note(station, "nothing to act on", "no_plan");
            break;
          }
          const predictions: Prediction[] = [];
          const results: { step: string; result: ToolResult }[] = [];
          for (const step of plan.steps) {
            if (!step.call) continue;
            if (spent.toolCalls >= budgets.maxToolCalls) {
              note(station, "tool-call bound reached", "max_tool_calls");
              terminated = "max_tool_calls";
              break outer;
            }
            spent = { ...spent, toolCalls: spent.toolCalls + 1 };
            predictions.push({ stepId: step.id, expected: step.describes });
            const result = await router(step.call);
            spent = addUsage(spent, result.usage);
            results.push({ step: step.id, result });
          }
          state = advance(state, { predictions, spent });
          note(station, `${results.length} action(s) attempted`);
          // OBSERVE reads these; carrying them on the state would make the
          // environment's answer part of the hashed record before it is judged.
          lastResults = results;
          break;
        }

        case "OBSERVE": {
          // Section 20: the environment is the authority. `observed` is the
          // environment's word and `output` is the tool's; a router that echoes
          // one into the other is caught by them being separate fields.
          const outcomes: Outcome[] = lastResults.map(({ step, result }) => {
            const expected = state.predictions.find((p) => p.stepId === step)?.expected ?? "";
            const matched =
              result.ok &&
              result.observed.length > 0 &&
              !/not performed|nothing was attempted/i.test(result.observed);
            return {
              stepId: step,
              observed: result.observed,
              matched,
              predictionError: matched ? 0 : 1,
            } satisfies Outcome;
          });
          state = advance(state, { outcomes, spent });
          note(
            station,
            outcomes.length
              ? `${outcomes.filter((o) => o.matched).length}/${outcomes.length} matched prediction`
              : "nothing to observe",
          );
          break;
        }

        case "MEASURE": {
          // `measure()` in `../measure` takes the v1.0 `state.ts` CognitiveState,
          // which is a DIFFERENT type with the same name as the v1.1 one this
          // loop carries — `labels` against `basis`. Converting between them to
          // reach that function would be work in service of a name; the v1.1
          // state answers the same question itself.
          const c = quantum.confidence();
          const errors = state.outcomes.filter((o) => !o.matched).length;
          note(
            station,
            `${c.top ?? "undecided"} p=${c.probability.toFixed(4)} margin ${c.margin.toFixed(4)}, ` +
              `${errors} prediction error(s), $${spent.costUsd.toFixed(6)} spent`,
          );
          break;
        }

        case "LEARN_OR_CORRECT": {
          const failed = state.outcomes.filter((o) => !o.matched);
          if (failed.length === 0) {
            note(station, `LEARN: ${state.outcomes.length} outcome(s) matched prediction`);
          } else {
            // Section 22: correct the LAYER, do not regenerate the answer. The
            // layer is named from what the runtime can see, and "unknown" is a
            // permitted answer — guessing a cause is what regenerating is.
            const layer =
              state.selectedPlan === null
                ? "plan"
                : failed.every((f) => /not performed/i.test(f.observed))
                  ? "tool"
                  : "unknown";
            note(station, `CORRECT: ${failed.length} mismatch(es), layer=${layer}`);
          }
          break;
        }

        case "CONSOLIDATE": {
          // Section 24: only validated information becomes durable. The filter
          // is the outcome record, not the model's confidence in itself.
          const durable =
            state.outcomes.filter((o) => o.matched).length > 0 && state.memoryRefs.length >= 0;
          const written = durable
            ? await memory.consolidate(
                state.outcomes
                  .filter((o) => o.matched)
                  .map((o) => ({
                    id: `${state.stateId}:${o.stepId}`,
                    layer: "episodic" as const,
                    text: o.observed,
                    confidence: 1 - o.predictionError,
                  })),
              )
            : 0;
          note(station, `${written} record(s) consolidated`);
          break;
        }

        case "REFLECT": {
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nOutcomes: ${state.outcomes.map((o) => `${o.stepId}=${o.matched ? "matched" : "MISMATCH"}`).join(", ") || "none"}\nWhat assumption was wrong? One line, or NONE.`,
            160,
          );
          note(
            station,
            r.ok ? firstLine(r.text) : "no reflection available",
            r.ok ? null : r.reason!,
          );
          break;
        }

        case "CHECK_GOAL": {
          const open = openGaps(gaps).length;
          const acted = state.outcomes.length > 0 && state.outcomes.every((o) => o.matched);
          if (acted && open === 0) {
            state = advance(state, { status: "success", spent });
            note(station, "success criteria satisfied");
          } else if (starvedBy) {
            state = advance(state, { status: "budget_exhausted", spent });
            terminated = starvedBy;
            note(station, `cannot continue: ${starvedBy}`, starvedBy);
          } else {
            note(
              station,
              `incomplete: ${open} open gap(s), ${state.outcomes.filter((o) => !o.matched).length} mismatch(es)`,
            );
          }
          break;
        }

        case "RESPOND": {
          if (!isTerminal(state.status)) {
            note(station, "loop continues; no answer yet");
            break;
          }
          const r = await ask(
            station,
            `Goal: ${state.goal.statement}\nStatus: ${state.status}\nSummarise in one line what was done and what remains.`,
            200,
          );
          answer = r.ok
            ? firstLine(r.text)
            : `${state.status}: ${state.outcomes.length} action(s), ${openGaps(gaps).length} open gap(s)`;
          note(station, answer, r.ok ? null : r.reason!);
          break;
        }
      }

      if (station === "RESPOND" && isTerminal(state.status)) {
        // `terminated` may already name the bound that starved the run, which is
        // more informative than the status it produced.
        if (terminated === "completed") terminated = state.status;
        break outer;
      }
    }

    spent = { ...spent, iterations: spent.iterations + 1 };
    state = advance(state, { iteration: state.iteration + 1, spent });
  }

  if (spent.iterations >= budgets.maxIterations && terminated === "completed") {
    terminated = "max_iterations";
  }

  return { state, quantum, log, research, gaps, answer, spent, terminated };
}
