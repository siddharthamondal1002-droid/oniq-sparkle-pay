/**
 * ONE COMPLETE SHADOW EXECUTION, MEASURED AND REPLAYED — brief sections 19 and 23.
 *
 * WHAT THIS IS AND IS NOT, stated first because the distinction is the whole
 * value of the numbers below. This runs the REAL loop, the REAL engine adapter,
 * the REAL tool router, the REAL job and the REAL verifier, end to end, and
 * writes the complete state chain to disk and replays it.
 *
 * It does NOT reach production. The queue is a fixture and the provider is a
 * RECORDED reply rather than a live `callText`, because this container cannot
 * reach `*.supabase.co` and because a live model call is a spend the owner has
 * not authorised for a script. So the token and latency figures are the
 * adapter's arithmetic over a recorded reply, and the cost figure is the real
 * `MODEL_RATES` price of those tokens — real pricing, recorded usage.
 *
 * Everything section 19 asks for IS real here: the chain is what the loop
 * produced, the persistence is JSON on disk, and the replay re-derives every id
 * from its own content with no engine, no router and no clock in reach.
 *
 *     npx tsx scripts/oqca-shadow-run.ts
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runShadow, replayChain } from "../supabase/functions/_shared/oqcaRuntime/shadow.ts";
import type {
  DispatchEnvironment,
  QueuedJob,
} from "../supabase/functions/_shared/oqcaRuntime/dispatchJob.ts";
import { DEFAULT_BUDGETS } from "../src/oqca/loop/seams.ts";

const T0 = Date.parse("2026-09-10T12:00:00Z");

/**
 * A queue with three shapes in it, deliberately: one long-waiting job, one
 * fresh, and one inside its backoff. A single-row queue would make IMAGINE
 * score one future and PLAN pick it, and every station downstream a formality.
 */
const QUEUE: QueuedJob[] = [
  {
    id: "8f2c1a",
    requestedSeconds: 120,
    grade: "movie",
    createdAtMs: T0 - 41 * 60_000,
    dispatchedAtMs: null,
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

function environment(): DispatchEnvironment & { sent: string[]; stamped: string[] } {
  const rows = new Map(QUEUE.map((j) => [j.id, j]));
  let now = T0;
  const env = {
    sent: [] as string[],
    stamped: [] as string[],
    // A monotone clock, so `elapsedMs` moves and the time bound is real.
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

/** A recorded reply in `callText`'s shape. Deterministic; no network. */
const RECORDED: Record<string, string> = {
  understand: "The goal is to get one queued film onto a runner without asking twice.",
  reason: "The oldest un-dispatched job is the one waiting longest and should go first.",
  verify: "UNVERIFIED",
  imagine:
    "dispatch story job 8f2c1a | a runner claims it | 0.1 | 0.9\n" +
    "dispatch story job b71e04 | a runner claims it | 0.1 | 0.4\n" +
    "hold: dispatch nothing this tick | nothing moves | 0.0 | 0.1",
  evaluate: "The oldest job carries the least risk of a second dispatch.",
  reflect: "Waiting time is the signal; the backoff is what keeps it honest.",
  respond: "Dispatched the film that had waited longest.",
};

async function main() {
  const env = environment();
  const budgets = {
    ...DEFAULT_BUDGETS,
    // EXPLICIT FINITE VALUES — section 21: "the owner-approved test
    // configuration must use explicit finite values". None of these is a
    // production ceiling and none is written into the kernel.
    maxTokens: 200_000,
    maxCostUsd: 0.05,
    maxToolCalls: 4,
    maxExecutionTimeMs: 20_000,
  };

  const started = Date.now();
  const result = await runShadow({
    runId: "shadow-0001",
    mode: "shadow",
    env,
    budgets,
    call: async (req) => {
      const kind = /station|Goal|Available actions/i.test(req.messages[0].content)
        ? "imagine"
        : "reason";
      const text =
        Object.entries(RECORDED).find(([k]) =>
          req.messages[0].content.toLowerCase().includes(k),
        )?.[1] ?? RECORDED[kind];
      return {
        ok: true as const,
        provider: "gemini",
        data: {
          model: "gemini-3.1-flash-lite",
          content: [{ type: "text", text }],
          usage: {
            input_tokens:
              Math.ceil(req.system.length / 3) + Math.ceil(req.messages[0].content.length / 3),
            output_tokens: Math.ceil(text.length / 3),
          },
        },
      };
    },
  });
  const wall = Date.now() - started;

  const out = join(process.cwd(), "docs", "oqca", "shadow-run");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "chain.json"), JSON.stringify(result.run.chain, null, 2));
  writeFileSync(join(out, "episode.json"), JSON.stringify(result.episode, null, 2));
  writeFileSync(join(out, "comparison.json"), JSON.stringify(result.comparison, null, 2));
  writeFileSync(
    join(out, "stations.json"),
    JSON.stringify(
      result.run.log.map((r) => ({ station: r.station, note: r.note, refused: r.refused })),
      null,
      2,
    ),
  );

  // REPLAY FROM DISK, not from memory: a chain that only replays as the object
  // the run happened to leave behind has not been persisted at all.
  const restored = JSON.parse(readFileSync(join(out, "chain.json"), "utf8"));
  const problems = replayChain(restored);

  const c = result.comparison;
  const e = result.episode;
  console.log(`
COMPLETE SHADOW EXECUTION — runId ${c.runId}, mode ${c.mode}
  production decision      ${c.productionDecision}
  OQCA decision            ${c.oqcaDecision ?? `(none — ${c.undecidedReason})`}
  agreement                ${c.agreed === null ? "n/a — no decision" : c.agreed}
  confidence / margin      ${c.oqcaConfidence.toFixed(4)} / ${c.oqcaMargin.toFixed(4)}

  stations run             ${result.run.log.length}
  state transitions        ${c.stateTransitions}
  terminated               ${c.terminated}
  verdict                  ${e.verdict} — ${e.verification}
  response class           ${e.responseClass}

  model calls              ${c.modelCalls} (${c.modelCallsRefused} refused)
  tokens in / out          ${e.modelCalls.reduce((s, m) => s + m.inputTokens, 0)} / ${e.modelCalls.reduce((s, m) => s + m.outputTokens, 0)}
  estimated cost           $${c.estimatedCostUsd.toFixed(6)}
  charged cost             $${c.costUsd.toFixed(6)}
  tool attempts / refused  ${c.toolAttempts} / ${c.toolsRefused}
  production writes        sent=${env.sent.length} stamped=${env.stamped.length}
  episodes persisted       ${c.persistedEpisodes}
  wall clock               ${wall} ms

  REFUSALS
${
  result.run.log
    .filter((r) => r.refused)
    .map((r) => `    ${r.station.padEnd(18)} ${r.refused}`)
    .join("\n") || "    (none)"
}

  REPLAY FROM DISK         ${problems.length === 0 ? "CLEAN — every id re-derived, every link held" : JSON.stringify(problems)}
  artifacts                docs/oqca/shadow-run/
`);
  if (problems.length > 0) process.exit(1);
}

await main();
