/**
 * OQCA'S FIRST CALLER IN THE APP.
 *
 * Owner, 2026-09-11: _"Everything else — the substrate, the autonomy runtime,
 * the self-improvement loop — has no caller in the app at all add it."_ They
 * were right, and it is this repository's most-recorded failure: nine versions
 * of a cognitive kernel, a knowledge substrate, an autonomous runtime and a
 * self-improvement episode, every one of them reachable only from a script on
 * a developer's disk. `story-dispatch` calls the LOOP behind a flag that ships
 * off; nothing anywhere called the other three.
 *
 * THIS IS A TAP, NOT A DAEMON, AND THAT IS THE HONEST SHAPE FOR TODAY.
 * A standing loop is a standing bill, and what a scheduled cognitive tick may
 * spend is the owner's decision under CLAUDE.md's first rule — unanswered
 * since v1.5 and still unanswered. An admin-gated button costs exactly what
 * the person who pressed it chose to spend, which at the shipped budgets is
 * nothing at all: `DEFAULT_BUDGETS` carries `maxTokens`, `maxCostUsd` and
 * `maxToolCalls` at 0, so every model call is refused at its own gate and no
 * tool touches production. The run still thinks, because v1.6 is what made a
 * zero budget stop being cognitive death.
 *
 * WHAT THE TAP ACTUALLY DOES, and every step of it is real:
 *
 *   OBSERVE   five readings from ONIQ's own production tables — the same five
 *             that diagnosed the six-day video outage on 2026-09-11
 *   SURVEY    the knowledge substrate, rebuilt this tick and RESTORED from the
 *             durable store an earlier tap wrote
 *   PLAN      rank the concerns, six factors, escalation-blocked faults first
 *   LEARN     retrieve VERBATIM from the readings themselves, verify through
 *             `evaluatePromotion`, and persist through the registered
 *             `UPDATE_KNOWLEDGE` capability
 *   RUN       the real 23 stations against the upgraded knowledge
 *   COMPARE   the objective's residual uncertainty, before against after
 *
 * SO THE DURABLE STORE IS THE POINT. Every OQCA report since v1.5 closes with
 * the same sentence — "nothing persists, so nothing ages" — and `oqca_state`
 * is the answer: two rows of bytes, service-role only, no client anywhere near
 * them. The second tap starts from what the first one learned, which is the
 * compounding claim, measured rather than asserted.
 *
 * NOTHING HERE MAY CHANGE ONIQ. Six of the nine registered capabilities are
 * `authorized: false` and `executeCapability` refuses them BY NAME; the three
 * that are authorized read tests, read static analysis, and write knowledge.
 * This host executes only the last of those, and says so rather than returning
 * a pass count it never measured. §28's self-modification stays behind its own
 * gate, which the owner has not opened.
 *
 * THE GATE IS `is_admin`, RE-DERIVED FROM THE CALLER'S OWN JWT, exactly as
 * `firebase-provisioning` and `health-api` do it. The screen is not the gate.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";
import { DEFAULT_RUNTIME_BOUNDS, runAutonomousRuntime } from "../_shared/oqca/autonomy/runtime.ts";
import type { SystemIdentity } from "../_shared/oqca/autonomy/world.ts";
import type { Observation } from "../_shared/oqca/autonomy/observation.ts";
import { makeSubstrateSurvey } from "../_shared/oqcaRuntime/autonomous.ts";
import { makeSinkCheckpointStore } from "../_shared/oqcaRuntime/autonomous.ts";
import { makeSystemObserver } from "../_shared/oqcaRuntime/observe.ts";
import { makeImprovementEpisode } from "../_shared/oqcaRuntime/improvement.ts";
import { makeLocalEvidenceResearch } from "../_shared/oqcaRuntime/research.ts";
import { makeSinkDurableStore } from "../_shared/oqcaRuntime/durableStore.ts";
import {
  type CapabilityExecutor,
  type CapabilityRequest,
  registryCapabilityStates,
  resourcesFor,
} from "../_shared/oqcaRuntime/selfModel.ts";
import {
  makeStateSink,
  OQCA_STATE_TABLE,
  OqcaStateUnavailable,
  type OqcaStateKey,
  type OqcaStateStore,
} from "../_shared/oqcaRuntime/pgSink.ts";
import {
  PRODUCTION_EVIDENCE_GAP,
  productionCorpus,
  productionEvidence,
  QUEUE_STALE_MINUTES,
  type ProductionSnapshot,
} from "../_shared/oqcaRuntime/productionEvidence.ts";

/**
 * THREE EPISODES PER TAP, AND THE NUMBER IS MEASURED RATHER THAN CHOSEN.
 *
 * A tap is not a daemon — a standing loop is a standing bill and that is the
 * owner's decision — so this is bounded hard. But ONE episode is too few, and
 * the reason is not obvious from reading anything: the FIRST objective a tap
 * selects is `learn:runner-availability`, the substrate's own long-standing
 * gap, which outranks every observation-driven concern and which NO corpus
 * ONIQ holds can close (whether a GitHub runner picked a job up is precisely
 * what this project cannot see). So a one-episode tap blocks on it, learns
 * nothing and persists nothing, every time, forever.
 *
 * Measured over six: episode 1 blocks on that gap, episode 2 reaches
 * `improve:runtime_failure:story_worker` and both LEARNS and PERSISTS, episode
 * 3 runs its follow-up. Three is where the first durable row appears. The
 * blocked gap then keeps its `blocked` status in the checkpoint, so a LATER
 * tap starts on real work rather than repeating it.
 *
 * Every episode still costs $0: `DEFAULT_BUDGETS` refuses every model call and
 * no tool touches production.
 */
const EPISODES_PER_TAP = 3;
/** Well inside an edge function's wall clock, so a tick reports rather than dies. */
const MAX_WALL_MS = 20_000;
/** How far back the error and renderer readings look. */
const WINDOW_HOURS = 24;
/** A bound on every read, so one tap cannot drag a table through the function. */
const MAX_ROWS = 200;

type Db = ReturnType<typeof createClient>;

const minutesSince = (iso: string | null, now: number): number | null =>
  iso === null ? null : (now - Date.parse(iso)) / 60_000;

/**
 * EVERY READ IS INDIVIDUALLY CAUGHT AND EVERY FAILURE IS A `null`.
 *
 * A snapshot field that is null produces NO evidence item, so the kind stays
 * UNOBSERVED with the observer's reason attached. A read that threw and was
 * folded into a zero would become "ONIQ looked and it is fine", which is the
 * §3 failure this whole design is built around.
 */
/**
 * A READ THAT THREW IS A READ THAT DID NOT HAPPEN. `null`, every time — and
 * `null` produces NO evidence item, so the kind stays UNOBSERVED with the
 * observer's reason attached. A read folded into a zero would become "ONIQ
 * looked and it is fine", which is the §3 failure this whole design exists to
 * prevent.
 */
async function safely<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

async function readProduction(db: Db, at: string, nowMs: number): Promise<ProductionSnapshot> {
  const since = new Date(nowMs - WINDOW_HOURS * 3_600_000).toISOString();

  const dispatch = await safely(async () => {
    const { data, error } = await db
      .from("story_dispatch_health")
      .select("consecutive_failures,last_ok_at,last_detail")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      lastOkAt: typeof row.last_ok_at === "string" ? row.last_ok_at : null,
      lastError: typeof row.last_detail === "string" ? row.last_detail : null,
    };
  });

  const queue = await safely(async () => {
    const { data, error } = await db
      .from("story_jobs")
      .select("created_at")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS);
    if (error || !data) return null;
    const rows = data as Record<string, unknown>[];
    const oldest = typeof rows[0]?.created_at === "string" ? (rows[0].created_at as string) : null;
    return { queued: rows.length, oldestMinutes: minutesSince(oldest, nowMs) };
  });

  /**
   * THE RENDERER IS READ FROM THE FILMS, NOT FROM THE WORKFLOW. ONIQ cannot
   * see a GitHub runner; what it can see is whether a film ever came back. A
   * project that has never rendered one answers `null`, which is UNKNOWN.
   */
  const worker = await safely(async () => {
    const { data, error } = await db
      .from("story_jobs")
      .select("updated_at")
      .in("status", ["ready", "delivered"])
      .order("updated_at", { ascending: false })
      .limit(MAX_ROWS);
    if (error || !data) return null;
    const rows = data as Record<string, unknown>[];
    const newest = typeof rows[0]?.updated_at === "string" ? (rows[0].updated_at as string) : null;
    const inWindow = rows.filter(
      (r) => typeof r.updated_at === "string" && (r.updated_at as string) >= since,
    ).length;
    return { sinceLastReadyMinutes: minutesSince(newest, nowMs), readyInWindow: inWindow };
  });

  const errorSurfaces = await safely(async () => {
    const { data, error } = await db
      .from("client_error_reports")
      .select("surface")
      .gte("created_at", since)
      .limit(MAX_ROWS * 5);
    if (error || !data) return null;
    const counts = new Map<string, number>();
    for (const row of data as Record<string, unknown>[]) {
      const s = typeof row.surface === "string" ? row.surface : "unknown";
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts].map(([surface, reports]) => ({ surface, reports }));
  });

  const durable = await safely(async () => {
    const { data, error } = await db
      .from(OQCA_STATE_TABLE)
      .select("doc")
      .eq("key", "knowledge")
      .maybeSingle();
    if (error) return null;
    if (!data) return { records: 0 };
    try {
      const parsed = JSON.parse(String((data as Record<string, unknown>).doc)) as {
        rows?: unknown[];
      };
      return { records: Array.isArray(parsed.rows) ? parsed.rows.length : 0 };
    } catch {
      // The bytes are there and unreadable. That is neither "0 records" nor a
      // failed read, and `null` is the only honest one of the three.
      return null;
    }
  });

  return { at, dispatch, queue, worker, errorSurfaces, durable };
}

/** The durable rows, over the service-role client. The only credential in play. */
function stateStore(db: Db): OqcaStateStore {
  return {
    get: async (key: OqcaStateKey) => {
      const { data, error } = await db
        .from(OQCA_STATE_TABLE)
        .select("doc")
        .eq("key", key)
        .maybeSingle();
      if (error) return { ok: false, reason: error.message };
      return { ok: true, doc: data ? String(data.doc) : null };
    },
    put: async (key: OqcaStateKey, doc: string) => {
      const { error } = await db
        .from(OQCA_STATE_TABLE)
        .upsert({ key, doc, updated_at: new Date().toISOString() }, { onConflict: "key" });
      return error ? { ok: false, reason: error.message } : { ok: true };
    },
  };
}

/**
 * §12's EXECUTOR, AND IT RUNS NOTHING IT CANNOT RUN. `UPDATE_KNOWLEDGE` is
 * permitted — the write is the durable store's and this only says yes — while
 * the two other authorized capabilities report that this host does not execute
 * them. A `RUN_TEST_SUITE` that returned a pass count it never measured would
 * be the fabricated observation §3 forbids, arriving through the one door
 * nobody watches.
 */
const executor: CapabilityExecutor = async (req: CapabilityRequest) =>
  req.id === "UPDATE_KNOWLEDGE"
    ? {
        ok: true,
        value: Number(req.args.records ?? 0),
        unit: "records",
        detail: "permitted: the durable store performs the write",
      }
    : { ok: false, reason: `${req.id} is authorized but oqca-observe does not execute it` };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ---- admins only, re-derived from the caller's own JWT ------------------
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  if (!token) return json(401, { error: "Unauthorized" });
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userRes, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userRes?.user) return json(401, { error: "Unauthorized" });
  const { data: isAdmin } = await db.rpc("is_admin", { _uid: userRes.user.id });
  if (isAdmin !== true) return json(403, { error: "Admins only" });

  const startedMs = Date.now();
  const notes: string[] = [];
  const at = new Date(startedMs).toISOString();
  const ctx = { at: () => at, nowMs: () => Date.now(), elapsedMs: () => Date.now() - startedMs };

  try {
    const snapshot = await readProduction(db, at, startedMs);
    const store = stateStore(db);
    const identity: SystemIdentity = {
      name: "ONIQ",
      version: "oqca-v1.7",
      // "unknown" IN WORDS, which is `UNIDENTIFIED`'s own convention: an empty
      // string renders as nothing and reads as a branch that was checked and
      // found blank. A deployed function has no git.
      branch: Deno.env.get("OQCA_BRANCH") ?? "unknown",
      // NEVER A GUESS. A commit this host cannot establish is absent, and the
      // world state's identity coverage is lower as a result — which is the
      // correct reading of "ONIQ does not know exactly what it is running".
      commit: null,
    };

    const report = await runAutonomousRuntime({
      survey: makeSubstrateSurvey(ctx),
      observe: makeSystemObserver(
        { read: async () => ({ ok: true, items: productionEvidence(snapshot) }) },
        ctx.at,
      ),
      identity,
      needs: (o: Observation) => resourcesFor(o.requires),
      // Authorization is a TABLE, not a discovery: nothing may attempt an
      // unauthorized capability, so nothing can ever observe one. See
      // `registryCapabilityStates` and the 2026-09-11 ranking fix.
      knownCapabilities: registryCapabilityStates(),
      runEpisode: makeImprovementEpisode(ctx, {
        // THE CORPUS IS THE READINGS THEMSELVES. A production measurement is a
        // document: verbatim, located by the query that produced it, first-hand.
        research: makeLocalEvidenceResearch(productionCorpus(snapshot)),
        durable: makeSinkDurableStore(makeStateSink(store, "knowledge", (m) => notes.push(m))),
        executor,
      }),
      store: makeSinkCheckpointStore(makeStateSink(store, "checkpoint", (m) => notes.push(m))),
      clock: () => Date.now(),
      bounds: {
        ...DEFAULT_RUNTIME_BOUNDS,
        maxEpisodes: EPISODES_PER_TAP,
        maxWallMs: MAX_WALL_MS,
      },
    });

    return json(200, {
      at,
      elapsedMs: Date.now() - startedMs,
      // What was READ, so a reader can tell an absent reading from a healthy one.
      readings: {
        dispatch: snapshot.dispatch,
        queue: snapshot.queue,
        worker: snapshot.worker,
        errorSurfaces: snapshot.errorSurfaces,
        durable: snapshot.durable,
        staleQueueMinutes: QUEUE_STALE_MINUTES,
        gap: PRODUCTION_EVIDENCE_GAP,
      },
      run: {
        restored: report.restored,
        episodes: report.episodes,
        stop: report.stop,
        stopDetail: report.stopDetail,
        generated: report.generated,
        checkpoints: report.checkpoints,
        settled: report.settled,
        learned: report.learned,
        persisted: report.persisted,
        improvementsVerified: report.improvementsVerified,
        capabilityBlocks: report.capabilityBlocks,
      },
      // Best first. This is the ranking the 2026-09-11 fix corrected, and it is
      // the answer to "what should somebody look at next".
      concerns: report.concerns.slice(0, 10).map((c) => ({
        id: c.goal.id,
        statement: c.goal.statement,
        score: c.score,
        state: c.observation.state,
        kind: c.observation.kind,
        subject: c.observation.subject,
        severity: c.observation.severity,
        detail: c.observation.detail,
        // WHY IT SCORED WHAT IT SCORED. The 2026-09-11 ranking defect was
        // invisible until the factors were printed rather than reasoned about.
        planning: c.planning,
      })),
      health: report.world?.health ?? null,
      capabilities: report.capabilities,
      experiments: report.experiments.map((e) => ({
        objectiveId: e.design.objectiveId,
        metric: e.design.metric,
        baseline: e.baseline?.value ?? null,
        candidate: e.candidate?.value ?? null,
        verdict: e.verdict,
        improvementVerified: e.improvementVerified,
      })),
      notes,
    });
  } catch (e) {
    /**
     * A DURABLE STORE THAT CANNOT BE READ IS A FAILED TICK, NOT A FRESH START.
     * `makeStateSink` throws rather than answering "empty" for exactly this,
     * and this is where that decision is paid for: a 503 naming the reason,
     * instead of a green report that quietly began from zero.
     */
    if (e instanceof OqcaStateUnavailable) {
      return json(503, { error: e.message, key: e.key });
    }
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
