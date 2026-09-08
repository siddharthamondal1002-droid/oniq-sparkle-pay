/**
 * ONIQ HEALTH — the words a screen puts next to a record. Client-only.
 *
 * Every label resolves through the `health.*` overlay, so all three languages
 * are served, and an unknown provenance source is labelled as AI-generated —
 * over-label, never under-label.
 */
import { DOCUMENT_KINDS, PROVENANCE_SOURCES, RECORD_KINDS, isAiDerived } from "./domain";

type T = (key: string, fallback?: string) => string;

/**
 * THE LABEL ON EVERY HEALTH AI SURFACE (owner directive 2026-09-08, B12):
 * "AI-assisted" — clear, not alarming, and claiming no clinical authority.
 * The health screens render this, through `health.ai.label`, in place of the
 * app-wide AI_OUTPUT_LABEL; playCompliance.test.ts knows the override. Never
 * "AI Doctor", "Medical AI" or "Diagnosis" — surfaces.test.ts bans them.
 */
export const HEALTH_AI_LABEL = "AI-assisted";

/**
 * The disclosure under every AI ANSWER, by the same directive. The gateway
 * names it (`AI_DISCLAIMER_KEY` = `health.ai.disclosure`, three languages in
 * i18n.ts); the Health shell's general footer (`health.disclaimer`) is a
 * different sentence, because a timeline of the person's own entries is not
 * AI-assisted information.
 */
export const HEALTH_AI_DISCLOSURE =
  "AI-assisted information — check your medical records and a qualified healthcare professional for medical decisions.";

export function kindLabel(t: T, kind: string): string {
  if ((RECORD_KINDS as readonly string[]).includes(kind)) return t(`health.kind.${kind}`, kind);
  return kind;
}

export function documentKindLabel(t: T, kind: string): string {
  if ((DOCUMENT_KINDS as readonly string[]).includes(kind)) return t(`health.doc.${kind}`, kind);
  return kind;
}

export function provenanceLabel(t: T, source: string | null | undefined): string {
  if (source && (PROVENANCE_SOURCES as readonly string[]).includes(source)) {
    return t(`health.provenance.${source}`, source);
  }
  return t("health.provenance.unknown", "AI-generated (source unknown)");
}

/** A server reason code, in the person's language, falling back to the English sentence. */
export function reasonText(t: T, err: { reason: string; message: string }): string {
  return t(`health.reason.${err.reason}`, err.message);
}

/** True when the row needs the AI treatment in the UI. */
export function needsAiLabel(source: string | null | undefined): boolean {
  return isAiDerived(source);
}

const LOCALE_FOR: Record<string, string> = { en: "en-IN", hi: "hi-IN", bn: "bn-IN" };

export function formatDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(LOCALE_FOR[lang] ?? "en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatValue(
  valueNum: number | null | undefined,
  valueUnit: string | null | undefined,
  valueText: string | null | undefined,
): string {
  if (valueNum !== null && valueNum !== undefined) {
    return valueUnit ? `${valueNum} ${valueUnit}` : String(valueNum);
  }
  return valueText ?? "";
}

/** The ISO instant for "today at noon" — a date input's value, made timezone-safe. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
