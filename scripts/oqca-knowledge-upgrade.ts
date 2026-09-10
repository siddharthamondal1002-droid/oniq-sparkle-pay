/**
 * ONE CONTROLLED KNOWLEDGE UPGRADE, END TO END — v1.4-R item D.
 *
 *     K0  ->  new evidence  ->  K1  ->  dependents identified
 *         ->  world state updated  ->  plan invalidated and replanned
 *
 * WHAT MAKES THIS A DEMONSTRATION RATHER THAN A FIXTURE. The knowledge being
 * upgraded is LOAD-BEARING: `worldFrom` builds the loop's available actions
 * from the backoff window ONIQ currently believes in, so a wrong belief removes
 * a real action from the plan and the loop dispatches a different film. Under
 * K0 it picks the younger job and leaves a 41-minute-old one queued — which is
 * the exact failure `story-dispatch`'s own header records. Under K1 it agrees
 * with production again.
 *
 * NOTHING HERE AUTHORIZES ANYTHING. `isDispatchable`'s belief argument reaches
 * `worldFrom` and `likelihoodsFrom` and reaches NO authorization site:
 * `productionChoice` and the tool's own `authorize` take the enforced constant
 * and always will. A belief may change what the loop CONSIDERS; it may never
 * open a door the real rule keeps shut, and the run below prints both numbers
 * side by side so the separation is visible rather than asserted.
 *
 * A CHANGED VALUE IS A CONFLICT, NOT A SUPERSESSION, and getting that backwards
 * is the first thing this script would have got wrong. `supersede()` requires
 * both records to share an id, and the id hashes subject|predicate|OBJECT — so
 * two different backoff values are two different assertions and §8's conflict
 * machinery is what adjudicates them. Supersession is for the SAME assertion
 * re-verified. Both are in the substrate; only one of them fits here.
 *
 *     npx tsx scripts/oqca-knowledge-upgrade.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runShadow } from "../supabase/functions/_shared/oqcaRuntime/shadow.ts";
import {
  ENFORCED_BACKOFF_BELIEF,
  buildSubstrate,
  runtimeSourceRegistry,
  type BackoffBelief,
} from "../supabase/functions/_shared/oqcaRuntime/substrate.ts";
import {
  DISPATCH_BACKOFF_MS,
  DISPATCH_GOAL,
  productionChoice,
  worldFrom,
  type DispatchEnvironment,
  type QueuedJob,
} from "../supabase/functions/_shared/oqcaRuntime/dispatchJob.ts";
import { dependentsOf } from "../supabase/functions/_shared/oqca/knowledge/substrate/store.ts";
/**
 * `conflict.ts` COMES FROM `src/`, AND THE REASON IS WORTH STATING RATHER THAN
 * WORKING AROUND: it is not in the mirror, because nothing the runtime imports
 * reaches it — and that is CORRECT today. A store rebuilt from scratch on every
 * tick has no rival records to adjudicate, so §8's machinery has nothing to do
 * inside a live dispatch. It becomes shipped code the day the store persists,
 * and the mirror will grow to include it on the next run of `oqca-mirror.mjs`
 * without anyone editing a list — which is what v1.4-R item A's derivation
 * bought.
 *
 * Safe to cross trees HERE and nowhere near a `CognitiveState`: a
 * `KnowledgeRecord` is a plain object, so the two module instances agree
 * structurally. The v1.2b collision was a class with a private field.
 */
import {
  detectConflicts,
  resolveConflict,
  applyResolution,
} from "../src/oqca/knowledge/substrate/conflict.ts";
import { toKnowledgeState } from "../supabase/functions/_shared/oqca/knowledge/substrate/project.ts";
import { detectGaps } from "../supabase/functions/_shared/oqca/knowledge/gaps.ts";
import { DEFAULT_BUDGETS } from "../src/oqca/loop/seams.ts";

const T0 = Date.parse("2026-09-10T12:00:00Z");
const AT = new Date(T0).toISOString();
const OUT = "docs/oqca/knowledge-upgrade";

/**
 * THE QUEUE IS BUILT SO THE BELIEF DECIDES THE ANSWER, and that is the only
 * fixture choice in this script.
 *
 * `8f2c1a` is the oldest job AND carries a dispatch stamp 12 minutes back. The
 * enforced 10-minute window makes it eligible; a stale 60-minute belief does
 * not. So the two beliefs disagree about the one job whose age would win.
 */
const QUEUE: QueuedJob[] = [
  {
    id: "8f2c1a",
    requestedSeconds: 120,
    grade: "movie",
    createdAtMs: T0 - 41 * 60_000,
    dispatchedAtMs: T0 - 12 * 60_000,
  },
  {
    id: "b71e04",
    requestedSeconds: 60,
    grade: "classic",
    createdAtMs: T0 - 9 * 60_000,
    dispatchedAtMs: null,
  },
  {
    id: "c0d933",
    requestedSeconds: 300,
    grade: "movie",
    createdAtMs: T0 - 6 * 60_000,
    dispatchedAtMs: T0 - 2 * 60_000,
  },
];

/**
 * K0: TWO AGREEING STALE RELEASE NOTES, and the count is the point.
 *
 * A SINGLE stale note cannot become a belief at all — the first version of this
 * fixture used one, `spec_cited` + `human_authored` = weight 0.400, confidence
 * 0.286, and the promotion gate refused it as CANDIDATE. `believedBackoff`
 * reads VERIFIED only, so the loop fell straight back to the enforced constant
 * and the "stale" run was indistinguishable from the fresh one. **The
 * substrate was working; the fixture was not.**
 *
 * Two agreeing notes at `fetched` + `human_authored` reach 2 x 0.800 = 1.600
 * -> confidence 0.615, VERIFIED. ONIQ genuinely believes an hour.
 *
 * AND THAT IS WHAT EXPOSED THE ORDERING DEFECT. On additive weight 1.600 beats
 * the code reading's 0.950, so `evidence_weight` would adopt the DOCUMENTS —
 * a stale number preferred to the value ONIQ had just read out of the running
 * module, with a rationale that reads perfectly. `measured_precedence` is the
 * rule that gets it right, and this script prints both numbers so the rule's
 * necessity is visible rather than asserted.
 */
const STALE_BELIEF: BackoffBelief = {
  windowMs: 60 * 60_000,
  evidence: [
    {
      sourceId: "oniq-codebase",
      sourceType: "release_notes",
      locator: "docs/oqca/knowledge-upgrade#stale-release-note-a",
      excerpt: "the dispatcher waits an hour before offering the same film again",
      directness: "fetched",
      extraction: "human_authored",
    },
    {
      sourceId: "oniq-codebase",
      sourceType: "repository_readme",
      locator: "docs/oqca/knowledge-upgrade#stale-release-note-b",
      excerpt: "backoff: 60 minutes between dispatches of one job",
      directness: "fetched",
      extraction: "human_authored",
    },
  ],
};

function environment(): DispatchEnvironment & { sent: string[]; stamped: string[] } {
  const rows = new Map(QUEUE.map((j) => [j.id, j]));
  let now = T0;
  const env = {
    sent: [] as string[],
    stamped: [] as string[],
    nowMs: () => (now += 7),
    readQueue: async () => [...rows.values()],
    readJob: async (id: string) => rows.get(id) ?? null,
    stampDispatched: async (id: string) => {
      env.stamped.push(id);
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, dispatchedAtMs: now });
    },
    sendDispatch: async (id: string) => {
      env.sent.push(id);
      return null;
    },
  };
  return env;
}

/** A recorded reply in `callText`'s shape. Deterministic; no network, no spend. */
const RECORDED: Record<string, string> = {
  understand: "The goal is to get one queued film onto a runner without asking twice.",
  reason: "The oldest eligible job is the one waiting longest and should go first.",
  verify: "UNVERIFIED",
  imagine:
    "dispatch story job 8f2c1a | a runner claims it | 0.1 | 0.9\n" +
    "dispatch story job b71e04 | a runner claims it | 0.1 | 0.4\n" +
    "hold: dispatch nothing this tick | nothing moves | 0.0 | 0.1",
  evaluate: "The oldest eligible job carries the least risk of a second dispatch.",
  reflect: "Waiting time is the signal; the backoff is what keeps it honest.",
  respond: "Dispatched the film that had waited longest.",
};

const call = async (req: { kind: string; prompt: string }) => ({
  ok: true,
  text: RECORDED[req.kind] ?? "",
  usage: { inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: 60, costUsd: 0 },
  model: "recorded/deterministic",
});

// ZERO SPEND, STATED IN THE BUDGETS RATHER THAN HOPED FOR. The tool budget is
// zero as well, so no production write is even reachable from this script.
const BUDGETS = { ...DEFAULT_BUDGETS, maxTokens: 200_000, maxCostUsd: 0, maxToolCalls: 0 };

async function decide(belief: BackoffBelief, runId: string) {
  const substrate = buildSubstrate({ at: AT, nowMs: T0, belief });
  const result = await runShadow({
    runId,
    mode: "shadow",
    env: environment(),
    call: call as never,
    budgets: BUDGETS,
    substrate,
  });
  return { substrate, result };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const sources = runtimeSourceRegistry();
  const enforcedChoice = productionChoice(QUEUE, T0);

  /* ---------------------------------------------------------------- *
   * K0 — the stale belief, and the decision it produces.
   * ---------------------------------------------------------------- */
  const k0 = await decide(STALE_BELIEF, "upgrade-k0");
  const k0Backoff = k0.substrate.store
    .bySubject("dispatch-backoff")
    .find((r) => r.predicate === "windowMs")!;
  const k0World = worldFrom(QUEUE, T0, STALE_BELIEF.windowMs);
  const k0Gaps = detectGaps(DISPATCH_GOAL, k0.substrate.state);

  /* ---------------------------------------------------------------- *
   * NEW EVIDENCE — the deployed constant, read here.
   *
   * It arrives as a RIVAL RECORD in the same store, not as an edit. §8: "never
   * silently overwrite an assertion. Preserve the competing assertions, create
   * a ConflictRecord, select or escalate a canonical value, and record the
   * resolution rationale." All four happen below and none is optional.
   * ---------------------------------------------------------------- */
  const fresh = buildSubstrate({ at: AT, nowMs: T0, belief: ENFORCED_BACKOFF_BELIEF });
  const k1Backoff = fresh.store
    .bySubject("dispatch-backoff")
    .find((r) => r.predicate === "windowMs")!;
  k0.substrate.store.put(k1Backoff);

  const rivals = detectConflicts(k0.substrate.store.bySubject("dispatch-backoff"));
  const conflict = resolveConflict([k0Backoff, k1Backoff], { sources, nowMs: T0 });
  const settled = applyResolution([k0Backoff, k1Backoff], conflict);
  for (const r of settled) k0.substrate.store.put(r);

  /* ---------------------------------------------------------------- *
   * OLD DEPENDENT KNOWLEDGE — walked, not guessed.
   * ---------------------------------------------------------------- */
  const stranded = dependentsOf(k0.substrate.store, k0Backoff.id);

  /* ---------------------------------------------------------------- *
   * WORLD STATE UPDATED, and the projection is re-run over the settled store
   * rather than patched. `toKnowledgeState` reads VERIFIED only, so the
   * out-weighed record leaves the graph the moment the resolution is applied.
   * ---------------------------------------------------------------- */
  const upgradedState = toKnowledgeState(
    k0.substrate.store.byStatus("VERIFIED"),
    T0,
    sources,
    "oqca-dispatch",
  );
  const k1Gaps = detectGaps(DISPATCH_GOAL, upgradedState);
  const k1World = worldFrom(QUEUE, T0, ENFORCED_BACKOFF_BELIEF.windowMs);

  /* ---------------------------------------------------------------- *
   * REPLAN — the loop run again on K1.
   * ---------------------------------------------------------------- */
  const k1 = await decide(ENFORCED_BACKOFF_BELIEF, "upgrade-k1");

  const fmt = (ms: number) => `${Math.round(ms / 60_000)} min`;
  const lines = [
    "ONE CONTROLLED KNOWLEDGE UPGRADE — K0 -> K1",
    "",
    `  enforced backoff (code)  ${fmt(DISPATCH_BACKOFF_MS)}   <- never moves`,
    `  production decision      ${enforcedChoice}`,
    "",
    "  K0 — the stale release note",
    `    believed backoff       ${fmt(STALE_BELIEF.windowMs)} (${STALE_BELIEF.evidence.length} x ${STALE_BELIEF.evidence[0].directness}/${STALE_BELIEF.evidence[0].extraction})`,
    `    record                 ${k0Backoff.id} ${k0Backoff.status} conf ${k0Backoff.confidence.toFixed(3)}`,
    `    actions available      ${k0World.availableActions.length}  [${k0World.availableActions.join(", ")}]`,
    `    unavailable            ${k0World.unavailableActions.length}`,
    `    gaps                   ${k0Gaps.map((g) => `${g.conceptId}=${g.status}`).join(" ")}`,
    `    OQCA decision          ${k0.result.comparison.oqcaDecision}`,
    `    agreed with production ${k0.result.comparison.agreed}`,
    "",
    "  NEW EVIDENCE — the deployed constant, read here",
    `    rival pairs detected   ${rivals.length}`,
    `    strategy               ${conflict.strategy}`,
    `    canonical              ${conflict.canonical}`,
    `    rationale              ${conflict.rationale}`,
    `    competing kept         ${conflict.competing.length} (nothing deleted)`,
    "",
    "  OLD DEPENDENT KNOWLEDGE",
    `    derived from K0        ${stranded.length}`,
    ...stranded.map((r) => `      ${r.subject} ${r.predicate}`),
    "",
    "  K1 — after the upgrade",
    `    believed backoff       ${fmt(ENFORCED_BACKOFF_BELIEF.windowMs)} (${ENFORCED_BACKOFF_BELIEF.evidence[0].sourceType}/${ENFORCED_BACKOFF_BELIEF.evidence[0].directness})`,
    `    record                 ${k1Backoff.id} conf ${k1Backoff.confidence.toFixed(3)}`,
    `    actions available      ${k1World.availableActions.length}  [${k1World.availableActions.join(", ")}]`,
    `    gaps                   ${k1Gaps.map((g) => `${g.conceptId}=${g.status}`).join(" ")}`,
    `    OQCA decision          ${k1.result.comparison.oqcaDecision}`,
    `    agreed with production ${k1.result.comparison.agreed}`,
    "",
    `  DECISION CHANGED         ${k0.result.comparison.oqcaDecision !== k1.result.comparison.oqcaDecision}`,
    `  UPGRADE RESTORED AGREEMENT ${k0.result.comparison.agreed === false && k1.result.comparison.agreed === true}`,
    "",
    "  SAFETY — the belief never reached an authorization site",
    `    productionChoice(K0 belief ignored)  ${enforcedChoice}`,
    `    believed vs enforced, K0            ${k0.result.comparison.believedBackoffMs} vs ${k0.result.comparison.enforcedBackoffMs}`,
    `    production writes, both runs        sent=0 stamped=0 (maxToolCalls 0)`,
    "",
    `  artifacts                ${OUT}/`,
  ];
  console.log(lines.join("\n"));

  writeFileSync(
    join(OUT, "upgrade.json"),
    JSON.stringify(
      {
        enforcedBackoffMs: DISPATCH_BACKOFF_MS,
        productionDecision: enforcedChoice,
        k0: {
          belief: STALE_BELIEF,
          recordId: k0Backoff.id,
          confidence: k0Backoff.confidence,
          availableActions: k0World.availableActions,
          gaps: k0Gaps.map((g) => ({ conceptId: g.conceptId, status: g.status })),
          comparison: k0.result.comparison,
        },
        conflict,
        dependents: stranded.map((r) => ({ id: r.id, subject: r.subject, predicate: r.predicate })),
        k1: {
          belief: ENFORCED_BACKOFF_BELIEF,
          recordId: k1Backoff.id,
          confidence: k1Backoff.confidence,
          availableActions: k1World.availableActions,
          gaps: k1Gaps.map((g) => ({ conceptId: g.conceptId, status: g.status })),
          comparison: k1.result.comparison,
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(OUT, "report.txt"), lines.join("\n") + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
