/**
 * OQCA v1.7 — THE EPISODE THAT CAN ACTUALLY LEARN. Owner directive 2026-09-11.
 *
 * `makeLoopEpisode` runs the 23 stations and says so honestly: it rebuilds the
 * substrate every tick, writes nothing back, and reports `learned: []` always.
 * That is v1.6's stated gap. THIS episode closes it, and the whole of §1's
 * lifecycle runs inside one call of it:
 *
 *   RESTORE      hydrate the durable store into the tick's substrate
 *   MEASURE      count the objective's open gaps  <- §13's BASELINE
 *   IDENTIFY     knowledgeNeeds -> SKIP_RESEARCH or RESEARCH        §7
 *   RESEARCH     retrieve VERBATIM evidence from a corpus in hand   §9
 *   VERIFY       evaluatePromotion, which is the only path to belief §10
 *   PERSIST      through the §12 registered capability, or not at all §8
 *   RUN          the real 23 stations over the upgraded knowledge
 *   MEASURE      count the open gaps again        <- §13's CANDIDATE
 *   COMPARE      compare(), which refuses to call a tie a win       §11
 *
 * THE MEASURABLE IS THE OBJECTIVE'S OWN OPEN-GAP COUNT, and choosing it was the
 * design decision worth recording. It is DISCRETE, so a delta is exact rather
 * than a float that needs a noise model; it is what the objective is FOR, so an
 * improvement in it is an improvement in the thing being attempted rather than
 * in a proxy; it costs nothing to take; and it genuinely varies, which is the
 * property a metric needs in order to be able to say "no". A timing metric
 * would have been the obvious choice and would have measured this container.
 *
 * AND IT IS WHAT MAKES §18's COMPOUNDING PROOF MEASURABLE RATHER THAN ASSERTED.
 * A process that researches and persists sees the count fall and reports
 * IMPROVED. A LATER process that restores what the first one wrote sees the
 * count already low — baseline and candidate equal, verdict NO_DIFFERENCE,
 * `settled` non-empty and `learned` EMPTY. That pair is §10's settled/learned
 * distinction proven across a process boundary, and neither half is a claim
 * anybody typed.
 *
 * NOTHING HERE SPENDS. The research is a search of documents the host already
 * read; the persistence is a write to the host's own sink; the 23 stations run
 * at the shipped budgets, whose three spend bounds are zero. A capability that
 * WOULD spend — `RUN_BENCHMARK`, `REQUEST_RESEARCH` — is registered and NOT
 * authorized, and `executeCapability` refuses it by name.
 */
import { detectGaps, openGaps, type Goal } from "../oqca/knowledge/gaps.ts";
import type { KnowledgeState } from "../oqca/knowledge/model.ts";
import { toKnowledgeState } from "../oqca/knowledge/substrate/project.ts";
import { type KnowledgeRecord, draftRecord } from "../oqca/knowledge/substrate/record.ts";
import { applyPromotion, evaluatePromotion } from "../oqca/knowledge/substrate/promotion.ts";
import { makeEvidence } from "../oqca/knowledge/substrate/evidence.ts";
import {
  type Provenance,
  EMPTY_PROVENANCE,
  withActivity,
} from "../oqca/knowledge/substrate/provenance.ts";
import {
  type DurableKnowledgeStore,
  type DurableRecord,
  NO_DURABLE_STORE,
  hydrate,
  toDurable,
} from "../oqca/knowledge/substrate/durable.ts";
import {
  type CycleContext,
  type EpisodeOutcome,
  type RunEpisode,
} from "../oqca/autonomy/runtime.ts";
import type { Objective } from "../oqca/autonomy/objective.ts";
import { knowledgeNeeds, researchDecision } from "../oqca/autonomy/improve.ts";
import { stalenessByConcept } from "../oqca/autonomy/select.ts";
import {
  type ExperimentRecord,
  blocked as experimentBlocked,
  compare,
  design,
  measurement,
} from "../oqca/autonomy/experiment.ts";
import { type CapabilityState, unavailable } from "../oqca/loop/capability.ts";
import { CognitiveState } from "../oqca/formalState.ts";
import { runCognitiveLoop } from "../oqca/loop/cognitiveLoop.ts";
import { type Budgets, DEFAULT_BUDGETS, type Engine } from "../oqca/loop/seams.ts";
import { objectiveState, type SubstrateContext } from "./autonomous.ts";
import { buildSubstrate, CODEBASE_SOURCE, type SubstrateBuild } from "./substrate.ts";
import { type LocalEvidenceResearch } from "./research.ts";
import {
  type CapabilityExecutor,
  NO_EXECUTOR,
  executeCapability,
  registeredCapability,
} from "./selfModel.ts";

/** The metric, named once so the record, the baseline ledger and the report agree. */
export const GAP_METRIC = "objective_residual_uncertainty";

/**
 * THE METRIC IS RESIDUAL UNCERTAINTY, NOT A COUNT OF OPEN GAPS, AND THE FIRST
 * VERSION WAS THE COUNT. That version made the whole demonstration vacuous, and
 * finding out why is the useful part.
 *
 * `openGaps` drops only VERIFIED concepts, and `detectGaps` calls a concept
 * VERIFIED at support ≥ 0.85 with mean evidence VOLATILITY ≤ 0.2. A line
 * retrieved from a source file is `slow` knowledge — someone can edit the file
 * — which `project.ts` maps to a belief volatility of 0.25. So a perfectly good
 * first-hand retrieval leaves the concept UNCERTAIN rather than VERIFIED, the
 * count does not move, and every experiment answers NO_DIFFERENCE. Measured on
 * the first live run: three records retrieved, promoted and persisted, gaps
 * 1 -> 1.
 *
 * The wrong fix is to relabel the record `stable` so the threshold clears —
 * a fixture built to flatter the subject, which this repository has a receipt
 * for. The right fix is to measure the thing that actually changed: gap
 * uncertainty falls from 1 (UNKNOWN: no evidence bears on it at all) to about
 * 0.125 (UNCERTAIN: strong evidence, slow volatility). That is a real, exact,
 * deterministic improvement in what ONIQ knows, and it still reaches 0 when a
 * concept does become VERIFIED — so the metric spans the whole range rather
 * than only its last step.
 */
export const MIN_GAP_DELTA = 0.05;

/**
 * A COUNT OVER A DETERMINISTIC STATE IS ONE READING AND CANNOT BE MORE. Taking
 * it twice would produce the identical number and dress a single sample as two
 * — the shape §11 calls INCONCLUSIVE for good reason. So the criterion asks for
 * one and the honesty lives in `minDelta` instead.
 */
export const GAP_SAMPLES = 1;

export type ImprovementDeps = {
  /** §9. Absent means research refuses, which is the v1.6 behaviour unchanged. */
  readonly research?: LocalEvidenceResearch;
  /** §8. Absent means nothing persists and the episode says `persisted: []`. */
  readonly durable?: DurableKnowledgeStore;
  /** §12. Absent means every registered capability refuses. */
  readonly executor?: CapabilityExecutor;
  /**
   * THE MODEL, AND ABSENT MEANS THE 23 STATIONS REASON ABOUT NOTHING.
   *
   * This was missing entirely, which made the budget question unanswerable: with
   * no engine the kernel falls back to `REFUSING_ENGINE`, so raising `maxTokens`
   * only changed the refusal from `insufficient_allowance` to `no engine
   * configured` — the same silence, differently worded. An owner reading either
   * would reasonably conclude the number was too low.
   *
   * It stays OPTIONAL because the refusing default is the right one for a
   * caller that has not decided to spend; what was wrong was that no caller
   * COULD decide. `engine.ts` reaches a provider only through the spend ledger,
   * so supplying one here still cannot spend past the ledger's ceilings.
   */
  readonly engine?: (objective: Objective) => Engine;
  readonly budgets?: Budgets;
};

/**
 * HOW MUCH ABOUT THIS GOAL IS STILL UNSETTLED, summed over its own required
 * concepts. `detectGaps` computes each concept's uncertainty from its evidence;
 * this is their total, so the number is in "concepts' worth of doubt" and zero
 * means every requirement is settled.
 */
export function residualUncertainty(goal: Goal, state: KnowledgeState): number {
  return detectGaps(goal, state).reduce((a, g) => a + g.uncertainty, 0);
}

/**
 * The §9 provenance chain for a retrieved claim. FIVE STEPS, in order, because
 * `evaluatePromotion` refuses an untraceable record BY NAME — and the names are
 * what a later reader uses to decide whether to believe it, so each one says
 * what actually happened rather than what the step is called.
 */
function retrievalProvenance(at: string, locator: string, question: string): Provenance {
  const notes: readonly (readonly [string, string])[] = [
    ["source", `the ONIQ repository, read by the host: ${locator}`],
    ["acquisition", "the host read the bytes and hashed them; no network, no credential"],
    ["extraction", "the matching line, verbatim, with no rewording"],
    ["assertion", `one record, subjected to the concept id "${question}"`],
    ["validation", "the promotion policy scored it; nothing here writes a status"],
  ];
  let prov: Provenance = EMPTY_PROVENANCE;
  for (const [step, note] of notes) {
    prov = withActivity(prov, {
      step: step as "source" | "acquisition" | "extraction" | "assertion" | "validation",
      agent: "supabase/functions/_shared/oqcaRuntime/improvement.ts",
      used: [CODEBASE_SOURCE.id],
      generated: question,
      at,
      note,
    });
  }
  return prov;
}

/**
 * WHAT ONIQ RESEARCHED, TURNED INTO RECORDS THE SUBSTRATE MAY OR MAY NOT
 * BELIEVE — and this function deliberately does not decide which.
 * `evaluatePromotion` is the only path to belief, and a draft is born
 * `CANDIDATE` with no constructor that can produce anything else. Exported so a
 * test can drive the shaping without a whole episode.
 *
 * THE SUBJECT IS THE CONCEPT ID VERBATIM. `detectGaps` looks concepts up BY ID,
 * so a record with a tidier subject is invisible to the gap detector however
 * true it is — the same trap `substrate.ts` records for its dispatch records.
 */
export function recordsFromRetrieval(
  concept: string,
  research: LocalEvidenceResearch,
  at: string,
): { readonly records: readonly KnowledgeRecord[]; readonly refusal: string | null } {
  const got = research.retrieve(concept);
  if (!got.ok) return { records: [], refusal: got.reason };
  const records = got.findings.map((f, n) =>
    draftRecord({
      subject: concept,
      predicate: "is_documented_as",
      object: f.excerpt,
      domain: ["oniq_capability"],
      provenance: retrievalProvenance(at, f.locator, concept),
      evidence: [
        makeEvidence({
          id: `ev_local_${n + 1}_${f.line}`,
          sourceId: CODEBASE_SOURCE.id,
          // A line read out of a module ONIQ is running is a reading of this
          // system, not a document about it — `conflict.ts` reads the
          // distinction and `measured_precedence` turns on it.
          sourceType: "measurement",
          sourceVersion: f.sourceVersion,
          locator: f.locator,
          contentHash: f.contentHash,
          excerpt: f.excerpt,
          extraction: f.extraction,
          directness: f.directness,
          retrievedAt: at,
          verifier: "makeLocalEvidenceResearch",
          supports: true,
        }),
      ],
      validity: { validFrom: at, validUntil: null, lastVerifiedAt: at },
      volatility: "slow",
    }),
  );
  return { records, refusal: null };
}

/**
 * A capability state in the v1.6 ledger's own vocabulary, from a §12 refusal.
 *
 * THE TRANSLATION IS NOT COSMETIC. `reconsider` returns a blocked objective to
 * `pending` once every capability it named is observed AVAILABLE, and it reads
 * this vocabulary. An episode that refused a capability and did not say so in
 * these words would leave an objective blocked with nothing to clear it.
 */
function capabilityFrom(
  id: "UPDATE_KNOWLEDGE" | "REQUEST_RESEARCH",
  ok: boolean,
  detail: string,
): CapabilityState {
  const registered = registeredCapability(id);
  return {
    capability: registered?.resource ?? "verification",
    availability: ok ? "available" : "unauthorized",
    detail,
    bound: null,
    station: id === "UPDATE_KNOWLEDGE" ? "CONSOLIDATE" : "RESEARCH",
  };
}

export function makeImprovementEpisode(
  ctx: SubstrateContext,
  deps: ImprovementDeps = {},
): RunEpisode {
  const budgets = deps.budgets ?? DEFAULT_BUDGETS;
  const durable = deps.durable ?? NO_DURABLE_STORE;
  const executor = deps.executor ?? NO_EXECUTOR;

  return async (objective: Objective, _cycle: CycleContext): Promise<EpisodeOutcome> => {
    const at = ctx.at();
    const nowMs = ctx.nowMs();
    const goal = objective.goal;
    const build: SubstrateBuild = buildSubstrate({
      at,
      nowMs,
      resolved: ctx.resolved,
      elapsedMs: ctx.elapsedMs,
    });

    // ---- RESTORE --------------------------------------------------------
    /**
     * §8's claim, exercised: the rows an EARLIER process wrote go into the SAME
     * store as this tick's rebuild, before anything is measured. Skipping this
     * when the load refuses is the honest branch — a store that cannot be read
     * has taught ONIQ nothing, and treating a read error as an empty store is
     * the silent-restart failure `durableStore.ts` names.
     */
    const loaded = await durable.load();
    const hydrated = hydrate(loaded);
    for (const r of hydrated.records) build.store.put(r);
    const restoreNote =
      hydrated.reason !== null
        ? `durable knowledge unavailable: ${hydrated.reason}`
        : `restored ${hydrated.records.length} durable record(s)` +
          (hydrated.rejected.length > 0 ? `, ${hydrated.rejected.length} rejected` : "");

    const sources = build.sources;
    const before = toKnowledgeState(build.store.all(), nowMs, sources);

    // ---- MEASURE (baseline) ---------------------------------------------
    const baselineGaps = residualUncertainty(goal, before);
    const plan = design({
      objectiveId: objective.id,
      kind: "improvement",
      hypothesis:
        `researching the concepts ${goal.id} requires, verifying what is retrieved and ` +
        `persisting it will leave fewer of that goal's concepts open`,
      baselineArm: "the substrate as this tick rebuilt it, plus whatever was already durable",
      candidateArm: "the same substrate after this episode's retrieval, promotion and persistence",
      variables: ["records promoted from retrieved evidence this episode"],
      // NAMED RATHER THAN LEFT EMPTY, because "no controls" is a real design and
      // has to be distinguishable from a design nobody thought about. Both arms
      // are the same store in the same process at the same instant; the only
      // thing that differs is what this episode put into it.
      controls: [
        "the same goal",
        "the same substrate build",
        "the same instant",
        "the same promotion policy",
      ],
      metric: GAP_METRIC,
      direction: "lower_is_better",
      criterion: { minDelta: MIN_GAP_DELTA, minSamples: GAP_SAMPLES },
      // A deterministic episode has no randomness to seed, and saying 0 is
      // honest where inventing a seed would imply a sampling this never does.
      seed: 0,
      configuration: { goal: goal.id, requires: goal.requires.map((r) => r.conceptId) },
    });
    const baseline = measurement(GAP_METRIC, baselineGaps, {
      unit: "concepts-of-doubt",
      samples: GAP_SAMPLES,
      direction: "lower_is_better",
      provenance: {
        locator: `${goal.id}#openGaps`,
        sourceVersion: null,
        contentHash: null,
        agent: "supabase/functions/_shared/oqcaRuntime/improvement.ts",
        at,
      },
    });

    // ---- IDENTIFY KNOWLEDGE GAPS ----------------------------------------
    /**
     * STALENESS COMES FROM THE STORE, THE SAME WAY THE SURVEY COMPUTES IT.
     * `knowledgeNeeds` reads it to answer `stale`, which is a verdict that does
     * NOT skip research — a record past its verification interval is exactly the
     * one where acting on the stored answer is worst.
     *
     * AND THE FIRST DRAFT OF THIS LINE READ `ctx.staleness?.()`, A FIELD
     * `SubstrateContext` HAS NEVER HAD. It typechecked — because `tsconfig.json`
     * includes `src/**` only, and this file had no importer under `src/`, so tsc
     * never loaded it. That is this repository's most-recorded failure arriving
     * in the TYPECHECKER itself, and the fix is the same one it always is: the
     * v1.7 test suite imports all four new runtime modules, which is what puts
     * them in the program at all.
     */
    const needs = knowledgeNeeds(goal, before, stalenessByConcept(build.store.all(), nowMs));
    const decision = researchDecision(needs);
    const capabilities: CapabilityState[] = [];
    /**
     * WHETHER *THIS EPISODE'S* RETRIEVAL RAN, tracked locally rather than read
     * back out of the merged capability list. The list also carries the 23
     * stations' own ledger, so scanning it for a research refusal answers a
     * different question than the one the experiment needs — which is exactly
     * the bug the live run exposed.
     */
    let retrievalRan = false;
    const learned: string[] = [];
    const persistedIds: string[] = [];
    const notes: string[] = [restoreNote, `knowledge verdict: ${decision}`];

    // ---- RESEARCH / VERIFY ----------------------------------------------
    const promoted: KnowledgeRecord[] = [];
    if (decision === "RESEARCH") {
      if (!deps.research) {
        capabilities.push(
          capabilityFrom("REQUEST_RESEARCH", false, "no research capability is wired"),
        );
        notes.push("research refused: no retrieval capability is wired to this runtime");
      } else {
        const research = deps.research;
        let searched = 0;
        for (const need of needs) {
          if (need.verdict === "known") continue;
          const { records, refusal } = recordsFromRetrieval(need.concept, research, at);
          if (refusal !== null) {
            capabilities.push(capabilityFrom("REQUEST_RESEARCH", false, refusal));
            notes.push(`research refused for ${need.concept}: ${refusal}`);
            continue;
          }
          searched += 1;
          for (const draft of records) {
            /**
             * BELIEF IS THE POLICY'S, NOT THIS FILE'S. A retrieved line reaches
             * VERIFIED only if `fetched` + `direct_quotation` from a registered
             * source clears `minConfidence`; anything weaker stays CANDIDATE,
             * is stored, and is invisible to `detectGaps` — which is the
             * correct outcome and is why `learned` counts promotions rather
             * than retrievals.
             */
            /**
             * RE-PROMOTING A RECORD ONIQ ALREADY HELD IS NOT LEARNING, and the
             * first live run reported it as such: a follow-up objective
             * re-retrieved the same three lines, re-promoted them, and
             * announced "3 learned, 3 persisted" beside a verdict of
             * NO_DIFFERENCE — the uncertainty had not moved because there was
             * nothing new to move it. That is v1.5's settled/learned over-claim
             * arriving in a second place, and §10 asks for `researched`,
             * `verified` and `learned` to stay three different things.
             *
             * The id hashes the assertion, so "already in the store" is exact:
             * the same line from the same locator is the same record. It is
             * still PUT (a re-verification refreshes its evidence) and it is
             * still persisted; it simply does not count as something this
             * episode moved.
             */
            const held = build.store.get(draft.id);
            const decided = applyPromotion(draft, evaluatePromotion(draft, sources));
            build.store.put(decided);
            if (decided.status === "VERIFIED") {
              promoted.push(decided);
              if (held === null || held.status !== "VERIFIED") learned.push(decided.subject);
            }
          }
        }
        retrievalRan = searched > 0;
        capabilities.push(
          capabilityFrom(
            "REQUEST_RESEARCH",
            retrievalRan,
            retrievalRan
              ? `retrieved over a local corpus for ${searched} concept(s)`
              : "every concept's retrieval refused",
          ),
        );
      }
    }

    // ---- UPDATE DURABLE KNOWLEDGE ---------------------------------------
    /**
     * THE §12 GATE IS CROSSED BEFORE THE WRITE, NOT AFTER IT. `executeCapability`
     * checks registration, authorization and the argument bounds; only then does
     * the store see a row. A write that happened and was then reported as
     * refused would be the worst of both — and a gate below the thing it guards
     * is the ordering mistake this repo pins in three other places.
     */
    if (promoted.length > 0) {
      const permitted = await executeCapability(
        { id: "UPDATE_KNOWLEDGE", args: { records: String(promoted.length) } },
        executor,
      );
      if (!permitted.ok) {
        capabilities.push(capabilityFrom("UPDATE_KNOWLEDGE", false, permitted.reason));
        notes.push(`knowledge update refused: ${permitted.reason}`);
      } else {
        const rows: readonly DurableRecord[] = promoted.map((r) =>
          toDurable(r, { createdAt: at, updatedAt: at }),
        );
        const saved = await durable.save(rows);
        if (saved.ok) {
          // FROM THE STORE'S OWN ANSWER. A count taken from `rows.length` would
          // report a durable write that a refusing sink never made.
          persistedIds.push(...promoted.slice(0, saved.written).map((r) => r.id));
          capabilities.push(
            capabilityFrom("UPDATE_KNOWLEDGE", true, `persisted ${saved.written} record(s)`),
          );
        } else {
          capabilities.push(capabilityFrom("UPDATE_KNOWLEDGE", false, saved.reason));
          notes.push(`durable write refused: ${saved.reason}`);
        }
      }
    }

    // ---- RUN THE 23 STATIONS --------------------------------------------
    const after = toKnowledgeState(build.store.all(), nowMs, sources);
    const initial = objectiveState(goal, budgets);
    const run = await runCognitiveLoop({
      initial,
      quantum: CognitiveState.restore(initial.quantumState),
      knowledge: after,
      budgets,
      /**
       * THE SAME ADAPTER THE EPISODE USED, so the run cannot contradict its own
       * caller. Handing station 10 a refusing adapter while retrieving here made
       * one episode report research as BOTH available and unavailable, and
       * `unavailable()` reads the refusal — so a successful retrieval was
       * invisible and every experiment came back BLOCKED.
       */
      research: deps.research?.adapter,
      // Absent leaves `REFUSING_ENGINE`, which is what a caller that has not
      // chosen to spend should get — and is what every episode got before the
      // seam existed.
      //
      // A FACTORY RATHER THAN AN ENGINE, so the caller can bind the objective.
      // `ModelCallRecord.stateId` is documented as naming the state a call was
      // made FROM, and a host outside this function cannot see the loop's state
      // ids — it CAN see which objective is running, which is the honest thing
      // for a record to name here rather than a constant that reads like a
      // state reference and is not one.
      engine: deps.engine?.(objective),
    });
    capabilities.push(...run.capabilities);

    // ---- MEASURE (candidate) + COMPARE ----------------------------------
    const candidateGaps = residualUncertainty(goal, after);
    const candidate = measurement(GAP_METRIC, candidateGaps, {
      unit: "concepts-of-doubt",
      samples: GAP_SAMPLES,
      direction: "lower_is_better",
      provenance: baseline.provenance,
    });
    /**
     * A RESEARCH REFUSAL MAKES THE EXPERIMENT `BLOCKED`, NOT `NO_DIFFERENCE`.
     * Both arms would be measured and equal, so `compare` would answer "no
     * difference" — a statement that the intervention was tried and did
     * nothing. The intervention was never tried. §11's own rule is that an
     * inconclusive result may not become a success, and its mirror is that a
     * thing that did not run may not become a measured negative.
     */
    const intervened = decision === "SKIP_RESEARCH" || retrievalRan;
    const experiment: ExperimentRecord = intervened
      ? compare(plan, baseline, candidate, at)
      : experimentBlocked(plan, "the retrieval capability refused, so nothing was intervened", at);

    // ---- LEARN / RESPOND ------------------------------------------------
    const still = openGaps(detectGaps(goal, after));
    const settled = goal.requires
      .map((r) => r.conceptId)
      .filter((c) => !still.some((g) => g.conceptId === c));
    const refused = unavailable(capabilities);

    const summary =
      `${notes.join("; ")}; residual uncertainty ${baselineGaps.toFixed(3)} -> ` +
      `${candidateGaps.toFixed(3)} (${experiment.verdict})`;

    if (still.length === 0) {
      return {
        status: "success",
        note: `every concept ${goal.id} requires is VERIFIED (loop ${run.terminated}); ${summary}`,
        blockedOn: [],
        blockedReason: null,
        capabilities,
        settled,
        learned,
        persisted: persistedIds,
        experiment,
      };
    }
    return {
      status: "blocked",
      note:
        `${still.length} of ${goal.requires.length} concepts still open ` +
        `(loop ${run.terminated}); ${summary}`,
      /**
       * A CAPABILITY REFUSAL DOES NOT BECOME A KNOWLEDGE BLOCKER, which is
       * v1.6's finding applied here: naming the concepts when the real problem
       * was a refused resource spawns a follow-up to research something nobody
       * could afford to look at, and the follow-up blocks the same way forever.
       */
      blockedOn: refused.length > 0 ? [] : still.map((g) => g.conceptId),
      blockedReason:
        refused.length > 0
          ? refused.map((c) => `${c.capability}: ${c.detail}`).join("; ")
          : still.map((g) => `${g.conceptId}: ${g.reason}`).join("; "),
      capabilities,
      settled,
      learned,
      persisted: persistedIds,
      experiment,
    };
  };
}
