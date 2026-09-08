/**
 * TEST-ONLY. A text source the gateway tests inject through `deps.textSource`
 * so extraction and classification can be exercised end to end. It is never
 * registered in TEXT_SOURCE_REGISTRY and `aiIsolation.test.ts` asserts that
 * health-ai/index.ts imports nothing from __tests__.
 */
import type { DocumentTextSource } from "../../../../supabase/functions/_shared/health/ai/textSource";
import type { TextSourceId } from "../../ai/types";

export class InlineTextSource implements DocumentTextSource {
  readonly id: TextSourceId = "null";
  constructor(private readonly texts: Record<string, string>) {}
  text(documentId: string) {
    return Promise.resolve(
      Object.prototype.hasOwnProperty.call(this.texts, documentId) ? this.texts[documentId] : null,
    );
  }
}
