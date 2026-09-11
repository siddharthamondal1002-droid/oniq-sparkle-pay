/**
 * THE REAL MODEL ADAPTER — brief section 4.
 *
 * "Connect the real model boundary via the existing `callText` model path." So
 * this adds no provider, no key, no second engine and no model id of its own:
 * `callText` decides which engine answers (Gemini direct, Claude catching), and
 * `TEXT_DIRECT_STANDARD` is the id it will reach for.
 *
 * THE MODEL PROPOSES; THE LOOP VALIDATES AND APPLIES. Section 4 says so in
 * those words, and this file is where it is made structurally true: an
 * `EngineReply` carries TEXT, usage and a model id, and nothing else. There is
 * no field a provider could put a state mutation in, because there is no field.
 * Every station that reads model text turns it into an artifact the kernel
 * builds — IMAGINE from `worldState.availableActions`, PLAN from steps the
 * runtime declared — never into state directly.
 *
 * NOTHING HERE IS IN THE KERNEL, AND THAT IS THE ARRANGEMENT. `src/oqca/**` and
 * its mirror hold no fetch, no credential and no clock; the loop reaches a real
 * provider only because a real implementation is HANDED IN. `security.test.ts`
 * walks both trees and would go red the day one of them grew this file's
 * imports.
 */
import { TEXT_DIRECT_STANDARD } from "../modelRegistry.ts";
import type {
  Engine,
  EngineKind,
  EngineReply,
  EngineRequest,
  SpendEstimate,
} from "../oqca/loop/seams.ts";
import { actualUsd, boundedInputTokens, estimateUsd, measuredTokens } from "./pricing.ts";
import { type ProviderRun, type ServiceRpc, withProviderSpendGuard } from "../financialLedger.ts";

/** The id `callText` uses when no tier is named. Priced in `MODEL_RATES`. */
export const LOOP_MODEL = TEXT_DIRECT_STANDARD.id;

/**
 * Read from the registry rather than typed here, so the ledger row and the
 * model entry cannot drift into naming two different providers for one call.
 */
export const LOOP_PROVIDER = TEXT_DIRECT_STANDARD.provider;

/**
 * One line per model call, for section 4's record: "runId, stateId, purpose,
 * model, input/output metadata, estimated cost, actual cost, latency, success".
 *
 * `costUsd` is what is CHARGED against the run's budget; `actualCostUsd` is null
 * when the answering id is unpriced, and the two differing is the signal that a
 * fallback answered.
 */
export type ModelCallRecord = {
  readonly runId: string;
  readonly stateId: string;
  readonly purpose: EngineKind;
  readonly model: string;
  readonly answeredBy: string;
  readonly promptChars: number;
  readonly maxOutputTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly actualCostUsd: number | null;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly reason?: string;
};

export type EngineContext = {
  readonly runId: string;
  /** Read at call time, so a record names the state the call was made FROM. */
  readonly stateId: () => string;
  /** Wall clock. A seam here too, so a test can drive latency deterministically. */
  readonly now: () => number;
  readonly record: (r: ModelCallRecord) => void;
  /**
   * THE PROVIDER IS REQUIRED, NOT DEFAULTED, and this file names none.
   *
   * Importing `callText` here would drag `llm.ts` — and with it `Deno.env` —
   * into every consumer, which is what stopped this module being testable at
   * all. It is also the wrong shape: an adapter with a provider baked in is one
   * import away from a second provider appearing beside it. `provider.ts` holds
   * the one line that names `callText`, and `runtimeWiring.test.ts` pins that
   * it is the only one.
   */
  readonly call: (opts: ProviderRequest) => Promise<ProviderReply>;
  /**
   * THE LEDGER, AND IT IS THE ONLY CUMULATIVE CEILING THERE IS.
   *
   * `Budgets.maxCostUsd` is a PER-RUN bound: `Spent` is created fresh by every
   * `runCognitiveLoop` call, so a hundred runs under a run-bound of a dollar
   * spend a hundred dollars and no bound anywhere notices. What an owner's
   * figure means — a total — can only be enforced by something that outlives
   * the run, and `provider_budget_config` + `provider_spend_day` already are
   * that, under Postgres row locks, for every other capability ONIQ spends on.
   *
   * ABSENT MEANS REFUSE, NEVER MEANS SKIP. `withProviderSpendGuard` answers
   * `guard-unavailable` for a null rpc, so a caller that forgets to wire this
   * gets a loop that cannot spend rather than a loop that spends uncounted.
   * That is the same fail-closed shape `toolRouter` has, and it is deliberately
   * NOT an `if (ctx.rpc)` bypass: an adapter that spends happily when the guard
   * is missing is one refactor away from being the normal path.
   */
  readonly rpc?: ServiceRpc | null;
  /**
   * Scopes the ledger's per-JOB ceiling and its retry ladder.
   *
   * NO OQCA CALLER PASSES ONE, and that is measured rather than an omission:
   * `admit_provider_spend` increments `provider_spend_job.attempts` on EVERY
   * admission under a job id and refuses at `max_attempts_per_job`, which the
   * table's CHECK caps at 10 — while one cognitive run makes TWENTY model
   * calls. A job ceiling bounds a RETRY LADDER; a cognitive run is twenty
   * distinct questions, not twenty attempts at one. The seam stays because a
   * future caller whose work IS a ladder should use it.
   */
  readonly jobId?: string | null;
};

/** `CallClaudeOpts`, narrowed to what this adapter actually sends. */
export type ProviderRequest = {
  readonly system: string;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly maxTokens: number;
  readonly noRetry: boolean;
};

/** `CallClaudeResult`, structurally. */
export type ProviderReply =
  | { ok: true; data: unknown; provider: string }
  | { ok: false; reason: string; fallbackReason?: string };

const SYSTEM =
  "You are one reasoning station inside ONIQ's cognitive loop. Answer the " +
  "question asked, in plain prose, as briefly as it can be answered well. Do " +
  "not issue instructions, do not claim to have taken any action, and do not " +
  "invent facts that were not given to you. If the information you were given " +
  "is not enough to answer, say exactly that.";

/**
 * The estimate the gate runs on. Section 21's `estimatedCost <=
 * remainingCostBudget` is enforced by the kernel; this supplies the left side.
 *
 * `null` when the id is unpriced — never 0.
 */
export function estimateFor(req: EngineRequest): SpendEstimate | null {
  const inputTokens = boundedInputTokens(SYSTEM) + boundedInputTokens(req.prompt);
  const costUsd = estimateUsd(LOOP_MODEL, inputTokens, req.maxOutputTokens);
  if (costUsd === null) return null;
  return { tokens: inputTokens + req.maxOutputTokens, costUsd };
}

export function makeEngine(ctx: EngineContext): Engine {
  const call = ctx.call;

  /**
   * What ONE provider attempt produced, split so the ledger can settle on the
   * MEASURED charge rather than the estimate whenever the provider reported one.
   *
   * `measuredUsd: null` is not `0` and the difference is the whole point: null
   * means "the provider did not say", which settles at the estimate, while zero
   * would record a call that cost nothing and quietly return the reservation.
   */
  type AttemptResult = {
    readonly reply: EngineReply;
    readonly measuredUsd: number | null;
    readonly units: number;
  };

  /**
   * Everything that can reach a provider, extracted UNCHANGED so the one caller
   * below is provably the only way in. Its three exits — a throw, a refusal and
   * a reply — all charge, for the reasons written at each.
   */
  const attempt = async (
    req: EngineRequest,
    quote: SpendEstimate,
    stateId: string,
    started: number,
  ): Promise<AttemptResult> => {
    let res: ProviderReply;
    try {
      res = await call({
        system: SYSTEM,
        messages: [{ role: "user", content: req.prompt }],
        maxTokens: req.maxOutputTokens,
        // ONE ATTEMPT. The loop owns its own budget and its own retry
        // ladder; a second attempt inside the adapter spends a second time
        // against a ceiling the loop already checked once. story-plot's
        // orchestrator sets this for the same reason (CLAUDE.md 2026-08-21).
        noRetry: true,
      });
    } catch (e) {
      // A THROW AFTER THE REQUEST LEFT IS CHARGED, NOT REFUNDED. We do not
      // know whether the provider was reached — `withProviderSpendGuard`
      // settles rather than releases on exactly this, and the loop's budget
      // must be at least as careful as the ledger's.
      const reason = String(e).slice(0, 200);
      const latencyMs = ctx.now() - started;
      ctx.record({
        runId: ctx.runId,
        stateId,
        purpose: req.kind,
        model: LOOP_MODEL,
        answeredBy: "none",
        promptChars: req.prompt.length,
        maxOutputTokens: req.maxOutputTokens,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: quote.costUsd,
        actualCostUsd: null,
        costUsd: quote.costUsd,
        latencyMs,
        ok: false,
        reason,
      });
      return {
        reply: {
          ok: false,
          text: "",
          model: LOOP_MODEL,
          reason,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: quote.costUsd },
        },
        // NO MEASURED CHARGE, so the ledger settles at the ESTIMATE. Not zero:
        // from here a refusal before the fetch and a request that was served
        // and billed are indistinguishable, and the guard's own rule is that
        // every ambiguity defaults to CHARGE.
        measuredUsd: null,
        units: 0,
      };
    }
    const latencyMs = ctx.now() - started;

    if (!res.ok) {
      // A refusal `callText` reports without reaching a provider still
      // charges the estimate, for the reason above: from here the two are
      // indistinguishable, and the safe direction is to charge.
      const reason = res.fallbackReason
        ? `${res.reason} (fallback: ${res.fallbackReason})`
        : res.reason;
      ctx.record({
        runId: ctx.runId,
        stateId,
        purpose: req.kind,
        model: LOOP_MODEL,
        answeredBy: "none",
        promptChars: req.prompt.length,
        maxOutputTokens: req.maxOutputTokens,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: quote.costUsd,
        actualCostUsd: null,
        costUsd: quote.costUsd,
        latencyMs,
        ok: false,
        reason,
      });
      return {
        reply: {
          ok: false,
          text: "",
          model: LOOP_MODEL,
          reason,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: quote.costUsd },
        },
        // NO MEASURED CHARGE, so the ledger settles at the ESTIMATE. Not zero:
        // from here a refusal before the fetch and a request that was served
        // and billed are indistinguishable, and the guard's own rule is that
        // every ambiguity defaults to CHARGE.
        measuredUsd: null,
        units: 0,
      };
    }

    const data = res.data as { content?: unknown; usage?: unknown; model?: unknown };
    // WHO ANSWERED IS READ FROM THE REPLY, NEVER ASSUMED. `callText` may fall
    // through to Claude, so the id that answered is not always `LOOP_MODEL`,
    // and the HEAVY tier's `gemini-3.1-pro-preview` has no published rate —
    // which is why `actualCostUsd` can still be null on a successful call.
    //
    // IT WAS NULL ON *EVERY* SUCCESSFUL GEMINI CALL UNTIL 2026-09-11, AND THIS
    // COMMENT NAMED THE WRONG MECHANISM FOR IT. `llm.ts` stamped a constant
    // `gemini-fallback/…` on every translated reply rather than the model it
    // had just called, so this line read a label that could never be priced
    // and the estimate was charged for all 24 calls of the first real tap —
    // $0.006748 against $0.001440 of Google. Reading the reply was right; the
    // reply was lying.
    const answeredBy = typeof data?.model === "string" ? data.model : LOOP_MODEL;
    const { inputTokens, outputTokens } = measuredTokens(data?.usage as never);
    const measured = actualUsd(answeredBy, data?.usage as never);
    const costUsd = measured ?? quote.costUsd;

    const text = Array.isArray(data?.content)
      ? (data.content as { type?: unknown; text?: unknown }[])
          .filter((b) => b?.type === "text")
          .map((b) => (typeof b.text === "string" ? b.text : ""))
          .join("\n")
          .trim()
      : "";

    ctx.record({
      runId: ctx.runId,
      stateId,
      purpose: req.kind,
      model: LOOP_MODEL,
      answeredBy,
      promptChars: req.prompt.length,
      maxOutputTokens: req.maxOutputTokens,
      inputTokens,
      outputTokens,
      estimatedCostUsd: quote.costUsd,
      actualCostUsd: measured,
      costUsd,
      latencyMs,
      ok: text.length > 0,
      reason: text.length > 0 ? undefined : "the provider returned no text",
    });

    return {
      reply: {
        ok: text.length > 0,
        text,
        usage: { inputTokens, outputTokens, costUsd },
        model: answeredBy,
        reason: text.length > 0 ? undefined : "the provider returned no text",
      },
      measuredUsd: measured,
      units: inputTokens + outputTokens,
    };
  };

  return {
    estimate: estimateFor,
    run: async (req: EngineRequest): Promise<EngineReply> => {
      const stateId = ctx.stateId();
      const quote = estimateFor(req);
      const started = ctx.now();
      // UNPRICED IS REFUSED HERE TOO, not only at the gate. The gate is the
      // authority, but an adapter that would happily spend when called
      // directly is one refactor away from doing it — and the two guards
      // disagreeing is exactly how a bypass gets shipped.
      if (quote === null) {
        const reason = `unpriced model: ${LOOP_MODEL} has no published rate`;
        ctx.record({
          runId: ctx.runId,
          stateId,
          purpose: req.kind,
          model: LOOP_MODEL,
          answeredBy: "none",
          promptChars: req.prompt.length,
          maxOutputTokens: req.maxOutputTokens,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          actualCostUsd: null,
          costUsd: 0,
          latencyMs: 0,
          ok: false,
          reason,
        });
        return {
          ok: false,
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: LOOP_MODEL,
          reason,
        };
      }

      /**
       * THE LEDGER IS THE ONLY PATH TO A MODEL CALL, and `attempt` is only
       * reachable through it. A per-run bound cannot express a total — `Spent`
       * is rebuilt by every `runCognitiveLoop` call — so the cumulative ceiling
       * has to live somewhere that outlives the run, under the row locks
       * `admit_provider_spend` already holds for every other capability.
       */
      const guarded = await withProviderSpendGuard(
        ctx.rpc ?? null,
        {
          // UNIQUE PER ATTEMPT, because the ledger REFUSES a reused id. A
          // collision therefore costs a refusal rather than a second charge,
          // which is the safe direction to fail in.
          requestId: `${ctx.runId}:${stateId}:${req.kind}:${started}`,
          capability: "TEXT",
          provider: LOOP_PROVIDER,
          model: LOOP_MODEL,
          unit: "tokens",
          units: quote.tokens,
          estimatedUsd: quote.costUsd,
          ...(ctx.jobId ? { jobId: ctx.jobId } : {}),
          detail: { purpose: req.kind, runId: ctx.runId, stateId },
        },
        async (): Promise<ProviderRun<AttemptResult>> => {
          const out = await attempt(req, quote, stateId, started);
          return {
            value: out,
            // `neverCalled` is deliberately NOT claimed. From here a refusal
            // before the fetch and a request that was served and billed are
            // indistinguishable, and the guard's own rule is that every
            // ambiguity defaults to CHARGE. Same reasoning as `toolRouter`.
            actualUsd: out.measuredUsd ?? undefined,
            unitsActual: out.units,
            outcome: out.reply.ok ? "ACCEPTED" : "FAILED",
          };
        },
      );

      if (!guarded.admitted) {
        // REFUSED BEFORE ANYTHING LEFT, so this is the one path that charges
        // nothing — and it is recorded, because a spend ceiling that stops a
        // run silently reads exactly like a model that had nothing to say.
        const reason = `the spend ledger refused: ${guarded.reason}`;
        ctx.record({
          runId: ctx.runId,
          stateId,
          purpose: req.kind,
          model: LOOP_MODEL,
          answeredBy: "none",
          promptChars: req.prompt.length,
          maxOutputTokens: req.maxOutputTokens,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: quote.costUsd,
          actualCostUsd: null,
          costUsd: 0,
          latencyMs: ctx.now() - started,
          ok: false,
          reason,
        });
        return {
          ok: false,
          text: "",
          model: LOOP_MODEL,
          reason,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        };
      }

      return guarded.value.reply;
    },
  };
}
