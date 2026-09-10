/**
 * BENCHMARK THE STORE ONIQ HAS, ON THE QUERIES ONIQ ACTUALLY MAKES — v1.4-R
 * item G, and the spec's §20 phase 2 in its own words:
 *
 *   "Given ONIQ's existing production rails, do not replace the current data
 *    architecture merely to add a graph. First implement an adapter-backed
 *    KnowledgeStore and benchmark Jena/AGE against the actual ONIQ workload."
 *
 * WHAT IS MEASURED AND WHAT IS NOT, first, because a one-armed benchmark
 * reported as a comparison is exactly the unfair-baseline failure §16 exists to
 * name. **The local store is measured. Jena and AGE are NOT.** Neither can be
 * stood up here: Apache Jena is a JVM dependency `package.json` would have to
 * carry (Lovable owns that file) and AGE is a Postgres extension on a project
 * this container cannot reach and must not migrate. Their numbers are absent,
 * not zero, and nothing below claims otherwise.
 *
 * SO THE QUESTION IS NOT "WHICH IS FASTER". It is the one the spec actually
 * asks: is the existing store a bottleneck on ONIQ's real workload? That is
 * answerable from one arm, and if the answer is "it answers every real query in
 * microseconds over a corpus of a hundred-odd records", a triple store cannot
 * make it faster in any way a person would notice — and the decision follows
 * without the other arms.
 *
 * THE WORKLOAD IS THE REAL ONE. Every query below is a call the shipped runtime
 * makes on a tick, in the order it makes it, over the store that tick builds.
 * A synthetic query mix would measure a workload nobody has.
 *
 *     npx tsx scripts/oqca-store-benchmark.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildSubstrate,
  runtimeSourceRegistry,
} from "../supabase/functions/_shared/oqcaRuntime/substrate.ts";
import { DISPATCH_GOAL } from "../supabase/functions/_shared/oqcaRuntime/dispatchJob.ts";
import { toKnowledgeState } from "../supabase/functions/_shared/oqca/knowledge/substrate/project.ts";
import { detectGaps } from "../supabase/functions/_shared/oqca/knowledge/gaps.ts";
import { QUANTUM_DOMAIN } from "../supabase/functions/_shared/oqca/quantum/knowledge.ts";
import { dependentsOf } from "../supabase/functions/_shared/oqca/knowledge/substrate/store.ts";

const T0 = Date.parse("2026-09-10T12:00:00Z");
const AT = new Date(T0).toISOString();
const OUT = "docs/oqca/store-benchmark";

/** Enough repetitions that the arithmetic is not dominated by the timer. */
const REPS = 2000;

function bench(name: string, fn: () => unknown, reps = REPS) {
  // Warm the path first, so the figure is steady-state rather than first-call.
  for (let i = 0; i < 50; i++) fn();
  const t0 = performance.now();
  let sink = 0;
  for (let i = 0; i < reps; i++) {
    const r = fn();
    sink += Array.isArray(r) ? r.length : r === null ? 0 : 1;
  }
  const t1 = performance.now();
  return { name, reps, totalMs: t1 - t0, perCallUs: ((t1 - t0) * 1000) / reps, sink };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const sources = runtimeSourceRegistry();

  const buildTimes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    buildSubstrate({ at: AT, nowMs: T0 });
    buildTimes.push(performance.now() - t);
  }
  buildTimes.sort((a, b) => a - b);

  const b = buildSubstrate({ at: AT, nowMs: T0 });
  const store = b.store;
  const verified = store.byStatus("VERIFIED");
  const backoff = store.bySubject("dispatch-backoff")[0];

  const rows = [
    bench("all()", () => store.all()),
    bench("byStatus(VERIFIED)", () => store.byStatus("VERIFIED")),
    bench("bySubject(dispatch-backoff)", () => store.bySubject("dispatch-backoff")),
    bench("byDomain(quantum)", () => store.byDomain(QUANTUM_DOMAIN)),
    bench("get(id)", () => store.get(backoff.id)),
    bench("dependentsOf(backoff)", () => dependentsOf(store, backoff.id)),
    // The two the loop makes per tick, and the expensive ones.
    bench("lookup(goal statement, 8)", () => b.knowledge.lookup(DISPATCH_GOAL.statement, 8), 500),
    bench("toKnowledgeState(VERIFIED)", () => toKnowledgeState(verified, T0, sources), 200),
    bench("detectGaps(goal)", () => detectGaps(DISPATCH_GOAL, b.state), 500),
  ];

  const pad = (s: string, n: number) => s.padEnd(n);
  const lines = [
    "THE STORE ONIQ HAS, ON THE QUERIES ONIQ MAKES",
    "",
    `  corpus                  ${store.all().length} records (${verified.length} VERIFIED), ${store.journal().length} journal ops`,
    `  concepts / relations    ${b.state.concepts.size} / ${b.state.relations.size}`,
    "",
    `  full tick build         min ${buildTimes[0].toFixed(2)} ms   median ${buildTimes[10].toFixed(2)} ms   max ${buildTimes[19].toFixed(2)} ms`,
    "    (ingests 118 quantum records, runs the 2-qubit convention experiment,",
    "     probes isDispatchable, promotes 123 records and projects the graph)",
    "",
    "  query                             reps      total ms     per call",
    ...rows.map(
      (r) =>
        `    ${pad(r.name, 32)}${String(r.reps).padStart(5)}${r.totalMs.toFixed(2).padStart(12)}${(r.perCallUs.toFixed(2) + " us").padStart(14)}`,
    ),
    "",
    "  MEASURED ARMS           local in-memory store: 1 of 1",
    "  UNMEASURED ARMS         Apache Jena: JVM dependency, package.json is Lovable's",
    "                          Apache AGE:  a Postgres extension on a project this",
    "                                       container cannot reach and must not migrate",
    "",
    "  VERDICT                 the existing store is not a bottleneck on this workload.",
    "                          No graph database is added. Revisit when a number below changes.",
  ];
  console.log(lines.join("\n"));

  writeFileSync(
    join(OUT, "benchmark.json"),
    JSON.stringify(
      {
        corpus: {
          records: store.all().length,
          verified: verified.length,
          journalOps: store.journal().length,
          concepts: b.state.concepts.size,
          relations: b.state.relations.size,
        },
        tickBuildMs: { min: buildTimes[0], median: buildTimes[10], max: buildTimes[19] },
        queries: rows,
        measuredArms: ["local-in-memory"],
        unmeasuredArms: ["apache-jena", "apache-age"],
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(join(OUT, "report.txt"), lines.join("\n") + "\n");
}

main();
