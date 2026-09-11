/**
 * THE RESEARCH ADAPTER — v1.3 section 12: "Never fabricate research."
 *
 * IT REFUSES, AND THAT IS THE WHOLE FILE. ONIQ has exactly one thing shaped
 * like research — `smart-scout`, which reaches a search-capable model — and it
 * is a LIVE, PAID, user-facing path. Wiring a scheduled cognitive tick into it
 * would be a provider-and-payment decision, which is the owner's under
 * CLAUDE.md's first rule and not an engineering call; and it would spend on
 * every tick, unattended, on a question the loop chose for itself.
 *
 * WHY THIS IS A REFUSAL AND NOT AN EMPTY RESULT, which is the only design
 * decision here worth arguing about: `ResearchResult` is a union so that
 * "I researched this and found nothing" and "I cannot research" are DIFFERENT
 * answers. An adapter that returned `{ ok: true, findings: [] }` would be
 * stating a negative result it never established — a fabricated finding, which
 * is exactly what section 12 forbids, arriving through the one door nobody
 * watches.
 *
 * The RESEARCH station turns this refusal into a KNOWLEDGE failure and hands it
 * to the recovery ladder with `researchAvailable: false`, so the ladder replans
 * instead of recommending the step that just refused.
 */
import type { ResearchAdapter, ResearchResult } from "../oqca/loop/seams.ts";
import type { Directness, ExtractionMethod } from "../oqca/knowledge/substrate/evidence.ts";

export const RESEARCH_GAP =
  "no research capability is wired to a scheduled cognitive run: ONIQ's only " +
  "search-capable path is smart-scout, which is paid and user-facing, and " +
  "pointing an unattended loop at it is a spend decision the owner has not made";

export type ResearchContext = {
  readonly record: (note: { question: string; reason: string }) => void;
};

export function makeResearch(ctx: ResearchContext): ResearchAdapter {
  return {
    investigate: async (question) => {
      ctx.record({ question, reason: RESEARCH_GAP });
      return { ok: false, reason: RESEARCH_GAP };
    },
  };
}

/* ================================================================ *
 * v1.7 §9 — RESEARCH THAT RETRIEVES, RATHER THAN RESEARCH THAT ANSWERS
 * ================================================================ */

/**
 * Owner directive 2026-09-11 §9: research means _"retrieve evidence, extract
 * claims, record source, record provenance, verify"_, and NOT _"generate a
 * plausible answer"_. The refusal above stands for the EXTERNAL, paid kind. But
 * there is a corpus ONIQ can honestly retrieve from for nothing: its own
 * repository, which the host can read and hash.
 *
 * SO THIS IS A REAL RETRIEVAL AND IT COSTS $0. Every finding is a VERBATIM line
 * from a document the host supplied, with that document's locator, its version
 * and its content hash travelling alongside — which is exactly the four fields
 * `SourceEvidence` demands, and it is why a finding from here is admissible as
 * `fetched` + `direct_quotation` while anything this runtime merely recalled is
 * `recalled` and weighs zero.
 *
 * AND AN EMPTY RESULT HERE IS AN ESTABLISHED NEGATIVE, WHICH IS WHY IT IS `ok`.
 * That is the one place this file departs from `makeResearch`'s reasoning, and
 * the difference is that the corpus is FINITE AND IN HAND: "I read these N
 * documents and none of them says anything about X" is a result, not a guess.
 * An EMPTY corpus is different again and refuses — searching nothing establishes
 * nothing — and so does a question with no usable term in it.
 */
export type CorpusDocument = {
  /** A path or URL. What `SourceEvidence.locator` will carry. */
  readonly locator: string;
  /** The revision this text was read at, when the host knows one. */
  readonly sourceVersion: string | null;
  /** An integrity handle over the bytes read. Never invented — null is legal. */
  readonly contentHash: string | null;
  readonly text: string;
};

export type EvidenceFinding = {
  readonly question: string;
  readonly locator: string;
  readonly sourceVersion: string | null;
  readonly contentHash: string | null;
  /** VERBATIM. The line as it stands in the document, bounded but never reworded. */
  readonly excerpt: string;
  /** 1-based, so a reader can go and look. */
  readonly line: number;
  readonly directness: Directness;
  readonly extraction: ExtractionMethod;
};

export type EvidenceRetrieval =
  | { readonly ok: true; readonly findings: readonly EvidenceFinding[]; readonly searched: number }
  | { readonly ok: false; readonly reason: string };

/** An excerpt long enough to be checkable and short enough to stay an excerpt. */
export const MAX_LOCAL_EXCERPT = 400;
/** Shorter terms match everything; `is`, `to`, `id` would hit every line. */
export const MIN_TERM_LENGTH = 3;
/** One question may not mine a corpus for an unbounded pile of agreement. */
export const MAX_LOCAL_FINDINGS = 3;
/**
 * HOW MUCH A LINE MUST SAY BEYOND THE WORDS OF THE QUESTION, in characters.
 *
 * MEASURED ON THE FIRST FOUR-PROCESS RUN, where it was the difference between
 * a finding and a tautology. Asked about `motion_failure`, the corpus answered
 * with `"motion_failure",` — the concept's own entry in `OBSERVATION_KINDS`.
 * That is a verbatim line from a real file with a real locator and a real hash,
 * and it is TRUE; it is also the question read back, and promoting it to
 * VERIFIED would have ONIQ recording that it had learned something when all it
 * had found was its own enum. Compare the same run's `runner-availability`,
 * which returned three lines of prose explaining why nothing in this container
 * can observe a runner — a real answer to a real question.
 *
 * So a line must retain some content once the search terms are struck out.
 * Twelve characters is roughly a short clause; the number is a threshold and
 * is stated as one rather than defended as principled. What IS principled is
 * the direction: refusing is the safe side, because these findings are promoted
 * and a fabricated fact in the durable store outlives the run that made it.
 */
export const MIN_SUBSTANCE = 12;

/**
 * The terms a question is searched by. Exported because the matching rule IS
 * the honesty of this adapter, and a rule nobody can read is a rule nobody can
 * argue with.
 */
export function searchTerms(question: string): readonly string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= MIN_TERM_LENGTH),
    ),
  ];
}

/**
 * EVERY TERM MUST APPEAR IN THE LINE, WHICH IS STRICTER THAN IT NEEDS TO BE AND
 * IS THE SAFE DIRECTION. A loose match invents a supporting quotation for a
 * claim the document never made, and this adapter's findings are promoted to
 * VERIFIED — so a false positive is a fabricated fact in the durable store,
 * while a false negative is a gap that stays open and says so. Stated as a
 * LIMIT rather than hidden: a document that phrases the same fact in other
 * words yields nothing here, and the fix is a better corpus, not a looser rule.
 */
function matches(line: string, terms: readonly string[]): boolean {
  const lower = line.toLowerCase();
  return terms.length > 0 && terms.every((t) => lower.includes(t));
}

/**
 * What the line says that the QUESTION did not. Exported because it is the
 * second half of this adapter's honesty and deserves to be checkable on its
 * own: `substance("motion_failure,", ["motion","failure"])` is 0.
 */
export function substance(line: string, terms: readonly string[]): number {
  let rest = line.toLowerCase();
  for (const t of terms) rest = rest.split(t).join(" ");
  return rest.replace(/[^a-z0-9]+/g, "").length;
}

export type LocalEvidenceResearch = {
  readonly adapter: ResearchAdapter;
  readonly retrieve: (question: string) => EvidenceRetrieval;
};

export function makeLocalEvidenceResearch(
  corpus: readonly CorpusDocument[],
): LocalEvidenceResearch {
  const retrieve = (question: string): EvidenceRetrieval => {
    if (corpus.length === 0) {
      return { ok: false, reason: "the local evidence corpus is empty: nothing was searched" };
    }
    const terms = searchTerms(question);
    if (terms.length === 0) {
      return {
        ok: false,
        reason: `no searchable term of ${MIN_TERM_LENGTH}+ characters in "${question}"`,
      };
    }
    const findings: EvidenceFinding[] = [];
    for (const doc of corpus) {
      const lines = doc.text.split("\n");
      for (let i = 0; i < lines.length && findings.length < MAX_LOCAL_FINDINGS; i += 1) {
        const line = lines[i].trim();
        if (line.length === 0 || !matches(line, terms)) continue;
        // A line whose entire content is the words of the question restates it
        // rather than answering it — see MIN_SUBSTANCE.
        if (substance(line, terms) < MIN_SUBSTANCE) continue;
        findings.push({
          question,
          locator: `${doc.locator}:${i + 1}`,
          sourceVersion: doc.sourceVersion,
          contentHash: doc.contentHash,
          excerpt: line.slice(0, MAX_LOCAL_EXCERPT),
          line: i + 1,
          // FIRST-HAND AND VERBATIM, and both halves are true of what this did:
          // the host read the bytes, and the excerpt is the line unchanged.
          directness: "fetched",
          extraction: "direct_quotation",
        });
      }
      if (findings.length >= MAX_LOCAL_FINDINGS) break;
    }
    return { ok: true, findings, searched: corpus.length };
  };

  return {
    retrieve,
    adapter: {
      investigate: async (question: string): Promise<ResearchResult> => {
        const got = retrieve(question);
        if (!got.ok) return { ok: false, reason: got.reason };
        return {
          ok: true,
          findings: got.findings.map((f, n) => ({
            id: `local_${n + 1}`,
            question: f.question,
            answer: f.excerpt,
            sourceRef: f.locator,
            // The SEAM's confidence field, and it is deliberately not the
            // substrate's: `scoreConfidence` computes belief from evidence and
            // this number never reaches it. A retrieval is first-hand, so 1
            // says "this is what the document says", never "this is true".
            confidence: 1,
          })),
        };
      },
    },
  };
}
