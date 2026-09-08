/**
 * ONIQ HEALTH AI — where a document's text comes from. Phase 2: nowhere.
 *
 * Extraction and classification read text through this seam, and the seam
 * has exactly one registered source, which yields nothing. That is on
 * purpose: Phase 2 ships no OCR and no model that could read a PDF, so in
 * production `extract_document` answers `no_text` for everyone — and the
 * receipt and audit row for that refusal are what prove the pipeline ran.
 *
 * THE DEPLOYED REQUEST BODY CARRIES NO TEXT FIELD. The first draft let an
 * admin (or any caller outside production) paste text into the request; the
 * review (docs/health/05 §14) killed it because a paste-to-model field would
 * outlive Phase 2 and bypass the whole document pipeline — consent, mime and
 * size checks, the bucket's deletion story — the day a real provider exists.
 * The inline source used by the gateway tests lives under `__tests__/` and
 * `aiIsolation.test.ts` asserts `health-ai/index.ts` never imports one.
 */
import { TEXT_SOURCE_IDS, type TextSourceId } from "./types.ts";

export interface DocumentTextSource {
  readonly id: TextSourceId;
  /** The text of the document with this id, or null when the source has none. */
  text(documentId: string): Promise<string | null>;
}

export class NullTextSource implements DocumentTextSource {
  readonly id = "null" as const;
  text(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

export const TEXT_SOURCE_REGISTRY: Record<TextSourceId, () => DocumentTextSource> = {
  null: () => new NullTextSource(),
};

export function textSourceFor(id: unknown): DocumentTextSource {
  if (typeof id !== "string" || !(TEXT_SOURCE_IDS as readonly string[]).includes(id)) {
    return new NullTextSource();
  }
  return TEXT_SOURCE_REGISTRY[id as TextSourceId]();
}
