/**
 * ONIQ HEALTH AI — the synthetic provider. THE ONLY PROVIDER IN PHASE 2.
 *
 * Deterministic and template-driven: it reads the structured context and
 * writes segments of the classes the contract allows, citing by alias the
 * records it quotes. It never interprets, never invents a number, never
 * leaves the process. Its purpose is to make the whole gateway — policy,
 * context, scrub, receipt, contract, audit — run end to end without a
 * health byte reaching anyone.
 *
 * IT HAS NO SPECIAL MODES. The first draft carried a `misbehave` option so
 * the contract could be proven against a real provider object; the review
 * moved that into a test-only class (`__tests__/ai/misbehavingProvider.ts`),
 * because a constructor option is one config value away from production.
 * The registry factory takes no arguments and `aiIsolation.test.ts` reads
 * that back from source.
 *
 * IT SPEAKS THE REQUEST'S LANGUAGE. The gateway's contract refuses a
 * response whose language differs from the context's, so the templates
 * exist in all three, and the general-information sentence avoids the
 * second person in each (the contract refuses `general_info` that addresses
 * the reader, since that is where advice hides).
 */
import {
  AI_RESPONSE_SCHEMA_VERSION,
  type AiLanguage,
  type AiResponse,
  type AiSegment,
  type ContextRecord,
  type ProviderInput,
  type ProviderOutput,
} from "./types.ts";
import { classifyDocument } from "./classify.ts";
import { extractCandidates } from "./extract.ts";
import { contextText, estimateTokens } from "./cost.ts";

type Templates = {
  fact: (display: string, dateLabel: string, value: string) => string;
  /** No number word here: the contract grounds every number, and a count is not a value. */
  prior: (count: number, display: string, dates: string) => string;
  general: string;
  noneYet: string;
  noAnswer: string;
  verification: string;
  /**
   * DELIBERATELY DIGIT-FREE. `document_fact` grounds every number in the
   * DOCUMENT text, so a synthetic sentence carrying a number would pass
   * grounding whenever the fixture happened to print it and prove nothing
   * about the rule. The rule is exercised directly against
   * `validateAiResponse` in `contract.test.ts`.
   */
  described: string;
};

const T: Record<AiLanguage, Templates> = {
  en: {
    fact: (d, when, v) => `${d} on ${when} was recorded as ${v}.`,
    prior: (n, d, dates) =>
      n === 1 ? `An earlier ${d} reading: ${dates}.` : `Earlier ${d} readings: ${dates}.`,
    general: "Readings like these are best discussed with a doctor who knows the history.",
    noneYet: "There are no records to summarise yet.",
    noAnswer: "The records do not carry an answer to that question.",
    verification: "This is a synthetic verification answer produced inside ONIQ.",
    described: "This report was read inside ONIQ; it states findings rather than measurements.",
  },
  hi: {
    fact: (d, when, v) => `${when} को ${d} ${v} दर्ज किया गया था।`,
    prior: (_n, d, dates) => `${d} की पिछली रीडिंग: ${dates}।`,
    general: "ऐसी रीडिंग पर उस डॉक्टर से बात करना सबसे अच्छा है जो इतिहास जानता हो।",
    noneYet: "सारांश के लिए अभी कोई रिकॉर्ड नहीं है।",
    noAnswer: "रिकॉर्ड में इस सवाल का जवाब नहीं है।",
    verification: "यह ONIQ के भीतर बना एक सिंथेटिक सत्यापन उत्तर है।",
    described: "यह रिपोर्ट ONIQ के भीतर पढ़ी गई; इसमें माप के बजाय निष्कर्ष दर्ज हैं।",
  },
  bn: {
    fact: (d, when, v) => `${when} তারিখে ${d} ${v} হিসেবে নথিভুক্ত হয়েছিল।`,
    prior: (_n, d, dates) => `${d}-এর আগের রিডিং: ${dates}।`,
    general: "এই ধরনের রিডিং নিয়ে ইতিহাস জানেন এমন ডাক্তারের সঙ্গে আলোচনা করাই ভালো।",
    noneYet: "সারসংক্ষেপের জন্য এখনও কোনো রেকর্ড নেই।",
    noAnswer: "রেকর্ডে এই প্রশ্নের উত্তর নেই।",
    verification: "এটি ONIQ-এর ভিতরে তৈরি একটি সিন্থেটিক যাচাই উত্তর।",
    described: "এই রিপোর্ট ONIQ-এর ভিতরে পড়া হয়েছে; এতে পরিমাপের বদলে পর্যবেক্ষণ রয়েছে।",
  },
};

export class SyntheticHealthAIProvider {
  readonly id = "synthetic" as const;
  readonly recipient = "oniq" as const;
  readonly synthetic = true as const;

  run(input: ProviderInput): Promise<ProviderOutput> {
    const inputTokens = estimateTokens(contextText(input.context));
    switch (input.task) {
      case "classify_document": {
        const doc = input.context.documents[0];
        const classification = doc
          ? classifyDocument({
              title: doc.title,
              mime: doc.mime,
              sizeBytes: doc.sizeBytes,
              text: doc.text,
            })
          : { kind: "other", confidence: 0, method: "rules:v1" };
        return Promise.resolve({
          kind: "classification",
          classification,
          usage: { inputTokens, outputTokens: 8 },
        });
      }
      case "extract_document": {
        const doc = input.context.documents[0];
        const extraction = extractCandidates(doc?.text ?? "", doc?.capturedDay ?? "1970-01-01");
        return Promise.resolve({
          kind: "extraction",
          extraction,
          usage: { inputTokens, outputTokens: 12 * extraction.candidates.length },
        });
      }
      default: {
        const segments = this.segmentsFor(input);
        const outputTokens = estimateTokens(segments.map((s) => s.text).join("\n"));
        const response: AiResponse = {
          schemaVersion: AI_RESPONSE_SCHEMA_VERSION,
          task: input.task,
          provider: "synthetic",
          model: input.model,
          language: input.context.language,
          segments,
          refusals: [],
          usage: { inputTokens, outputTokens },
          costUsd: 0,
        };
        return Promise.resolve({ kind: "response", response });
      }
    }
  }

  private fact(r: ContextRecord, t: Templates): AiSegment {
    const value =
      r.valueNum !== null
        ? `${r.valueNum}${r.valueUnit ? ` ${r.valueUnit}` : ""}`
        : (r.valueText ?? "");
    return {
      class: "record_fact",
      text: t.fact(r.display, r.dateLabel, value),
      sourceRefs: [r.ref],
      confidence: 1,
    };
  }

  private segmentsFor(input: ProviderInput): AiSegment[] {
    const { records, question, language } = input.context;
    const t = T[language];
    const out: AiSegment[] = [];
    if (input.task === "explain_record") {
      const target = records[0];
      if (target) out.push(this.fact(target, t));
      // The SAME ANALYTE (same display), not merely the same kind, and the
      // sentence cites the target too, so the digits of its display
      // ("Vitamin B12") are grounded in what it cites. Red-teamed
      // 2026-09-08: the first version called an HbA1c row "an earlier
      // Cholesterol reading" and was refused as ungrounded on "B12".
      const analyte = target?.display.toLowerCase();
      const prior = records.slice(1).filter((p) => p.display.toLowerCase() === analyte);
      if (target && prior.length > 0) {
        out.push({
          class: "record_fact",
          text: t.prior(prior.length, target.display, prior.map((p) => p.dateLabel).join(", ")),
          sourceRefs: [target.ref, ...prior.map((p) => p.ref)],
        });
      }
      out.push({ class: "general_info", text: t.general });
    } else if (input.task === "summarize_timeline") {
      for (const r of records.slice(0, 10)) out.push(this.fact(r, t));
      if (records.length === 0) out.push({ class: "unknown", text: t.noneYet });
    } else if (input.task === "describe_document") {
      // Deliberately DIGIT-FREE. A synthetic that quoted a number would pass
      // grounding by construction and prove nothing about it; the grounding
      // rule is exercised directly against validateAiResponse in the tests.
      if (input.context.documents[0]) {
        out.push({ class: "document_fact", text: t.described, sourceRefs: ["d1"] });
      } else {
        out.push({ class: "unknown", text: t.noAnswer });
      }
    } else if (input.task === "answer_question") {
      const words = (question ?? "")
        .toLowerCase()
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter((w) => w.length > 2);
      const hits = records.filter((r) =>
        words.some((w) => r.display.toLowerCase().includes(w) || r.kind.includes(w)),
      );
      for (const r of hits.slice(0, 5)) out.push(this.fact(r, t));
      if (hits.length === 0) out.push({ class: "unknown", text: t.noAnswer });
      out.push({ class: "general_info", text: t.verification });
    }
    return out;
  }
}
