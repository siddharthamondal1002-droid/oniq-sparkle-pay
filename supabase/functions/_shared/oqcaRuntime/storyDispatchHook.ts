/**
 * THE ONE CALLER — brief section 2, and the whole of what `story-dispatch`
 * gains.
 *
 * "Wire OQCA into exactly one real workflow. Do not create a generic global
 * middleware layer." So this is not middleware and takes no route: it is a
 * function `story-dispatch` calls, named after the job it serves.
 *
 * IT CANNOT THROW. Every path returns a value, including the ones that catch.
 * A cognitive loop that breaks a scheduled dispatcher would be a strictly worse
 * outcome than one that never ran — and the dispatcher going quiet is the exact
 * failure `story_dispatch_health` was created for after a user's film sat
 * `queued` for half an hour.
 */
import { DEFAULT_BUDGETS } from "../oqca/loop/seams.ts";
import { makeDispatchEnvironment, type DispatchEnvConfig } from "./dispatchEnv.ts";
import { HOLD_ACTION, jobIdFrom } from "./dispatchJob.ts";
import {
  OQCA_COST_ENV,
  OQCA_TOKENS_ENV,
  OQCA_TOOLS_ENV,
  envReader,
  readNonNegative,
  type OqcaMode,
} from "./flag.ts";
import { runShadow, type ShadowComparison } from "./shadow.ts";
import type { DispatchEnvironment } from "./dispatchJob.ts";

export type OqcaHookResult = {
  /** True ONLY when the loop actually dispatched a job in assisted mode. */
  readonly handled: boolean;
  readonly jobId: string | null;
  readonly comparison: ShadowComparison | null;
  readonly error: string | null;
};

export const NOT_RUN: OqcaHookResult = {
  handled: false,
  jobId: null,
  comparison: null,
  error: null,
};

export type HookConfig = {
  readonly mode: OqcaMode;
  readonly runId: string;
  readonly env?: DispatchEnvironment;
  readonly envConfig?: DispatchEnvConfig;
  readonly getEnv?: (name: string) => string | undefined;
  /**
   * THE PROVIDER, REQUIRED AND PASSED IN BY THE ONE CALLER.
   *
   * It used to default to `callTextProvider` here, which imported `llm.ts`,
   * which reads `Deno.env` — and that made this whole module unloadable by the
   * node test runner. An adapter nobody can test is an adapter nobody checks,
   * and the seam already existed; it just stopped one level too early.
   */
  readonly call: Parameters<typeof runShadow>[0]["call"];
  /**
   * The spend ledger's service-role RPC. Absent means the loop cannot spend at
   * all — every model call and paying tool is refused rather than run unguarded.
   */
  readonly rpc?: Parameters<typeof runShadow>[0]["rpc"];
};

/**
 * Budgets come from the environment and default to refusing every spend.
 *
 * `maxExecutionTimeMs` is NOT read from the environment and is deliberately
 * smaller than the shipped default: this runs inside a scheduled function with
 * its own wall clock, and a loop that outlives the isolate leaves the
 * dispatcher having done nothing at all. Time is a runaway guard, not a spend —
 * seams.ts carries the full reason the two are configured differently.
 */
export const HOOK_TIME_BUDGET_MS = 20_000;

export function budgetsFrom(getEnv: (name: string) => string | undefined) {
  return {
    ...DEFAULT_BUDGETS,
    maxCostUsd: readNonNegative(getEnv(OQCA_COST_ENV)),
    maxTokens: readNonNegative(getEnv(OQCA_TOKENS_ENV)),
    maxToolCalls: readNonNegative(getEnv(OQCA_TOOLS_ENV)),
    maxExecutionTimeMs: HOOK_TIME_BUDGET_MS,
  };
}

export async function runOqcaForDispatch(cfg: HookConfig): Promise<OqcaHookResult> {
  if (cfg.mode === "off") return NOT_RUN;
  try {
    const getEnv = cfg.getEnv ?? envReader();
    const env = cfg.env ?? makeDispatchEnvironment(cfg.envConfig!);
    const result = await runShadow({
      runId: cfg.runId,
      mode: cfg.mode === "assisted" ? "assisted" : "shadow",
      env,
      call: cfg.call,
      rpc: cfg.rpc ?? null,
      budgets: budgetsFrom(getEnv),
    });

    // HANDLED IS READ FROM WHAT THE ENVIRONMENT SAYS HAPPENED, never from the
    // loop's decision. The loop choosing a job is not the same as a dispatch
    // having gone out — the router may have refused it, the authorization may
    // have declined it, or shadow mode may have blocked it — and reporting
    // `handled` on the decision would leave the production path skipped and no
    // dispatch made.
    const performed = result.episode.actions.find(
      (a) => a.attempted && a.ok && a.tool !== HOLD_ACTION,
    );
    const held = result.episode.actions.some((a) => a.attempted && a.ok && a.tool === HOLD_ACTION);

    return {
      // A HOLD IS HANDLED TOO, and it is the interesting case: the loop looked
      // at the queue and chose to dispatch nothing. Letting the production path
      // run afterwards would overrule that decision silently and make assisted
      // mode a no-op that only ever ADDS dispatches.
      handled: cfg.mode === "assisted" && (performed !== undefined || held),
      jobId: performed ? jobIdFrom(performed.tool) : null,
      comparison: result.comparison,
      error: null,
    };
  } catch (e) {
    // THE PRODUCTION PATH RUNS. `handled: false` is the whole safety property
    // of this catch: whatever went wrong, story-dispatch does what it always
    // did.
    return { handled: false, jobId: null, comparison: null, error: String(e).slice(0, 300) };
  }
}
