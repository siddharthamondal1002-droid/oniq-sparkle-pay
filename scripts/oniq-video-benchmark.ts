/**
 * §21 + §22 — the video-failure benchmark, run against the cognitive kernel.
 *
 *     npx tsx scripts/oniq-video-benchmark.ts --adapter openai --model gpt-6-astra
 *     npx tsx scripts/oniq-video-benchmark.ts --adapter mock      (free, no key)
 *
 * THE KERNEL IS GIVEN ONE SENTENCE AND FIVE READ-ONLY TOOLS. The instruction
 * below is the WHOLE prompt: it does not name a table, a surface, a status
 * code, or how many causes there are. Everything else it learns by asking.
 *
 * NEEDS THE KEY AND THE NETWORK, so the `openai` arm runs where both exist —
 * the Lovable sandbox — not in the dev container, where api.openai.com answers
 * HTTP 000 against a proxy CONNECT 403.
 */
import {
  ERROR_DETAIL,
  ERROR_SURFACES,
  JOB_COUNTS,
  JOB_ERRORS,
  baselineDiagnosis,
  score,
  type BenchTable,
} from "../src/lib/cognitive/videoIncidentBenchmark.ts";
import { openaiResponsesAdapter } from "../src/lib/cognitive/openaiResponsesAdapter.ts";
import { mockModelAdapter, type ModelAdapter } from "../src/oqca/cognitive/modelAdapter.ts";
import { registry, type ToolSpec } from "../src/oqca/cognitive/capabilityRegistry.ts";
import { runKernel } from "../src/oqca/cognitive/cognitiveKernel.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const AT = "2026-09-12T05:15:00Z";
const called: string[] = [];

function render(t: BenchTable): string {
  return t.rows
    .map((r) => `${r.key} = ${r.value}${r.newest ? ` (newest ${r.newest})` : ""}`)
    .join("\n");
}

/** Every tool is read-only: sideEffect NONE, reversible, free, zero risk. */
function table(name: string, t: BenchTable, description: string): ToolSpec {
  return {
    name,
    description,
    schema: [],
    authorized: true,
    sideEffect: "NONE",
    reversible: true,
    costUsd: 0,
    risk: 0,
    timeoutMs: 5000,
    produces: "database_query",
    run: async () => {
      called.push(name);
      return {
        ok: true,
        summary: render(t),
        evidence: { source: "database_query", locator: t.locator, at: t.at, excerpt: render(t) },
      };
    },
  };
}

const TOOLS: readonly ToolSpec[] = [
  table(
    "db_job_counts",
    JOB_COUNTS,
    "Counts of video/story jobs by status, with the newest timestamp for each.",
  ),
  table(
    "db_error_surfaces",
    ERROR_SURFACES,
    "Error report counts per surface over the last 14 days.",
  ),
  table(
    "db_job_errors",
    JOB_ERRORS,
    "The error text recorded on jobs over the last 14 days, with counts.",
  ),
  {
    name: "db_error_detail",
    description: "The full detail payload for one error surface. Argument: surface.",
    schema: ["surface"],
    authorized: true,
    sideEffect: "NONE",
    reversible: true,
    costUsd: 0,
    risk: 0,
    timeoutMs: 5000,
    produces: "database_query",
    run: async (args) => {
      const surface = args.surface ?? "";
      called.push(`db_error_detail:${surface}`);
      const hit = ERROR_DETAIL[surface];
      if (!hit) return { ok: false, reason: `no surface named ${surface}` };
      return {
        ok: true,
        summary: hit,
        evidence: {
          source: "database_query",
          locator: `production: client_error_reports where surface = '${surface}'`,
          at: AT,
          excerpt: hit,
        },
      };
    },
  },
];

const INSTRUCTIONS = [
  "You are diagnosing a production incident in a video generation system.",
  "Investigate using the tools provided. Call one tool at a time.",
  "Do not guess: base every claim on something a tool returned.",
  "When you can state the root cause or causes, reply with your conclusion and request no further tool.",
  "Your final reply must name each distinct root cause you found and the evidence for it.",
].join(" ");

function chooseAdapter(): ModelAdapter {
  const kind = arg("adapter", "mock");
  if (kind === "openai") {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set; cannot run the openai arm");
    return openaiResponsesAdapter({
      apiKey,
      model: arg("model", "gpt-6-astra"),
      fetchImpl: fetch,
      timeoutMs: 120_000,
    });
  }
  return mockModelAdapter([
    {
      text: "",
      wantsTool: { name: "db_job_counts", args: {} },
      model: "mock",
      inputTokens: 0,
      outputTokens: 0,
    },
    {
      text: "jobs failed most recently on 2026-09-11",
      wantsTool: null,
      model: "mock",
      inputTokens: 0,
      outputTokens: 0,
    },
  ]);
}

async function main() {
  console.log(`BASELINE (§22, rank the loudest surface): ${baselineDiagnosis()}`);
  console.log("");

  const started = Date.now();
  const report = await runKernel({
    goal: "Video jobs are failing.",
    mode: "OBSERVE",
    model: chooseAdapter(),
    registry: registry(TOOLS),
    clock: () => new Date().toISOString(),
    instructions: INSTRUCTIONS,
    maxIterations: Number(arg("iterations", "10")),
  });
  const elapsedMs = Date.now() - started;

  const conclusion = report.stopDetail;
  const transcript = report.state.observations.join("\n");
  const s = score(`${conclusion}\n${transcript}`, called, {
    elapsedMs,
    inputTokens: report.inputTokens,
    outputTokens: report.outputTokens,
  });

  console.log(`stop            ${report.stop}`);
  console.log(`model calls     ${report.modelCalls}`);
  console.log(`tool calls      ${s.toolCalls}  (${called.join(", ")})`);
  console.log(`irrelevant      ${s.irrelevantToolCalls}`);
  console.log(`causes FOUND    ${s.causesFound.join(", ") || "none"}`);
  console.log(`causes MISSED   ${s.causesMissed.join(", ") || "none"}`);
  console.log(
    `distractors named ${s.falsePositives.join(", ") || "none"}  (NAMED, not necessarily blamed)`,
  );
  console.log(`tokens          ${s.inputTokens} in / ${s.outputTokens} out`);
  console.log(`elapsed         ${s.elapsedMs} ms`);
  console.log("");
  console.log("CONCLUSION:");
  console.log(transcript.trim() || conclusion);
}

void main();
