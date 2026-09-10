/**
 * THE GENERAL KNOWLEDGE SUBSTRATE — the upgradation spec's §6–§12, §17, §18,
 * §21, and §15's architectural ruling that quantum is ONE DOMAIN under it.
 *
 * The core principle, in the spec's own words: **"ONIQ must distinguish
 * information it has encountered from knowledge it has verified. New evidence
 * must be able to strengthen, qualify, contradict, supersede, or invalidate
 * older knowledge."**
 *
 * Every assertion here is about a REFUSAL or a TRANSITION, because those are
 * the two things that separate this from a document store. A test that only
 * checked a record round-trips would pass on a store that believed everything.
 */
import { describe, expect, it } from "vitest";
import {
  draftRecord,
  supersede,
  assertionId,
  mayInformDecision,
  mayInformConflictAwareDecision,
  hasCompleteProvenance,
  KNOWLEDGE_STATUSES,
  UNBOUNDED_VALIDITY,
} from "../knowledge/substrate/record.ts";
import {
  makeEvidence,
  evidenceWeight,
  DIRECTNESS_WEIGHT,
  EXTRACTION_WEIGHT,
  MAX_EXCERPT,
  type RegisteredSource,
  type SourceEvidence,
} from "../knowledge/substrate/evidence.ts";
import {
  EMPTY_PROVENANCE,
  withActivity,
  isTraceable,
  provenanceGaps,
  chainSummary,
  REQUIRED_STEPS,
  PROV_CHAIN,
} from "../knowledge/substrate/provenance.ts";
import {
  STRICT_POLICY,
  scoreConfidence,
  evaluatePromotion,
  applyPromotion,
} from "../knowledge/substrate/promotion.ts";
import {
  conflicts,
  resolveConflict,
  applyResolution,
  detectConflicts,
} from "../knowledge/substrate/conflict.ts";
import {
  freshness,
  expired,
  notYetValid,
  usableNow,
  VERIFICATION_INTERVAL_MS,
} from "../knowledge/substrate/decay.ts";
import { makeLocalStore, decisionReadable } from "../knowledge/substrate/store.ts";
import {
  statement,
  toFact,
  makeSubstrateKnowledgeAdapter,
  contestedFacts,
} from "../knowledge/substrate/project.ts";
import {
  computeMetrics,
  unmeasured,
  rollbackIntegrity,
  provenanceCoverage,
  stalenessRate,
  retrievalGrounding,
  contradictionRate,
  resolutionAccuracy,
  escalationRate,
  upgradeGain,
} from "../knowledge/substrate/metrics.ts";

const NOW = Date.parse("2026-09-10T18:00:00Z");
const ISO = "2026-09-10T12:00:00Z";

const SRC: RegisteredSource = {
  id: "registry",
  title: "A registry",
  publisher: "Someone",
  homepage: "example.invalid",
  license: null,
  reliability: 1,
  domains: ["versions"],
  acquirable: true,
};

const sources = new Map<string, RegisteredSource>([[SRC.id, SRC]]);

function ev(over: Partial<SourceEvidence> = {}): SourceEvidence {
  return makeEvidence({
    id: `e${Math.round(Math.abs(Math.sin(over.excerpt?.length ?? 1)) * 1e6)}`,
    sourceId: SRC.id,
    sourceType: "package_registry",
    sourceVersion: null,
    locator: "registry://thing",
    contentHash: null,
    excerpt: "x",
    extraction: "structured_field",
    directness: "fetched",
    retrievedAt: ISO,
    verifier: null,
    supports: true,
    ...over,
  });
}

function fullProvenance() {
  let p = EMPTY_PROVENANCE;
  for (const step of REQUIRED_STEPS) {
    p = withActivity(p, { step, agent: "test", used: [], generated: "r", at: ISO, note: "" });
  }
  return p;
}

const draft = (over: Parameters<typeof draftRecord>[0]) => draftRecord(over);

describe("§6/§7 — the record, and the fact that nothing is born believed", () => {
  it("always drafts CANDIDATE, and there is no other constructor", () => {
    const r = draft({
      subject: "s",
      predicate: "p",
      object: 1,
      domain: ["d"],
      evidence: [ev()],
      provenance: fullProvenance(),
    });
    expect(r.status).toBe("CANDIDATE");
    expect(r.confidence).toBe(0);
    expect(r.version).toBe(1);
    expect(KNOWLEDGE_STATUSES).toEqual([
      "CANDIDATE",
      "VERIFIED",
      "CONTESTED",
      "SUPERSEDED",
      "REJECTED",
    ]);
  });

  it("hashes the ASSERTION and not the belief, so promotion advances a record", () => {
    const base = { subject: "s", predicate: "p", object: { a: 1, b: 2 }, domain: ["d", "e"] };
    const a = assertionId(base.subject, base.predicate, base.object, base.domain);
    // Key order and domain order must not change identity, or two writers of
    // the same fact produce two rows that can never be reconciled.
    const b = assertionId("s", "p", { b: 2, a: 1 }, ["e", "d"]);
    expect(a).toBe(b);
    // A different OBJECT is a different assertion.
    expect(assertionId("s", "p", { a: 1, b: 3 }, ["d"])).not.toBe(a);
    const r = draft({ ...base, evidence: [ev()] });
    const promoted = applyPromotion(r, { outcome: "VERIFIED", confidence: 0.9, reasons: [] });
    expect(promoted.id).toBe(r.id);
  });

  it("mayInformDecision admits VERIFIED only; CONTESTED needs an opt-in by name", () => {
    expect(mayInformDecision("VERIFIED")).toBe(true);
    for (const s of ["CANDIDATE", "CONTESTED", "SUPERSEDED", "REJECTED"] as const) {
      expect(mayInformDecision(s), s).toBe(false);
    }
    expect(mayInformConflictAwareDecision("CONTESTED")).toBe(true);
    expect(mayInformConflictAwareDecision("REJECTED")).toBe(false);
  });

  it("supersession KEEPS the loser and increments the version", () => {
    const older = draft({
      subject: "s",
      predicate: "p",
      object: 1,
      domain: ["d"],
      evidence: [ev()],
    });
    const newer = draft({
      subject: "s",
      predicate: "p",
      object: 1,
      domain: ["d"],
      evidence: [ev({ excerpt: "yy" })],
    });
    const { retired, current } = supersede(older, newer);
    expect(retired.status).toBe("SUPERSEDED");
    expect(retired.supersededBy).toBe(newer.id);
    expect(current.version).toBe(2);
    // Two DIFFERENT assertions are a conflict, never a supersession.
    const other = draft({
      subject: "s",
      predicate: "p",
      object: 2,
      domain: ["d"],
      evidence: [ev()],
    });
    expect(() => supersede(older, other)).toThrow(/same assertion id/);
  });

  it("refuses a record with no subject, predicate or domain", () => {
    expect(() =>
      draft({ subject: "", predicate: "p", object: 1, domain: ["d"], evidence: [] }),
    ).toThrow();
    expect(() =>
      draft({ subject: "s", predicate: "p", object: 1, domain: [], evidence: [] }),
    ).toThrow(/domain/);
  });
});

describe("§9 — provenance, and the weight that makes recall worthless", () => {
  it("recalled evidence is worth exactly zero, whatever the publisher", () => {
    expect(DIRECTNESS_WEIGHT.recalled).toBe(0);
    // MULTIPLICATIVE, so a five-star source cannot rescue it. That inversion
    // is the point: a confident memory must not outrank a real reading.
    expect(evidenceWeight(ev({ directness: "recalled" }), SRC)).toBe(0);
    expect(evidenceWeight(ev({ directness: "fetched" }), SRC)).toBe(1);
    expect(EXTRACTION_WEIGHT.model_extraction).toBeLessThan(EXTRACTION_WEIGHT.structured_field);
  });

  it("refuses evidence with no locator, a bad instant or an oversized excerpt", () => {
    expect(() => makeEvidence({ ...ev(), locator: "" })).toThrow(/locator/);
    expect(() => makeEvidence({ ...ev(), retrievedAt: "not a date" })).toThrow(/ISO 8601/);
    expect(() => makeEvidence({ ...ev(), excerpt: "x".repeat(MAX_EXCERPT + 1) })).toThrow(
      /excerpt/,
    );
  });

  it("traceability needs the four required steps, and names the missing ones", () => {
    expect(isTraceable(EMPTY_PROVENANCE)).toBe(false);
    expect(provenanceGaps(EMPTY_PROVENANCE)).toEqual([...REQUIRED_STEPS]);
    const p = fullProvenance();
    expect(isTraceable(p)).toBe(true);
    expect(provenanceGaps(p)).toEqual([]);
    // VALIDATION IS DELIBERATELY NOT REQUIRED for traceability: a claim can be
    // fully traced and not yet validated, and conflating the two would make
    // "where did this come from" unanswerable for anything unvalidated.
    expect(REQUIRED_STEPS).not.toContain("validation");
    expect(PROV_CHAIN).toContain("validation");
    expect(chainSummary(p).length).toBeGreaterThan(0);
  });
});

describe("§21 — promotion is the only door to belief, and it refuses by name", () => {
  const good = () =>
    draft({
      subject: "pkg",
      predicate: "hasVersion",
      object: "1.0",
      domain: ["versions"],
      evidence: [ev()],
      provenance: fullProvenance(),
    });

  it("promotes one first-hand item and says so", () => {
    const d = evaluatePromotion(good(), sources);
    expect(d.outcome).toBe("VERIFIED");
    expect(d.reasons).toEqual([]);
    expect(d.confidence).toBeCloseTo(0.5, 6);
  });

  it("the threshold is REACHABLE by the evidence the policy admits", () => {
    // `w / (w + 1)` maps a weight of [0,1] onto [0,0.5], so any minConfidence
    // above 0.5 is unreachable for ANY single item and silently means "two
    // sources" — which the first draft's 0.6 did, contradicting
    // `minIndependentSources: 1`. Found by the quantum ingestion coming back
    // 113/113 CANDIDATE at exactly 0.500.
    expect(STRICT_POLICY.minIndependentSources).toBe(1);
    expect(STRICT_POLICY.minConfidence).toBeLessThanOrEqual(0.5);
    const oneComputed = draft({
      subject: "gate",
      predicate: "isUnitary",
      object: true,
      domain: ["algebra"],
      evidence: [ev({ directness: "derived", extraction: "computed" })],
      provenance: fullProvenance(),
    });
    expect(evaluatePromotion(oneComputed, sources).outcome).toBe("VERIFIED");
    // And a single SECOND-HAND item still is not enough.
    const oneCited = draft({
      subject: "x",
      predicate: "y",
      object: 1,
      domain: ["d"],
      evidence: [ev({ directness: "spec_cited", extraction: "human_authored" })],
      provenance: fullProvenance(),
    });
    expect(evaluatePromotion(oneCited, sources).outcome).toBe("CANDIDATE");
  });

  it("REJECTS a recalled-only claim and a model-only claim, by name", () => {
    const recalled = draft({
      subject: "x",
      predicate: "y",
      object: 1,
      domain: ["d"],
      evidence: [ev({ directness: "recalled" })],
      provenance: fullProvenance(),
    });
    const d1 = evaluatePromotion(recalled, sources);
    expect(d1.outcome).toBe("REJECTED");
    expect(d1.reasons.join(" ")).toMatch(/recalled from training/);

    const modelOnly = draft({
      subject: "x",
      predicate: "y",
      object: 1,
      domain: ["d"],
      evidence: [ev({ extraction: "model_extraction" })],
      provenance: fullProvenance(),
    });
    const d2 = evaluatePromotion(modelOnly, sources);
    expect(d2.outcome).toBe("REJECTED");
    expect(d2.reasons.join(" ")).toMatch(/deterministic corroborator/);
  });

  it("refuses without provenance, and reports EVERY reason not the first", () => {
    const bare = draft({ subject: "x", predicate: "y", object: 1, domain: ["d"], evidence: [] });
    const d = evaluatePromotion(bare, sources);
    expect(d.outcome).toBe("CANDIDATE");
    expect(d.reasons.length).toBeGreaterThan(1);
    expect(d.reasons.join(" ")).toMatch(/provenance chain is incomplete/);
    expect(hasCompleteProvenance(bare)).toBe(false);
  });

  it("evidence on BOTH sides is CONTESTED, not merely weak", () => {
    const both = draft({
      subject: "x",
      predicate: "y",
      object: 1,
      domain: ["d"],
      evidence: [ev(), ev({ excerpt: "against", supports: false })],
      provenance: fullProvenance(),
    });
    expect(evaluatePromotion(both, sources).outcome).toBe("CONTESTED");
  });

  it("confidence saturates, so twenty mediocre sources cannot out-vote one good one", () => {
    const many = draft({
      subject: "x",
      predicate: "y",
      object: 1,
      domain: ["d"],
      evidence: Array.from({ length: 20 }, (_, i) =>
        ev({ id: `m${i}`, directness: "search_snippet", extraction: "model_extraction" }),
      ),
      provenance: fullProvenance(),
    });
    expect(scoreConfidence(many, sources)).toBeLessThan(1);
    // Refuting weight subtracts, and a net of zero is a confidence of zero.
    const cancelled = draft({
      subject: "x",
      predicate: "y",
      object: 1,
      domain: ["d"],
      evidence: [ev(), ev({ id: "no", supports: false })],
      provenance: fullProvenance(),
    });
    expect(scoreConfidence(cancelled, sources)).toBe(0);
  });
});

describe("§8 — conflict, and the loser that is never deleted", () => {
  const mk = (object: unknown, weightDirect: SourceEvidence["directness"]) =>
    applyPromotion(
      draft({
        subject: "pkg",
        predicate: "hasVersion",
        object,
        domain: ["versions"],
        evidence: [ev({ id: `c${String(object)}`, directness: weightDirect })],
        provenance: fullProvenance(),
      }),
      { outcome: "VERIFIED", confidence: 0.5, reasons: [] },
    );

  it("detects a conflict as same subject+predicate, different object", () => {
    const a = mk("1.0", "fetched");
    const b = mk("2.0", "spec_cited");
    expect(conflicts(a, b)).toBe(true);
    expect(conflicts(a, a)).toBe(false);
    expect(detectConflicts([a, b]).length).toBe(1);
  });

  it("prefers the heavier evidence and NEVER deletes the loser", () => {
    const a = mk("1.0", "fetched");
    const b = mk("2.0", "spec_cited");
    const c = resolveConflict([a, b], { sources, nowMs: NOW });
    expect(c.canonical).toBe(a.id);
    expect(c.strategy).toBe("evidence_weight");
    const after = applyResolution([a, b], c);
    expect(after.length).toBe(2);
    expect(after.find((r) => r.id === b.id)!.status).not.toBe("VERIFIED");
    expect(after.find((r) => r.id === a.id)!.status).toBe("VERIFIED");
  });

  it("escalates rather than guessing when the margin is not met", () => {
    const a = mk("1.0", "fetched");
    const b = mk("2.0", "fetched");
    const c = resolveConflict([a, b], { sources, nowMs: NOW });
    expect(c.escalated).toBe(true);
    expect(c.canonical).toBeNull();
  });

  it("divergent_by_design is not resolved at all, and keeps both", () => {
    const a = mk("big-endian", "fetched");
    const b = mk("little-endian", "fetched");
    const c = resolveConflict([a, b], { sources, nowMs: NOW }, "divergent_by_design");
    expect(c.canonical).toBeNull();
    expect(c.rationale).toMatch(/both are kept/);
    const after = applyResolution([a, b], c);
    expect(after.length).toBe(2);
  });

  it("refuses to resolve fewer than two records", () => {
    expect(() => resolveConflict([mk("1.0", "fetched")], { sources, nowMs: NOW })).toThrow(
      /two records/,
    );
  });
});

describe("§10 — decay, and freshness that is never mistaken for confidence", () => {
  const withVerified = (
    v: Parameters<typeof draftRecord>[0]["volatility"],
    lastVerifiedAt: string | null,
  ) =>
    draft({
      subject: "s",
      predicate: "p",
      object: 1,
      domain: ["d"],
      evidence: [ev()],
      volatility: v,
      validity: { ...UNBOUNDED_VALIDITY, lastVerifiedAt },
    });

  it("treats unknown volatility as the SHORTEST interval, not the most forgiving", () => {
    // The spec: "Unknown freshness: treat as stale until verified."
    expect(VERIFICATION_INTERVAL_MS.unknown).toBe(0);
    expect(VERIFICATION_INTERVAL_MS.stable).toBeGreaterThan(VERIFICATION_INTERVAL_MS.slow);
    expect(VERIFICATION_INTERVAL_MS.slow).toBeGreaterThan(VERIFICATION_INTERVAL_MS.fast);
  });

  it("a never-verified record is stale and says why", () => {
    const f = freshness(withVerified("stable", null), NOW);
    expect(f.stale).toBe(true);
    expect(f.reason).toMatch(/never verified/);
    expect(f.ageMs).toBeNull();
  });

  it("a fast record goes stale in a day and a stable one does not", () => {
    const twoDays = new Date(NOW - 2 * 86_400_000).toISOString();
    expect(freshness(withVerified("fast", twoDays), NOW).stale).toBe(true);
    expect(freshness(withVerified("stable", twoDays), NOW).stale).toBe(false);
  });

  it("validity windows bite in both directions", () => {
    const past = draft({
      subject: "s",
      predicate: "p",
      object: 1,
      domain: ["d"],
      evidence: [ev()],
      validity: { validFrom: null, validUntil: "2020-01-01T00:00:00Z", lastVerifiedAt: ISO },
    });
    expect(expired(past, NOW)).toBe(true);
    const future = draft({
      subject: "s",
      predicate: "p",
      object: 1,
      domain: ["d"],
      evidence: [ev()],
      validity: { validFrom: "2030-01-01T00:00:00Z", validUntil: null, lastVerifiedAt: ISO },
    });
    expect(notYetValid(future, NOW)).toBe(true);
    expect(
      usableNow(applyPromotion(future, { outcome: "VERIFIED", confidence: 1, reasons: [] }), NOW),
    ).toBe(false);
  });
});

describe("§12/§17 — the store replays, and the projection feeds the loop", () => {
  const verified = (subject: string, object: unknown) =>
    applyPromotion(
      draft({
        subject,
        predicate: "is",
        object,
        domain: ["quantum"],
        evidence: [ev({ id: `s_${subject}` })],
        provenance: fullProvenance(),
        volatility: "stable",
        validity: { ...UNBOUNDED_VALIDITY, lastVerifiedAt: ISO },
      }),
      { outcome: "VERIFIED", confidence: 0.8, reasons: [] },
    );

  it("reads deterministically and replays every prefix", () => {
    const store = makeLocalStore();
    store.put(verified("zebra", 1));
    store.put(verified("apple", 2));
    expect(store.all().map((r) => r.subject)).toEqual(store.all().map((r) => r.subject));
    expect(store.journal().length).toBe(2);
    expect(store.replayTo(1).length).toBe(1);
    expect(store.replayTo(2).length).toBe(2);
    expect(rollbackIntegrity(store)).toBe(1);
  });

  it("a supersession keeps the retired row AND leaves the current one current", () => {
    // §21: "Do not erase historical knowledge." The retired row lived under
    // the SAME key as its replacement until this test was written — and
    // `supersede()` requires the ids to be equal, so the second write always
    // overwrote the first and no retired row had ever survived a read.
    const store = makeLocalStore();
    const a = verified("pkg", 1);
    store.put(a);
    store.supersedeWith(a, a);
    expect(store.get(a.id)!.status).toBe("VERIFIED");
    expect(store.get(a.id)!.version).toBe(2);
    expect(store.all().length).toBe(1);
    const history = store.history();
    expect(history.length).toBe(1);
    expect(history[0].status).toBe("SUPERSEDED");
    expect(history[0].version).toBe(1);
    expect(history[0].supersededBy).toBe(a.id);
    expect(store.journal().length).toBe(2);
  });

  it("decisionReadable admits only what is verified AND fresh", () => {
    const store = makeLocalStore();
    store.put(verified("fresh", 1));
    const stale = applyPromotion(
      draft({
        subject: "stale",
        predicate: "is",
        object: 2,
        domain: ["quantum"],
        evidence: [ev({ id: "st" })],
        volatility: "fast",
        validity: { ...UNBOUNDED_VALIDITY, lastVerifiedAt: "2020-01-01T00:00:00Z" },
      }),
      { outcome: "VERIFIED", confidence: 0.8, reasons: [] },
    );
    store.put(stale);
    // STALENESS IS NOT UNUSABILITY, and `decay.ts` says so deliberately: the
    // spec's §10 is "Freshness must never be confused with confidence", so
    // `usableNow` reads the STATUS and the validity window and leaves
    // freshness to the metric. A stale-but-valid record still informs a
    // decision, and `stalenessRate` is what reports how much of the store is
    // in that state. Asserted here so the contract cannot drift either way.
    const readable = decisionReadable(store, "quantum", NOW)
      .map((r) => r.subject)
      .sort();
    expect(readable).toEqual(["fresh", "stale"]);
    expect(freshness(stale, NOW).stale).toBe(true);
    expect(stalenessRate(store, NOW)).toBeCloseTo(0.5, 6);

    // What DOES leave it out is an expired validity window, so the two are
    // genuinely different gates rather than one that never fires.
    const gone = applyPromotion(
      draft({
        subject: "expired",
        predicate: "is",
        object: 3,
        domain: ["quantum"],
        evidence: [ev({ id: "ex" })],
        validity: { validFrom: null, validUntil: "2020-01-01T00:00:00Z", lastVerifiedAt: ISO },
      }),
      { outcome: "VERIFIED", confidence: 0.8, reasons: [] },
    );
    store.put(gone);
    expect(decisionReadable(store, "quantum", NOW).map((r) => r.subject)).not.toContain("expired");
  });

  it("the v1.3 seam honours its limit and never returns a fact with no source", async () => {
    const store = makeLocalStore();
    for (const s of ["alpha thing", "beta thing", "gamma thing"]) store.put(verified(s, 1));
    const adapter = makeSubstrateKnowledgeAdapter(store, () => NOW);
    const hits = await adapter.lookup("thing", 2);
    expect(hits.length).toBe(2);
    for (const h of hits) expect(h.sourceRef.length).toBeGreaterThan(0);
    // A query matching nothing returns nothing rather than everything.
    expect((await adapter.lookup("unrelated", 5)).length).toBe(0);
    expect(statement(verified("alpha thing", 1))).toMatch(/alpha thing/);
    expect(toFact(verified("x", 1)).sourceRef.length).toBeGreaterThan(0);
  });

  it("contested facts arrive only through the opt-in, and are labelled", () => {
    const store = makeLocalStore();
    const c = applyPromotion(
      draft({
        subject: "convention",
        predicate: "is",
        object: "big-endian",
        domain: ["quantum"],
        evidence: [ev({ id: "c1" }), ev({ id: "c2", supports: false })],
        provenance: fullProvenance(),
        validity: { ...UNBOUNDED_VALIDITY, lastVerifiedAt: ISO },
      }),
      { outcome: "CONTESTED", confidence: 0.3, reasons: ["both sides"] },
    );
    store.put(c);
    expect(decisionReadable(store, "quantum", NOW).length).toBe(0);
    const opted = contestedFacts(store);
    expect(opted.length).toBe(1);
    expect(opted[0].statement).toMatch(/^\[CONTESTED\]/);
  });
});

describe("§18 — the ten metrics, each driven off its trivial answer", () => {
  const store = makeLocalStore();
  const v = (subject: string) =>
    applyPromotion(
      draft({
        subject,
        predicate: "is",
        object: 1,
        domain: ["d"],
        evidence: [ev({ id: `m_${subject}` })],
        provenance: fullProvenance(),
        volatility: "stable",
        validity: { ...UNBOUNDED_VALIDITY, lastVerifiedAt: ISO },
      }),
      { outcome: "VERIFIED", confidence: 0.8, reasons: [] },
    );
  const a = v("a");
  const b = v("b");
  store.put(a);
  store.put(b);

  it("returns null — never zero — for the four that need a labelled set", () => {
    const m = computeMetrics(store, { nowMs: NOW });
    expect([...unmeasured(m)].sort()).toEqual([
      "falsePromotionRate",
      "knowledgePrecision",
      "knowledgeRecall",
      "resolutionAccuracy",
      "upgradeGain",
    ]);
    // A dashboard that rendered these as 0 would be showing five fabricated
    // numbers, which is the failure §21's "do not confuse confidence with
    // truth" is about.
    expect(m.knowledgePrecision).toBeNull();
  });

  it("computes precision, recall and the false-promotion rate once labelled", () => {
    const labels = [
      { recordId: a.id, correct: true },
      { recordId: b.id, correct: false },
      { recordId: "never_stored", correct: true },
    ];
    const m = computeMetrics(store, { nowMs: NOW, labels });
    expect(m.knowledgePrecision).toBeCloseTo(0.5, 6);
    expect(m.falsePromotionRate).toBeCloseTo(0.5, 6);
    // RECALL'S DENOMINATOR IS EVERY TRUE LABEL, including the one the store
    // never held — a recall counting only present records is a precision.
    expect(m.knowledgeRecall).toBeCloseTo(0.5, 6);
  });

  it("provenance coverage falls when a record has no chain", () => {
    expect(provenanceCoverage(store)).toBe(1);
    const s2 = makeLocalStore();
    s2.put(a);
    s2.put(draft({ subject: "bare", predicate: "p", object: 1, domain: ["d"], evidence: [] }));
    expect(provenanceCoverage(s2)).toBeCloseTo(0.5, 6);
  });

  it("staleness rises when a fast record ages", () => {
    expect(stalenessRate(store, NOW)).toBe(0);
    const s2 = makeLocalStore();
    s2.put(
      applyPromotion(
        draft({
          subject: "old",
          predicate: "p",
          object: 1,
          domain: ["d"],
          evidence: [ev({ id: "o" })],
          volatility: "fast",
          validity: { ...UNBOUNDED_VALIDITY, lastVerifiedAt: "2020-01-01T00:00:00Z" },
        }),
        { outcome: "VERIFIED", confidence: 0.8, reasons: [] },
      ),
    );
    expect(stalenessRate(s2, NOW)).toBe(1);
  });

  it("grounding falls when an answer cites something unverified", () => {
    expect(retrievalGrounding(store, [a.id, b.id])).toBe(1);
    expect(retrievalGrounding(store, [a.id, "made_up"])).toBeCloseTo(0.5, 6);
    // No citations at all is 1 by convention: nothing was claimed.
    expect(retrievalGrounding(store, [])).toBe(1);
  });

  it("contradiction rate is per thousand, and rises with conflicts", () => {
    expect(contradictionRate(store, [])).toBe(0);
    const c = resolveConflict([a, { ...b, subject: a.subject, predicate: a.predicate }], {
      sources,
      nowMs: NOW,
    });
    expect(contradictionRate(store, [c])).toBeCloseTo(500, 3);
  });

  it("an ESCALATED conflict is excluded from resolution accuracy, not scored wrong", () => {
    // Scoring a refusal-to-guess as wrong would push the resolver towards
    // guessing, which is exactly backwards.
    const escalated = {
      ...resolveConflict([a, { ...b, subject: a.subject, predicate: a.predicate }], {
        sources,
        nowMs: NOW,
      }),
      escalated: true,
      canonical: null,
    };
    expect(
      resolutionAccuracy([escalated], [{ conflictId: escalated.id, canonical: a.id }]),
    ).toBeNull();
    expect(escalationRate([escalated])).toBe(1);
    const decided = { ...escalated, escalated: false, canonical: a.id };
    expect(resolutionAccuracy([decided], [{ conflictId: decided.id, canonical: a.id }])).toBe(1);
    expect(resolutionAccuracy([decided], [{ conflictId: decided.id, canonical: b.id }])).toBe(0);
  });

  it("upgrade gain is the caller's scores, and null when either is missing", () => {
    expect(upgradeGain(0.4, 0.7)).toBeCloseTo(0.3, 9);
    expect(upgradeGain(null, 0.7)).toBeNull();
    expect(
      computeMetrics(store, { nowMs: NOW, taskScoreBefore: 0.2, taskScoreAfter: 0.5 }).upgradeGain,
    ).toBeCloseTo(0.3, 9);
  });

  it("rollback integrity distinguishes a store that replays from one that does not", () => {
    expect(rollbackIntegrity(makeLocalStore())).toBe(1);
    expect(rollbackIntegrity(store)).toBe(1);
    // A STUB THAT IGNORES ITS JOURNAL scores less than 1, so the metric is not
    // satisfiable by returning the current state every time. It scored a
    // perfect 1 against the first version of this metric, which compared each
    // prefix against another replay instead of against the journal.
    const fake = { ...store, replayTo: () => store.all() };
    expect(rollbackIntegrity(fake)).toBeLessThan(1);
    // And one that returns nothing is caught too, from the other side.
    const empty = { ...store, replayTo: () => [] };
    expect(rollbackIntegrity(empty)).toBeLessThan(1);
  });
});
