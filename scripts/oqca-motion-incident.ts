/**
 * OQCA ON THE IN-HOUSE VIDEO MOTION PROBLEM.
 *
 * The second real ONIQ fault put to the autonomous runtime, after the
 * 2026-09-11 dispatch outage (`scripts/oqca-dispatch-incident.ts`). Owner
 * request 2026-09-12: _"Use oqca to check inhouse video motion problem."_
 *
 * THE READINGS ARE MEASURED IN BOTH REPOSITORIES, 2026-09-12, and every one is
 * a count somebody can re-run: the command or the SQL that produced it is the
 * `locator`. The in-house video path lives in `oniq-gpu-worker` (LTX-Video 2B
 * on an A5000, `videogen.py`, shipped by a Dockerfile that names every file it
 * COPYies individually); the jobs it produces are rows in `oniq-sparkle-pay`'s
 * production database.
 *
 * WHAT THIS IS A TEST OF, stated BEFORE the run so the result can disagree with
 * it. My own reading of the evidence is that the motion problem is not that
 * the model moves badly — it is that `validation/clip_quality.py` is 288 lines
 * of measured, calibrated, 24-test motion judgement that is NOT in the
 * production image and is imported by NOTHING that ships. If the runtime ranks
 * a `missing_validation` concern first, it agrees. If it ranks the fixture
 * failure rate or the telemetry gap first, or names something I have not
 * thought of, that is the finding and my prediction was wrong. The dispatch
 * incident's prediction WAS wrong and the run said so, which is the point.
 *
 * NOTHING HERE TELLS IT THE ANSWER. Every reading carries a count, a locator
 * and a severity, and never a diagnosis or a remedy. No reading says "ship the
 * validator", "add a column" or "the threshold is wrong".
 *
 * AND IT CANNOT FIX ANY OF IT. Shipping a module into a Docker image is
 * `REBUILD_ARTIFACT`, adding a column is `UPDATE_CONFIGURATION`, and inspecting
 * more clips is `CREATE_EXPERIMENT` and spends GPU money — all three are
 * registered and NOT authorized (`selfModel.ts`). Naming the blocker IS the
 * deliverable, and after the 2026-09-11 `needsAPerson` fix an
 * escalation-blocked real fault should outrank a never-observed chore rather
 * than sinking beneath one.
 *
 * COST: $0. No engine is passed, so `REFUSING_ENGINE` refuses every model call
 * before it is made; no tool touches production; nothing is deployed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { type Observation } from "../src/oqca/autonomy/observation.ts";
import { type SystemIdentity } from "../src/oqca/autonomy/world.ts";
import { runAutonomousRuntime, DEFAULT_RUNTIME_BOUNDS } from "../src/oqca/autonomy/runtime.ts";
import {
  registryCapabilityStates,
  resourcesFor,
} from "../supabase/functions/_shared/oqcaRuntime/selfModel.ts";
import type {
  CapabilityExecutor,
  CapabilityRequest,
} from "../supabase/functions/_shared/oqcaRuntime/selfModel.ts";
import {
  type EvidenceItem,
  type SystemEvidence,
  makeSystemObserver,
} from "../supabase/functions/_shared/oqcaRuntime/observe.ts";
import {
  type SubstrateContext,
  makeSinkCheckpointStore,
  makeSubstrateSurvey,
} from "../supabase/functions/_shared/oqcaRuntime/autonomous.ts";
import { makeImprovementEpisode } from "../supabase/functions/_shared/oqcaRuntime/improvement.ts";
import {
  type CorpusDocument,
  makeLocalEvidenceResearch,
} from "../supabase/functions/_shared/oqcaRuntime/research.ts";
import { makeSinkDurableStore } from "../supabase/functions/_shared/oqcaRuntime/durableStore.ts";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
/** The in-house video worker is a SEPARATE repository, checked out beside this one. */
const WORKER_ROOT = resolve(ROOT, "..", "oniq-gpu-worker");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const HAS = (name: string) => process.argv.includes(`--${name}`);

const DIR = resolve(ROOT, arg("dir", "docs/oqca/motion-incident"));
const KNOWLEDGE_FILE = join(DIR, "knowledge.json");
const CHECKPOINT_FILE = join(DIR, "checkpoint.json");
const LOG_FILE = join(DIR, "console.txt");

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const lines: string[] = [];
function say(s: string) {
  lines.push(s);
  console.log(s);
}

/**
 * THE READINGS, MEASURED 2026-09-12.
 *
 * `severity` is the host's, and it is the one number here that is a judgement
 * rather than a count. A validator that cannot run in production is high but
 * not 1: no user is being shown a broken clip TODAY, because in-house video has
 * produced four jobs ever and none since 2026-08-28. Zero means "read, and
 * fine" — the control reading — and null would mean "read, and cannot say",
 * which is not the case for any of these.
 */
const READINGS: readonly EvidenceItem[] = [
  {
    kind: "missing_validation",
    subject: "clip_quality_shipped",
    locator: "oniq-gpu-worker:grep -c '^COPY' Dockerfile; grep -l clip_quality *.py",
    sourceVersion: "2026-09-12",
    contentHash: null,
    detail:
      "the Dockerfile COPYies 16 paths and names 14 python modules individually; " +
      "validation/clip_quality.py is not among them and no shipped module imports it, " +
      "so the four motion verdicts cannot be computed inside the production image",
    value: 0,
    severity: 0.9,
    requires: ["REBUILD_ARTIFACT"],
  },
  {
    kind: "missing_telemetry",
    subject: "gpu_video_jobs_verdict",
    locator: "production:information_schema.columns where table_name = 'gpu_video_jobs'",
    sourceVersion: "2026-09-12",
    contentHash: null,
    detail:
      "the table carries 33 columns covering cost, bytes, timing, audio and watermark " +
      "and none of them records a motion verdict, an aliveness number or an anchor " +
      "distance, so no clip this system has produced can be asked whether it moved",
    value: 0,
    severity: 0.7,
    requires: ["UPDATE_CONFIGURATION"],
  },
  {
    kind: "motion_failure",
    subject: "ltx_clip_inspection",
    locator: "oniq-gpu-worker:validation/fixtures/fixtures.json",
    sourceVersion: "2026-08-29",
    contentHash: null,
    detail:
      "three clips were pulled and frame-inspected on gpu-validation run 79 and one of " +
      "the three is a pass: aliveness 0.003 anchor_p75 0.0044 PASS, aliveness 0.0046 " +
      "anchor_p75 0.1567 PARTIAL identity drift, aliveness 0.0106 anchor_p75 0.2618 " +
      "FAIL scene replaced",
    value: 2,
    severity: 0.8,
    requires: ["CREATE_EXPERIMENT"],
  },
  {
    kind: "missing_validation",
    subject: "static_threshold_calibration",
    locator: "oniq-gpu-worker:validation/clip_quality.py CALIBRATION",
    sourceVersion: "2026-08-29",
    contentHash: null,
    detail:
      "static_below is 0.0015, which is half the least alive of the three known good " +
      "samples rather than a number derived from a frozen clip; no frozen fixture " +
      "exists, so the one verdict that names a clip which never moved has never been " +
      "checked against a clip which never moved",
    value: 0,
    severity: 0.6,
    requires: ["CREATE_EXPERIMENT"],
  },
  {
    kind: "generation_failure",
    subject: "gpu_video_jobs_volume",
    locator: "production:gpu_video_jobs group by status",
    sourceVersion: "2026-09-12",
    contentHash: null,
    detail:
      "four rows exist in total, three completed between 2026-08-26 and 2026-08-27 and " +
      "one orphaned on 2026-08-28, and nothing has been generated since, so the sample " +
      "any judgement about production motion could rest on is three clips",
    value: 4,
    severity: 0.3,
    requires: ["CREATE_EXPERIMENT"],
  },
  {
    /**
     * THE CONTROL. A severity-0 reading that says the thing is healthy, so the
     * host is not only feeding bad news and `actionable()` can be seen dropping
     * it — the same role the dispatcher's 159 responses of 200 played in the
     * dispatch incident.
     */
    kind: "resource_availability",
    subject: "clip_quality_module",
    locator: "oniq-gpu-worker:wc -l validation/clip_quality.py; grep -c 'def test_' tests/",
    sourceVersion: "2026-09-12",
    contentHash: null,
    detail:
      "the motion judgement itself is written and covered: 288 lines carrying four " +
      "verdicts and a calibration block, with 24 tests over synthetic byte frames that " +
      "need no network, no ffmpeg and no GPU",
    value: 24,
    severity: 0,
    requires: [],
  },
];

/**
 * THE CORPUS IS THE READINGS AND THE REAL SOURCE, and the split is deliberate.
 *
 * Each reading becomes one line opening with its concept id, because
 * `makeLocalEvidenceResearch` requires EVERY term of the question to appear on
 * one line and the question IS `${kind}:${subject}` — the shape
 * `productionEvidence.ts` uses live, for the same reason. Without it a question
 * about `missing_validation:clip_quality_shipped` retrieves nothing however
 * much the corpus discusses it.
 *
 * The SOURCE FILES are added underneath so the loop can find things this host
 * did not put in a reading. They are read off disk at their real hashes: what
 * it cites, it retrieved itself.
 */
const CORPUS_FILES: readonly (readonly [string, string])[] = [
  [WORKER_ROOT, "validation/clip_quality.py"],
  [WORKER_ROOT, "validation/frame_pull.py"],
  [WORKER_ROOT, "videogen.py"],
  [WORKER_ROOT, "Dockerfile"],
  [ROOT, "supabase/functions/_shared/oqcaRuntime/selfModel.ts"],
];

function corpus(): readonly CorpusDocument[] {
  const out: CorpusDocument[] = READINGS.map((r) => ({
    locator: r.locator,
    sourceVersion: r.sourceVersion,
    contentHash: null,
    text: `${r.kind}:${r.subject} — ${r.detail}`,
  }));
  for (const [base, rel] of CORPUS_FILES) {
    let text: string;
    try {
      text = readFileSync(resolve(base, rel), "utf8");
    } catch {
      continue; // A file this host cannot read is absent, never invented.
    }
    const label = base === ROOT ? rel : `oniq-gpu-worker:${rel}`;
    out.push({ locator: label, sourceVersion: null, contentHash: sha(text), text });
  }
  return out;
}

async function main() {
  if (HAS("reset")) {
    rmSync(DIR, { recursive: true, force: true });
    say(`reset: ${relative(ROOT, DIR)} removed`);
  }
  mkdirSync(DIR, { recursive: true });

  const docs = corpus();
  say(`${READINGS.length} measured reading(s); corpus ${docs.length} document(s)`);

  const evidence: SystemEvidence = { read: async () => ({ ok: true, items: READINGS }) };
  const started = Date.now();
  const ctx: SubstrateContext = {
    at: () => new Date(started).toISOString(),
    nowMs: () => started,
  };

  const readFile = async (p: string) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
  const writeFile = async (p: string, json: string) => {
    writeFileSync(p, json);
    return true;
  };

  /** Permits a knowledge write and runs nothing else — the v1.7 host's executor. */
  const executor: CapabilityExecutor = async (req: CapabilityRequest) => {
    if (req.id === "UPDATE_KNOWLEDGE") {
      return {
        ok: true,
        value: Number(req.args.records ?? 0),
        unit: "records",
        detail: "permitted",
      };
    }
    return { ok: false, reason: `${req.id} is authorized but this host does not execute it` };
  };

  const identity: SystemIdentity = {
    name: "ONIQ",
    version: "oqca-motion-incident",
    branch: arg("branch", "claude/check-56jtg5"),
    commit: null,
  };

  const report = await runAutonomousRuntime({
    survey: makeSubstrateSurvey(ctx),
    observe: makeSystemObserver(evidence, ctx.at),
    identity,
    needs: (o: Observation) => resourcesFor(o.requires),
    knownCapabilities: registryCapabilityStates(),
    runEpisode: makeImprovementEpisode(ctx, {
      research: makeLocalEvidenceResearch(docs),
      durable: makeSinkDurableStore({
        read: () => readFile(KNOWLEDGE_FILE),
        write: (json) => writeFile(KNOWLEDGE_FILE, json),
        note: (m) => say(`  durable: ${m}`),
      }),
      executor,
    }),
    store: makeSinkCheckpointStore({
      read: () => readFile(CHECKPOINT_FILE),
      write: (json) => writeFile(CHECKPOINT_FILE, json),
      note: (m) => say(`  checkpoint: ${m}`),
    }),
    clock: () => Date.now(),
    bounds: { ...DEFAULT_RUNTIME_BOUNDS, maxEpisodes: Number(arg("episodes", "3")) },
  });

  say("");
  say(`restored      ${report.restored}`);
  say(`episodes      ${report.episodes}`);
  say(`stop          ${report.stop} — ${report.stopDetail}`);
  say(`generated     ${report.generated} objective(s)`);
  say(`concerns      ${report.concerns.length} ranked`);
  for (const c of report.concerns) {
    const f = c.planning;
    say(
      `  ${c.score.toFixed(5)} tgt=${c.target.score.toFixed(5)}` +
        ` cap=${f.capability.toFixed(2)} cost=${f.cost.toFixed(2)} rev=${f.reversibility.toFixed(2)}` +
        ` risk=${f.risk.toFixed(2)} dep=${f.dependencies.toFixed(2)} exp=${f.expectedImprovement.toFixed(2)}` +
        `  ${c.observation.state.padEnd(10)} ${c.goal.id}`,
    );
    const t = c.target.factors;
    say(
      `          learn[imp=${t.importance.toFixed(3)} unc=${t.uncertainty.toFixed(3)}` +
        ` dep=${t.dependency.toFixed(3)} gain=${t.informationGain.toFixed(3)}` +
        ` stale=${t.staleness.toFixed(3)} rel=${t.relevance.toFixed(3)}] ${c.target.status}`,
    );
  }
  say(
    `observed      ${report.observations.filter((o) => o.state === "OBSERVED").length}/${report.observations.length} kinds`,
  );
  say(`settled       ${report.settled.length}`);
  say(`learned       ${report.learned.length}`);
  say(`persisted     ${report.persisted.length}`);
  say(`checkpoints   ${report.checkpoints}/${report.checkpointAttempts}`);
  for (const h of report.history.slice(-Number(arg("episodes", "3")))) {
    say(`  #${h.episode} ${h.goalId} ${h.status} [${h.experimentVerdict ?? "no experiment"}]`);
    say(`      ${h.note}`);
    if (h.selfEvaluation) say(`      ${h.selfEvaluation.summary}`);
  }

  const prior = (await readFile(LOG_FILE)) ?? "";
  writeFileSync(LOG_FILE, `${prior}${prior ? "\n" : ""}${lines.join("\n")}\n`);
}

void main();
