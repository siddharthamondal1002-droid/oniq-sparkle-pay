/**
 * NOTHING MEDICAL LEAVES THE DOMAIN THROUGH A LOG, AN AUDIT ROW, AN ERROR OR
 * A NOTIFICATION. The whitelist is the mechanism; this is the proof, run
 * against a record that carries every content field the schema has.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_DETAIL_KEYS,
  LOG_KEYS,
  NOTIFICATION_TEXT,
  REASON_MESSAGES,
  auditDetail,
  redactForLog,
  safeMessage,
} from "@/health/redact";
import { HEALTH_STRINGS } from "@/health/i18n";
import { stripComments } from "@/test/sourceText";

const RECORD = {
  kind: "lab",
  category: "labs",
  display: "HbA1c",
  value_text: "7.9 percent, above range",
  valueText: "7.9 percent, above range",
  value_num: 7.9,
  notes: "patient reports fatigue",
  title: "Diabetes panel March",
  sha256: "deadbeef".repeat(8),
  storage_path: "uid/health/x.pdf",
  provenance: { source: "user_entry" },
  count: 3,
  status: "active",
  reason: "consent_required",
};

const CONTENT = ["HbA1c", "7.9", "fatigue", "Diabetes", "deadbeef", "uid/health", "user_entry"];

describe("auditDetail and redactForLog", () => {
  it("keep only whitelisted primitives", () => {
    const out = auditDetail(RECORD);
    expect(out).toEqual({
      kind: "lab",
      category: "labs",
      count: 3,
      status: "active",
      reason: "consent_required",
    });
    const log = redactForLog({ ...RECORD, event: "x", requestId: "r1", ms: 12 });
    expect(Object.keys(log).sort()).toEqual([
      "count",
      "event",
      "ms",
      "reason",
      "requestId",
      "status",
    ]);
  });

  it("let no content string through", () => {
    const text = JSON.stringify(auditDetail(RECORD)) + JSON.stringify(redactForLog(RECORD));
    for (const c of CONTENT) expect(text).not.toContain(c);
  });

  it("truncate long strings and drop objects, nulls and NaN", () => {
    const out = auditDetail({
      kind: "x".repeat(200),
      category: null,
      count: NaN,
      status: { a: 1 },
    });
    expect(out.kind).toHaveLength(64);
    expect(out).not.toHaveProperty("category");
    expect(out).not.toHaveProperty("count");
    expect(out).not.toHaveProperty("status");
  });

  it("whitelist nothing that could carry content", () => {
    for (const k of [...AUDIT_DETAIL_KEYS, ...LOG_KEYS]) {
      expect(k).not.toMatch(/value|text|note|title|display|path|sha|name|body|content/i);
    }
  });
});

describe("what a person is told", () => {
  it("maps unknown reasons to the generic sentence, never echoing input", () => {
    expect(safeMessage("HbA1c is high")).toBe(REASON_MESSAGES.failed);
    expect(safeMessage(null)).toBe(REASON_MESSAGES.failed);
    expect(safeMessage("__proto__")).toBe(REASON_MESSAGES.failed);
    expect(safeMessage("consent_required")).toMatch(/consent/i);
  });

  it("names no provider in any sentence", () => {
    for (const msg of Object.values(REASON_MESSAGES)) {
      expect(msg.toLowerCase()).not.toMatch(/google|gemini|vertex|anthropic|claude/);
    }
  });

  it("has a sentence, in three languages, for every reason the function can emit", () => {
    const fn = stripComments(
      readFileSync(join(__dirname, "../../../supabase/functions/health-api/index.ts"), "utf8"),
    );
    const emitted = new Set<string>();
    for (const m of fn.matchAll(/reason:\s*"([a-z_]+)"/g)) emitted.add(m[1]);
    for (const m of fn.matchAll(/reason:\s*[^\n?]*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)) {
      emitted.add(m[1]);
      emitted.add(m[2]);
    }
    expect(emitted.size).toBeGreaterThan(8);
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

  it("keeps the notification to one content-free sentence", () => {
    expect(NOTIFICATION_TEXT).not.toMatch(/\{|\}|%s/);
    expect(NOTIFICATION_TEXT.length).toBeLessThan(80);
  });
});
