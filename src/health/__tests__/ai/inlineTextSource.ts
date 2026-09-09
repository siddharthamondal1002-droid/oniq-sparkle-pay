/**
 * TEST-ONLY. A text source the gateway tests inject through `deps.textSource`
 * so extraction and classification can be exercised end to end. It is never
 * registered in TEXT_SOURCE_REGISTRY and `wiring.test.ts` asserts that
 * health-ai/index.ts imports nothing from __tests__.
 *
 * Since Phase 3b the seam answers in kinds: a text (as a PDF's own layer
 * would) or bytes still to be transcribed. `InlineTextSource` answers text;
 * `InlineBytesSource` answers bytes, so the gateway's paid-step ordering can
 * be proven without a bucket.
 */
import type {
  DocumentRead,
  DocumentTextSource,
} from "../../../../supabase/functions/_shared/health/ai/textSource";
import type { TextSourceId } from "../../ai/types";

export class InlineTextSource implements DocumentTextSource {
  readonly id: TextSourceId = "null";
  constructor(private readonly texts: Record<string, string>) {}
  read(documentId: string): Promise<DocumentRead | null> {
    if (!Object.prototype.hasOwnProperty.call(this.texts, documentId)) return Promise.resolve(null);
    return Promise.resolve({
      kind: "text",
      text: this.texts[documentId],
      method: "pdf_text",
      pages: 1,
      truncated: false,
    });
  }
}

export class InlineBytesSource implements DocumentTextSource {
  readonly id: TextSourceId = "null";
  constructor(private readonly files: Record<string, { mime: string; bytes: Uint8Array }>) {}
  read(documentId: string): Promise<DocumentRead | null> {
    if (!Object.prototype.hasOwnProperty.call(this.files, documentId)) return Promise.resolve(null);
    const f = this.files[documentId];
    return Promise.resolve({ kind: "bytes", mime: f.mime, bytes: f.bytes });
  }
}
