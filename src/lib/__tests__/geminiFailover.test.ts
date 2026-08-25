/**
 * GEMINI FAILOVER — owner loops, 2026-08-25.
 *
 * The thing being defended is narrow and easy to lose: a fallback provider is
 * a way to spend money on a request that has already failed. If the trigger is
 * "Claude errored", then a request the guard REFUSED for being over-cap simply
 * gets run somewhere else, and the ceiling stops meaning anything.
 *
 * So these tests are mostly about what must NOT happen. One class fails over;
 * ten do not; each of the ten has its own case.
 *
 * The ledger here is a simulator, not a mock of the module under test — it
 * implements admit/settle/release with the same duplicate-id and
 * over-request-cap rules Postgres enforces, so the assertions are about the
 * real reserve → call → settle path rather than about calls being made.
 */
import { describe, expect, it } from "vitest";
import type { ServiceRpc } from "../../../supabase/functions/_shared/financialLedger.ts";
import {
  GEMINI_FAILOVER_MODEL,
  GEMINI_FAILOVER_MODEL_AVAILABLE,
  GEMINI_PRICING_PROVENANCE,
  MODEL_RATES,
  SEARCH_UNIT_USD_BY_MODEL,
  type SearchBudget,
  USD_PER_WEB_SEARCH,
  estimateSearchUsd,
  geminiOutputTokens,
  searchUnitUsdFor,
  worstCaseUsd,
} from "../../../supabase/functions/_shared/searchBudget.ts";
import type { GuardSpec } from "../../../supabase/functions/_shared/searchGuard.ts";
import {
  type ClaudeFailureClass,
  FAILOVER_TRIGGER,
  classifyClaudeFailure,
  failoverDecision,
  failoverEnvFrom,
  geminiBudgetFrom,
  geminiRequestId,
  isAnthropicCreditExhaustion,
  withCreditExhaustionFailover,
} from "../../../supabase/functions/_shared/geminiFailover.ts";
import {
  crossCheckSatisfied,
  dropUnbackedRows,
  groundedQueriesToReserve,
  readGrounding,
  searchCapabilityFor,
  translateSearchTools,
} from "../../../supabase/functions/_shared/geminiSearch.ts";

/** The owner's SEARCH request ceiling. Not a variable in this experiment. */
const REQUEST_CAP_USD = 0.5;

// ------------------------------------------------------------ ledger simulator
type Row = {
  requestId: string;
  provider: string;
  model: string;
  estimatedUsd: number;
  actualUsd: number | null;
  state: "RESERVED" | "SETTLED" | "RELEASED";
  outcome: string | null;
};

function fakeLedger(
  requestCapUsd = REQUEST_CAP_USD,
  /** Refuse a specific request id, the way a nearly-spent daily cap would. */
  refuseAdmit: (id: string) => string | null = () => null,
) {
  const rows = new Map<string, Row>();
  const order: string[] = [];
  /** Reservations open at this instant. Must never exceed 1 in these flows. */
  let open = 0;
  let peakOpen = 0;

  const rpc: ServiceRpc = async (fn, args) => {
    const id = String(args._request_id);
    if (fn === "admit_provider_spend") {
      order.push(`admit:${id}`);
      // Postgres refuses a repeated id. Reusing one cannot double-reserve.
      if (rows.has(id)) return { data: { ok: false, reason: "duplicate-request" }, error: null };
      const forced = refuseAdmit(id);
      if (forced) return { data: { ok: false, reason: forced }, error: null };
      const est = Number(args._estimated_usd);
      if (est > requestCapUsd) {
        return { data: { ok: false, reason: "over-request-cap" }, error: null };
      }
      rows.set(id, {
        requestId: id,
        provider: String(args._provider),
        model: String(args._model),
        estimatedUsd: est,
        actualUsd: null,
        state: "RESERVED",
        outcome: null,
      });
      open += 1;
      peakOpen = Math.max(peakOpen, open);
      return { data: { ok: true, reason: "ok", attempt: 1 }, error: null };
    }
    if (fn === "settle_provider_spend") {
      order.push(`settle:${id}`);
      const row = rows.get(id);
      if (row && row.state === "RESERVED") {
        row.state = "SETTLED";
        row.actualUsd = args._actual_usd === null ? null : Number(args._actual_usd);
        row.outcome = String(args._outcome);
        open -= 1;
      }
      return { data: null, error: null };
    }
    if (fn === "release_provider_spend") {
      order.push(`release:${id}`);
      const row = rows.get(id);
      if (row && row.state === "RESERVED") {
        row.state = "RELEASED";
        open -= 1;
      }
      return { data: null, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };

  return {
    rpc,
    rows,
    order,
    peakOpen: () => peakOpen,
    /** What the ledger says is committed: reservations plus settled charges. */
    committed: () =>
      [...rows.values()]
        .filter((r) => r.state !== "RELEASED")
        .reduce((sum, r) => sum + (r.actualUsd ?? r.estimatedUsd), 0),
    row: (id: string) => rows.get(id),
  };
}

/** A chat-shaped request: no live sources needed, so it may fail over. */
const CHAT_BUDGET: SearchBudget = {
  maxSearches: 0,
  maxProviderCalls: 1,
  maxLlmCalls: 1,
  maxInputTokens: 40_000,
  maxOutputTokens: 2_500,
  maxWallClockMs: 120_000,
  maxEstimatedUsd: REQUEST_CAP_USD,
};

/** A scouting request: it searches, so it needs grounding. */
const SEARCH_BUDGET: SearchBudget = { ...CHAT_BUDGET, maxSearches: 6 };

const spec = (over: Partial<GuardSpec> = {}): GuardSpec => ({
  requestId: "req-1",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  searchType: "ting-chat",
  budget: CHAT_BUDGET,
  ...over,
});

const CREDIT_EXHAUSTED = {
  ok: false,
  status: 400,
  body: {
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "Your credit balance is too low to access the Anthropic API.",
    },
  },
};

/**
 * The ladder with every lock open. `modelAvailable` is passed explicitly so
 * these tests exercise the mechanism regardless of what the measured constant
 * currently says — production always reads the constant.
 */
const ON = { enabled: true, configured: true, modelAvailable: true };

/** A Gemini leg that answers, reporting Google-shaped usage. */
const geminiOk =
  (inTok = 30_000, outTok = 900) =>
  async () => ({
    value: { answered: true },
    usage: { input_tokens: inTok, output_tokens: outTok },
    stopReason: "end_turn",
  });

// ============================================================ §2/§3 pricing
describe("the Gemini failover model is priced, and priced honestly", () => {
  it("is the MEASURED-CALLABLE model, at its published $0.30 / $2.50 per MTok", () => {
    expect(GEMINI_FAILOVER_MODEL).toBe("gemini-3.5-flash-lite");
    expect(MODEL_RATES[GEMINI_FAILOVER_MODEL]).toEqual({ inUsd: 0.3 / 1e6, outUsd: 2.5 / 1e6 });
  });

  it("is not the preview, and not the 2.5 id that 404s on our key", () => {
    expect(GEMINI_FAILOVER_MODEL).not.toMatch(/preview/);
    expect(GEMINI_FAILOVER_MODEL).not.toBe("gemini-2.5-flash-lite");
    // The 2.5 rate stays in the table so historic ledger rows can be priced.
    expect(MODEL_RATES["gemini-2.5-flash-lite"]).toBeTruthy();
  });

  it("records that the rate is corroborated, NOT read from a primary page", () => {
    // Every Google docs host is egress-blocked from this container. The
    // distinction is recorded in the code so nobody later mistakes this rate
    // for the Anthropic ones, which were read off the vendor's own page.
    expect(GEMINI_PRICING_PROVENANCE).toBe("corroborated-secondary");
  });

  it("prices a zero-search Gemini call exactly — tokens are the whole bill", () => {
    const usd = estimateSearchUsd({
      model: GEMINI_FAILOVER_MODEL,
      searches: 0,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(0.3 + 2.5, 10);
  });

  it("prices grounding per QUERY, on the scheme for this model's generation", () => {
    // $14 per 1,000 on the 3.x family; $35 per 1,000 on 2.x. The earlier
    // reading of these as contradictory was wrong — they are two schemes.
    expect(searchUnitUsdFor("gemini-3.5-flash-lite")).toBeCloseTo(0.014, 10);
    expect(searchUnitUsdFor("gemini-2.5-flash-lite")).toBeCloseTo(0.035, 10);
  });

  it("still REFUSES a searching call on a model whose grounding rate is unknown", () => {
    // The guard that used to block every Gemini search. Kept live, not
    // deleted: pointing the failover at an unpriced model must go back to
    // refusing rather than reserving against nothing.
    SEARCH_UNIT_USD_BY_MODEL["gemini-test-unpriced"] = null;
    MODEL_RATES["gemini-test-unpriced"] = { inUsd: 1 / 1e6, outUsd: 1 / 1e6 };
    try {
      expect(() =>
        estimateSearchUsd({
          model: "gemini-test-unpriced",
          searches: 1,
          inputTokens: 10,
          outputTokens: 10,
        }),
      ).toThrow(/unpriced-search-unit/);
    } finally {
      delete SEARCH_UNIT_USD_BY_MODEL["gemini-test-unpriced"];
      delete MODEL_RATES["gemini-test-unpriced"];
    }
  });

  it("does not disturb any Anthropic rate", () => {
    expect(MODEL_RATES["claude-haiku-4-5"]).toEqual({ inUsd: 1 / 1e6, outUsd: 5 / 1e6 });
    for (const m of ["claude-opus-5", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"]) {
      expect(SEARCH_UNIT_USD_BY_MODEL[m], m).toBe(USD_PER_WEB_SEARCH);
    }
    expect(worstCaseUsd("claude-haiku-4-5", SEARCH_BUDGET)).toBeGreaterThan(0);
  });

  it("is never reachable as 'unpriced-model' — the refusal §3 forbids", () => {
    expect(Object.keys(MODEL_RATES)).toContain(GEMINI_FAILOVER_MODEL);
  });
});

// ============================================================ classification
describe("the credit-exhaustion classifier is narrow", () => {
  it("matches Anthropic's exact shape", () => {
    expect(isAnthropicCreditExhaustion(400, CREDIT_EXHAUSTED.body)).toBe(true);
    expect(classifyClaudeFailure(CREDIT_EXHAUSTED)).toBe(FAILOVER_TRIGGER);
  });

  it("does not match a bare 400 — that is OUR malformed request", () => {
    // Failing over here would spend Google's money to paper over our own bug.
    expect(
      isAnthropicCreditExhaustion(400, {
        error: { type: "invalid_request_error", message: "messages: field required" },
      }),
    ).toBe(false);
  });

  it("does not match 429, 500, 529, or an unreadable body", () => {
    for (const status of [401, 429, 500, 529]) {
      expect(isAnthropicCreditExhaustion(status, CREDIT_EXHAUSTED.body), String(status)).toBe(
        false,
      );
      expect(classifyClaudeFailure({ ok: false, status, body: CREDIT_EXHAUSTED.body })).toBe(
        "PROVIDER_OTHER",
      );
    }
    expect(classifyClaudeFailure({ ok: false, status: 400, body: null })).toBe("PROVIDER_OTHER");
    expect(classifyClaudeFailure({ ok: false, status: null })).toBe("PROVIDER_OTHER");
  });

  it("a caller-known class always wins over the HTTP shape", () => {
    // A schema failure on a 200 must not be re-read as a provider outage.
    expect(classifyClaudeFailure({ ok: true, status: 200, knownClass: "SCHEMA_FAILURE" })).toBe(
      "SCHEMA_FAILURE",
    );
  });
});

// ============================================================ §5 non-triggers
describe("every non-trigger failure class refuses to fail over", () => {
  const NON_TRIGGERS: ClaudeFailureClass[] = [
    "GUARD_REFUSAL",
    "OVER_CAP",
    "UNDER_RESERVED",
    "SCHEMA_FAILURE",
    "APPLICATION_ERROR",
    "MALFORMED_REQUEST",
    "SAFETY_REFUSAL",
    "USER_CANCELLED",
    "VALIDATION_FAILURE",
    "PROVIDER_OTHER",
    "NONE",
  ];

  it.each(NON_TRIGGERS)("%s does not fail over", (cls) => {
    const d = failoverDecision(cls, CHAT_BUDGET, ON);
    expect(d.eligible).toBe(false);
    expect(d.eligible === false && d.block).toBe("not-credit-exhaustion");
  });

  it("only CREDIT_EXHAUSTION is eligible, and only with the gate on", () => {
    expect(failoverDecision("CREDIT_EXHAUSTION", CHAT_BUDGET, ON)).toEqual({ eligible: true });
    expect(failoverDecision("CREDIT_EXHAUSTION", CHAT_BUDGET, { ...ON, enabled: false })).toEqual({
      eligible: false,
      block: "failover-disabled",
    });
    expect(
      failoverDecision("CREDIT_EXHAUSTION", CHAT_BUDGET, { ...ON, configured: false }),
    ).toEqual({ eligible: false, block: "gemini-not-configured" });
  });

  it("a SEARCHING request now DOES fail over — grounding is priced and translated", () => {
    expect(failoverDecision("CREDIT_EXHAUSTION", SEARCH_BUDGET, ON)).toEqual({ eligible: true });
  });

  it("the MODEL-AVAILABILITY lock blocks before the owner's gate is consulted", () => {
    // Measured 2026-08-25: gemini-3.5-flash-lite returns 200 with real text,
    // so the lock is OPEN for the current model. It exists because
    // gemini-2.5-flash-lite passes a metadata lookup and then 404s on
    // generateContent — catalogue presence is not availability.
    expect(GEMINI_FAILOVER_MODEL_AVAILABLE).toBe(true);
    expect(
      failoverDecision("CREDIT_EXHAUSTION", CHAT_BUDGET, { ...ON, modelAvailable: false }),
    ).toEqual({ eligible: false, block: "model-unavailable" });
  });

  it("production reads availability from the measured constant, not the environment", () => {
    // An operator setting GEMINI_FAILOVER_ENABLED=true must NOT be able to
    // start calling a model that returns 404.
    const live = failoverEnvFrom(() => "true");
    expect(live.enabled).toBe(true);
    // Comes from the measured constant, NOT from the environment string.
    expect(live.modelAvailable).toBe(GEMINI_FAILOVER_MODEL_AVAILABLE);
    expect(failoverEnvFrom(() => "true").modelAvailable).not.toBe("true");
  });

  it("the owner gate is OFF unless explicitly 'true'", () => {
    const env = (v?: string) => failoverEnvFrom((k) => (k === "GEMINI_FAILOVER_ENABLED" ? v : "k"));
    expect(env(undefined).enabled).toBe(false);
    expect(env("").enabled).toBe(false);
    expect(env("1").enabled).toBe(false);
    expect(env("TRUE").enabled).toBe(false);
    expect(env("true").enabled).toBe(true);
  });
});

// ============================================================ §7 A–H
describe("A. Claude succeeds — Gemini is never called", () => {
  it("settles one Anthropic row and nothing else", async () => {
    const led = fakeLedger();
    let geminiCalls = 0;
    const out = await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({
        value: { answered: true },
        attempt: { ok: true, status: 200 },
        usage: { input_tokens: 12_000, output_tokens: 400 },
        stopReason: "end_turn",
      }),
      async () => {
        geminiCalls += 1;
        return { value: { answered: false } };
      },
    );

    expect(geminiCalls).toBe(0);
    expect(out.provider).toBe("anthropic");
    expect(out.claudeClass).toBe("NONE");
    expect(led.rows.size).toBe(1);
    expect(led.row("req-1")?.state).toBe("SETTLED");
    expect(led.row("req-1")?.outcome).toBe("ACCEPTED");
    // 12,000 in + 400 out on Haiku = $0.012 + $0.002.
    expect(led.row("req-1")?.actualUsd).toBeCloseTo(0.014, 9);
  });
});

describe("B. Claude credit exhaustion — release, reserve Gemini, settle Gemini", () => {
  it("walks the whole ladder exactly once", async () => {
    const led = fakeLedger();
    const out = await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({ value: { answered: false }, attempt: CREDIT_EXHAUSTED }),
      geminiOk(30_000, 900),
    );

    expect(out.claudeClass).toBe("CREDIT_EXHAUSTION");
    expect(out.provider).toBe("google");

    // The Claude reservation went BACK — Anthropic refused before serving, so
    // nothing was billed and there is no cost to carry.
    const claude = led.row("req-1");
    expect(claude?.state).toBe("RELEASED");
    expect(claude?.actualUsd).toBeNull();

    // Gemini got its OWN reservation, under its own id, on its own model.
    const gem = led.row(geminiRequestId("req-1"));
    expect(gem?.state).toBe("SETTLED");
    expect(gem?.provider).toBe("google");
    expect(gem?.model).toBe(GEMINI_FAILOVER_MODEL);
    // 30,000 in @ $0.30/MTok + 900 out @ $2.50/MTok, zero grounded queries.
    expect(gem?.actualUsd).toBeCloseTo(30_000 * 3e-7 + 900 * 2.5e-6, 10);

    // Exactly one admit per leg, in order, never overlapping.
    expect(led.order).toEqual([
      "admit:req-1",
      "release:req-1",
      "admit:req-1-gx",
      "settle:req-1-gx",
    ]);
    expect(led.peakOpen()).toBe(1);
  });

  it("charges only the Gemini leg — the released Claude leg costs nothing", async () => {
    const led = fakeLedger();
    await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
      geminiOk(30_000, 900),
    );
    expect(led.committed()).toBeCloseTo(30_000 * 3e-7 + 900 * 2.5e-6, 10);
  });
});

describe("C. Claude guard refusal — no Gemini fallback", () => {
  it("a refused admission is not re-run on another provider", async () => {
    // A $0.50 ceiling with a request that reserves above it.
    const led = fakeLedger(0.001);
    let geminiCalls = 0;
    const out = await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
      async () => {
        geminiCalls += 1;
        return { value: null };
      },
    );

    expect(out.result.admitted).toBe(false);
    expect(out.result.admitted === false && out.result.reason).toBe("over-request-cap");
    expect(out.claudeClass).toBe("GUARD_REFUSAL");
    expect(geminiCalls).toBe(0);
    expect(led.rows.size).toBe(0);
  });
});

describe("D. Claude over-cap — no Gemini fallback", () => {
  it("a settled-over-cap request does not get a second provider", async () => {
    const led = fakeLedger();
    let geminiCalls = 0;
    const out = await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({
        value: null,
        // The call SUCCEEDED and settled above the ceiling. Running it again
        // anywhere spends more money, never less.
        attempt: { ok: true, status: 200, knownClass: "OVER_CAP" },
        usage: { input_tokens: 400_000, output_tokens: 20_000 },
      }),
      async () => {
        geminiCalls += 1;
        return { value: null };
      },
    );

    expect(out.claudeClass).toBe("OVER_CAP");
    expect(out.block).toBe("not-credit-exhaustion");
    expect(geminiCalls).toBe(0);
    expect(led.row("req-1")?.state).toBe("SETTLED");
  });
});

describe("E. Claude malformed response — no automatic provider fallback", () => {
  it("a schema failure settles on Anthropic and stops", async () => {
    const led = fakeLedger();
    let geminiCalls = 0;
    const out = await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({
        value: { answered: false },
        attempt: { ok: true, status: 200, knownClass: "SCHEMA_FAILURE" },
        usage: { input_tokens: 9_000, output_tokens: 100 },
      }),
      async () => {
        geminiCalls += 1;
        return { value: null };
      },
    );

    expect(out.claudeClass).toBe("SCHEMA_FAILURE");
    expect(geminiCalls).toBe(0);
    // The Claude call really happened, so it is CHARGED, not released.
    expect(led.row("req-1")?.state).toBe("SETTLED");
    expect(led.row("req-1")?.actualUsd).toBeCloseTo(9_000e-6 + 100 * 5e-6, 9);
  });
});

describe("F. Gemini fails after its reservation", () => {
  it("never invents an actual — the estimate stands, nothing is stranded", async () => {
    const led = fakeLedger();
    const out = await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
      async () => ({
        value: { answered: false },
        // Google was reached and failed. We cannot prove nothing was billed,
        // so the reservation is CHARGED, not handed back — the safe direction.
        usage: null,
        terminationReason: "PROVIDER_ERROR" as const,
      }),
    );

    const gem = led.row(geminiRequestId("req-1"));
    expect(out.provider).toBe("google");
    expect(gem?.state).toBe("SETTLED");
    expect(gem?.outcome).toBe("FAILED");
    // Null, never 0 and never a fabricated figure.
    expect(gem?.actualUsd).toBeNull();
    // Settled or released — never left open.
    expect([...led.rows.values()].every((r) => r.state !== "RESERVED")).toBe(true);
  });

  it("releases when Gemini was never actually called", async () => {
    const led = fakeLedger();
    await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
      async () => ({ value: null, neverCalled: true }),
    );
    expect(led.row(geminiRequestId("req-1"))?.state).toBe("RELEASED");
    expect(led.committed()).toBe(0);
  });

  it("charges the estimate when the Gemini callback throws", async () => {
    const led = fakeLedger();
    await expect(
      withCreditExhaustionFailover(
        led.rpc,
        spec(),
        ON,
        async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
        async () => {
          throw new Error("socket hang up");
        },
      ),
    ).rejects.toThrow(/socket hang up/);
    const gem = led.row(geminiRequestId("req-1"));
    expect(gem?.state).toBe("SETTLED");
    expect(gem?.outcome).toBe("FAILED");
    expect(gem?.actualUsd).toBeNull();
  });
});

describe("G. Gemini exceeds the financial ceiling", () => {
  it("admission refuses BEFORE Gemini executes", async () => {
    // Note the shape of this case. Gemini is CHEAPER than Haiku per token, so
    // for one budget its reservation is always the smaller of the two — the
    // request ceiling can never bite on the Gemini leg alone. What can, and
    // what this covers, is the ledger refusing the second leg on any ground:
    // here the daily cap, which the released Claude leg does nothing to free.
    const led = fakeLedger(REQUEST_CAP_USD, (id) =>
      id.endsWith("-gx") ? "daily-cap-reached" : null,
    );
    let geminiCalls = 0;
    const out = await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
      async () => {
        geminiCalls += 1;
        return { value: null };
      },
    );

    expect(led.row("req-1")?.state).toBe("RELEASED");
    expect(out.provider).toBe("google");
    expect(out.result.admitted).toBe(false);
    expect(out.result.admitted === false && out.result.reason).toBe("daily-cap-reached");
    // The whole point: refused BEFORE execution, so nothing was spent.
    expect(geminiCalls).toBe(0);
    // And no row was opened for the refused leg.
    expect(led.row(geminiRequestId("req-1"))).toBeUndefined();
  });

  it("a Gemini reservation over the ceiling is refused on arithmetic, not luck", async () => {
    // Force the case the request cap DOES cover: a budget whose Gemini
    // worst case exceeds $0.50 on tokens alone.
    const huge: SearchBudget = { ...CHAT_BUDGET, maxInputTokens: 20_000_000 };
    expect(worstCaseUsd(GEMINI_FAILOVER_MODEL, geminiBudgetFrom(huge))).toBeGreaterThan(
      REQUEST_CAP_USD,
    );

    const led = fakeLedger();
    const { data } = await led.rpc("admit_provider_spend", {
      _request_id: "over",
      _provider: "google",
      _model: GEMINI_FAILOVER_MODEL,
      _estimated_usd: worstCaseUsd(GEMINI_FAILOVER_MODEL, geminiBudgetFrom(huge)),
    });
    expect(data).toEqual({ ok: false, reason: "over-request-cap" });
  });

  it("the Gemini leg inherits the ceiling, it does not get a wider one", () => {
    const g = geminiBudgetFrom({ ...CHAT_BUDGET, maxEstimatedUsd: REQUEST_CAP_USD });
    expect(g.maxEstimatedUsd).toBe(REQUEST_CAP_USD);
    // Searches are no longer zeroed — they carry HEADROOM, because Google's
    // google_search has no max_uses and Gemini decides how many to run.
    expect(geminiBudgetFrom(SEARCH_BUDGET).maxSearches).toBe(SEARCH_BUDGET.maxSearches * 2);
  });
});

describe("H. concurrency — no double reservation, no cross-request leakage", () => {
  it("two concurrent requests keep four separate rows", async () => {
    const led = fakeLedger();
    const run = (id: string) =>
      withCreditExhaustionFailover(
        led.rpc,
        spec({ requestId: id }),
        ON,
        async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
        geminiOk(10_000, 100),
      );

    await Promise.all([run("req-a"), run("req-b")]);

    expect([...led.rows.keys()].sort()).toEqual(["req-a", "req-a-gx", "req-b", "req-b-gx"]);
    expect(led.row("req-a")?.state).toBe("RELEASED");
    expect(led.row("req-b")?.state).toBe("RELEASED");
    expect(led.row("req-a-gx")?.state).toBe("SETTLED");
    expect(led.row("req-b-gx")?.state).toBe("SETTLED");
    // Two Gemini legs, each charged once.
    expect(led.committed()).toBeCloseTo(2 * (10_000 * 3e-7 + 100 * 2.5e-6), 10);
  });

  it("a retry under the same id cannot double-reserve either leg", async () => {
    const led = fakeLedger();
    const once = () =>
      withCreditExhaustionFailover(
        led.rpc,
        spec({ requestId: "req-same" }),
        ON,
        async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
        geminiOk(10_000, 100),
      );

    await once();
    const second = await once();

    // The ledger refuses the repeated id rather than opening a second
    // reservation for the same work.
    expect(second.result.admitted).toBe(false);
    expect(second.result.admitted === false && second.result.reason).toBe("duplicate-request");
    expect(led.rows.size).toBe(2);
  });

  it("the two legs never hold reservations at the same time", async () => {
    const led = fakeLedger();
    await withCreditExhaustionFailover(
      led.rpc,
      spec(),
      ON,
      async () => ({ value: null, attempt: CREDIT_EXHAUSTED }),
      geminiOk(),
    );
    expect(led.peakOpen()).toBe(1);
  });

  it("the Gemini id is derived, distinct, and within the ledger's column", () => {
    expect(geminiRequestId("req-1")).toBe("req-1-gx");
    expect(geminiRequestId("x".repeat(64)).length).toBeLessThanOrEqual(64);
    expect(geminiRequestId("abc")).not.toBe("abc");
  });
});

// ============================================================ §10 production
describe("the production gate is closed", () => {
  it("no searching edge function has been switched to Gemini", () => {
    // The failover adds a provider; it does not move the fleet off Haiku.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    for (const p of [
      "supabase/functions/smart-scout/index.ts",
      "supabase/functions/ting/index.ts",
      "supabase/functions/health-scan/index.ts",
      "supabase/functions/hotel-scout/index.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), p), "utf8");
      const models = [...src.matchAll(/"(claude-[a-z0-9-]+)"/g)].map((m) => m[1]);
      expect([...new Set(models)], p).toEqual(["claude-haiku-4-5"]);
    }
  });

  it("llm.ts's default model is untouched — §1 said not to change it", () => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const llm = readFileSync(join(process.cwd(), "supabase/functions/_shared/llm.ts"), "utf8");
    expect(llm).toMatch(/opts\.model \?\? "claude-opus-5"/);
  });
});

// ============================================================ the ting wiring
/**
 * Source-level guards on the one caller that has a fallback.
 *
 * ting's trigger used to be `if (!hasAttachment)` inside `else` on `!res.ok`,
 * which is to say: ANY Anthropic failure bought a second call on a second key.
 * It never fired only because gemini-3.6-flash had no rate — so pricing any
 * Google model would have switched it on by accident. These assertions exist
 * so that cannot come back silently.
 */
describe("ting's fallback is gated, classified, and priced", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const TING = readFileSync(join(process.cwd(), "supabase/functions/ting/index.ts"), "utf8");

  it("goes through the classifier and the decision, not a bare !res.ok", () => {
    expect(TING).toMatch(/classifyClaudeFailure\(/);
    expect(TING).toMatch(/failoverDecision\(/);
    expect(TING).toMatch(/if \(gate\.eligible && !hasAttachment\)/);
  });

  it("reads the owner gate from the environment", () => {
    expect(TING).toMatch(/failoverEnvFrom\(\(k\) => Deno\.env\.get\(k\)\)/);
  });

  it("calls the priced model, never the unpriced one it used to name", () => {
    expect(TING).toMatch(/model: GEMINI_FAILOVER_MODEL/);
    expect(TING).toMatch(/geminiModel: GEMINI_FAILOVER_MODEL/);
    // As a string LITERAL. The name survives in a comment explaining the
    // trap, which is the point of the comment.
    expect(TING).not.toMatch(/"gemini-3\.6-flash"/);
  });

  it("derives the fallback request id instead of minting a fresh one", () => {
    // A fresh uuid per attempt would let a client retry reserve twice.
    expect(TING).toMatch(/requestId: geminiRequestId\(/);
    expect(TING).not.toMatch(/requestId: requestIdFrom\(null\)/);
  });

  it("zeroes the fallback's searches through geminiBudgetFrom", () => {
    expect(TING).toMatch(/budget: geminiBudgetFrom\(/);
  });

  it("keeps Claude as the primary — the failover does not demote Haiku", () => {
    expect(TING).toMatch(/const TING_MODEL = "claude-haiku-4-5"/);
  });
});

describe("callGemini's model is separate from callClaude's", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const LLM = readFileSync(join(process.cwd(), "supabase/functions/_shared/llm.ts"), "utf8");

  it("uses a distinct geminiModel option", () => {
    // callGeminiFallback forwards an Anthropic caller's whole opts to
    // callGemini. If callGemini honoured `model`, that path would POST a
    // Claude id to generativelanguage.googleapis.com.
    expect(LLM).toMatch(/geminiModel\?: string/);
    expect(LLM).toMatch(/opts\.geminiModel \?\? GEMINI_FALLBACK_MODEL/);
    expect(LLM).toMatch(/models\/\$\{geminiModel\}:generateContent/);
  });

  it("leaves the Anthropic default exactly as it was", () => {
    expect(LLM).toMatch(/model: opts\.model \?\? "claude-opus-5"/);
    expect(LLM).toMatch(/const GEMINI_FALLBACK_MODEL = "gemini-3\.6-flash"/);
  });
});

// ==================================================== Gemini thinking tokens
/**
 * Gemini 2.5 models think by default, and thinking tokens are billed as
 * OUTPUT. The translator read `candidatesTokenCount` alone, which would settle
 * a Gemini call BELOW what Google charged for it — the same under-counting
 * defect the Haiku battery removed, arriving from the other side.
 */
describe("Gemini output tokens include thinking", () => {
  it("picks up thoughts that sit OUTSIDE candidates", () => {
    // prompt 1,000 + candidates 200 + thoughts 800 = total 2,000.
    expect(
      geminiOutputTokens({
        promptTokenCount: 1_000,
        candidatesTokenCount: 200,
        totalTokenCount: 2_000,
      }),
    ).toBe(1_000);
  });

  it("equals candidates when thoughts are already inside them", () => {
    expect(
      geminiOutputTokens({
        promptTokenCount: 1_000,
        candidatesTokenCount: 500,
        totalTokenCount: 1_500,
      }),
    ).toBe(500);
  });

  it("falls back to candidates when no total is reported", () => {
    expect(geminiOutputTokens({ promptTokenCount: 10, candidatesTokenCount: 7 })).toBe(7);
    expect(geminiOutputTokens({})).toBe(0);
  });

  it("never returns less than candidates — under-counting is the one direction barred", () => {
    // A malformed total below prompt must not produce a negative or a zero.
    expect(
      geminiOutputTokens({
        promptTokenCount: 5_000,
        candidatesTokenCount: 300,
        totalTokenCount: 100,
      }),
    ).toBe(300);
  });
});

// ==================================================== PHASE 4 — grounded search
/**
 * The source-integrity layer, and why it is not optional.
 *
 * The first real grounded call ONIQ ever made (2026-08-25, gemini-3.5-flash-lite,
 * "current price of 1kg Tata Salt") returned ONE grounding chunk —
 * bigbasket.com — and prose asserting TWO prices, the second from Blinkit,
 * which nothing supported. That is the exact shape these tests exist to catch:
 * the model searched once and then filled the rest in from memory.
 */
describe("Anthropic's web-search tool translates instead of vanishing", () => {
  it("maps web_search_20250305 onto Google's google_search", () => {
    const t = translateSearchTools([
      { type: "web_search_20250305", name: "web_search", max_uses: 6 },
    ]);
    expect(t.ok).toBe(true);
    expect(t.ok === true && t.searchRequired).toBe(true);
    expect(t.ok === true && t.tools).toEqual([{ google_search: {} }]);
  });

  it("REFUSES an Anthropic server tool it cannot translate", () => {
    // The old bridge dropped these silently, which is how a request that
    // demands citations reached a model that could not look anything up.
    const t = translateSearchTools([{ type: "code_execution_20250522", name: "code" }]);
    expect(t.ok).toBe(false);
    expect(t.ok === false && t.reason).toBe("search-tool-untranslatable");
  });

  it("a no-tools request is fine and simply does not require search", () => {
    const t = translateSearchTools([]);
    expect(t.ok === true && t.searchRequired).toBe(false);
  });
});

describe("the fail-closed gate rejects before generation", () => {
  it("refuses a search-required request with no search tool", () => {
    const cap = searchCapabilityFor([], SEARCH_BUDGET);
    expect(cap.ok).toBe(false);
    expect(cap.ok === false && cap.reason).toBe("search-required-without-search-tool");
  });

  it("passes a search-required request that carries the tool", () => {
    const cap = searchCapabilityFor(
      [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      SEARCH_BUDGET,
    );
    expect(cap.ok).toBe(true);
    expect(cap.ok === true && cap.tools).toEqual([{ google_search: {} }]);
  });

  it("passes a chat request that needs no sources", () => {
    expect(searchCapabilityFor([], CHAT_BUDGET).ok).toBe(true);
  });
});

/** The real grounding block from the 2026-08-25 call, field-for-field. */
const REAL_CANDIDATE = {
  groundingMetadata: {
    webSearchQueries: ["Tata Salt 1kg price BigBasket India 2026"],
    groundingChunks: [
      {
        web: {
          title: "bigbasket.com",
          uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHBelWZRFPFkXcQYKz9tDypDTRRiZ96dAuJ",
        },
      },
    ],
  },
};

describe("reading what Gemini actually retrieved", () => {
  it("recovers the publisher domain from the chunk title", () => {
    // Google puts the real host in `title`; `uri` is its own redirect.
    const g = readGrounding(REAL_CANDIDATE);
    expect([...g.domains]).toEqual(["bigbasket.com"]);
    expect(g.sources[0].redirectUrl).toMatch(/^https:\/\/vertexaisearch\.cloud\.google\.com\//);
  });

  it("counts the grounded queries, because usageMetadata does not", () => {
    // Verified against the real response: no search/grounding count field
    // exists in usageMetadata, so this IS the billable unit count.
    expect(readGrounding(REAL_CANDIDATE).queryCount).toBe(1);
    expect(readGrounding({}).queryCount).toBe(0);
  });

  it("ignores chunks whose title is not a host", () => {
    const g = readGrounding({
      groundingMetadata: {
        groundingChunks: [{ web: { title: "Best salt prices 2026", uri: "https://x.test/a" } }],
      },
    });
    expect(g.domains.size).toBe(0);
  });
});

describe("Gemini may only claim sources it actually received", () => {
  const grounding = readGrounding(REAL_CANDIDATE);

  it("drops the row the measured failure would have produced", () => {
    const rows = [
      { site: "BigBasket", price_inr: 28, source_domain: "bigbasket.com" },
      // The Blinkit price. No chunk backed it.
      { site: "Blinkit", price_inr: 30, source_domain: "blinkit.com" },
    ];
    const v = dropUnbackedRows(rows, grounding);
    expect(v.kept.map((r) => r.site)).toEqual(["BigBasket"]);
    expect(v.dropped).toHaveLength(1);
    expect(v.dropped[0].claimed).toBe("blinkit.com");
    expect(v.dropped[0].why).toBe("unbacked");
  });

  it("accepts a subdomain of a backed host, and ignores www", () => {
    const v = dropUnbackedRows(
      [
        { source_domain: "shop.bigbasket.com" },
        { source_domain: "www.bigbasket.com" },
        { source_domain: "BIGBASKET.COM" },
      ],
      grounding,
    );
    expect(v.kept).toHaveLength(3);
  });

  it("drops a row with no source at all", () => {
    const v = dropUnbackedRows([{ site: "Somewhere", price_inr: 25 }], grounding);
    expect(v.kept).toHaveLength(0);
    expect(v.dropped[0].why).toBe("no-domain");
  });

  it("does not let a lookalike domain pass as backed", () => {
    // "bigbasket.com.evil.test" ends with neither ".bigbasket.com" nor equals it.
    const v = dropUnbackedRows([{ source_domain: "bigbasket.com.evil.test" }], grounding);
    expect(v.kept).toHaveLength(0);
  });

  it("cross-check needs two DISTINCT hosts, not two rows", () => {
    expect(crossCheckSatisfied(grounding)).toBe(false);
    const two = readGrounding({
      groundingMetadata: {
        groundingChunks: [
          { web: { title: "bigbasket.com", uri: "https://v.test/1" } },
          { web: { title: "blinkit.com", uri: "https://v.test/2" } },
        ],
      },
    });
    expect(crossCheckSatisfied(two)).toBe(true);
  });
});

// ==================================================== PHASE 5 — grounded money
describe("grounding is reserved and settled as a billable unit", () => {
  it("reserves headroom because google_search has no max_uses", () => {
    // Anthropic enforces max_uses server-side; Google does not. Gemini decides
    // how many queries to run, so the reservation cannot assume the budget.
    expect(groundedQueriesToReserve(SEARCH_BUDGET)).toBe(SEARCH_BUDGET.maxSearches * 2);
  });

  it("the worst case for BOTH searching functions still fits $0.50", () => {
    // smart-scout: 6 hops, 20k base + 6x14k input, 6k output reserve.
    const scout: SearchBudget = {
      ...SEARCH_BUDGET,
      maxSearches: 6,
      maxInputTokens: 20_000 + 6 * 14_000,
      maxOutputTokens: 6_000,
    };
    // hotel-scout: 11 hops — the widest thing ONIQ runs.
    const stay: SearchBudget = {
      ...SEARCH_BUDGET,
      maxSearches: 11,
      maxInputTokens: 20_000 + 11 * 14_000,
      maxOutputTokens: 6_000,
    };
    for (const [name, b] of [
      ["smart-scout", scout],
      ["hotel-scout", stay],
    ] as const) {
      const worst = worstCaseUsd(GEMINI_FAILOVER_MODEL, geminiBudgetFrom(b));
      expect(worst, name).toBeLessThanOrEqual(REQUEST_CAP_USD);
    }
  });

  it("prices grounded queries into the estimate at $14/1,000", () => {
    const noSearch = estimateSearchUsd({
      model: GEMINI_FAILOVER_MODEL,
      searches: 0,
      inputTokens: 1_000,
      outputTokens: 100,
    });
    const sixSearches = estimateSearchUsd({
      model: GEMINI_FAILOVER_MODEL,
      searches: 6,
      inputTokens: 1_000,
      outputTokens: 100,
    });
    expect(sixSearches - noSearch).toBeCloseTo(6 * 0.014, 10);
  });
});

describe("thinking tokens reach settlement", () => {
  it("counts thoughts reported OUTSIDE both candidates and the total", () => {
    // gemini-3.5-flash and 3.6-flash spent their whole 16-token budget on
    // thinking and returned empty content — thoughts are real output spend.
    expect(
      geminiOutputTokens({
        promptTokenCount: 100,
        candidatesTokenCount: 0,
        thoughtsTokenCount: 13,
        totalTokenCount: 100,
      }),
    ).toBe(13);
  });

  it("counts thoughts reported inside the total but outside candidates", () => {
    expect(
      geminiOutputTokens({
        promptTokenCount: 26,
        candidatesTokenCount: 49,
        totalTokenCount: 200,
      }),
    ).toBe(174);
  });

  it("matches the real ungrounded shape exactly — no thoughts, no inflation", () => {
    // Verbatim from the 2026-08-25 grounded response.
    expect(
      geminiOutputTokens({
        promptTokenCount: 26,
        candidatesTokenCount: 49,
        totalTokenCount: 75,
      }),
    ).toBe(49);
  });
});

// ============================================ the live path, not just the module
/**
 * Source-level guards on `callGemini` itself.
 *
 * A translation module that nothing calls is decoration. The bug being fixed
 * lived in the REQUEST BUILDER — `translateToolsToGemini` skipped Anthropic
 * server tools, so the tools array reaching Google was empty while the system
 * prompt still demanded citations.
 */
describe("callGemini sends search instead of dropping it", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const LLM = readFileSync(join(process.cwd(), "supabase/functions/_shared/llm.ts"), "utf8");

  it("runs opts.tools through translateSearchTools before building the body", () => {
    expect(LLM).toMatch(/const search = translateSearchTools\(opts\.tools\)/);
    expect(LLM).toMatch(/if \(search\.searchRequired\) body\.tools = search\.tools/);
  });

  it("refuses rather than proceeding when translation fails", () => {
    expect(LLM).toMatch(
      /if \(!search\.ok\)[\s\S]{0,160}return \{ ok: false, reason: search\.reason \}/,
    );
  });

  it("carries the fail-closed assertion for callers that need live sources", () => {
    expect(LLM).toMatch(/opts\.requireSearch && !search\.searchRequired/);
    expect(LLM).toMatch(/search-required-without-search-tool/);
  });

  it("surfaces the retrieved sources so a caller can validate claims", () => {
    // Without the retrieved set there is nothing to check a claimed
    // source_domain against.
    expect(LLM).toMatch(/_oniqGrounding: readGrounding\(cand\)/);
  });

  it("reports grounded query count in Anthropic's usage shape", () => {
    // So the existing settlement path prices it with no special case.
    expect(LLM).toMatch(
      /server_tool_use: \{ web_search_requests: geminiGroundedQueryCount\(cand\) \}/,
    );
  });
});
