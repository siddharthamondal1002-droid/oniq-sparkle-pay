/**
 * PROMOTION — spec §7 and §21, and this is the file the whole substrate exists
 * to make possible.
 *
 * §21's rules, each of which is a refusal here rather than a comment:
 *   "Do not promote a claim without provenance."
 *   "Do not let an LLM alone decide factual truth. Models may propose/extract;
 *    deterministic validators and evidence policies must constrain promotion."
 *   "Do not confuse confidence with truth."
 *
 * NOTHING ELSE IN THE SUBSTRATE MAY SET `status: "VERIFIED"`. `draftRecord`
 * always returns CANDIDATE and there is no other constructor — so a claim
 * reaches belief through this policy or it does not reach belief. That is the
 * difference between a knowledge system and a document store, and it is
 * structural rather than a convention someone has to remember.
 */
import type { KnowledgeRecord } from "./record.ts";
import { hasCompleteProvenance } from "./record.ts";
import type { RegisteredSource, SourceEvidence } from "./evidence.ts";
import { evidenceWeight } from "./evidence.ts";

export type PromotionPolicy = {
  /** Confidence a record must reach. */
  readonly minConfidence: number;
  /** How many INDEPENDENT sources must support it. */
  readonly minIndependentSources: number;
  /** Must §9's chain be complete? Off only for a deliberately loose domain. */
  readonly requireProvenance: boolean;
  /**
   * May a model's own extraction be the sole support? §21 says no, so this
   * defaults false and the test suite mutates it to prove the rule bites.
   */
  readonly allowModelOnlyEvidence: boolean;
};

/**
 * THE DEFAULT IS THE STRICT ONE. A loose default would be the policy in force
 * everywhere nobody thought about it, which is where a wrong fact gets in.
 *
 * `minIndependentSources: 1` is not a contradiction of that: for a great many
 * true statements there IS only one authority (a package registry is the
 * authority on that package's version), and demanding two would either block
 * every such fact or invite a fake second source. Independence is enforced on
 * the axis that matters — `allowModelOnlyEvidence: false` — rather than by a
 * count that is easy to satisfy dishonestly.
 */
/*
 * AND `minConfidence` IS 0.45 BECAUSE THE CURVE PUTS EVERY SINGLE-SOURCE FACT
 * IN THE BOTTOM HALF — measured, not chosen. `w / (w + 1)` maps a weight of
 * [0, 1] onto a confidence of [0, 0.5], so the FIRST draft's 0.6 was a
 * threshold no admissible single item could ever reach, and it silently meant
 * "at least two sources" while `minIndependentSources` said one. The comment
 * above and the number below disagreed, and the number wins in production.
 *
 * Found by running the quantum ingestion, not by this module's own tests: all
 * 113 records came back CANDIDATE at exactly 0.500 with the reason
 * "confidence 0.500 below 0.6". A test written after the code would have
 * asserted whatever the code did.
 *
 * The arithmetic the number is set from, so a future edit can check it rather
 * than re-derive it:
 *
 *   fetched  + structured_field + reliability 1.0   w 1.000 -> 0.500   admit
 *   derived  + computed         + reliability 1.0   w 0.855 -> 0.461   admit
 *   search_snippet + parse      + reliability 0.9   w 0.513 -> 0.339   refuse
 *   spec_cited + human_authored + reliability 0.9   w 0.360 -> 0.265   refuse
 *   3 x spec_cited                                  w 1.080 -> 0.519   admit
 *   anything recalled                               w 0     -> 0       refuse
 *
 * So: ONE first-hand item — a real fetch, or a computation this repo ran —
 * verifies. Second-hand items need three of them. That is the policy the
 * prose always described; 0.45 is where the curve puts it.
 */
export const STRICT_POLICY: PromotionPolicy = {
  minConfidence: 0.45,
  minIndependentSources: 1,
  requireProvenance: true,
  allowModelOnlyEvidence: false,
};

/**
 * Confidence from evidence. A DECISION SIGNAL, never a probability of truth —
 * §21. Supporting weight net of refuting weight, squashed into [0,1).
 *
 * IT SATURATES RATHER THAN SUMMING WITHOUT BOUND, so twenty mediocre sources
 * cannot out-vote one authoritative one by sheer count. The shape is
 * `w / (w + 1)`: one unit of good evidence reaches 0.5, three reach 0.75, and
 * nothing ever reaches 1 — because "certain" is not a state evidence can
 * produce and a system that could reach it would have no room to be corrected.
 */
export function scoreConfidence(
  r: KnowledgeRecord,
  sources: ReadonlyMap<string, RegisteredSource>,
): number {
  let support = 0;
  let refute = 0;
  for (const e of r.evidence) {
    const w = evidenceWeight(e, sources.get(e.sourceId) ?? null);
    if (e.supports) support += w;
    else refute += w;
  }
  const net = support - refute;
  if (net <= 0) return 0;
  return net / (net + 1);
}

export type PromotionOutcome = "VERIFIED" | "CONTESTED" | "REJECTED" | "CANDIDATE";

export type PromotionDecision = {
  readonly outcome: PromotionOutcome;
  readonly confidence: number;
  /** Every reason, not the first — an operator needs all of them to fix it. */
  readonly reasons: readonly string[];
};

function independentSources(evidence: readonly SourceEvidence[]): number {
  return new Set(evidence.filter((e) => e.supports).map((e) => e.sourceId)).size;
}

/**
 * The gate. Every refusal is NAMED, because "not promoted" with no reason is
 * the diagnostic failure this repo has a receipt for — a message that stands in
 * for the sentence underneath it.
 */
export function evaluatePromotion(
  r: KnowledgeRecord,
  sources: ReadonlyMap<string, RegisteredSource>,
  policy: PromotionPolicy = STRICT_POLICY,
): PromotionDecision {
  const reasons: string[] = [];
  const confidence = scoreConfidence(r, sources);

  const supporting = r.evidence.filter((e) => e.supports);
  if (supporting.length === 0) reasons.push("no supporting evidence");

  // RECALLED EVIDENCE IS WORTH ZERO AND SAYS SO. `evidenceWeight` already
  // multiplies it out, but a claim supported ONLY by recall must be refused by
  // NAME rather than merely scoring low — otherwise a generous policy could
  // let it through and nobody would see why.
  if (supporting.length > 0 && supporting.every((e) => e.directness === "recalled")) {
    reasons.push("every supporting item is recalled from training, which is not evidence");
  }

  if (!policy.allowModelOnlyEvidence && supporting.length > 0) {
    const deterministic = supporting.some((e) => e.extraction !== "model_extraction");
    if (!deterministic) {
      reasons.push("only a model proposed this; §21 requires a deterministic corroborator");
    }
  }

  if (policy.requireProvenance && !hasCompleteProvenance(r)) {
    reasons.push("provenance chain is incomplete");
  }

  const n = independentSources(r.evidence);
  if (n < policy.minIndependentSources) {
    reasons.push(`${n} independent source(s), policy requires ${policy.minIndependentSources}`);
  }

  if (confidence < policy.minConfidence) {
    reasons.push(`confidence ${confidence.toFixed(3)} below ${policy.minConfidence}`);
  }

  // A record with real evidence on BOTH sides is not a weak record — it is a
  // contested one, and that is a different outcome with different handling.
  const refuting = r.evidence.filter((e) => !e.supports);
  if (refuting.length > 0 && supporting.length > 0) {
    return {
      outcome: "CONTESTED",
      confidence,
      reasons: [...reasons, "credible evidence exists on both sides"],
    };
  }

  if (reasons.length === 0) return { outcome: "VERIFIED", confidence, reasons: [] };

  // REFUSING IS NOT REJECTING. A record that merely lacks evidence stays a
  // CANDIDATE and may be promoted later when more arrives; REJECTED is
  // reserved for a record that FAILED — refuted, or unsupportable in principle.
  const fatal = reasons.some(
    (m) => m.startsWith("every supporting item is recalled") || m.startsWith("only a model"),
  );
  return { outcome: fatal ? "REJECTED" : "CANDIDATE", confidence, reasons };
}

/**
 * Applies a decision. The record's CONFIDENCE is always written back even when
 * the outcome is a refusal — an operator asking "how close was it?" needs the
 * number, and recomputing it elsewhere is how two answers appear.
 */
export function applyPromotion(r: KnowledgeRecord, d: PromotionDecision): KnowledgeRecord {
  return { ...r, confidence: d.confidence, status: d.outcome };
}
