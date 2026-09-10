/**
 * THE SUBSTRATE, IN THE SHIPPED RUNTIME — v1.4-R items A, B and C.
 *
 * Before this, the knowledge seam was served by four hand-written sentences in
 * `knowledge.ts`, and `IDENTIFY_GAPS` refused every run with
 * `no_knowledge_state` because nothing supplied one. The substrate existed,
 * was tested, and could not be reached from anything ONIQ ships — which is this
 * repo's most-recorded failure and would have been its fifth at the largest
 * scale yet.
 *
 * NOW: this module builds a real `KnowledgeStore` on every tick, ingests the
 * quantum domain and the dispatch rules through `evaluatePromotion`, and hands
 * the loop BOTH exits `project.ts` promised — the `KnowledgeAdapter` the
 * LOAD_MEMORY station calls, and the `KnowledgeState` the IDENTIFY_GAPS station
 * reads. `toKnowledgeState` had no caller anywhere in the repository until
 * this file, not even a test.
 *
 * IT IS READ-ONLY AND IT SPENDS NOTHING, and both are structural rather than
 * promised. There is no network primitive here, no Supabase client, no
 * credential and no model: every record is derived from modules already checked
 * in, or computed by a two-qubit circuit that runs locally. The one measured
 * cost is CPU — see `INGEST_BUDGET_MS`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: persist. The store is rebuilt per tick and
 * discarded, because a durable knowledge table is a migration and a write path,
 * and v1.4-R's own instruction is that the first integration is read-only. The
 * consequence is stated rather than discovered: nothing ONIQ learns during a
 * tick survives it, and `substrateGap()` says so where a reader will see it.
 */
import {
  ingestQuantumKnowledge,
  quantumSourceRegistry,
  resetEvidenceIds,
  type IngestReport,
} from "../oqca/quantum/knowledge.ts";
import { makeLocalStore, type KnowledgeStore } from "../oqca/knowledge/substrate/store.ts";
import {
  draftRecord,
  type KnowledgeRecord,
  type Volatility,
} from "../oqca/knowledge/substrate/record.ts";
import {
  makeEvidence,
  type Directness,
  type ExtractionMethod,
  type RegisteredSource,
  type SourceEvidence,
  type SourceType,
} from "../oqca/knowledge/substrate/evidence.ts";
import {
  EMPTY_PROVENANCE,
  withActivity,
  type Provenance,
} from "../oqca/knowledge/substrate/provenance.ts";
import { evaluatePromotion, applyPromotion } from "../oqca/knowledge/substrate/promotion.ts";
import {
  makeSubstrateKnowledgeAdapter,
  toKnowledgeState,
} from "../oqca/knowledge/substrate/project.ts";
import type { KnowledgeState } from "../oqca/knowledge/model.ts";
import type { KnowledgeAdapter } from "../oqca/loop/seams.ts";
import { DISPATCH_BACKOFF_MS, isDispatchable, type QueuedJob } from "./dispatchJob.ts";

/**
 * The domain the dispatch rules live in. Separate from `quantum` so
 * `decisionReadable(store, DISPATCH_DOMAIN, now)` reads the job's own rules and
 * nothing else — the two domains share a store and never a namespace.
 */
export const DISPATCH_DOMAIN = "story_dispatch";

/**
 * ONIQ'S OWN SOURCE CODE, AS A REGISTERED SOURCE.
 *
 * Reliability 1 about what this codebase does, and about nothing else — the
 * same discipline `evidence.ts` states for a package registry. The module is
 * the authority on its own constants; it is the authority on no fact about the
 * world.
 */
export const CODEBASE_SOURCE: RegisteredSource = {
  id: "oniq-codebase",
  title: "The ONIQ repository, as deployed",
  publisher: "ONIQ",
  homepage: "supabase/functions/_shared/oqcaRuntime",
  license: null,
  reliability: 1,
  domains: [DISPATCH_DOMAIN, "oniq_capability"],
  acquirable: true,
};

/**
 * WHAT THE RUN MUST ANSWER FOR ITSELF, and it is not free-standing prose.
 *
 * `DISPATCH_GOAL.requires` names three concepts, and `detectGaps` looks each
 * one up BY ID. So a record whose subject is anything else is invisible to the
 * gap detector however true it is — which is why these subjects are the concept
 * ids verbatim rather than tidy names.
 *
 * `runner-availability` HAS NO RECORD, ON PURPOSE. story-dispatch genuinely
 * cannot see whether a GPU runner is free; its own header records a film
 * sitting `queued` for half an hour while one sat warm and idle. Writing a
 * plausible sentence about it would close the one gap that is real, so the gap
 * detector is left to report it UNKNOWN — which, the first time this ran, is
 * exactly what it did.
 */
const DISPATCH_SUBJECTS = {
  backoff: "dispatch-backoff",
  eligibility: "queue-eligibility",
  action: "dispatch-action",
  hold: "dispatch-hold",
  grade: "story-grade",
} as const;

/**
 * HOW ONIQ CAME TO HOLD A CLAIM ABOUT ITS OWN CODE — and the labelling here
 * was wrong twice in the first draft, in opposite directions.
 *
 * FIRST: the backoff VALUE was labelled `derived`, whose definition in
 * `evidence.ts` is "computed here from other records". Nothing is computed —
 * the module is imported and its exported constant read, so the bytes are in
 * hand and the excerpt quotes them. That is `fetched` by the rung's own words,
 * and calling it `derived` under-rated a first-hand reading at 0.9 against a
 * document's 1.0.
 *
 * SECOND, and the larger error: the four RULE SENTENCES were labelled the same
 * way. They are paraphrases — somebody's prose about what `isDispatchable` and
 * `dispatchTools` do, checked in beside them and never checked AGAINST them. A
 * paraphrase of code is `spec_cited` at best, and dressing it as a reading is
 * exactly the pseudo-provenance this whole type exists to prevent. The
 * consequence is stated rather than hidden: those records come out CANDIDATE,
 * the promotion gate refuses them, and they do not reach the loop. What would
 * fix that is MEASURING the behaviour, which is what `eligibilityProbe` below
 * does for the one rule that governs the decision.
 */
export type BeliefEvidence = {
  readonly sourceId: string;
  readonly sourceType: SourceType;
  readonly locator: string;
  readonly excerpt: string;
  readonly directness: Directness;
  readonly extraction: ExtractionMethod;
};

/**
 * WHAT ONIQ BELIEVES THE BACKOFF IS, **AND WHERE THAT BELIEF CAME FROM**.
 *
 * The first draft took a bare `backoffMs` number and attached evidence saying
 * it had been read from `dispatchJob.ts:DISPATCH_BACKOFF_MS`. That is fine
 * while the number IS the constant, and a fabrication the moment it is not: the
 * locator would name a module that says something else, at a rung that claims a
 * first-hand reading, and `resolveConflict` would weigh a stale belief as if
 * ONIQ had just read it out of the code. A belief and its provenance travel
 * together, or the provenance is decoration.
 */
export type BackoffBelief = {
  readonly windowMs: number;
  readonly evidence: readonly BeliefEvidence[];
};

/** The belief a tick holds by default: the deployed constant, read here. */
export const ENFORCED_BACKOFF_BELIEF: BackoffBelief = {
  windowMs: DISPATCH_BACKOFF_MS,
  evidence: [
    {
      sourceId: CODEBASE_SOURCE.id,
      // A reading of a module ONIQ is RUNNING is an observation of this system,
      // not a document about it. `SOURCE_TYPES` keeps those apart and
      // `conflict.ts` reads the distinction.
      sourceType: "measurement",
      locator: "_shared/oqcaRuntime/dispatchJob.ts:DISPATCH_BACKOFF_MS",
      excerpt:
        `DISPATCH_BACKOFF_MS = ${DISPATCH_BACKOFF_MS}: a job dispatched within the last ` +
        `${Math.round(DISPATCH_BACKOFF_MS / 60000)} minute(s) is inside its backoff window`,
      directness: "fetched",
      extraction: "computed",
    },
  ],
};

/**
 * MEASURING THE ELIGIBILITY RULE INSTEAD OF PARAPHRASING IT — item E's second
 * route to knowledge, applied to the domain that actually decides something.
 *
 * Two probe rows with OPPOSITE pre-registered outcomes, run through the real
 * `isDispatchable`: one stamped just outside the window (must be eligible) and
 * one just inside it (must not). Both must match or NOTHING is recorded — a
 * probe pair that agrees with itself proves only that the function is
 * constant, which is the same discipline `conventions.ts` enforces with its
 * control.
 *
 * `justOutside` and `justInside` straddle the boundary by one minute, so the
 * pair is sensitive to the WINDOW and not merely to the sign of a subtraction.
 */
export type EligibilityProbe = {
  /** Stamped one minute OUTSIDE the window. Must be eligible. */
  readonly justOutside: boolean;
  /** Stamped one minute INSIDE it. Must NOT be. This is the leg that matters. */
  readonly justInside: boolean;
  /** Never dispatched at all. Must be eligible. */
  readonly neverDispatched: boolean;
  /** All three as predicted. Anything else records nothing. */
  readonly ok: boolean;
};

/**
 * EVERY LEG IS RETURNED, NOT JUST THE VERDICT, and a mutation is why.
 *
 * The first version returned a bare boolean, and a mutation that DELETED the
 * `justInside` leg — the one that distinguishes a window from the sign of a
 * subtraction — reported GREEN. It could not do otherwise: with the real
 * `isDispatchable` behind it the verdict is `true` whether two legs ran or
 * three, so no assertion over the verdict alone can see the difference.
 * Returning the legs makes each one separately assertable.
 */
export function eligibilityProbe(
  nowMs: number,
  windowMs: number,
  /**
   * THE RULE UNDER TEST, AS A SEAM — the same shape `runConventionExperiment`
   * takes a backend, and for the same reason.
   *
   * With the real `isDispatchable` hard-wired, `justInside` is `false` whether
   * the leg RAN or was hard-coded, so no assertion could tell a probe that
   * measures from one that reports. A mutation deleting that leg — the one that
   * distinguishes a WINDOW from the sign of a subtraction — reported GREEN
   * twice before this parameter existed. A test can now hand in a rule that
   * admits everything and watch the probe refuse.
   */
  rule: (job: QueuedJob, now: number, window: number) => boolean = isDispatchable,
): EligibilityProbe {
  const row = (dispatchedAtMs: number | null): QueuedJob => ({
    id: "probe",
    requestedSeconds: 1,
    grade: null,
    createdAtMs: nowMs - windowMs * 2,
    dispatchedAtMs,
  });
  const justOutside = rule(row(nowMs - windowMs - 60_000), nowMs, windowMs);
  const justInside = rule(row(nowMs - windowMs + 60_000), nowMs, windowMs);
  const neverDispatched = rule(row(null), nowMs, windowMs);
  return {
    justOutside,
    justInside,
    neverDispatched,
    ok: justOutside === true && justInside === false && neverDispatched === true,
  };
}

function rule(
  subject: string,
  predicate: string,
  object: unknown,
  evidence: readonly SourceEvidence[],
  volatility: Volatility,
  provenance: Provenance,
  at: string,
  derivedFrom: readonly string[] = [],
): KnowledgeRecord {
  return draftRecord({
    subject,
    predicate,
    object,
    domain: [DISPATCH_DOMAIN],
    evidence,
    volatility,
    provenance,
    derivedFrom,
    validity: { validFrom: null, validUntil: null, lastVerifiedAt: at },
  });
}

/**
 * The dispatch rules as RECORDS rather than as sentences.
 *
 * `belief` is an argument and not the constant, and that is v1.4-R item D's
 * whole hinge: what ONIQ BELIEVES the backoff to be is a knowledge record that
 * can be out-weighed by better evidence, while what the code ENFORCES stays
 * `DISPATCH_BACKOFF_MS`. When the two disagree the loop reasons from the belief
 * and reaches a different answer from production — which is precisely what a
 * shadow run is for, and what makes a knowledge upgrade observable end to end.
 */
export function dispatchRuleRecords(
  at: string,
  belief: BackoffBelief = ENFORCED_BACKOFF_BELIEF,
  /**
   * The instant the eligibility probe is run at. `null` skips the probe, so a
   * caller with no clock gets no measured record rather than an unmeasured one
   * dressed up as measured.
   */
  nowMs: number | null = null,
): readonly KnowledgeRecord[] {
  // The four `REQUIRED_STEPS`, in order — anything short of them makes the
  // record untraceable and `evaluatePromotion` refuses it by name.
  const notes: Record<string, string> = {
    source: "the deployed dispatch modules",
    acquisition: "imported and read; no network, no query, no credential",
    extraction: "the exported constant, and the rule the constant governs",
    assertion: "one record per rule, subjected to the goal's own concept ids",
    validation: "the value is re-read from the module on every tick",
  };
  let prov: Provenance = EMPTY_PROVENANCE;
  for (const step of ["source", "acquisition", "extraction", "assertion", "validation"] as const) {
    prov = withActivity(prov, {
      step,
      agent: "supabase/functions/_shared/oqcaRuntime/substrate.ts",
      used: [CODEBASE_SOURCE.id],
      generated: "dispatch_rules",
      at,
      note: notes[step],
    });
  }
  let n = 0;
  const ev = (e: BeliefEvidence): SourceEvidence =>
    makeEvidence({
      id: `ev_code_${(n += 1)}`,
      sourceId: e.sourceId,
      sourceType: e.sourceType,
      sourceVersion: null,
      locator: e.locator,
      contentHash: null,
      excerpt: e.excerpt,
      extraction: e.extraction,
      directness: e.directness,
      retrievedAt: at,
      verifier: e.sourceType === "measurement" ? "dispatchRuleRecords" : null,
      supports: true,
    });

  /**
   * A PARAPHRASE OF CODE, HONESTLY LABELLED. `spec_cited` + `human_authored` is
   * weight 0.40, confidence 0.286, and the promotion gate refuses it — so these
   * records exist, are addressable, and do NOT reach the loop. That is the
   * correct outcome for a sentence nothing checked, and the fix is to measure
   * the behaviour rather than to relabel the sentence.
   */
  const paraphrase = (locator: string, excerpt: string): BeliefEvidence => ({
    sourceId: CODEBASE_SOURCE.id,
    sourceType: "repository_readme",
    locator,
    excerpt,
    directness: "spec_cited",
    extraction: "human_authored",
  });

  const backoff = rule(
    DISPATCH_SUBJECTS.backoff,
    "windowMs",
    belief.windowMs,
    belief.evidence.map(ev),
    // STABLE, not `slow`: a constant in a deployed module does not drift with
    // time, it changes when someone edits it — and the next tick re-reads it.
    // `slow`'s 0.25 volatility would also hold the gap at UNCERTAIN forever,
    // since `detectGaps` requires 0.2 or less to call anything VERIFIED.
    "stable",
    prov,
    at,
  );

  // MEASURED, OR ABSENT. A probe pair that did not both land produces no
  // eligibility record at all, rather than a confident sentence about a rule
  // ONIQ could not confirm.
  const probed = nowMs !== null && eligibilityProbe(nowMs, belief.windowMs).ok;
  const eligibility = probed
    ? [
        rule(
          DISPATCH_SUBJECTS.eligibility,
          "ruleIs",
          "queued and outside the backoff window, oldest first, ties broken by id",
          [
            ev({
              sourceId: CODEBASE_SOURCE.id,
              sourceType: "measurement",
              locator: "_shared/oqcaRuntime/dispatchJob.ts:isDispatchable",
              excerpt:
                `probed at window ${belief.windowMs}ms: a row stamped one minute OUTSIDE the ` +
                "window is eligible, one minute INSIDE is not, and a never-dispatched row is",
              directness: "experimentally_verified",
              extraction: "computed",
            }),
          ],
          "stable",
          prov,
          at,
          // ITEM D's DEPENDENCY EDGE, AND IT IS REAL RATHER THAN DECORATIVE.
          // The probe is run AT the believed window, so what counts as eligible
          // is derived from what ONIQ believes the window to be. When that
          // record is out-weighed, `dependentsOf` finds this one and says it
          // must be re-derived — which is what "old dependent knowledge
          // identified" means.
          [backoff.id],
        ),
      ]
    : [];

  return [
    backoff,
    ...eligibility,
    rule(
      DISPATCH_SUBJECTS.action,
      "isReversibleAndTouchesProduction",
      true,
      [
        ev(
          paraphrase(
            "_shared/oqcaRuntime/dispatchJob.ts:dispatchTools",
            "story-dispatch does not claim the row: a dispatch that lands on no runner leaves the job queued and available. It is reversible AND it writes to production",
          ),
        ),
      ],
      "stable",
      prov,
      at,
    ),
    rule(
      DISPATCH_SUBJECTS.hold,
      "isADecision",
      true,
      [
        ev(
          paraphrase(
            "_shared/oqcaRuntime/dispatchJob.ts:HOLD_ACTION",
            "a tick that dispatches nothing has still decided something; holding is a real choice with a real outcome",
          ),
        ),
      ],
      "stable",
      prov,
      at,
    ),
    rule(
      DISPATCH_SUBJECTS.grade,
      "movieRendersOn",
      "Veo, on the metered Google key",
      [
        ev(
          paraphrase(
            "supabase/functions/story-clip",
            "a movie-grade job renders through Veo on the metered Google key; a classic-grade job renders Ken Burns over stills and spends nothing there",
          ),
        ),
      ],
      "slow",
      prov,
      at,
    ),
  ];
}

/** Every source the runtime's store can weigh evidence against. */
export function runtimeSourceRegistry(): ReadonlyMap<string, RegisteredSource> {
  const m = new Map(quantumSourceRegistry());
  m.set(CODEBASE_SOURCE.id, CODEBASE_SOURCE);
  return m;
}

export type SubstrateBuild = {
  readonly store: KnowledgeStore;
  readonly sources: ReadonlyMap<string, RegisteredSource>;
  readonly knowledge: KnowledgeAdapter;
  readonly state: KnowledgeState;
  readonly quantum: IngestReport;
  readonly dispatchRecords: number;
  readonly buildMs: number;
};

/**
 * How long an ingestion may take before it is worth noticing. Not a hard
 * ceiling — refusing to think because a pure computation ran long would be a
 * worse failure than the delay — but the number is REPORTED on the comparison
 * row, so a regression shows up as a measurement instead of as a slow function
 * nobody profiled. Measured here at roughly 8 ms for 118 quantum records plus
 * the two-qubit experiment.
 */
export const INGEST_BUDGET_MS = 250;

/**
 * WHAT NOTHING HERE CARRIES, said where a reader will find it rather than only
 * in a design document. The same shape `knowledge.ts` and `memory.ts` already
 * use for their own gaps.
 */
export function substrateGap(): string {
  return (
    "the store is built per tick and discarded: ONIQ has no durable knowledge table, " +
    "so nothing learned during a run survives it"
  );
}

/**
 * Build the tick's knowledge. Pure with respect to the world.
 *
 * `resolved` answers "does this exported name exist" for `capabilityFacts`. The
 * runtime cannot introspect a module namespace the way a test can, so it is an
 * argument with a conservative default: an unresolvable name makes a capability
 * claim FALSE rather than unproven, and claiming a capability ONIQ cannot
 * demonstrate is the one direction that must not be guessed.
 */
export function buildSubstrate(opts: {
  readonly at: string;
  readonly nowMs: number;
  readonly belief?: BackoffBelief;
  readonly resolved?: (name: string) => boolean;
  readonly elapsedMs?: () => number;
}): SubstrateBuild {
  const started = opts.elapsedMs ? opts.elapsedMs() : 0;
  // Deterministic evidence ids per tick. The counter is module-level in
  // `quantum/knowledge.ts` and would otherwise climb for the life of the
  // isolate, so two ticks of the same code would produce different ids for the
  // same evidence — replayable only by accident.
  resetEvidenceIds();

  const store = makeLocalStore();
  const sources = runtimeSourceRegistry();
  const quantum = ingestQuantumKnowledge(store, opts.at, opts.resolved ?? (() => false));

  const drafts = dispatchRuleRecords(opts.at, opts.belief, opts.nowMs);
  for (const d of drafts) {
    // THE SAME GATE THE QUANTUM DOMAIN GOES THROUGH. Nothing in this file may
    // write a status: `evaluatePromotion` is the only path to belief, which is
    // what makes the dispatch rules a domain UNDER the substrate rather than a
    // second store beside it.
    store.put(applyPromotion(d, evaluatePromotion(d, sources)));
  }

  const state = toKnowledgeState(store.byStatus("VERIFIED"), opts.nowMs, sources, "oqca-dispatch");
  return {
    store,
    sources,
    knowledge: makeSubstrateKnowledgeAdapter(store, () => opts.nowMs),
    state,
    quantum,
    dispatchRecords: drafts.length,
    buildMs: opts.elapsedMs ? opts.elapsedMs() - started : 0,
  };
}
