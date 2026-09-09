/**
 * The stored-document text source (Phase 3b, owner directive 2026-09-09
 * "A, B and C"): a PDF's own text layer is read here and nothing leaves; a
 * photo, a scan or a PDF with no usable text layer comes back as BYTES for
 * the gateway to have transcribed — after the caps and the receipt, which
 * this seam never touches. The PDF reader itself (pdfText.ts) runs on Deno
 * and is proven by scripts/health-pdf-text-probe.ts; here it is injected.
 */
import { describe, expect, it } from "vitest";
import {
  capText,
  MAX_READ_BYTES,
  MIN_USABLE_TEXT_CHARS,
  NullTextSource,
  StoredDocumentSource,
  usableText,
  type PdfTextResult,
} from "../../../../supabase/functions/_shared/health/ai/textSource";
import { LIMITS } from "../../ai/types";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 fixture bytes");
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function source(
  files: Record<string, { mime: string; bytes: Uint8Array }>,
  pdf: (bytes: Uint8Array) => Promise<PdfTextResult>,
) {
  const asked: string[] = [];
  const src = new StoredDocumentSource({
    loadBytes: (id) => {
      asked.push(id);
      return Promise.resolve(files[id] ?? null);
    },
    pdfText: pdf,
  });
  return { src, asked };
}

const layer =
  (text: string, pages = 1, truncated = false) =>
  (_bytes: Uint8Array): Promise<PdfTextResult> =>
    Promise.resolve({ text, pages, truncated });

describe("usableText", () => {
  it("needs MIN_USABLE_TEXT_CHARS letters or digits, in any script", () => {
    expect(usableText("")).toBe(false);
    expect(usableText("   \n\t ")).toBe(false);
    expect(usableText("a".repeat(MIN_USABLE_TEXT_CHARS - 1))).toBe(false);
    expect(usableText("a".repeat(MIN_USABLE_TEXT_CHARS))).toBe(true);
    expect(usableText("HbA1c 5.4 % Haemoglobin 13.2 g/dL")).toBe(true);
    expect(usableText("हीमोग्लोबिन १३.२ ग्राम प्रति डेसीलीटर, एचबीए१सी ५.४")).toBe(true);
    // Punctuation and stray glyphs — what a scanned PDF's "text layer" holds — do not count.
    expect(usableText("- . , ; : ' \" ( ) [ ] { } | / \\ ~ ^ ` ! @ # $ % & * _ + = < > ?")).toBe(
      false,
    );
  });
});

describe("capText", () => {
  it("normalises line endings, trims, and cuts at the gateway's document ceiling with a flag", () => {
    expect(capText("a\r\nb\r\n c \t\n")).toEqual({ text: "a\nb\n c", truncated: false });
    const long = "x".repeat(LIMITS.MAX_DOCUMENT_CHARS + 5);
    const cut = capText(long);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBe(LIMITS.MAX_DOCUMENT_CHARS);
    expect(capText("short", 3)).toEqual({ text: "sho", truncated: true });
  });
});

describe("StoredDocumentSource", () => {
  it("a PDF with a text layer answers TEXT, method pdf_text, with its pages — and no bytes", async () => {
    const { src, asked } = source(
      { d1: { mime: "application/pdf", bytes: PDF_BYTES } },
      layer("HbA1c 5.4 %\nHaemoglobin 13.2 g/dL\nFasting glucose 92 mg/dL", 2),
    );
    const r = await src.read("d1");
    expect(r).toEqual({
      kind: "text",
      text: "HbA1c 5.4 %\nHaemoglobin 13.2 g/dL\nFasting glucose 92 mg/dL",
      method: "pdf_text",
      pages: 2,
      truncated: false,
    });
    expect(asked).toEqual(["d1"]);
  });

  it("a PDF whose text layer is empty or stray glyphs answers BYTES (a scan)", async () => {
    for (const text of ["", "   ", ". . . -", "ab"]) {
      const { src } = source({ d1: { mime: "application/pdf", bytes: PDF_BYTES } }, layer(text));
      const r = await src.read("d1");
      expect(r?.kind, JSON.stringify(text)).toBe("bytes");
      if (r?.kind === "bytes") {
        expect(r.mime).toBe("application/pdf");
        expect(r.bytes).toBe(PDF_BYTES);
      }
    }
  });

  it("a PDF the reader cannot open answers BYTES rather than an error: the transcription reads it as pages", async () => {
    const { src } = source({ d1: { mime: "application/pdf", bytes: PDF_BYTES } }, () =>
      Promise.reject(new Error("Invalid PDF structure")),
    );
    expect((await src.read("d1"))?.kind).toBe("bytes");
  });

  it("an image answers BYTES without asking the PDF reader", async () => {
    let pdfCalls = 0;
    const { src } = source({ d1: { mime: "image/png", bytes: PNG_BYTES } }, (b) => {
      pdfCalls++;
      return layer("never")(b);
    });
    const r = await src.read("d1");
    expect(r).toEqual({ kind: "bytes", mime: "image/png", bytes: PNG_BYTES });
    expect(pdfCalls).toBe(0);
  });

  it("nothing for an unknown id, an unsupported type, an empty file or one over the bucket's limit", async () => {
    const huge = new Uint8Array(MAX_READ_BYTES + 1);
    const { src } = source(
      {
        d2: { mime: "text/plain", bytes: PNG_BYTES },
        d3: { mime: "image/png", bytes: new Uint8Array(0) },
        d4: { mime: "image/jpeg", bytes: huge },
        d5: { mime: "image/svg+xml", bytes: PNG_BYTES },
      },
      layer("HbA1c 5.4 % Haemoglobin 13.2 g/dL Fasting glucose 92 mg/dL"),
    );
    for (const id of ["nope", "d2", "d3", "d4", "d5"]) expect(await src.read(id), id).toBeNull();
  });

  it("cuts a long text layer at the ceiling and carries the reader's own truncation flag", async () => {
    const long = "HbA1c 5.4 % ".repeat(3000);
    const { src } = source(
      { d1: { mime: "application/pdf", bytes: PDF_BYTES } },
      layer(long, 60, true),
    );
    const r = await src.read("d1");
    expect(r?.kind).toBe("text");
    if (r?.kind === "text") {
      expect(r.text.length).toBe(LIMITS.MAX_DOCUMENT_CHARS);
      expect(r.truncated).toBe(true);
      expect(r.pages).toBe(60);
    }
  });

  it("the null source answers nothing, and the stored source has the id the registry names", async () => {
    expect(await new NullTextSource().read("d1")).toBeNull();
    const { src } = source({}, layer(""));
    expect(src.id).toBe("document");
  });
});
