/**
 * REFUSE, NEVER TRIM — one closed code per fault. The synthetic provider's
 * real output passes in all three languages; every misbehaviour the
 * test-only provider can produce is refused with the exact code; a fact that
 * QUOTES a medication record is not a dose instruction.
 */
import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  extractNumberWords,
  extractNumbers,
  forbiddenIn,
  maskCited,
  validateAiResponse,
  type ContractExpectation,
} from "../../../../supabase/functions/_shared/health/ai/contract";
import {
  buildMinimumContext,
  type RecordRow,
} from "../../../../supabase/functions/_shared/health/ai/context";
import { SyntheticHealthAIProvider } from "../../../../supabase/functions/_shared/health/ai/synthetic";
import { normalizeForMatch } from "../../../../supabase/functions/_shared/health/ai/scrub";
import {
  AI_LANGUAGES,
  CONTRACT_REFUSAL_CODES,
  PROVIDER_CLASS_ALLOWLIST,
  type AiLanguage,
  type AiResponse,
} from "../../ai/types";
import { MISBEHAVIOURS, MisbehavingProvider, type Misbehaviour } from "./misbehavingProvider";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rows: RecordRow[] = [
  {
    id: u(1),
    kind: "lab",
    display: "HbA1c",
    value_num: 6.1,
    value_unit: "%",
    value_text: null,
    effective_at: "2026-03-14T09:00:00.000Z",
    provenance: { source: "user_entry" },
  },
  {
    id: u(2),
    kind: "lab",
    display: "HbA1c",
    value_num: 6.4,
    value_unit: "%",
    value_text: null,
    effective_at: "2025-12-01T09:00:00.000Z",
    provenance: { source: "user_entry" },
  },
  {
    id: u(3),
    kind: "medication",
    display: "Metformin 500 mg",
    value_num: null,
    value_unit: null,
    value_text: "twice daily after food",
    effective_at: "2026-01-05T09:00:00.000Z",
    provenance: { source: "user_entry" },
  },
];

function built(
  language: AiLanguage = "en",
  task: "explain_record" | "summarize_timeline" | "answer_question" = "explain_record",
) {
  const r = buildMinimumContext({
    task,
    language,
    records: rows,
    targetRecordId: u(1),
    question: "hba1c",
  });
  if (!r.ok) throw new Error(r.reason);
  return r;
}

function expectation(
  language: AiLanguage,
  task: ContractExpectation["task"] = "explain_record",
): ContractExpectation {
  return {
    task,
    provider: "synthetic",
    model: "synthetic-v1",
    language,
    classAllowlist: PROVIDER_CLASS_ALLOWLIST.synthetic,
  };
}

async function synthetic(
  language: AiLanguage,
  task: "explain_record" | "summarize_timeline" | "answer_question",
) {
  const { context, manifest } = built(language, task);
  const out = await new SyntheticHealthAIProvider().run({
    task,
    model: "synthetic-v1",
    context,
    counts: { records: context.records.length, documents: 0 },
  });
  if (out.kind !== "response") throw new Error("not a response");
  return { out, context, manifest };
}

describe("the synthetic provider passes its own contract", () => {
  for (const language of AI_LANGUAGES) {
    for (const task of ["explain_record", "summarize_timeline", "answer_question"] as const) {
      it(`${task} in ${language}`, async () => {
        const { out, context, manifest } = await synthetic(language, task);
        const v = validateAiResponse(
          out.response,
          manifest,
          expectation(language, task),
          context.records,
        );
        expect(v, JSON.stringify(out.response.segments)).toEqual({ ok: true });
        expect(out.response.language).toBe(language);
      });
    }
  }

  it("cites by alias, never by id, and every alias resolves", async () => {
    const { out, manifest } = await synthetic("en", "explain_record");
    const refs = out.response.segments.flatMap((s) => s.sourceRefs ?? []);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^r\d+$/);
    expect(JSON.stringify(out.response)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4/);
    expect(manifest.recordIds.length).toBeGreaterThanOrEqual(2);
  });
});

describe("every misbehaviour is refused with its code", () => {
  const EXPECTED: Record<Exclude<Misbehaviour, "throw">, string> = {
    fabricate: "ungrounded_number",
    dose: "forbidden_dose",
    prescribe: "forbidden_prescribe",
    diagnose: "forbidden_diagnosis",
    med_change: "forbidden_med_change",
    impersonate: "forbidden_impersonation",
    care_avoidance: "forbidden_care_avoidance",
    off_app: "forbidden_off_app",
    disclaimer: "disclaimer_in_output",
    cite_outside: "citation_outside_manifest",
    cite_bad_alias: "citation_outside_manifest",
    general_cites: "general_info_cites",
    second_person: "general_info_second_person",
    unknown_number: "unknown_has_number",
    interpretation: "class_not_allowed",
    identifier: "identifier_in_output",
    obfuscated: "obfuscated_output",
    wrong_language: "language_unsupported",
    split_dose: "forbidden_dose",
    fact_without_source: "fact_without_source",
    not_an_object: "not_an_object",
  };

  it.each(MISBEHAVIOURS.filter((m) => m !== "throw"))("%s", async (mode) => {
    const { context, manifest } = built();
    const out = await new MisbehavingProvider(mode as Misbehaviour).run({
      task: "explain_record",
      model: "synthetic-v1",
      context,
      counts: { records: context.records.length, documents: 0 },
    });
    if (out.kind !== "response") throw new Error("not a response");
    const v = validateAiResponse(out.response, manifest, expectation("en"), context.records);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe(EXPECTED[mode as Exclude<Misbehaviour, "throw">]);
      expect(CONTRACT_REFUSAL_CODES).toContain(v.code);
    }
  });
});

describe("grounding and masking", () => {
  const { context, manifest } = built();
  const base = (): AiResponse => ({
    schemaVersion: "health-ai-response/1",
    task: "explain_record",
    provider: "synthetic",
    model: "synthetic-v1",
    language: "en",
    segments: [],
    refusals: [],
    usage: { inputTokens: 1, outputTokens: 1 },
    costUsd: 0,
  });
  const check = (segments: AiResponse["segments"]) =>
    validateAiResponse({ ...base(), segments }, manifest, expectation("en"), context.records);

  it("a fact may quote its record's value, unit, date, and the count of citations", () => {
    expect(
      check([
        {
          class: "record_fact",
          text: "HbA1c on 14 Mar 2026 was recorded as 6.1 %.",
          sourceRefs: ["r1"],
        },
      ]),
    ).toEqual({ ok: true });
    expect(
      check([
        {
          class: "record_fact",
          text: "Two HbA1c readings: 14 Mar 2026 and 1 Dec 2025.",
          sourceRefs: ["r1", "r2"],
        },
      ]),
    ).toEqual({ ok: true });
    expect(
      check([{ class: "record_fact", text: "HbA1c was 6.10 percent.", sourceRefs: ["r1"] }]),
    ).toEqual({ ok: true });
  });

  it("a number from nowhere is refused, in digits or in words, and in Devanagari digits", () => {
    expect(check([{ class: "record_fact", text: "HbA1c was 7.2 %.", sourceRefs: ["r1"] }])).toEqual(
      { ok: false, code: "ungrounded_number" },
    );
    expect(
      check([{ class: "record_fact", text: "There were seven readings.", sourceRefs: ["r1"] }]),
    ).toEqual({ ok: false, code: "ungrounded_number" });
    expect(check([{ class: "record_fact", text: "HbA1c था ७.२ %.", sourceRefs: ["r1"] }])).toEqual({
      ok: false,
      code: "ungrounded_number",
    });
  });

  it("quoting a medication record is not a dose instruction; instructing is", () => {
    const { context: c3, manifest: m3 } = (() => {
      const r = buildMinimumContext({
        task: "explain_record",
        language: "en",
        records: rows,
        targetRecordId: u(3),
      });
      if (!r.ok) throw new Error(r.reason);
      return r;
    })();
    const ok = validateAiResponse(
      {
        ...base(),
        segments: [
          {
            class: "record_fact",
            text: "Metformin 500 mg on 5 Jan 2026 was recorded as twice daily after food.",
            sourceRefs: ["r1"],
          },
        ],
      },
      m3,
      expectation("en"),
      c3.records,
    );
    expect(ok).toEqual({ ok: true });
    const bad = validateAiResponse(
      {
        ...base(),
        segments: [
          {
            class: "record_fact",
            text: "Metformin 500 mg on 5 Jan 2026 — take 1000 mg twice daily instead.",
            sourceRefs: ["r1"],
          },
        ],
      },
      m3,
      expectation("en"),
      c3.records,
    );
    expect(bad.ok).toBe(false);
  });

  it("second person is refused in general_info in every language, and allowed in a fact", () => {
    expect(check([{ class: "general_info", text: "You should rest." }]).ok).toBe(false);
    const hi = validateAiResponse(
      {
        ...base(),
        language: "hi",
        segments: [{ class: "general_info", text: "आपको आराम करना चाहिए।" }],
      },
      { ...manifest, language: "hi" },
      expectation("hi"),
      context.records,
    );
    expect(hi).toEqual({ ok: false, code: "general_info_second_person" });
    const bn = validateAiResponse(
      {
        ...base(),
        language: "bn",
        segments: [{ class: "general_info", text: "আপনার বিশ্রাম দরকার।" }],
      },
      { ...manifest, language: "bn" },
      expectation("bn"),
      context.records,
    );
    expect(bn).toEqual({ ok: false, code: "general_info_second_person" });
  });

  it("forbidden groups in Hindi and Bengali", () => {
    expect(forbiddenIn(normalizeForMatch("500 mg की गोली दिन में दो बार लो"), "hi")).toBe(
      "forbidden_dose",
    );
    expect(forbiddenIn(normalizeForMatch("आपको मधुमेह है"), "hi")).toBe("forbidden_diagnosis");
    expect(forbiddenIn(normalizeForMatch("मैं डॉक्टर हूँ"), "hi")).toBe("forbidden_impersonation");
    expect(forbiddenIn(normalizeForMatch("দিনে দুবার 500 mg ট্যাবলেট খান"), "bn")).toBe(
      "forbidden_dose",
    );
    expect(forbiddenIn(normalizeForMatch("আপনার ডায়াবেটিস আছে"), "bn")).toBe(
      "forbidden_diagnosis",
    );
    expect(forbiddenIn(normalizeForMatch("ওষুধ বন্ধ করুন"), "bn")).toBe("forbidden_med_change");
    expect(forbiddenIn(normalizeForMatch("HbA1c 6.1 % on 14 Mar 2026"), "bn")).toBeNull();
  });

  it("shape faults each have a code", () => {
    const m = manifest;
    const r = context.records;
    expect(
      validateAiResponse({ ...base(), schemaVersion: "x" as never }, m, expectation("en"), r),
    ).toEqual({ ok: false, code: "schema_version" });
    expect(
      validateAiResponse({ ...base(), task: "answer_question" }, m, expectation("en"), r),
    ).toEqual({ ok: false, code: "task_mismatch" });
    expect(
      validateAiResponse({ ...base(), provider: "vertex" as never }, m, expectation("en"), r),
    ).toEqual({ ok: false, code: "provider_mismatch" });
    expect(validateAiResponse({ ...base(), model: "other" }, m, expectation("en"), r)).toEqual({
      ok: false,
      code: "model_mismatch",
    });
    expect(
      validateAiResponse({ ...base(), language: "ta" as never }, m, expectation("en"), r),
    ).toEqual({ ok: false, code: "language_unsupported" });
    expect(check([])).toEqual({ ok: false, code: "no_segments" });
    expect(
      check(Array.from({ length: 21 }, () => ({ class: "unknown" as const, text: "unclear" }))),
    ).toEqual({ ok: false, code: "too_many_segments" });
    expect(
      validateAiResponse(
        {
          ...base(),
          refusals: ["nope"] as never,
          segments: [{ class: "unknown", text: "unclear" }],
        },
        m,
        expectation("en"),
        r,
      ),
    ).toEqual({ ok: false, code: "bad_refusal_code" });
    expect(
      validateAiResponse(
        {
          ...base(),
          usage: { inputTokens: -1, outputTokens: 0 },
          segments: [{ class: "unknown", text: "unclear" }],
        },
        m,
        expectation("en"),
        r,
      ),
    ).toEqual({ ok: false, code: "usage_shape" });
    expect(
      validateAiResponse(
        { ...base(), costUsd: -1, segments: [{ class: "unknown", text: "unclear" }] },
        m,
        expectation("en"),
        r,
      ),
    ).toEqual({ ok: false, code: "cost_shape" });
    expect(check([{ class: "unknown", text: "  " }])).toEqual({ ok: false, code: "segment_empty" });
    expect(check([{ class: "unknown", text: "x".repeat(601) }])).toEqual({
      ok: false,
      code: "segment_too_long",
    });
    expect(
      check([
        { class: "record_fact", text: "many", sourceRefs: Array.from({ length: 11 }, () => "r1") },
      ]),
    ).toEqual({ ok: false, code: "too_many_citations" });
    expect(check([{ class: "unknown", text: "unclear", confidence: 2 }])).toEqual({
      ok: false,
      code: "confidence_range",
    });
    expect(check([{ class: "unknown", text: "unclear", sourceRefs: ["r1"] }])).toEqual({
      ok: false,
      code: "unknown_cites",
    });
    expect(check([{ class: "ai_interpretation", text: "trend", sourceRefs: [] }])).toEqual({
      ok: false,
      code: "class_not_allowed",
    });
    expect(
      check(
        Array.from({ length: 8 }, () => ({ class: "unknown" as const, text: "y".repeat(590) })),
      ),
    ).toEqual({ ok: false, code: "response_too_long" });
  });

  it("helpers", () => {
    expect(extractNumbers("13.20 and 1,234 and 09")).toEqual(["13.2", "1234", "9"]);
    expect(extractNumberWords("one earlier reading, तीन, দুই")).toEqual(["1", "3", "2"]);
    expect(allowedNumbers(context.records.slice(0, 1))).toContain("6.1");
    expect(
      maskCited(normalizeForMatch("HbA1c on 14 Mar 2026"), context.records.slice(0, 1)),
    ).not.toContain("hba1c");
  });
});
