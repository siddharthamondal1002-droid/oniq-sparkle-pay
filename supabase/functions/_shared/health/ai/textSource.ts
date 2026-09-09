/**
 * ONIQ HEALTH AI — where a document's text comes from.
 *
 * Phase 2: nowhere. Extraction and classification read text through this
 * seam, and the seam had exactly one registered source, which yielded
 * nothing; in production `extract_document` answered `no_text` for everyone,
 * and the audit row for that refusal was what proved the pipeline ran.
 *
 * Phase 3b (owner directive 2026-09-09, "i want A, B and C all done"): the
 * seam reads the STORED document. `read()` answers in one of three ways, and
 * the gateway — not this file — decides what each costs:
 *
 *   kind "text"   the PDF's own text layer, read HERE with pdfText.ts. Nothing
 *                 left ONIQ; the gateway proceeds exactly as Phase 2 did.
 *   kind "bytes"  a photo, a scan, or a PDF with no usable text layer. The
 *                 file itself must be TRANSCRIBED by the registered provider,
 *                 which is a paid call and the one step where the document's
 *                 bytes leave ONIQ — so the gateway checks the caps and writes
 *                 the receipt BEFORE it asks, and this file never asks.
 *   null          no such document for this person, an unsupported type, or
 *                 nothing to read: `no_text`, free, audited.
 *
 * THE DEPLOYED REQUEST BODY STILL CARRIES NO TEXT FIELD. A document's text
 * reaches the gateway only through this seam, from the bucket, by the id the
 * Store already proved is the person's own. The test-only inline source lives
 * under `__tests__/` and `wiring.test.ts` asserts `health-ai/index.ts` never
 * imports one.
 *
 * WHAT COUNTS AS "USABLE" TEXT: MIN_USABLE_TEXT_CHARS letters or digits. A
 * scanned PDF's text layer is empty or a few stray glyphs; treating that as
 * text would extract nothing and charge nothing, and the person would read
 * "no readable text" for a report that plainly has some. Below the threshold
 * the file goes to transcription instead.
 */
import { LIMITS, type TextSourceId, type TextSourceMethod } from "./types.ts";

export type DocumentRead =
  | {
      kind: "text";
      text: string;
      method: TextSourceMethod;
      pages: number | null;
      truncated: boolean;
    }
  | { kind: "bytes"; mime: string; bytes: Uint8Array };

export interface DocumentTextSource {
  readonly id: TextSourceId;
  /** The document with this id, as text, as bytes still to be transcribed, or nothing. */
  read(documentId: string): Promise<DocumentRead | null>;
}

export class NullTextSource implements DocumentTextSource {
  readonly id = "null" as const;
  read(_documentId: string): Promise<DocumentRead | null> {
    return Promise.resolve(null);
  }
}

/** The zero-arity sources; "document" needs the bucket and the PDF reader, so it is built by name below. */
export const TEXT_SOURCE_REGISTRY: Record<"null", () => DocumentTextSource> = {
  null: () => new NullTextSource(),
};

export function textSourceFor(id: unknown): DocumentTextSource {
  if (id === "null") return TEXT_SOURCE_REGISTRY.null();
  return new NullTextSource();
}

/* ----------------------------------------------------- the stored document -- */

export type PdfTextResult = {
  text: string;
  pages: number;
  /** More pages than PDF_MAX_PAGES: the rest were not read. */
  truncated: boolean;
};

export type LoadedDocument = { bytes: Uint8Array; mime: string };

export type StoredDocumentDeps = {
  /** The bytes of the person's OWN document with this id, or null. The caller closes over the person. */
  loadBytes: (documentId: string) => Promise<LoadedDocument | null>;
  /** The PDF's text layer, read on ONIQ's side; throws on a file that is not a readable PDF. */
  pdfText: (bytes: Uint8Array) => Promise<PdfTextResult>;
};

export const PDF_MIME = "application/pdf";
export const TRANSCRIBABLE_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
/** Letters or digits a text layer must carry to count as the document's text. */
export const MIN_USABLE_TEXT_CHARS = 24;
/** The most bytes this seam will read; the bucket's own limit is the same number. */
export const MAX_READ_BYTES = 10 * 1024 * 1024;

export function usableText(text: string): boolean {
  let n = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch) && ++n >= MIN_USABLE_TEXT_CHARS) return true;
  }
  return false;
}

/** Cut at the gateway's document ceiling and say so — never refuse after reading. */
export function capText(text: string, max: number = LIMITS.MAX_DOCUMENT_CHARS) {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return clean.length > max
    ? { text: clean.slice(0, max), truncated: true }
    : { text: clean, truncated: false };
}

export class StoredDocumentSource implements DocumentTextSource {
  readonly id = "document" as const;
  constructor(private readonly deps: StoredDocumentDeps) {}

  async read(documentId: string): Promise<DocumentRead | null> {
    const loaded = await this.deps.loadBytes(documentId);
    if (!loaded) return null;
    if (!(TRANSCRIBABLE_MIMES as readonly string[]).includes(loaded.mime)) return null;
    if (loaded.bytes.byteLength === 0 || loaded.bytes.byteLength > MAX_READ_BYTES) return null;
    if (loaded.mime === PDF_MIME) {
      let layer: PdfTextResult | null = null;
      try {
        // A COPY: PDF.js transfers the buffer it is handed and leaves the
        // original detached (byteLength 0) — measured on Deno 2.9 — and the
        // same bytes must still be whole for a transcription below.
        layer = await this.deps.pdfText(loaded.bytes.slice());
      } catch {
        // A PDF the reader cannot open is still a document a person can see;
        // the transcription path reads it as an image, page by page.
        layer = null;
      }
      if (layer && usableText(layer.text)) {
        const cut = capText(layer.text);
        return {
          kind: "text",
          text: cut.text,
          method: "pdf_text",
          pages: layer.pages,
          truncated: cut.truncated || layer.truncated,
        };
      }
    }
    return { kind: "bytes", mime: loaded.mime, bytes: loaded.bytes };
  }
}
