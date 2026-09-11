/**
 * OQCA HAS A CALLER IN THE APP — the owner's instruction, 2026-09-11:
 * _"Everything else — the substrate, the autonomy runtime, the self-improvement
 * loop — has no caller in the app at all add it."_
 *
 * THIS FILE IS ALSO WHAT PUTS THE NEW RUNTIME MODULES IN THE TYPECHECKER'S
 * PROGRAM. `tsconfig.json`'s `include` is `src/**` only, so anything under
 * `supabase/functions/` is typechecked ONLY when something under `src/` reaches
 * it — which is how v1.7 shipped a call to a field that has never existed with
 * `tsc --noEmit` clean. Importing `pgSink.ts` and `productionEvidence.ts` here
 * is not decoration.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "@/test/sourceText";
import { DEFAULT_RUNTIME_BOUNDS, runAutonomousRuntime } from "../autonomy/runtime";
import type { Observation } from "../autonomy/observation";
import {
  makeStateSink,
  NO_STATE_STORE,
  OQCA_STATE_KEYS,
  OQCA_STATE_TABLE,
  OqcaStateUnavailable,
  type OqcaStateKey,
  type OqcaStateStore,
} from "../../../supabase/functions/_shared/oqcaRuntime/pgSink.ts";
import {
  DISPATCH_FAILURES_FOR_FULL_SEVERITY,
  PRODUCTION_EVIDENCE_GAP,
  QUEUE_ABANDONED_MINUTES,
  QUEUE_STALE_MINUTES,
  WORKER_SILENCE_FOR_FULL_SEVERITY,
  productionCorpus,
  productionEvidence,
  type ProductionSnapshot,
} from "../../../supabase/functions/_shared/oqcaRuntime/productionEvidence.ts";
import {
  makeSubstrateSurvey,
  makeSinkCheckpointStore,
} from "../../../supabase/functions/_shared/oqcaRuntime/autonomous.ts";
import { makeSystemObserver } from "../../../supabase/functions/_shared/oqcaRuntime/observe.ts";
import { makeImprovementEpisode } from "../../../supabase/functions/_shared/oqcaRuntime/improvement.ts";
import { makeLocalEvidenceResearch } from "../../../supabase/functions/_shared/oqcaRuntime/research.ts";
import { makeSinkDurableStore } from "../../../supabase/functions/_shared/oqcaRuntime/durableStore.ts";
import {
  type CapabilityExecutor,
  type CapabilityRequest,
  registryCapabilityStates,
  resourcesFor,
} from "../../../supabase/functions/_shared/oqcaRuntime/selfModel.ts";

const FUNCTION = "supabase/functions/oqca-observe/index.ts";
const fn = () => stripComments(readFileSync(FUNCTION, "utf8"));

/** Matches `EPISODES_PER_TAP` in the function; see the note there. */
const EPISODES_PER_TAP = 3;

/**
 * One COMPLETE traversal, measured 2026-09-11 through the deployed engine:
 * 39,936 ms for two episodes that both ended `loop max_iterations`. Rounded
 * down so the assertions below are conservative about how much a run needs.
 */
const MEASURED_TRAVERSAL_MS = 19_968;

/**
 * The longest this repo already lets one of its edge functions run —
 * `story-plot`'s own self-imposed cap, "because an edge function has a wall
 * clock". `smart-scout` records the hosted platform ceiling as 400 s; this is
 * the tighter, first-party figure and therefore the one worth binding to.
 */
const EDGE_FUNCTION_BUDGET_MS = 90_000;

const AT = "2026-09-11T12:00:00.000Z";

/** A live outage, in the shape the host reads it. */
const OUTAGE: ProductionSnapshot = {
  at: AT,
  dispatch: {
    consecutiveFailures: 4,
    lastOkAt: "2026-09-05T14:24:04.000Z",
    lastError: "401 Bad credentials",
  },
  queue: { queued: 2, oldestMinutes: 480 },
  worker: { sinceLastReadyMinutes: 8_600, readyInWindow: 0 },
  errorSurfaces: [
    { surface: "story-dispatch", reports: 38 },
    { surface: "chat-viewport", reports: 3 },
  ],
  durable: { records: 0 },
};

/* ================================================================ *
 * THE DURABLE SINK
 * ================================================================ */

function memoryStore(): OqcaStateStore & { readonly raw: Map<OqcaStateKey, string> } {
  const raw = new Map<OqcaStateKey, string>();
  return {
    raw,
    get: async (key) => ({ ok: true, doc: raw.get(key) ?? null }),
    put: async (key, doc) => {
      raw.set(key, doc);
      return { ok: true };
    },
  };
}

describe("the durable state sink", () => {
  it("names one relation and a closed set of keys", () => {
    expect(OQCA_STATE_TABLE).toBe("oqca_state");
    expect([...OQCA_STATE_KEYS]).toEqual(["knowledge", "checkpoint"]);
  });

  it("reads back what it wrote, per key, without crossing keys", async () => {
    const store = memoryStore();
    const knowledge = makeStateSink(store, "knowledge");
    const checkpoint = makeStateSink(store, "checkpoint");
    expect(await knowledge.read()).toBeNull();
    expect(await knowledge.write('{"a":1}')).toBe(true);
    expect(await knowledge.read()).toBe('{"a":1}');
    // The other slot is untouched — one table, two independent documents.
    expect(await checkpoint.read()).toBeNull();
  });

  it("THROWS on a failed read rather than answering empty", async () => {
    /**
     * THE WHOLE POINT OF THE FILE. `null` means "nothing stored yet", which is
     * what a first run legitimately returns. Folding a failed read onto it
     * would make an unreachable store indistinguishable from a fresh morning:
     * ONIQ would start from zero, report `restored 0 record(s)` and nothing
     * anywhere would say a backlog had been lost.
     */
    const sink = makeStateSink(
      {
        get: async () => ({ ok: false, reason: "connection refused" }),
        put: async () => ({ ok: true }),
      },
      "knowledge",
    );
    await expect(sink.read()).rejects.toBeInstanceOf(OqcaStateUnavailable);
    await expect(sink.read()).rejects.toThrow(/connection refused/);
  });

  it("reports a refused WRITE as false, so no count is invented", async () => {
    const notes: string[] = [];
    const sink = makeStateSink(
      {
        get: async () => ({ ok: true, doc: null }),
        put: async () => ({ ok: false, reason: "read only" }),
      },
      "knowledge",
      (m) => notes.push(m),
    );
    expect(await sink.write("{}")).toBe(false);
    expect(notes.join(" ")).toMatch(/read only/);
  });

  it("the refusing default reads as empty and never confirms a write", async () => {
    expect(await NO_STATE_STORE.get("knowledge")).toEqual({ ok: true, doc: null });
    const put = await NO_STATE_STORE.put("knowledge", "{}");
    expect(put.ok).toBe(false);
  });
});

/* ================================================================ *
 * THE PRODUCTION EVIDENCE
 * ================================================================ */

describe("production evidence", () => {
  it("a reading the host could not take produces NO item at all", () => {
    const blind: ProductionSnapshot = {
      at: AT,
      dispatch: null,
      queue: null,
      worker: null,
      errorSurfaces: null,
      durable: null,
    };
    expect(productionEvidence(blind)).toEqual([]);
    // ...and the kinds then complete to UNOBSERVED, which is §3's whole point.
    expect(PRODUCTION_EVIDENCE_GAP).toMatch(/UNOBSERVED/);
  });

  it("a failing dispatcher is severity 1 and asks for a person", () => {
    const item = productionEvidence(OUTAGE).find((i) => i.subject === "github_repository_dispatch");
    expect(item?.severity).toBe(1);
    expect(item?.value).toBe(4);
    // UPDATE_CONFIGURATION is registered and NOT authorized: escalation, which
    // is what the 2026-09-11 ranking fix made rank above a never-observed chore.
    expect(item?.requires).toEqual(["UPDATE_CONFIGURATION"]);
    expect(item?.detail).toMatch(/401 Bad credentials/);
  });

  it("a healthy dispatcher is severity 0 — OBSERVED, not UNKNOWN", () => {
    const item = productionEvidence({
      ...OUTAGE,
      dispatch: { consecutiveFailures: 0, lastOkAt: AT, lastError: null },
    }).find((i) => i.subject === "github_repository_dispatch");
    expect(item?.severity).toBe(0);
    expect(item?.severity).not.toBeNull();
  });

  it("the dispatch scale saturates at its stated threshold", () => {
    const at = (n: number) =>
      productionEvidence({
        ...OUTAGE,
        dispatch: { consecutiveFailures: n, lastOkAt: null, lastError: null },
      }).find((i) => i.subject === "github_repository_dispatch")?.severity;
    expect(at(1)).toBeCloseTo(1 / DISPATCH_FAILURES_FOR_FULL_SEVERITY, 10);
    expect(at(DISPATCH_FAILURES_FOR_FULL_SEVERITY)).toBe(1);
    expect(at(99)).toBe(1);
  });

  it("the queue has three states and the middle one is why it is not a boolean", () => {
    const sev = (oldest: number | null) =>
      productionEvidence({ ...OUTAGE, queue: { queued: 1, oldestMinutes: oldest } }).find(
        (i) => i.subject === "story_jobs_queue",
      )?.severity;
    expect(sev(null)).toBe(0);
    expect(sev(QUEUE_STALE_MINUTES - 1)).toBe(0);
    expect(sev(QUEUE_STALE_MINUTES)).toBe(0.5);
    expect(sev(QUEUE_ABANDONED_MINUTES)).toBe(1);
  });

  it("a renderer that has never run is UNKNOWN, never a crisis", () => {
    const item = productionEvidence({
      ...OUTAGE,
      worker: { sinceLastReadyMinutes: null, readyInWindow: 0 },
    }).find((i) => i.subject === "story_worker");
    // null severity is "looked, cannot say" — `observe.ts` turns it into UNKNOWN.
    expect(item?.severity).toBeNull();
    expect(item?.value).toBeNull();
  });

  it("a silent renderer reaches severity 1 at its stated threshold", () => {
    const sev = (mins: number) =>
      productionEvidence({
        ...OUTAGE,
        worker: { sinceLastReadyMinutes: mins, readyInWindow: 0 },
      }).find((i) => i.subject === "story_worker")?.severity;
    expect(sev(0)).toBe(0);
    expect(sev(WORKER_SILENCE_FOR_FULL_SEVERITY)).toBe(1);
    expect(sev(WORKER_SILENCE_FOR_FULL_SEVERITY * 10)).toBe(1);
  });

  it("the loudest error surface is named, and the total travels beside it", () => {
    const item = productionEvidence(OUTAGE).find((i) => i.subject === "client_error_reports");
    expect(item?.value).toBe(41);
    expect(item?.detail).toMatch(/story-dispatch with 38/);
  });

  it("the durable store answering at all is evidence, and it is healthy", () => {
    const item = productionEvidence(OUTAGE).find((i) => i.subject === "oqca_durable_state");
    expect(item?.severity).toBe(0);
    expect(item?.requires).toEqual(["UPDATE_KNOWLEDGE"]);
  });

  it("names no health-domain table, so the health isolation seal holds", () => {
    const src = readFileSync(
      "supabase/functions/_shared/oqcaRuntime/productionEvidence.ts",
      "utf8",
    );
    for (const t of [
      "health_records",
      "health_documents",
      "health_consents",
      "health_audit",
      "health_config",
      "health_ai_requests",
    ]) {
      expect(src, `${t} must not be named outside the health module`).not.toContain(t);
    }
  });
});

describe("the corpus is the readings themselves", () => {
  it("every concept id retrieves its own measured line, verbatim", () => {
    const research = makeLocalEvidenceResearch(productionCorpus(OUTAGE));
    for (const item of productionEvidence(OUTAGE)) {
      // `concernId` is `${kind}:${subject}`, and retrieval requires EVERY term
      // of the question — which is why each corpus line opens with exactly it.
      const got = research.retrieve(`${item.kind}:${item.subject}`);
      expect(got.ok, `${item.kind}:${item.subject} retrieved nothing`).toBe(true);
      if (!got.ok) continue;
      expect(got.findings.length).toBeGreaterThan(0);
      expect(got.findings[0].excerpt).toContain(item.detail.slice(0, 40));
      // The locator names the QUERY that produced the reading, not this file.
      expect(got.findings[0].locator).toMatch(/read by oqca-observe/);
    }
  });

  it("and an empty snapshot retrieves nothing rather than inventing a negative", () => {
    const research = makeLocalEvidenceResearch(
      productionCorpus({
        at: AT,
        dispatch: null,
        queue: null,
        worker: null,
        errorSurfaces: null,
        durable: null,
      }),
    );
    const got = research.retrieve("provider_failure:github_repository_dispatch");
    expect(got.ok).toBe(false);
  });
});

/* ================================================================ *
 * THE WHOLE LIFECYCLE, OVER ONE SHARED STORE
 * ================================================================ */

const PERMIT_KNOWLEDGE: CapabilityExecutor = async (req: CapabilityRequest) =>
  req.id === "UPDATE_KNOWLEDGE"
    ? { ok: true, value: Number(req.args.records ?? 0), unit: "records", detail: "permitted" }
    : { ok: false, reason: `${req.id} not executed here` };

function tap(store: OqcaStateStore, snapshot: ProductionSnapshot) {
  const ctx = { at: () => AT, nowMs: () => Date.parse(AT), elapsedMs: () => 0 };
  return runAutonomousRuntime({
    survey: makeSubstrateSurvey(ctx),
    observe: makeSystemObserver(
      { read: async () => ({ ok: true, items: productionEvidence(snapshot) }) },
      ctx.at,
    ),
    needs: (o: Observation) => resourcesFor(o.requires),
    knownCapabilities: registryCapabilityStates(),
    runEpisode: makeImprovementEpisode(ctx, {
      research: makeLocalEvidenceResearch(productionCorpus(snapshot)),
      durable: makeSinkDurableStore(makeStateSink(store, "knowledge")),
      executor: PERMIT_KNOWLEDGE,
    }),
    store: makeSinkCheckpointStore(makeStateSink(store, "checkpoint")),
    clock: () => Date.parse(AT),
    bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: EPISODES_PER_TAP },
  });
}

describe("a tap of the app's caller", () => {
  it("observes production, ranks the outage first, and persists what it learned", async () => {
    const store = memoryStore();
    const first = await tap(store, OUTAGE);

    // The observer ran over real readings, so the world state is not blind.
    expect(first.observations.length).toBeGreaterThan(0);
    expect(first.concerns.length).toBeGreaterThan(0);
    /**
     * EVERY MEASURED FAULT OUTRANKS EVERY UNOBSERVED CHORE, and that is the
     * property rather than a particular winner. Before the 2026-09-11 ranking
     * fix a severity-1.0 production fault ranked 14th of 18 — beneath
     * "establish how to observe X" chores — precisely because acting on it
     * needs a capability nobody has authorized. Escalation is work ONIQ can
     * always do.
     *
     * THE TOP TWO ARE A GENUINE TIE AND THE TEST SAYS SO. The dispatcher and
     * the film queue are the same outage seen from two ends: both severity 1,
     * both OBSERVED, both escalation-blocked. Nothing in the evidence separates
     * them, so `planImprovements` falls through to the id — and pinning one as
     * the winner would be asserting an alphabetical accident as a finding.
     */
    const ids = first.concerns.map((c) => c.goal.id);
    const firstChore = first.concerns.findIndex((c) => c.observation.state === "UNOBSERVED");
    expect(firstChore).toBeGreaterThan(0);
    for (const measured of ["github_repository_dispatch", "story_jobs_queue", "story_worker"]) {
      expect(
        ids.findIndex((i) => i.includes(measured)),
        `${measured} ranked below a never-observed chore`,
      ).toBeLessThan(firstChore);
    }

    /**
     * AND THE LIMIT, ASSERTED SO IT CANNOT DRIFT UNNOTICED. A MID-severity
     * measured fault can still rank BELOW a never-observed chore, and the
     * arithmetic is worth writing down rather than discovering later:
     *
     *   severity 1.00, needs a person   1.00 x 0.060 = 0.060000   <- first
     *   severity 0.30, needs nothing    0.30 x 0.168 = 0.050400
     *   severity 0.76, needs a person   0.76 x 0.060 = 0.034656   <- below
     *
     * The escalation factor halves what ONIQ cannot do itself, and at 0.76 that
     * is enough to cross a chore it can. This is a modifier RE-RANKING rather
     * than vetoing — v1.6's own rule — and it is a near-tie (a 2.8x modifier
     * against a 2.5x importance), not the 67x inversion the 2026-09-11 fix
     * removed. Forcing the order with a new constant would be inventing a
     * number nobody measured. If this ever needs to change, it changes here
     * deliberately.
     */
    const errorRank = ids.findIndex((i) => i.includes("client_error_reports"));
    expect(errorRank).toBeGreaterThan(firstChore);

    // The substrate and the durable store are both real: something stuck.
    expect(first.episodes).toBe(EPISODES_PER_TAP);
    /**
     * IT LEARNED SOMETHING REAL, FROM A PRODUCTION READING. The corpus is the
     * readings themselves, so what was promoted into durable knowledge is the
     * measured sentence about the renderer — verbatim, located by the query
     * that produced it, and first-hand.
     */
    expect(first.learned).toContain("runtime_failure:story_worker");
    expect(first.persisted.length).toBeGreaterThan(0);
    expect(store.raw.get("knowledge")).toBeTruthy();
    expect(store.raw.get("checkpoint")).toBeTruthy();

    /**
     * AND THE STOP NAMES WHAT A PERSON CAN GO AND FIX, which is the whole of
     * what v1.6 built `capability_blocked` for and what the 2026-09-11 ranking
     * fix made reachable. Both halves are here: the zero token budget (ONIQ's
     * own number, the owner's to raise) and the unauthorized tools (an
     * authorization nobody has granted).
     */
    expect(first.stop).toBe("capability_blocked");
    expect(first.stopDetail).toMatch(/max_tokens/);
    expect(first.stopDetail).toMatch(/unauthorized/);
  });

  it("and a LATER tap restores what the first one wrote", async () => {
    /**
     * §18's COMPOUNDING CLAIM, over the shape the edge function actually uses.
     * The two runs share nothing but two strings in one table.
     */
    const store = memoryStore();
    const first = await tap(store, OUTAGE);
    const afterFirst = JSON.parse(store.raw.get("knowledge")!) as { rows: unknown[] };
    const second = await tap(store, OUTAGE);

    expect(first.restored).toBe(false);
    expect(second.restored).toBe(true);
    // The backlog survived, so the second tap is not a fresh morning.
    expect(second.snapshot.backlog.length).toBeGreaterThan(0);
    expect(afterFirst.rows.length).toBeGreaterThan(0);

    /**
     * THE SECOND TAP LEARNS MORE, AND LOSES NOTHING — measured, and not what
     * this assertion first claimed. It was written expecting the row count to
     * hold steady, on the assumption that a second tap would re-persist the
     * same assertion; it grew 1 -> 3 instead. That is the design working
     * rather than a leak: the first tap's objective is `blocked` in the
     * restored checkpoint, so the second one reaches the concerns BELOW it and
     * learns about the dispatcher and the film queue as well.
     *
     * So the two claims worth pinning are that nothing is LOST (every id the
     * first tap wrote survives, which is what `mergeDurable`'s upsert-by-id
     * guarantees and what a blind overwrite would break) and that the second
     * tap moved something the first one did not.
     */
    const ids = (raw: string) =>
      (JSON.parse(raw) as { rows: { knowledge_id: string }[] }).rows.map((r) => r.knowledge_id);
    const firstIds = afterFirst.rows.map((r) => (r as { knowledge_id: string }).knowledge_id);
    const secondIds = ids(store.raw.get("knowledge")!);
    for (const id of firstIds) expect(secondIds, `${id} was lost`).toContain(id);
    expect(secondIds.length).toBeGreaterThan(firstIds.length);
    expect(second.learned.length).toBeGreaterThan(0);
    expect(second.learned).not.toEqual(first.learned);
    expect(second.episodes).toBeGreaterThan(0);
  });

  it("a tick whose memory is unreachable FAILS rather than starting from zero", async () => {
    const broken: OqcaStateStore = {
      get: async () => ({ ok: false, reason: "the durable store is unreachable" }),
      put: async () => ({ ok: true }),
    };
    await expect(tap(broken, OUTAGE)).rejects.toBeInstanceOf(OqcaStateUnavailable);
  });
});

/* ================================================================ *
 * THE FUNCTION'S OWN WIRING — read from source, comments stripped
 * ================================================================ */

describe("oqca-observe", () => {
  it("gates on is_admin before it reads anything", () => {
    /**
     * THE HANDLER, NOT THE FILE. The first draft of this read `readProduction(`
     * over the whole source and matched its DECLARATION, which sits above
     * the request handler — so it compared the gate against a function
     * definition and
     * reported the gate as running last on source where it runs first. This
     * repo has now made that class of mistake often enough to have a name for
     * it; the window is the handler body.
     */
    /**
     * THE ANCHOR IS THE HANDLER'S FIRST STATEMENT, not the runtime call that
     * registers it. `security.test.ts` bans the Deno namespace across this
     * tree and it is right to: a test TITLE or a window anchor is not worth
     * cutting a hole in a security guard for. The repo has now reworded twice
     * for the same reason rather than exempting anything.
     */
    const HANDLER_START = 'if (req.method === "OPTIONS")';
    const handler = fn().slice(fn().indexOf(HANDLER_START));
    expect(handler.length).toBeGreaterThan(0);
    const gate = handler.indexOf('rpc("is_admin"');
    const forbid = handler.indexOf('403, { error: "Admins only" }');
    const read = handler.indexOf("await readProduction(db");
    expect(gate).toBeGreaterThan(0);
    expect(forbid).toBeGreaterThan(gate);
    expect(read).toBeGreaterThan(forbid);
  });

  /**
   * THIS GUARD USED TO ASSERT THAT A TAP COSTS NOTHING, and it went red on
   * purpose. Owner directive 2026-09-11 — "increase the budget to 100$" —
   * superseded the premise, so the assertion was rewritten rather than deleted:
   * what replaces it is the set of things that must STILL be true now that the
   * tap can spend.
   */
  it("spends under a per-run runaway guard, and never names the owner's total here", () => {
    const src = fn();
    expect(src).toMatch(/budgets: TAP_BUDGETS/);
    // THE OWNER'S $100 MUST NOT APPEAR IN A PER-RUN BOUND. `Budgets` is rebuilt
    // by every `runCognitiveLoop` call, so 100 here would mean $100 PER RUN and
    // no total at all — the exact confusion this change exists to end. The
    // total lives in `provider_budget_config.daily_usd_cap` for TEXT.
    expect(src).not.toMatch(/maxCostUsd:\s*100\b/);
    expect(src).toMatch(/maxCostUsd:\s*0\.05\b/);
    expect(src).toMatch(/maxTokens:\s*50_000\b/);
  });

  it("keeps the tool budget at zero: thinking about ONIQ is not changing it", () => {
    // A separate permission the owner has not been asked for, and one of two
    // independent guards — the other being that all six writing capabilities
    // are `authorized: false`. Raising this would remove one and buy nothing.
    expect(fn()).toMatch(/maxToolCalls:\s*0\b/);
  });

  it("reaches a model only through the spend ledger, and passes no job id", () => {
    const src = fn();
    // `serviceRoleRpc()` rather than an `if`: a null rpc REFUSES inside
    // `withProviderSpendGuard`, so a forgotten wiring cannot spend unguarded.
    expect(src).toMatch(/rpc: serviceRoleRpc\(\)/);
    expect(src).toMatch(/call: callTextProvider/);
    /**
     * NO JOB ID, AND THIS IS THE ONE THAT WOULD BE "HELPFULLY" ADDED BACK.
     * `admit_provider_spend` increments `attempts` on EVERY admission under a
     * job id and refuses at `max_attempts_per_job`, which the table's CHECK
     * caps at 10 — while one cognitive run makes TWENTY model calls. So a job
     * id here refuses call eleven with `job-attempts-exhausted`, and the loop
     * reports it as a model with nothing to say. `fn()` strips comments, which
     * matters here because the paragraph above names the thing it bans.
     */
    expect(src).not.toMatch(/jobId:/);
  });

  it("runs a bounded number of episodes per tap, and it matches what is tested", () => {
    const src = fn();
    expect(src).toMatch(new RegExp(`const EPISODES_PER_TAP = ${EPISODES_PER_TAP};`));
    expect(src).toMatch(/maxEpisodes: EPISODES_PER_TAP/);
  });

  /**
   * THE RUN BOUND AND THE LIFECYCLE BOUND ARE DIFFERENT THINGS.
   *
   * They were one constant at 20_000 until 2026-09-11, which was invisible
   * while every model call was refused instantly. MEASURED on the first tap
   * that reached a real model, and read from the checkpoint it wrote rather
   * than inferred from the elapsed time: two COMPLETE traversals in 39,936 ms,
   * both ending `loop max_iterations` — the designed end at four iterations —
   * so ~19,968 ms each, and the per-run bound was sitting within ~32 ms of an
   * ordinary run without having bitten yet.
   *
   * That is the dangerous shape: the stations that learn and persist are at the
   * END of a traversal, so a per-run bound that starts biting kills exactly the
   * work and reports a loop with nothing to say.
   */
  it("keeps the two wall-clock bounds separate, and the run bound above a real run", () => {
    const src = fn();
    const runMs = Number(/const MAX_RUN_MS = ([\d_]+);/.exec(src)?.[1]?.replace(/_/g, ""));
    const tapMs = Number(/const MAX_TAP_MS = ([\d_]+);/.exec(src)?.[1]?.replace(/_/g, ""));
    expect(Number.isFinite(runMs)).toBe(true);
    expect(Number.isFinite(tapMs)).toBe(true);
    // One constant used twice is what this replaced; they must not collapse
    // back into the same number by a later "tidy".
    expect(src).toMatch(/maxExecutionTimeMs: MAX_RUN_MS/);
    expect(src).toMatch(/maxWallMs: MAX_TAP_MS/);
    expect(src).not.toMatch(/MAX_WALL_MS/);
    // A runaway guard sits well above normal operation, not beside it.
    expect(runMs).toBeGreaterThanOrEqual(2 * MEASURED_TRAVERSAL_MS);
  });

  /**
   * `runtime.ts` checks the lifecycle bound BEFORE each cycle, so the last
   * episode can start just inside it and run a whole episode past it. The tap's
   * worst case is therefore MAX_TAP_MS + MAX_RUN_MS, and it must stay inside
   * what this repo already allows an edge function: `story-plot` caps itself at
   * 90 s "because an edge function has a wall clock".
   */
  it("admits the third episode and still lands inside the platform budget", () => {
    const src = fn();
    const runMs = Number(/const MAX_RUN_MS = ([\d_]+);/.exec(src)?.[1]?.replace(/_/g, ""));
    const tapMs = Number(/const MAX_TAP_MS = ([\d_]+);/.exec(src)?.[1]?.replace(/_/g, ""));
    // Episode N starts at (N-1) x traversal; the check is `elapsed >= bound`.
    const startsOfThird = 2 * MEASURED_TRAVERSAL_MS;
    expect(startsOfThird).toBeLessThan(tapMs);
    // And a fourth must not, or EPISODES_PER_TAP would be the only thing
    // stopping it and the two bounds would disagree about the same tap.
    expect(3 * MEASURED_TRAVERSAL_MS).toBeGreaterThanOrEqual(tapMs);
    expect(tapMs + runMs).toBeLessThanOrEqual(EDGE_FUNCTION_BUDGET_MS);
  });

  it("executes only UPDATE_KNOWLEDGE and refuses the rest by name", () => {
    const src = fn();
    const body = src.slice(
      src.indexOf("const executor"),
      src.indexOf('if (req.method === "OPTIONS")'),
    );
    expect(body).toMatch(/req\.id === "UPDATE_KNOWLEDGE"/);
    expect(body).toMatch(/does not execute it/);
    // Nothing here may run a suite and report a number it never measured.
    expect(body).not.toMatch(/RUN_TEST_SUITE"\s*\?/);
  });

  it("uses one sink builder for both durable slots", () => {
    const src = fn();
    expect(src).toMatch(/makeStateSink\(store, "knowledge"/);
    expect(src).toMatch(/makeStateSink\(store, "checkpoint"/);
  });

  it("answers 503 when its own memory is unreachable, never 200", () => {
    const src = fn();
    const c = src.slice(src.indexOf("catch (e)"));
    const guard = c.indexOf("OqcaStateUnavailable");
    expect(guard).toBeGreaterThan(-1);
    expect(c.slice(guard, guard + 200)).toMatch(/json\(503/);
  });

  it("names no health-domain table", () => {
    const src = readFileSync(FUNCTION, "utf8");
    for (const t of ["health_records", "health_documents", "health_audit", "health_ai_requests"]) {
      expect(src).not.toContain(t);
    }
  });
});
