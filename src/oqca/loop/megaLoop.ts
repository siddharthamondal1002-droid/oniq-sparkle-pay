/**
 * OQCA v1.1 — the Mega Quantum Loop, as a BOUNDED state machine. Brief §13.
 *
 * "Every transition must be represented explicitly. The loop must be pausable
 * and resumable from a serialized CognitiveState. Do not make it an
 * uncontrolled infinite loop."
 *
 * TWO OF THE EIGHTEEN PHASES CANNOT BE PERFORMED, AND THE LOOP SAYS SO EVERY
 * TIME IT REACHES THEM. `ENTANGLE` and `CORRECT` are category C in
 * `cognitive.ts` — no tensor factorisation, no code space — so the loop visits
 * them, records `skipped` with the reason, and moves on. It does NOT quietly
 * drop them from the sequence, and it does not substitute something that looks
 * similar: a loop that renamed renormalisation to CORRECT would report
 * eighteen working phases and have seventeen.
 *
 * ACT PERFORMS NOTHING. Brief §18 (Security) forbids unrestricted tool
 * execution, network side effects and autonomous external actions, so ACT
 * RECORDS AN INTENT and the actuator is a caller-supplied pure function whose
 * default returns a description. There is no code path from this file to a
 * network, a shell or a credential, and `security.test.ts` asserts it over the
 * whole directory rather than over this one file.
 *
 * DETERMINISTIC TERMINATION, four independent bounds, each of which alone ends
 * the run: iterations, state transitions, research operations, actuator calls.
 * `terminated` names WHICH one stopped it — "it finished" and "it hit the
 * transition ceiling" are different outcomes and a caller must be able to tell
 * them apart.
 */
import { CognitiveState, type StateSnapshot } from "../formalState.ts";
import { evidence, interfere, phase, superpose } from "../cognitive.ts";
import { CATEGORY_OF, type CognitiveOperation } from "../cognitive.ts";
import { detectGaps, openGaps, type Gap, type Goal } from "../knowledge/gaps.ts";
import { planResearch, type ResearchPlan } from "../knowledge/planner.ts";
import type { KnowledgeState } from "../knowledge/model.ts";
import { measure } from "../measure.ts";

export const LOOP_PHASES = [
  "OBSERVE",
  "REPRESENT",
  "SUPERPOSE",
  "ENTANGLE",
  "REASON",
  "IDENTIFY_GAPS",
  "RESEARCH_PLAN",
  "EVIDENCE_UPDATE",
  "INTERFERE",
  "PREDICT",
  "MEASURE",
  "ACT",
  "OBSERVE_RESULT",
  "ERROR",
  "CORRECT",
  "LEARN",
  "CONSOLIDATE",
  "NEXT_STATE",
] as const;

export type LoopPhase = (typeof LOOP_PHASES)[number];

/** Phases that map onto a category-C cognitive operation and cannot run. */
export const UNPERFORMABLE_PHASES: Readonly<Record<string, CognitiveOperation>> = {
  ENTANGLE: "ENTANGLE",
  CORRECT: "CORRECT",
};

export type LoopBounds = {
  readonly maxIterations: number;
  readonly maxStateTransitions: number;
  readonly maxResearchOperations: number;
  readonly maxToolCalls: number;
};

export const DEFAULT_BOUNDS: LoopBounds = {
  maxIterations: 4,
  maxStateTransitions: 128,
  maxResearchOperations: 8,
  maxToolCalls: 0, // ZERO by default: the loop takes no external action at all.
};

export type Observation = {
  /** One likelihood per hypothesis, or null for an iteration with no news. */
  readonly likelihoods: readonly number[] | null;
  /** A contextual fact, as a phase per hypothesis. Optional. */
  readonly phases?: readonly number[];
  /** [i, j, theta] — an interference to apply this iteration. Optional. */
  readonly interfere?: readonly [number, number, number];
  /** A hypothesis to admit this iteration, with its share. Optional. */
  readonly admit?: { readonly label: string; readonly share: number };
  readonly evidenceIds?: readonly string[];
};

export type ActIntent = {
  readonly iteration: number;
  readonly chosen: string | null;
  readonly probability: number;
  readonly margin: number;
  readonly description: string;
};

/** A pure describer. The DEFAULT performs nothing and cannot be made to. */
export type Actuator = (intent: ActIntent) => string;

export const RECORD_ONLY_ACTUATOR: Actuator = (i) =>
  `recorded intent only: ${i.chosen ?? "no decision"} at p=${i.probability.toFixed(4)}`;

export type PhaseRecord = {
  readonly iteration: number;
  readonly phase: LoopPhase;
  readonly skipped: string | null;
  readonly note: string;
  readonly stateId: string;
  readonly transitions: number;
};

export type LoopTermination =
  | "completed"
  | "max_iterations"
  | "max_state_transitions"
  | "max_research_operations"
  | "max_tool_calls"
  | "paused";

export type LoopSnapshot = {
  readonly iteration: number;
  readonly phaseIndex: number;
  readonly state: StateSnapshot;
  readonly transitions: number;
  readonly researchOperations: number;
  readonly toolCalls: number;
  readonly log: readonly PhaseRecord[];
};

export type LoopResult = {
  readonly state: CognitiveState;
  readonly terminated: LoopTermination;
  readonly iterations: number;
  readonly log: readonly PhaseRecord[];
  readonly gaps: readonly Gap[];
  readonly plan: ResearchPlan | null;
  readonly intents: readonly ActIntent[];
  readonly snapshot: LoopSnapshot;
  /** The phases that were reached and could not be performed, with reasons. */
  readonly unperformed: readonly { readonly phase: LoopPhase; readonly reason: string }[];
};

export type LoopInput = {
  readonly initial: CognitiveState;
  readonly observations: readonly Observation[];
  readonly goal?: Goal;
  readonly knowledge?: KnowledgeState;
  readonly bounds?: Partial<LoopBounds>;
  readonly actuator?: Actuator;
  /** Resume from here instead of starting at iteration 0, phase 0. */
  readonly resumeFrom?: LoopSnapshot;
  /** Stop before this many phases have run. Used to pause mid-iteration. */
  readonly stopAfterPhases?: number;
};

export function runMegaLoop(input: LoopInput): LoopResult {
  const bounds: LoopBounds = { ...DEFAULT_BOUNDS, ...(input.bounds ?? {}) };
  const actuator = input.actuator ?? RECORD_ONLY_ACTUATOR;

  let state = input.resumeFrom ? CognitiveState.restore(input.resumeFrom.state) : input.initial;
  let iteration = input.resumeFrom?.iteration ?? 0;
  let phaseIndex = input.resumeFrom?.phaseIndex ?? 0;
  let transitions = input.resumeFrom?.transitions ?? 0;
  let researchOperations = input.resumeFrom?.researchOperations ?? 0;
  let toolCalls = input.resumeFrom?.toolCalls ?? 0;
  const log: PhaseRecord[] = [...(input.resumeFrom?.log ?? [])];

  let gaps: Gap[] = [];
  let plan: ResearchPlan | null = null;
  const intents: ActIntent[] = [];
  const unperformed: { phase: LoopPhase; reason: string }[] = [];
  let terminated: LoopTermination = "completed";
  let phasesRun = 0;

  const note = (p: LoopPhase, text: string, skipped: string | null = null) => {
    log.push({ iteration, phase: p, skipped, note: text, stateId: state.stateId, transitions });
  };

  outer: while (iteration < bounds.maxIterations) {
    const obs: Observation = input.observations[iteration] ?? { likelihoods: null };

    // THE PHASE ORDER MAKES THIS CHECKABLE UP FRONT, AND IT IS WORTH DOING.
    // SUPERPOSE runs BEFORE EVIDENCE_UPDATE, so an observation that both admits
    // a hypothesis and carries likelihoods must size them to the basis AFTER
    // admission. Discovering that eleven phases later gives "one likelihood per
    // hypothesis" with no hint of the cause; padding the vector instead would
    // be INVENTING a likelihood for a hypothesis nobody has evidence about,
    // which is worse than either. So it is refused here, by name.
    const admits = obs.admit && !state.basis.includes(obs.admit.label) ? 1 : 0;
    const expectedWidth = state.basis.length + admits;
    if (obs.likelihoods && obs.likelihoods.length !== expectedWidth) {
      throw new Error(
        `OQCA loop: iteration ${iteration} supplies ${obs.likelihoods.length} likelihoods but ` +
          `EVIDENCE_UPDATE will see a basis of ${expectedWidth}` +
          (admits ? " (SUPERPOSE runs first and admits one hypothesis this iteration)" : "") +
          ". Size the likelihoods to the post-admission basis; the loop will not invent one.",
      );
    }

    for (; phaseIndex < LOOP_PHASES.length; phaseIndex++) {
      if (input.stopAfterPhases !== undefined && phasesRun >= input.stopAfterPhases) {
        terminated = "paused";
        break outer;
      }
      const p = LOOP_PHASES[phaseIndex];
      phasesRun++;

      // Category C is refused BY NAME, every time, rather than dropped.
      const unperformable = UNPERFORMABLE_PHASES[p];
      if (unperformable) {
        const reason = `${p} maps to cognitive operation ${unperformable}, category ${CATEGORY_OF[unperformable]} — not physically represented`;
        note(p, "not performed", reason);
        unperformed.push({ phase: p, reason });
        continue;
      }

      const before = state.history.length;
      switch (p) {
        case "OBSERVE":
          note(
            p,
            obs.likelihoods
              ? `observation with ${obs.likelihoods.length} likelihoods`
              : "no observation this iteration",
          );
          break;

        case "REPRESENT":
          note(p, `basis ${state.basis.length}, norm ${state.norm().toFixed(12)}`);
          break;

        case "SUPERPOSE":
          if (obs.admit && !state.basis.includes(obs.admit.label)) {
            state = superpose(state, obs.admit.label, obs.admit.share, {
              evidenceIds: obs.evidenceIds,
            });
            note(p, `admitted ${obs.admit.label} at share ${obs.admit.share}`);
          } else {
            note(p, "no new hypothesis admitted");
          }
          break;

        case "REASON": {
          const c = state.confidence();
          note(
            p,
            `leading ${c.top} at ${c.probability.toFixed(4)}, margin ${c.margin.toFixed(4)}, entropy ${c.entropy.toFixed(4)} bits`,
          );
          break;
        }

        case "IDENTIFY_GAPS":
          if (input.goal && input.knowledge) {
            gaps = detectGaps(input.goal, input.knowledge);
            note(p, `${openGaps(gaps).length} open of ${gaps.length} required concepts`);
          } else {
            note(p, "no goal or knowledge state supplied; nothing to detect", "no goal supplied");
          }
          break;

        case "RESEARCH_PLAN":
          if (gaps.length > 0) {
            if (researchOperations >= bounds.maxResearchOperations) {
              terminated = "max_research_operations";
              note(p, "research bound reached", "max_research_operations");
              break outer;
            }
            researchOperations++;
            plan = planResearch(input.goal?.id ?? "unknown", gaps);
            note(
              p,
              `next: ${plan.next?.concept ?? "nothing"} (${plan.candidates.length} candidates)`,
            );
          } else {
            note(p, "no gaps to plan against");
          }
          break;

        case "EVIDENCE_UPDATE":
          if (obs.likelihoods) {
            state = evidence(state, obs.likelihoods, { evidenceIds: obs.evidenceIds });
            note(p, "evidence folded in (Bayes-exact)");
          } else {
            note(p, "no evidence this iteration");
          }
          break;

        case "INTERFERE": {
          let did = false;
          if (obs.phases) {
            obs.phases.forEach((theta, i) => {
              if (theta !== 0) {
                state = phase(state, state.basis[i], theta);
                did = true;
              }
            });
          }
          if (obs.interfere) {
            const [i, j, theta] = obs.interfere;
            state = interfere(state, state.basis[i], state.basis[j], theta);
            did = true;
          }
          note(
            p,
            did ? "phase and/or interference applied" : "no contextual operation this iteration",
          );
          break;
        }

        case "PREDICT": {
          const p2 = state.probabilities();
          note(p, `predicted distribution ${p2.map((x) => x.toFixed(3)).join("/")}`);
          break;
        }

        case "MEASURE": {
          // Non-destructive by default: the loop looks without collapsing, so a
          // later iteration still has a distribution to update.
          const m = measure({
            labels: state.basis,
            amplitudes: state.amplitudes,
            timestep: state.timestep,
          });
          note(p, `maximum policy chose ${m.label} at ${m.probability.toFixed(4)}`);
          break;
        }

        case "ACT": {
          if (toolCalls >= bounds.maxToolCalls) {
            // The DEFAULT bound is 0, so the ordinary run records an intent and
            // performs nothing. That is the security posture, not a limitation.
            const c = state.confidence();
            const intent: ActIntent = {
              iteration,
              chosen: c.top,
              probability: c.probability,
              margin: c.margin,
              description: "not performed: maxToolCalls reached",
            };
            intents.push(intent);
            note(
              p,
              `intent recorded, NOT performed (maxToolCalls=${bounds.maxToolCalls})`,
              "max_tool_calls",
            );
            break;
          }
          toolCalls++;
          const c = state.confidence();
          const intent: ActIntent = {
            iteration,
            chosen: c.top,
            probability: c.probability,
            margin: c.margin,
            description: "",
          };
          const described = actuator(intent);
          intents.push({ ...intent, description: described });
          note(p, described);
          break;
        }

        case "OBSERVE_RESULT":
          note(p, "no external result to observe: ACT performed nothing");
          break;

        case "ERROR": {
          const v = state.validate();
          note(p, v.ok ? "state valid" : `INVALID: ${v.problems.map((x) => x.code).join(", ")}`);
          break;
        }

        case "LEARN":
          note(
            p,
            `history ${state.history.length} transitions, normError ${state.normError.toExponential(2)}`,
          );
          break;

        case "CONSOLIDATE":
          note(p, `state ${state.stateId.slice(0, 12)} at timestep ${state.timestep}`);
          break;

        case "NEXT_STATE":
          note(p, `iteration ${iteration} complete`);
          break;
      }

      transitions += state.history.length - before;
      if (transitions > bounds.maxStateTransitions) {
        terminated = "max_state_transitions";
        break outer;
      }
    }

    phaseIndex = 0;
    iteration++;
  }

  if (
    terminated === "completed" &&
    iteration >= bounds.maxIterations &&
    input.observations.length > bounds.maxIterations
  ) {
    terminated = "max_iterations";
  }

  return {
    state,
    terminated,
    iterations: iteration,
    log,
    gaps,
    plan,
    intents,
    unperformed,
    snapshot: {
      iteration,
      phaseIndex,
      state: state.snapshot(),
      transitions,
      researchOperations,
      toolCalls,
      log,
    },
  };
}
