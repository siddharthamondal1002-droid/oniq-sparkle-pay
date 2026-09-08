/**
 * TEST-ONLY. A provider that returns exactly the outputs the contract must
 * refuse — a fabricated number, a dose, a diagnosis, an out-of-manifest
 * citation, a general note that cites, one that addresses the reader, an
 * off-app contact, a home-made disclaimer, an interpretation the synthetic
 * allowlist forbids, an identifier, obfuscated text, the wrong language, a
 * dose split across two segments, a thrown error. It is passed to the
 * gateway through `deps.providerFor` and never registered; `provider.ts`'s
 * registry stays exactly ["synthetic"].
 */
import type { HealthAIProvider } from "../../../../supabase/functions/_shared/health/ai/provider";
import {
  AI_RESPONSE_SCHEMA_VERSION,
  type AiResponse,
  type AiSegment,
  type ProviderInput,
  type ProviderOutput,
} from "../../ai/types";

export const MISBEHAVIOURS = [
  "fabricate",
  "dose",
  "prescribe",
  "diagnose",
  "med_change",
  "impersonate",
  "care_avoidance",
  "off_app",
  "disclaimer",
  "cite_outside",
  "cite_bad_alias",
  "general_cites",
  "second_person",
  "unknown_number",
  "interpretation",
  "identifier",
  "obfuscated",
  "wrong_language",
  "split_dose",
  "fact_without_source",
  "throw",
  "not_an_object",
] as const;
export type Misbehaviour = (typeof MISBEHAVIOURS)[number];

export class MisbehavingProvider implements HealthAIProvider {
  readonly id = "synthetic" as const;
  readonly recipient = "oniq" as const;
  readonly synthetic = true as const;
  constructor(readonly mode: Misbehaviour) {}

  run(input: ProviderInput): Promise<ProviderOutput> {
    if (this.mode === "throw") return Promise.reject(new Error("boom"));
    const r = input.context.records[0];
    const ref = r?.ref ?? "r1";
    const fact = (text: string): AiSegment => ({ class: "record_fact", text, sourceRefs: [ref] });
    const general = (text: string): AiSegment => ({ class: "general_info", text });
    let segments: AiSegment[];
    switch (this.mode) {
      case "fabricate":
        segments = [fact(`${r?.display ?? "Reading"} was 999.9 last week.`)];
        break;
      case "dose":
        segments = [general("Take 500 mg paracetamol twice a day for a week.")];
        break;
      case "prescribe":
        segments = [general("I recommend starting a low-dose tablet for the pressure.")];
        break;
      case "diagnose":
        segments = [
          fact(`${r?.display ?? "This"} on ${r?.dateLabel ?? ""} means you have diabetes.`),
        ];
        break;
      case "med_change":
        segments = [general("It is fine to stop the medicine for now.")];
        break;
      case "impersonate":
        segments = [general("As a doctor, this looks fine to me.")];
        break;
      case "care_avoidance":
        segments = [general("There is no need to see a doctor about this.")];
        break;
      case "off_app":
        segments = [general("Contact me on WhatsApp for a full report.")];
        break;
      case "disclaimer":
        segments = [general("This is not medical advice.")];
        break;
      case "cite_outside":
        segments = [{ class: "record_fact", text: "A reading was recorded.", sourceRefs: ["r99"] }];
        break;
      case "cite_bad_alias":
        segments = [
          {
            class: "record_fact",
            text: "A reading was recorded.",
            sourceRefs: ["00000000-0000-0000-0000-000000000001"],
          },
        ];
        break;
      case "general_cites":
        segments = [{ class: "general_info", text: "A general note.", sourceRefs: [ref] }];
        break;
      case "second_person":
        segments = [general("Your readings look fine to me.")];
        break;
      case "unknown_number":
        segments = [{ class: "unknown", text: "There are three things unclear here." }];
        break;
      case "interpretation":
        segments = [
          {
            class: "ai_interpretation",
            text: "This trend suggests improvement.",
            sourceRefs: [ref],
          },
        ];
        break;
      case "identifier":
        segments = [general("Written by rao@example.com for the file.")];
        break;
      case "obfuscated":
        segments = [general("Every​thing is fi​ne here.")];
        break;
      case "split_dose":
        segments = [general("Take 500 mg"), general("twice a day with food.")];
        break;
      case "fact_without_source":
        segments = [{ class: "record_fact", text: "Something was recorded." }];
        break;
      default:
        segments = [general("A plain note about readings in general.")];
    }
    const response: AiResponse = {
      schemaVersion: AI_RESPONSE_SCHEMA_VERSION,
      task: input.task,
      provider: "synthetic" as const,
      model: input.model,
      language: this.mode === "wrong_language" ? ("hi" as const) : input.context.language,
      segments,
      refusals: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      costUsd: 0,
    };
    if (this.mode === "not_an_object") {
      return Promise.resolve({ kind: "response", response: null as unknown as AiResponse });
    }
    return Promise.resolve({ kind: "response", response });
  }
}
