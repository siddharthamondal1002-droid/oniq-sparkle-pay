import { describe, expect, it } from "vitest";
import {
  DOCUMENT_MIMES,
  EXT_FOR_MIME,
  MAX_DOCUMENT_BYTES,
  isAiDerived,
  sniffDocumentMime,
  validateDocumentInput,
  validateRecordInput,
} from "@/health/domain";

const NOW = new Date().toISOString();

describe("validateRecordInput", () => {
  const good = {
    kind: "vital",
    display: "Blood pressure",
    valueNum: 120,
    valueUnit: "mmHg",
    effectiveAt: NOW,
  };

  it("accepts a plain reading and returns exactly the fields it validated", () => {
    const v = validateRecordInput({ ...good, extra: "ignored" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toEqual(good);
  });

  it.each([
    ["bad_kind", { ...good, kind: "diagnosis" }],
    ["bad_display", { ...good, display: "" }],
    ["bad_display", { ...good, display: "x".repeat(121) }],
    ["bad_date", { ...good, effectiveAt: "last tuesday" }],
    ["future_date", { ...good, effectiveAt: new Date(Date.now() + 3 * 86400000).toISOString() }],
    ["bad_value", { ...good, valueNum: Number.NaN }],
    ["bad_unit", { ...good, valueUnit: "x".repeat(25) }],
    ["bad_text", { ...good, valueText: "x".repeat(2001) }],
    ["empty_value", { kind: "note", display: "Note", effectiveAt: NOW }],
    ["bad_input", null],
  ])("refuses with %s", (reason, input) => {
    const v = validateRecordInput(input);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe(reason);
  });
});

describe("validateDocumentInput", () => {
  const good = { kind: "lab_report", title: "CBC", mime: "application/pdf", sizeBytes: 1024 };

  it("accepts a declared document", () => {
    const v = validateDocumentInput(good);
    expect(v.ok).toBe(true);
  });

  it.each([
    ["bad_kind", { ...good, kind: "selfie" }],
    ["bad_title", { ...good, title: " " }],
    ["bad_mime", { ...good, mime: "image/gif" }],
    ["bad_mime", { ...good, mime: "application/javascript" }],
    ["bad_size", { ...good, sizeBytes: 0 }],
    ["bad_size", { ...good, sizeBytes: 12.5 }],
    ["too_large", { ...good, sizeBytes: MAX_DOCUMENT_BYTES + 1 }],
    ["bad_date", { ...good, capturedAt: "soon" }],
  ])("refuses with %s", (reason, input) => {
    const v = validateDocumentInput(input);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe(reason);
  });

  it("caps at 10 MiB and knows an extension for every allowed type", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
    for (const m of DOCUMENT_MIMES) expect(EXT_FOR_MIME[m]).toMatch(/^[a-z]{3,4}$/);
  });
});

describe("sniffDocumentMime", () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  it("recognises the four allowed types by their first bytes", () => {
    expect(sniffDocumentMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe("application/pdf");
    expect(sniffDocumentMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffDocumentMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe("image/png");
    expect(
      sniffDocumentMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)),
    ).toBe("image/webp");
  });

  it("returns null for anything else, including a short head and a script", () => {
    expect(sniffDocumentMime(bytes(0x25, 0x50))).toBeNull();
    expect(sniffDocumentMime(bytes(0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74))).toBeNull();
    expect(sniffDocumentMime(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull();
  });
});

describe("isAiDerived", () => {
  it("labels unknown and AI sources as AI, and human sources as not", () => {
    expect(isAiDerived(undefined)).toBe(true);
    expect(isAiDerived("made_up")).toBe(true);
    expect(isAiDerived("ai_interpretation")).toBe(true);
    expect(isAiDerived("document_extraction")).toBe(true);
    expect(isAiDerived("user_entry")).toBe(false);
    expect(isAiDerived("health_connect")).toBe(false);
  });
});
