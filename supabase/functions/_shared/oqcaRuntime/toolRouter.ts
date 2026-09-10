/**
 * THE TOOL ROUTER — brief sections 5, 9, 10 and 21.
 *
 * "OQCA decides whether an action is appropriate. The ToolRouter decides
 * whether that action is permitted." Those are two different questions and this
 * file answers only the second one.
 *
 * MEASURED 2026-09-10, and it is the finding this file exists because of: ONIQ
 * HAS NO ToolRouter. A repo-wide search for one, for a tool registry, and for
 * any dispatch/execute helper returns nothing outside `src/oqca/` itself. So
 * section 5's "connect the existing ToolRouter" cannot be honoured literally —
 * there is nothing to connect.
 *
 * WHAT DOES EXIST IS THE AUTHORIZATION BOUNDARY IT DESCRIBES, and that is
 * reused rather than replaced: `financialLedger.ts`'s `withProviderSpendGuard`
 * reserves, calls and settles against PostgreSQL row locks, refuses an unpriced
 * or zero-estimate call by name, and is already the only path to a billable
 * provider call in ONIQ. A tool that spends goes through it. A tool that does
 * not spend still passes its own `authorize` before anything happens.
 *
 * SO THIS IS AN ADAPTER, NOT A SECOND AUTHORIZATION SYSTEM. Two systems that
 * must agree forever drift the first time one is edited alone — CLAUDE.md's
 * 2026-09-05 note on Firestore rules versus 242 RLS policies is the same
 * warning, and the answer there was the same: keep one authority.
 *
 * THE REGISTRY IS CLOSED AND SUPPLIED BY THE CALLER. Not a global middleware
 * layer (section 2 forbids one), not a blocklist. A tool the caller did not
 * register cannot be run, whatever the model proposed — the health red team's
 * lesson that an allowlist is the only shape that survives someone adding a
 * file.
 */
import { type Capability, type ServiceRpc, withProviderSpendGuard } from "../financialLedger.ts";
import type { SpendEstimate, ToolCall, ToolResult, ToolRouter } from "../oqca/loop/seams.ts";
import type { IdempotencyClass } from "../oqca/recovery/failure.ts";

/**
 * WHAT THE ROUTER IS ALLOWED TO DO AT ALL, on this run.
 *
 * `shadow` is section 8: OQCA reasons alongside production and changes nothing.
 * `assisted` is section 9: OQCA may propose an action and the existing
 * authorization boundary still decides. There is deliberately no `autonomous` —
 * section 9's "do not allow autonomous production writes merely because OQCA
 * selected an action" is enforced by the mode not existing rather than by a
 * branch nobody takes.
 */
export type RouterMode = "shadow" | "assisted";

export type ToolOutcome = {
  readonly ok: boolean;
  /** What the tool itself claims happened. */
  readonly output: string;
  /**
   * What the ENVIRONMENT says afterwards, read back independently — section 10.
   * A tool that returns its own `output` here is lying to station 17, and the
   * loop compares the two fields precisely so it cannot.
   */
  readonly observed: string;
  readonly costUsd?: number;
  readonly reason?: string;
};

export type ToolSpec = {
  readonly name: string;
  readonly reversible: boolean;
  readonly touchesProduction: boolean;
  /**
   * RECOVERY BRIEF SECTION 7. REQUIRED, with no default, because the only
   * defensible default is UNKNOWN and a default UNKNOWN would silently make
   * every registered tool unretryable after a timeout. Whoever registers a
   * tool knows; nobody else can.
   */
  readonly idempotency: IdempotencyClass;
  /** What one call costs, or null when it cannot be priced. Never a guess. */
  readonly estimate: (call: ToolCall) => SpendEstimate | null;
  /**
   * WHICH LEDGER BUCKET THIS TOOL SPENDS FROM, and it is REQUIRED for any tool
   * whose estimate is above zero — see `makeToolRouter`. A tool that costs
   * money and names no capability cannot be admitted, because there would be
   * nothing to reserve against.
   */
  readonly capability?: Capability;
  /** The unit the ledger records. Required alongside `capability`. */
  readonly spendUnit?: string;
  /**
   * THE EXISTING AUTHORIZATION BOUNDARY, asked independently of OQCA's opinion.
   * Returns null to permit, or the reason it refuses. Section 9: OQCA selecting
   * an action is not authorization for it.
   */
  readonly authorize: (call: ToolCall) => Promise<string | null>;
  readonly perform: (call: ToolCall) => Promise<ToolOutcome>;
};

export type ToolCallRecord = {
  readonly runId: string;
  readonly tool: string;
  readonly mode: RouterMode;
  readonly rationale: string;
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly observed: string;
  readonly reason?: string;
};

export type RouterContext = {
  readonly runId: string;
  /**
   * The service-role RPC the ledger admits and settles through. Absent in a
   * shadow run and in every test that registers no paying tool — and a paying
   * tool is then REFUSED rather than run unguarded.
   */
  readonly rpc?: ServiceRpc | null;
  readonly mode: RouterMode;
  readonly now: () => number;
  readonly record: (r: ToolCallRecord) => void;
};

/**
 * A refusal, in the shape the loop reads.
 *
 * `observed` NAMES NOT HAVING ACTED, and the exact wording matters: OBSERVE
 * treats "not performed" and "nothing was attempted" as unmatched, so a refusal
 * can never be counted as a successful prediction. Section 10 in its own words:
 * a refused action is `action_not_executed`, not `action_failed`.
 */
function refuse(reason: string, observed = "nothing was attempted"): ToolResult {
  return {
    ok: false,
    output: "",
    observed,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    reason,
  };
}

export const ACTION_NOT_EXECUTED = "action_not_executed";
export const ACTION_FAILED = "action_failed";

/**
 * Which of section 10's two words describes an outcome.
 *
 * They are not interchangeable and conflating them corrupts LEARN: a refusal
 * says nothing about whether the action WOULD have worked, while a failure
 * says it was tried and did not. A loop that records refusals as failures
 * learns to avoid actions that were never attempted.
 */
export function outcomeClass(attempted: boolean, ok: boolean): string | null {
  if (!attempted) return ACTION_NOT_EXECUTED;
  return ok ? null : ACTION_FAILED;
}

/**
 * Reserve, perform, settle — the ledger's own discipline, with the tool's
 * `perform` as the callback so it cannot run before admission or skip
 * settlement.
 *
 * `neverCalled` is deliberately NOT claimed. From here we cannot know whether a
 * refused-but-attempted action reached anything, and `withProviderSpendGuard`'s
 * own rule is that every ambiguity defaults to CHARGE.
 */
async function throughLedger(
  ctx: RouterContext,
  spec: ToolSpec,
  call: ToolCall,
  quote: SpendEstimate,
): Promise<ToolOutcome> {
  const guarded = await withProviderSpendGuard(
    ctx.rpc ?? null,
    {
      requestId: `${ctx.runId}:${call.tool}`,
      capability: spec.capability!,
      model: call.tool,
      unit: (spec.spendUnit ?? "provider_unit") as never,
      unitsReserved: 1,
      estimatedUsd: quote.costUsd,
    } as never,
    async () => {
      const out = await spec.perform(call);
      return { value: out, outcome: out.ok ? ("ACCEPTED" as const) : ("FAILED" as const) };
    },
  );
  if (!guarded.admitted) {
    return {
      ok: false,
      output: "",
      observed: "nothing was attempted",
      costUsd: 0,
      reason: `the spend ledger refused: ${guarded.reason}`,
    };
  }
  return { ...guarded.value, costUsd: guarded.actualUsd ?? guarded.reservedUsd };
}

export function makeToolRouter(tools: readonly ToolSpec[], ctx: RouterContext): ToolRouter {
  const registry = new Map(tools.map((t) => [t.name, t]));
  return {
    // THE REGISTRY IS THE ONLY ANSWER. `null` for a tool it does not carry, so
    // the kernel falls back to UNKNOWN_TOOL_PROPERTIES — irreversible and
    // production-touching — and refuses. An unregistered action is not a safe
    // action.
    properties: (tool) => {
      const spec = registry.get(tool);
      if (!spec) return null;
      return {
        reversible: spec.reversible,
        touchesProduction: spec.touchesProduction,
        idempotency: spec.idempotency,
      };
    },
    estimate: (call) => {
      const spec = registry.get(call.tool);
      // AN UNREGISTERED TOOL IS UNPRICEABLE, NOT FREE. Returning a zero
      // estimate here would let an unknown tool pass the cost gate and be
      // refused one step later for a different reason — and a gate that names
      // the wrong bound sends whoever reads the log to raise the wrong number.
      if (!spec) return null;
      return spec.estimate(call);
    },
    execute: async (call): Promise<ToolResult> => {
      const started = ctx.now();
      const note = (
        attempted: boolean,
        ok: boolean,
        observed: string,
        costUsd: number,
        reason?: string,
      ) =>
        ctx.record({
          runId: ctx.runId,
          tool: call.tool,
          mode: ctx.mode,
          rationale: call.rationale,
          attempted,
          ok,
          costUsd,
          latencyMs: ctx.now() - started,
          observed,
          reason,
        });

      const spec = registry.get(call.tool);
      if (!spec) {
        const reason = `unknown tool: ${call.tool} is not registered for this run`;
        note(false, false, "nothing was attempted", 0, reason);
        return refuse(reason);
      }

      // THE LOOP'S DECLARED PROPERTIES MUST MATCH THE REGISTERED ONES. The
      // kernel refuses an irreversible step with no rollback (station 15), and
      // it judges that on what the CALL says. A call that under-declares —
      // `reversible: true` on a tool the registry says is not — would walk past
      // that refusal, so the mismatch is a refusal in itself rather than a
      // silent correction.
      if (
        call.reversible !== spec.reversible ||
        call.touchesProduction !== spec.touchesProduction
      ) {
        const reason =
          `declared properties do not match the registry for ${call.tool}: ` +
          `reversible ${call.reversible}/${spec.reversible}, ` +
          `touchesProduction ${call.touchesProduction}/${spec.touchesProduction}`;
        note(false, false, "nothing was attempted", 0, reason);
        return refuse(reason);
      }

      if (ctx.mode === "shadow" && spec.touchesProduction) {
        const reason = `shadow mode: ${call.tool} touches production and was not performed`;
        note(false, false, "not performed — shadow mode", 0, reason);
        return refuse(reason, "not performed — shadow mode");
      }

      const denied = await spec.authorize(call);
      if (denied !== null) {
        const reason = `not permitted: ${denied}`;
        note(false, false, "nothing was attempted", 0, reason);
        return refuse(reason);
      }

      const quote = spec.estimate(call);
      // A PAYING TOOL GOES THROUGH THE LEDGER OR IT DOES NOT RUN.
      //
      // This is the sentence section 5 asks for, made true in CODE rather than
      // in a comment — and the first draft of this file had it only in the
      // comment. `withProviderSpendGuard` is the ONLY path to a billable
      // provider call in ONIQ: it reserves under a row lock, calls, and settles,
      // and it refuses `unpriced-model` and `zero-estimate` by name. A second
      // way to spend would be a second thing to keep in step with the caps the
      // owner sets, which is exactly the drift this repo has a receipt for.
      const pays = quote !== null && quote.costUsd > 0;
      if (pays && (!spec.capability || !ctx.rpc)) {
        const reason = !spec.capability
          ? `${call.tool} costs money and names no ledger capability`
          : `${call.tool} costs money and no ledger connection was supplied`;
        note(false, false, "nothing was attempted", 0, reason);
        return refuse(reason);
      }

      let outcome: ToolOutcome;
      try {
        outcome = pays ? await throughLedger(ctx, spec, call, quote!) : await spec.perform(call);
      } catch (e) {
        // ATTEMPTED AND THREW. The world may well have changed, so this is
        // `action_failed`, never `action_not_executed` — and `observed` says
        // honestly that we do not know rather than claiming nothing happened.
        const reason = String(e).slice(0, 200);
        const observed = "the action threw; the environment was not read back";
        note(true, false, observed, 0, reason);
        return {
          ok: false,
          output: "",
          observed,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          reason,
        };
      }

      const costUsd = outcome.costUsd ?? 0;
      note(true, outcome.ok, outcome.observed, costUsd, outcome.reason);
      return {
        ok: outcome.ok,
        output: outcome.output,
        observed: outcome.observed,
        usage: { inputTokens: 0, outputTokens: 0, costUsd },
        reason: outcome.reason,
      };
    },
  };
}
