/**
 * THE COGNITIVE KERNEL — §8's tool loop, as the smallest thing that runs.
 *
 * OBSERVE -> REASON -> TOOL CALL -> TOOL RESULT -> UPDATE WORLD -> REASON AGAIN,
 * until one of §8's six stops. It does NOT stop after the first model reply
 * when the model asked for a tool — that is the specific failure §8 names.
 *
 * WHAT IS DELIBERATELY NOT HERE. No planner, no experiment selection, no skill
 * memory, no quantum layer. §25 says build a vertical slice and stop, and the
 * reviewer's §0 says the same; this is that slice. The parts that are absent
 * are absent, not stubbed to look present.
 *
 * THE MODEL PROPOSES AND THE REGISTRY DISPOSES. `proposal.wantsTool` is a
 * WISH: it goes through `invoke`, which consults ONIQ's own authorization and
 * the execution mode. A refused wish is recorded and the loop carries on — a
 * model asking for something it may not have is ordinary, not fatal.
 */
import {
  type CognitiveState,
  type ToolCallRecord,
  initialState,
  record,
  uncertaintyOf,
} from "./cognitiveState.ts";
import { type ExecutionMode } from "./executionMode.ts";
import { type ModelAdapter, type OfferedTool, REFUSING_MODEL } from "./modelAdapter.ts";
import { type Registry, invoke } from "./capabilityRegistry.ts";
import {
  type VerificationEngine,
  EMPTY_VERIFICATION,
  assert as assertClaim,
  standing,
  support,
} from "./verificationEngine.ts";
import { type Fact, observe as observeFact } from "./worldModel.ts";
import { type CheckpointStore, restore, serialize } from "./checkpoint.ts";

/** §8's stop set, and nothing else may end a run. */
export type Stop =
  | "FINAL_ANSWER"
  | "ACTION_REQUIRED"
  | "USER_REQUIRED"
  | "BLOCKED"
  | "SAFETY_STOPPED"
  | "RESOURCE_UNAVAILABLE";

export type KernelConfig = {
  readonly goal: string;
  readonly mode: ExecutionMode;
  readonly model?: ModelAdapter;
  readonly registry: Registry;
  readonly store?: CheckpointStore;
  readonly clock: () => string;
  readonly maxIterations?: number;
  /** Instructions handed to the model each turn. */
  readonly instructions: string;
};

export type KernelReport = {
  readonly stop: Stop;
  readonly stopDetail: string;
  readonly state: CognitiveState;
  readonly verification: VerificationEngine;
  readonly restored: boolean;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly refusedToolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export const DEFAULT_MAX_ITERATIONS = 8;

/**
 * A tool result becomes a FACT and a piece of EVIDENCE, never a conclusion.
 * The fact is OBSERVED because a tool read it; whether the CLAIM it bears on
 * is verified is `verificationEngine`'s to say, and it needs two independent
 * verifying sources to say VERIFIED.
 */
function factFromTool(tool: string, summary: string, at: string): Fact {
  return {
    entity: tool,
    attribute: "last_reading",
    value: summary.slice(0, 300),
    epistemic: "OBSERVED",
    supporting: [],
    contradicting: [],
    at,
  };
}

export async function runKernel(cfg: KernelConfig): Promise<KernelReport> {
  const model = cfg.model ?? REFUSING_MODEL;
  const maxIterations = cfg.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  let restored = false;
  let state = initialState(cfg.goal, cfg.clock());
  if (cfg.store) {
    const raw = await cfg.store.read();
    const r = restore(raw);
    if (r.ok) {
      state = r.checkpoint.state;
      restored = true;
      state = record(state, "RESTORE", `resumed from ${r.checkpoint.savedAt}`, cfg.clock());
    } else {
      state = record(state, "RESTORE", `starting fresh: ${r.reason}`, cfg.clock());
    }
  }

  let verification: VerificationEngine = EMPTY_VERIFICATION;
  let modelCalls = 0;
  let toolCalls = 0;
  let refusedToolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stop: Stop = "BLOCKED";
  let stopDetail = "the loop ended without reaching a stop";

  /**
   * WHAT AN OFFER CARRIES. The name, the description and the argument names —
   * all three, because a model cannot fill a field it was never shown. See
   * `OfferedTool`: offering names alone is what made the video benchmark score
   * zero on both frontier arms.
   */
  const offered: readonly OfferedTool[] = cfg.registry.specs
    .filter((s) => s.authorized)
    .map((s) => ({ name: s.name, description: s.description, schema: s.schema }));

  for (let i = 0; i < maxIterations; i += 1) {
    state = { ...state, iteration: state.iteration + 1 };
    state = record(state, "REASON", `iteration ${state.iteration}`, cfg.clock());

    const input = renderContext(state);
    const res = await model.reason({
      instructions: cfg.instructions,
      input,
      toolsOffered: offered,
    });
    modelCalls += 1;

    if (!res.ok) {
      stop = "RESOURCE_UNAVAILABLE";
      stopDetail = res.reason;
      state = record(state, "REASON", `model refused: ${res.reason}`, cfg.clock());
      break;
    }

    const p = res.proposal;
    inputTokens += p.inputTokens;
    outputTokens += p.outputTokens;

    if (p.text.length > 0) {
      state = { ...state, observations: [...state.observations, p.text] };
    }

    if (p.wantsTool === null) {
      stop = "FINAL_ANSWER";
      stopDetail = p.text.slice(0, 300);
      state = record(state, "RESPOND", "the model asked for no further tool", cfg.clock());
      break;
    }

    const inv = await invoke(cfg.registry, cfg.mode, p.wantsTool.name, p.wantsTool.args);
    const at = cfg.clock();
    const call: ToolCallRecord = {
      tool: inv.tool,
      args: inv.args,
      outcome: inv.outcome,
      detail: inv.detail,
      at,
    };
    state = { ...state, toolCalls: [...state.toolCalls, call] };
    state = record(state, "ACT", `${inv.tool} -> ${inv.outcome}`, at);

    if (inv.outcome === "REFUSED") {
      refusedToolCalls += 1;
      if (inv.detail.startsWith("DESTRUCTIVE_NEVER")) {
        stop = "SAFETY_STOPPED";
        stopDetail = inv.detail;
        break;
      }
      continue;
    }

    if (inv.outcome === "DRY_RUN") {
      stop = "ACTION_REQUIRED";
      stopDetail = inv.detail;
      state = record(state, "OBSERVE", "dry run: the call was recorded, not made", at);
      break;
    }

    toolCalls += 1;
    if (inv.result && inv.result.ok) {
      state = {
        ...state,
        world: observeFact(state.world, factFromTool(inv.tool, inv.result.summary, at)),
      };
      const claimId = `${inv.tool}:${JSON.stringify(inv.args)}`;
      verification = assertClaim(verification, claimId, inv.result.summary);
      verification = support(verification, claimId, inv.result.evidence);
      state = record(
        state,
        "UPDATE_WORLD",
        `${inv.tool} -> ${standing(verification, claimId)}`,
        at,
      );
    }
  }

  state = { ...state, uncertainty: uncertaintyOf(state.hypotheses) };

  if (cfg.store) {
    await cfg.store.write(serialize(state, cfg.clock()));
  }

  return {
    stop,
    stopDetail,
    state,
    verification,
    restored,
    modelCalls,
    toolCalls,
    refusedToolCalls,
    inputTokens,
    outputTokens,
  };
}

/**
 * WHAT THE MODEL IS SHOWN. §17: the kernel's own state, not a growing
 * transcript — so a restarted run shows the model what it KNOWS rather than
 * replaying how it got there.
 */
export function renderContext(s: CognitiveState): string {
  const facts = s.world.facts.map(
    (f) => `${f.entity}.${f.attribute} = ${f.value} [${f.epistemic}]`,
  );
  const calls = s.toolCalls.map(
    (c) => `${c.tool}(${JSON.stringify(c.args)}) -> ${c.outcome}: ${c.detail}`,
  );
  return [
    `GOAL: ${s.goal}`,
    `ITERATION: ${s.iteration}`,
    facts.length > 0 ? `KNOWN:\n${facts.join("\n")}` : "KNOWN: nothing yet",
    calls.length > 0 ? `TOOLS ALREADY CALLED:\n${calls.join("\n")}` : "TOOLS ALREADY CALLED: none",
  ].join("\n\n");
}
