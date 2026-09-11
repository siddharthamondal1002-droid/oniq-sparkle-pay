/**
 * OQCA v1.7 — THE HOST. Owner directive 2026-09-11 §17 and §18.
 *
 * §18 asks for FOUR PROCESSES that _"share nothing except the persisted ONIQ
 * state/knowledge store"_, and calls that the critical proof of compounding
 * autonomy. This script is one of those processes. Run it four times against
 * the same `--dir` and each invocation restores what the previous one left,
 * does what it can, and writes back.
 *
 *   npx tsx scripts/oqca-self-improve.ts --dir docs/oqca/self-improve --reset
 *   npx tsx scripts/oqca-self-improve.ts --dir docs/oqca/self-improve
 *   npx tsx scripts/oqca-self-improve.ts --dir docs/oqca/self-improve
 *   npx tsx scripts/oqca-self-improve.ts --dir docs/oqca/self-improve
 *
 * THIS IS THE ONLY FILE IN THE CHAIN THAT TOUCHES A DISK, and that is the whole
 * architecture rather than a convenience. `src/oqca/**` and its mirror are
 * walked by `security.test.ts` for `fetch`, `fs`, a clock and a credential, and
 * find none; `_shared/oqcaRuntime/**` holds the seams; the filesystem lives
 * here. Nothing in this script can be reached from a deployed function.
 *
 * WHAT IT OBSERVES IS DISCOVERED, NOT DECLARED — §2: _"The system must discover
 * the actual current architecture from available evidence. Do not hard-code
 * assumptions about files or modules."_ So it walks the OQCA trees, builds the
 * real import graph, and derives its findings from THAT. There is no list of
 * modules anywhere below, and adding a file to the repository changes what ONIQ
 * sees on the next run without anybody editing this script.
 *
 * WHAT IT REFUSES TO OBSERVE, said out loud rather than left absent: it does
 * not run the test suite, the benchmark or the mutation script. Those are
 * minutes of CPU per tick and what a scheduled job may spend is the owner's
 * under CLAUDE.md's first rule — the same reason `RUN_BENCHMARK` is registered
 * and NOT authorized. Those kinds come back UNOBSERVED with that reason, which
 * is how "connect an observer for X" becomes an objective ONIQ can raise for
 * itself instead of a thing only a person could think of.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** The trees ONIQ can see. A ROOT to walk, not a list of modules. */
const TREES = [
  "src/oqca",
  "supabase/functions/_shared/oqca",
  "supabase/functions/_shared/oqcaRuntime",
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const HAS = (name: string) => process.argv.includes(`--${name}`);

const DIR = resolve(ROOT, arg("dir", "docs/oqca/self-improve"));
const KNOWLEDGE_FILE = join(DIR, "knowledge.json");
const CHECKPOINT_FILE = join(DIR, "checkpoint.json");
const LOG_FILE = join(DIR, "console.txt");

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

type Module = {
  readonly path: string;
  readonly text: string;
  readonly hash: string;
  readonly isTest: boolean;
  readonly imports: readonly string[];
};

/**
 * THE IMPORT GRAPH, READ FROM THE SOURCE. Relative specifiers are resolved to
 * repo-relative paths so "who imports this" is answerable; anything else (an
 * npm or https specifier) is not a module in these trees and is dropped.
 */
function readModules(): readonly Module[] {
  const out: Module[] = [];
  for (const tree of TREES) {
    for (const abs of walk(join(ROOT, tree))) {
      const text = readFileSync(abs, "utf8");
      const path = relative(ROOT, abs);
      const imports: string[] = [];
      for (const m of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
        imports.push(relative(ROOT, resolve(dirname(abs), m[1])));
      }
      out.push({ path, text, hash: sha(text), isTest: path.includes("__tests__"), imports });
    }
  }
  return out;
}

/**
 * WHAT ONIQ CAN HONESTLY SAY ABOUT ITSELF FROM THOSE FILES.
 *
 * Two findings are DERIVED from the graph and everything else is refused with
 * its reason. Both derived ones are this repository's own most-recorded fault —
 * code that exists and nothing reaches — so they are worth ONIQ noticing about
 * itself rather than being noticed by a person a week later.
 */
function evidenceFrom(modules: readonly Module[]): readonly EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const importedBy = new Map<string, number>();
  for (const m of modules) {
    for (const i of m.imports) importedBy.set(i, (importedBy.get(i) ?? 0) + 1);
  }

  for (const m of modules) {
    if (m.isTest) continue;
    const inbound = importedBy.get(m.path) ?? 0;
    if (inbound === 0) {
      items.push({
        kind: "unreachable_path",
        subject: m.path,
        locator: m.path,
        sourceVersion: null,
        contentHash: m.hash,
        detail: `no module in the OQCA trees imports ${m.path}`,
        value: 0,
        // NOT A CONSTANT PER KIND: the severity rises with how much code is
        // unreachable, so a 20-line orphan and a 400-line one rank differently
        // and the ordering is a fact about the repository rather than a fact
        // about this function.
        severity: Math.min(1, m.text.split("\n").length / 500),
        requires: ["RUN_STATIC_ANALYSIS"],
      });
    }
    const named = modules.some((t) => t.isTest && t.text.includes(m.path.split("/").pop() ?? ""));
    if (!named) {
      items.push({
        kind: "missing_telemetry",
        subject: m.path,
        locator: m.path,
        sourceVersion: null,
        contentHash: m.hash,
        detail: `no file under __tests__ names ${m.path}`,
        value: 0,
        severity: Math.min(1, m.text.split("\n").length / 800),
        requires: ["RUN_TEST_SUITE"],
      });
    }
  }
  return items;
}

/** The corpus the researcher retrieves from: these same files, verbatim. */
function corpusFrom(modules: readonly Module[]): readonly CorpusDocument[] {
  return modules
    .filter((m) => !m.isTest)
    .map((m) => ({
      locator: m.path,
      sourceVersion: null,
      contentHash: m.hash,
      text: m.text,
    }));
}

const lines: string[] = [];
function say(s: string) {
  lines.push(s);
  console.log(s);
}

async function main() {
  if (HAS("reset")) {
    rmSync(DIR, { recursive: true, force: true });
    say(`reset: ${relative(ROOT, DIR)} removed`);
  }
  mkdirSync(DIR, { recursive: true });

  const modules = readModules();
  const items = evidenceFrom(modules);
  say(`read ${modules.length} module(s); derived ${items.length} finding(s) from the import graph`);

  const evidence: SystemEvidence = { read: async () => ({ ok: true, items }) };
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

  /**
   * §12's EXECUTOR, AND IT RUNS NOTHING. `UPDATE_KNOWLEDGE` is permitted — the
   * write itself is the durable store's, and this only says yes — while the
   * two read-only capabilities report that this host does not run them. That
   * is honest rather than convenient: a `RUN_TEST_SUITE` that silently returned
   * a pass count it never measured is the fabricated observation §3 forbids,
   * arriving through the one door nobody watches.
   */
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
    version: "oqca-v1.7",
    branch: arg("branch", "claude/check-56jtg5"),
    // NEVER A GUESS. A commit this host could not establish is absent, and the
    // world state's identity coverage is 0 rather than 1 as a result.
    commit: null,
  };

  const report = await runAutonomousRuntime({
    survey: makeSubstrateSurvey(ctx),
    observe: makeSystemObserver(evidence, ctx.at),
    identity,
    needs: (o: Observation) => resourcesFor(o.requires),
    // Authorization is a table, not a discovery: an unauthorized kind can never
    // be observed, because nothing may attempt it. See registryCapabilityStates.
    knownCapabilities: registryCapabilityStates(),
    runEpisode: makeImprovementEpisode(ctx, {
      research: makeLocalEvidenceResearch(corpusFrom(modules)),
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
    bounds: {
      ...DEFAULT_RUNTIME_BOUNDS,
      maxEpisodes: Number(arg("episodes", "3")),
    },
  });

  say("");
  say(`restored      ${report.restored}`);
  say(`episodes      ${report.episodes}`);
  say(`stop          ${report.stop} — ${report.stopDetail}`);
  say(`generated     ${report.generated} objective(s) this invocation`);
  say(
    `concerns      ${report.concerns.length} ranked; top: ${report.concerns[0]?.goal.id ?? "none"}`,
  );
  say(
    `observed      ${report.observations.filter((o) => o.state === "OBSERVED").length}/${report.observations.length} kinds`,
  );
  say(`settled       ${report.settled.length}`);
  say(
    `learned       ${report.learned.length}${report.learned.length ? `: ${[...new Set(report.learned)].join(", ")}` : ""}`,
  );
  say(`persisted     ${report.persisted.length}`);
  say(
    `experiments   ${report.experiments.length}; verified improvements ${report.improvementsVerified}`,
  );
  for (const x of report.experiments.slice(-3)) {
    say(`  ${x.design.metric}: ${x.verdict} — ${x.rationale}`);
  }
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
