/**
 * ONE AUTONOMOUS RUNTIME, ACROSS TWO OS PROCESSES — OQCA v1.5, the owner's
 * "biggest reachability test": server starts -> restore cognitive state ->
 * start autonomous runtime -> run episode -> checkpoint -> select the next
 * objective -> continue, with no user request anywhere.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT, first, because the distinction is the
 * whole value of the numbers. Real: the objective generator, the six-factor
 * learning selector, the 23-station loop, the knowledge substrate the survey
 * rebuilds each cycle, the checkpoint written to disk as JSON, and the restore
 * performed by a SECOND invocation of this script that shares nothing with the
 * first but that file. Not real: a server. Nothing hosts this; it is a command,
 * run twice, which is what makes the cross-process claim checkable rather than
 * asserted.
 *
 * NO USER REQUEST IS SUPPLIED, deliberately. `--seed-user` exists only so the
 * precedence rule (a person's request outranks the runtime's own chores) can be
 * exercised on demand; the default run has nobody asking for anything, which is
 * the state v1.5 is about.
 *
 * THE CLOCK IS PINNED. `T0` is a fixed instant rather than a real reading, so
 * two invocations produce the same record ids and the same staleness verdicts
 * and the second run's difference from the first is the RESTORE and nothing
 * else. A wall clock here would make every run differ for reasons that have
 * nothing to do with cognition.
 *
 *     npx tsx scripts/oqca-autonomous-run.ts --reset    # first process
 *     npx tsx scripts/oqca-autonomous-run.ts            # second, restores
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAutonomousRuntime, type RuntimeBounds } from "../src/oqca/autonomy/runtime.ts";
import { userObjective } from "../src/oqca/autonomy/objective.ts";
import {
  makeLoopEpisode,
  makeSinkCheckpointStore,
  makeSubstrateSurvey,
  autonomyGap,
  STANDING_GOAL,
} from "../supabase/functions/_shared/oqcaRuntime/autonomous.ts";

const OUT = "docs/oqca/autonomous-run";
const args = process.argv.slice(2);
const T0_ISO = "2026-09-10T12:00:00Z";
const T0 = Date.parse(T0_ISO);

/**
 * `--advance-days N` SURVEYS AT T0+N WHILE THE RECORDS STAY STAMPED AT T0, and
 * it exists because of something this script measured rather than to make a
 * demonstration look busier.
 *
 * THE MAINTENANCE PATH IS UNREACHABLE IN PRODUCTION TODAY. `buildSubstrate`
 * re-ingests every record on every tick and stamps `lastVerifiedAt` with that
 * tick's own instant, so `nowMs` and the verification time are always equal and
 * `freshness` can never report a `stable` or `slow` record stale. Nothing ages,
 * because nothing persists — which is `substrateGap()` in its own words, seen
 * from the other end. So the staleness factor and every maintenance objective
 * are real code with no reachable input until ONIQ has a durable knowledge
 * table, and the honest way to exercise them is to say so and move the clock
 * ON PURPOSE rather than to arrange a fixture that hides it.
 */
const ADVANCE_DAYS = Number(
  args.find((a) => a.startsWith("--advance-days="))?.split("=")[1] ?? "0",
);
const SURVEY_NOW = T0 + ADVANCE_DAYS * 86_400_000;
const tag = ADVANCE_DAYS ? `-adv${ADVANCE_DAYS}` : "";
// One checkpoint per clock, so the two demonstrations cannot restore each
// other’s backlog and read as a lifecycle that never happened.
const CHECKPOINT = join(OUT, `checkpoint${tag}.json`);

mkdirSync(OUT, { recursive: true });
if (args.includes("--reset")) {
  rmSync(CHECKPOINT, { force: true });
  for (const f of [
    "report-1.json",
    "report-2.json",
    "report-adv400-1.json",
    "report-adv400-2.json",
  ]) {
    rmSync(join(OUT, f), { force: true });
  }
}

const notes: string[] = [];
const sink = {
  write: async (json: string) => {
    writeFileSync(CHECKPOINT, json);
    return true;
  },
  read: async () => {
    try {
      return readFileSync(CHECKPOINT, "utf8");
    } catch {
      return null;
    }
  },
  note: (m: string) => notes.push(m),
};

const substrate = {
  at: () => T0_ISO,
  nowMs: () => SURVEY_NOW,
  // The runtime cannot introspect a module namespace, so capability claims are
  // FALSE unless proven. `substrate.ts` carries the full reason.
  resolved: () => false,
};

/**
 * Four episodes rather than the default eight: this run's purpose is to show
 * the lifecycle turning over and surviving a process boundary, and a second
 * invocation continuing from episode 4 is a better demonstration than one
 * invocation reaching the bound. Every bound here is a runaway guard; the SPEND
 * bounds are `DEFAULT_BUDGETS`, which are zero, and are not touched.
 */
const BOUNDS: RuntimeBounds = {
  maxEpisodes: 4,
  maxConsecutiveBlocked: 3,
  maxBacklog: 32,
  maxWallMs: 120_000,
};

const report = await runAutonomousRuntime({
  survey: makeSubstrateSurvey(substrate),
  runEpisode: makeLoopEpisode(substrate),
  store: makeSinkCheckpointStore(sink),
  bounds: BOUNDS,
  seed: args.includes("--seed-user")
    ? [userObjective({ ...STANDING_GOAL, id: "user:dispatch" }, 0)]
    : [],
});

const which = report.restored ? 2 : 1;
writeFileSync(
  join(OUT, `report${tag}-${which}.json`),
  `${JSON.stringify({ report, notes }, null, 2)}\n`,
);

console.log(`\n=== OQCA v1.6 autonomous runtime — process ${which} ===`);
console.log(`surveyed at              : T0 + ${ADVANCE_DAYS}d`);
console.log(`restored from checkpoint : ${report.restored}`);
console.log(`episodes THIS process    : ${report.episodes}`);
console.log(`episodes total           : ${report.snapshot.episode}`);
console.log(`stop                     : ${report.stop} — ${report.stopDetail}`);
console.log(`objectives generated     : ${report.generated}`);
console.log(`survey refusals          : ${report.surveyRefusals}`);
console.log(`checkpoints durably kept : ${report.checkpoints} of ${report.checkpointAttempts}`);
console.log(`settled (concepts)       : ${[...new Set(report.settled)].join(", ") || "none"}`);
console.log(`LEARNED (moved by a run) : ${[...new Set(report.learned)].join(", ") || "none"}`);
/**
 * v1.6 — THE RESOURCE ACCOUNTING, PRINTED. Requirement 6 asks for it to stay
 * observable and auditable, and a number that only lives in a JSON file nobody
 * opens is not observable. The stop above already names the resource when one
 * is what stopped the lifecycle; this says which capabilities were reached at
 * all and what each answered.
 */
console.log(`capability blocks        : ${report.capabilityBlocks}`);
for (const c of report.capabilities) {
  console.log(
    `  ${c.capability.padEnd(13)} ${c.availability.padEnd(23)}` +
      `${c.bound ? `bound=${c.bound} ` : ""}${c.station ? `at ${c.station} ` : ""}${c.detail}`,
  );
}
for (const n of notes) console.log(`note                     : ${n}`);

console.log(`\n--- episodes ---`);
for (const h of report.history) {
  console.log(
    `  #${h.episode} ${h.status.padEnd(8)} ${h.source.padEnd(13)} ${h.goalId}` +
      (h.followUpId ? `  -> follow-up ${h.followUpId.slice(0, 8)}` : "") +
      (h.reawakened.length ? `  -> reawakened ${h.reawakened.length}` : "") +
      (h.reconsidered.length ? `  -> reconsidered ${h.reconsidered.length}` : "") +
      (h.capabilities.some((c) => c.availability !== "available")
        ? `  -> waiting on ${h.capabilities
            .filter((c) => c.availability !== "available")
            .map((c) => c.capability)
            .join(",")}`
        : ""),
  );
}

console.log(`\n--- backlog ---`);
for (const o of [...report.snapshot.backlog].sort((a, b) => b.priority - a.priority)) {
  console.log(
    `  ${o.status.padEnd(10)} ${o.priority.toFixed(4)} d${o.depth} a${o.attempts} ` +
      `${o.source.padEnd(13)} ${o.goal.id}` +
      (o.blockedCapabilities.length
        ? `  [waiting on ${o.blockedCapabilities
            .map((c) => `${c.capability}:${c.availability}`)
            .join(", ")}]`
        : ""),
  );
}
console.log(`\ngap: ${autonomyGap()}\n`);
