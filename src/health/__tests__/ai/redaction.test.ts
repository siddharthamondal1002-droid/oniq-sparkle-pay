/**
 * NOTHING A PERSON WROTE REACHES A RECEIPT, AN AUDIT ROW OR A LOG LINE. A
 * gateway call is run with content in every field the schema has — a
 * display, a note, a question, a document title — and the JSON of every row
 * the store was handed, every audit detail through the whitelist, and a log
 * line through redactForLog is asserted to contain none of it, while the
 * task, provider and model survive.
 */
import { describe, expect, it } from "vitest";
import { runHealthAi } from "../../../../supabase/functions/_shared/health/ai/gateway";
import { auditDetail, redactForLog, AUDIT_DETAIL_KEYS, LOG_KEYS } from "../../redact";
import { allHealthFlagsOff } from "../../flagNames";
import { FakeStore } from "./fakeStore";
import { InlineTextSource } from "./inlineTextSource";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CONTENT = ["Metformin", "Dr Rao", "fatigue", "haemolysed", "HbA1c was high", "CBC March"];

describe("content never lands", () => {
  it("receipts, audits and the log line carry codes and counts only", async () => {
    const store = new FakeStore(
      new Map([
        [
          u(1),
          {
            id: u(1),
            consents: [
              {
                id: "s",
                purpose: "store_records",
                dataCategories: ["labs", "medications", "documents", "vitals"],
                recipient: "oniq",
                status: "active",
                startTime: "2026-01-01T00:00:00.000Z",
                expiryTime: null,
                termsVersion: "health-terms-v1",
              },
              {
                id: "a",
                purpose: "ai_interpretation",
                dataCategories: ["labs", "medications", "documents", "vitals"],
                recipient: "oniq",
                status: "active",
                startTime: "2026-01-01T00:00:00.000Z",
                expiryTime: null,
                termsVersion: "health-ai-terms-v1",
              },
            ],
            records: [
              {
                id: u(5),
                kind: "medication",
                display: "Metformin",
                value_num: null,
                value_unit: null,
                value_text: "noted by Dr Rao, fatigue",
                effective_at: "2026-03-14T00:00:00.000Z",
                status: "active",
                provenance: { source: "user_entry" },
              },
            ],
            documents: [
              {
                id: u(7),
                kind: "lab_report",
                title: "CBC March",
                mime: "application/pdf",
                size_bytes: 10,
                captured_at: null,
                created_at: "2026-03-15T00:00:00.000Z",
              },
            ],
          },
        ],
      ]),
      u(1),
    );
    const flags = allHealthFlagsOff();
    flags["health.enabled"] = true;
    flags["health.ai.enabled"] = true;
    const config = {
      flags,
      environment: "staging" as const,
      provider: "synthetic",
      model: "synthetic-v1",
      capPerUser: 9,
      capHouse: 9,
      adminVerificationEnabled: false,
    };
    const actor = { isAdmin: false, isAdult: true, regionBlocked: false };
    const deps = {
      store,
      now: "2026-09-08T12:00:00.000Z",
      requestId: u(9),
      textSource: new InlineTextSource({ [u(7)]: "Haemoglobin 12.1 g/dL sample haemolysed" }),
    };

    await runHealthAi(deps, config, actor, { task: "explain_record", recordId: u(5) });
    await runHealthAi(deps, config, actor, {
      task: "answer_question",
      question: "HbA1c was high, why?",
    });
    await runHealthAi(deps, config, actor, { task: "extract_document", documentId: u(7) });
    await runHealthAi(deps, config, actor, { task: "classify_document", documentId: u(7) });

    const receipts = JSON.stringify(store.receipts);
    const audits = JSON.stringify(
      store.audits.map((a) => ({ ...a, detail: auditDetail(a.detail) })),
    );
    const log = JSON.stringify(
      redactForLog({
        fn: "health-ai",
        task: "explain_record",
        provider: "synthetic",
        status: 200,
        ms: 1,
        requestId: u(9),
        outcome: "ok",
        question: "HbA1c was high",
        display: "Metformin",
      }),
    );
    for (const c of CONTENT) {
      expect(receipts, `receipt carries ${c}`).not.toContain(c);
      expect(audits, `audit carries ${c}`).not.toContain(c);
      expect(log, `log carries ${c}`).not.toContain(c);
    }
    expect(store.receipts.length).toBe(4);
    expect(store.audits.length).toBeGreaterThanOrEqual(4);
    // Provenance the extractor wrote carries a method and a confidence, not the page.
    expect(JSON.stringify(store.inserted)).not.toMatch(/haemolysed/);
  });

  it("the whitelist keeps task, provider, model, method and code, and drops content keys", () => {
    const detail = auditDetail({
      task: "explain_record",
      provider: "synthetic",
      model: "synthetic-v1",
      method: "user",
      code: "forbidden_dose",
      count: 3,
      question: "x",
      display: "y",
      text: "z",
    });
    expect(detail).toEqual({
      task: "explain_record",
      provider: "synthetic",
      model: "synthetic-v1",
      method: "user",
      code: "forbidden_dose",
      count: 3,
    });
    for (const k of [...AUDIT_DETAIL_KEYS, ...LOG_KEYS])
      expect(k).not.toMatch(
        /value|text|note|title|display|path|sha|name|body|content|question|manifest/i,
      );
  });
});

describe("every reason health-ai can emit has a sentence in three languages", () => {
  it("AI_REFUSAL_REASONS, legal_hold, and whatever the function's source names", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { stripComments } = await import("@/test/sourceText");
    const { AI_REFUSAL_REASONS } = await import("../../ai/types");
    const { REASON_MESSAGES } = await import("../../redact");
    const { HEALTH_STRINGS } = await import("../../i18n");
    const ROOT = join(__dirname, "..", "..", "..", "..");
    const emitted = new Set<string>([...AI_REFUSAL_REASONS, "legal_hold"]);
    for (const fn of ["health-ai", "health-api"]) {
      const src = stripComments(
        readFileSync(join(ROOT, `supabase/functions/${fn}/index.ts`), "utf8"),
      );
      for (const m of src.matchAll(/reason:\s*"([a-z_]+)"/g)) emitted.add(m[1]);
    }
    expect(emitted.size).toBeGreaterThan(25);
    for (const r of emitted) {
      expect(REASON_MESSAGES, `REASON_MESSAGES lacks ${r}`).toHaveProperty(r);
      for (const lang of ["en", "hi", "bn"] as const) {
        expect(
          HEALTH_STRINGS[lang][`health.reason.${r}`],
          `${lang} lacks health.reason.${r}`,
        ).toBeTruthy();
      }
    }
  });
});
